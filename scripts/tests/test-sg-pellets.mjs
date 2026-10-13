/**
 * SG 弹丸 — 爆裂充能与弹丸命中回归（§4.6 / §6.1）。
 * Pure: 无 CDN、无文件 I/O。合成单位 + initBattle / tick。
 *
 * 规则：整发充能 = target_burst_energy_pershot × 基础 shot_count，为【全部弹丸命中】时的充能；
 *   弹丸数 ▲ / 「弹丸数固定为 N」不改变整发充能，每颗弹丸充能 = 整发充能 / 发射弹丸数（动态）；
 *   本次射击充能 = 整发充能 × 命中弹丸数 / 发射弹丸数。
 *
 * Covers:
 *   P1 — 基础 10 弹丸全部命中：整发充能 = 100 × 10
 *   P2 — 弹丸数 ▲5（15 颗）：整发充能不变
 *   P3 — 弹丸数固定为 1：整发充能不变
 *   P4 — 弹丸全部打空（sgHitRate 0、参考距离 50）：充能 0、伤害 0
 *   P5 — 命中率 ▲ 收圆：单弹丸（固定为 1）几乎不再打空
 *   P6 — 逐弹丸独立判定暴击 / 核心，按（暴击, 核心）分为至多 4 类
 *   P7 — SG 命中行分类明细：分类伤害之和 = 整发伤害，每弹丸系数 = 整发系数 ÷ 发射弹丸数
 *
 * Run: node scripts/tests/test-sg-pellets.mjs
 */

import { initBattle, tick } from '../../src/engine/battle.js';
import { setRng } from '../../src/engine/rng.js';
import { rollPelletGroups } from '../../src/engine/battle-utils.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

const ENEMY = { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', hasCore: false, distance: 50 };

let _nextId = 92000;

/** 合成 SG 单位：10 弹丸、每弹丸 target 100 → 整发 1000。 */
function sgUnit(overrides = {}) {
  return {
    characterId:              _nextId++,
    name:                     'SG-Pellet-Test',
    element:                  'Iron',
    weaponType:               'SG',
    burstStep:                'Step3',
    _nikkeData:               {},
    _computedStats:           { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 },
    targetBurstEnergyPerShot: 100,
    burstEnergyPerShot:       100,
    burstSkillCooltime:       0,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    shotDamageMult:           1.0,
    shotCount:                10,
    rateOfFire:               90,
    baseAmmo:                 9,
    reloadTicks:              120,
    ...overrides,
  };
}

/**
 * 跑到首发命中，返回首发命中行（充能增量 = gaugeAfter，开局槽为 0）。
 * @param {object} buff  推入的测试 buff 字段（pelletFlat / pelletFixed / hitRatePct）
 * @param {object} enemy 敌人覆盖（sgHitRate 等）
 */
function firstShot(buff = null, enemy = {}) {
  const state = initBattle({ squad: [sgUnit()], enemy: { ...ENEMY, ...enemy }, hitLog: true });
  const u = state.squad[0];
  if (buff) state.buffs.push({ name: 'Pellet Test', unitId: u.id, endTick: Infinity, ...buff });
  for (let t = 0; t < 60 && !state.hitLog.some(h => h.label === 'normal_shot'); t++) tick(state);
  return state.hitLog.find(h => h.label === 'normal_shot');
}

section('P1–P3 — 弹丸数变化不改变整发充能');
{
  eq('基础 10 弹丸全部命中 → 1000', firstShot()?.gaugeAfter, 1000);
  eq('弹丸数 ▲5（15 颗）→ 仍为 1000', firstShot({ pelletFlat: 5 })?.gaugeAfter, 1000);
  eq('弹丸数固定为 1 → 仍为 1000', firstShot({ pelletFixed: 1 })?.gaugeAfter, 1000);
}

section('P4 — 弹丸全部打空：充能与伤害均为 0');
{
  const h = firstShot(null, { sgHitRate: 0 });
  eq('充能 0', h?.gaugeAfter, 0);
  eq('伤害 0', h?.damage, 0);
}

section('P5 — 命中率 ▲ 收圆：单弹丸打空率按有效散布缩放');
{
  // sgHitRate 0.7 @ d=50，散布按标定 250：HR 0 → 命中率 0.7；HR 100% → 1 − 0.3/5.5 ≈ 0.945
  setRng(() => 0.9);
  eq('HR 0、rng 0.9 → 单弹丸打空，充能 0', firstShot({ pelletFixed: 1 }, { sgHitRate: 0.7 })?.gaugeAfter, 0);
  eq('HR 100%、rng 0.9 → 单弹丸命中，整发充能 1000',
    firstShot({ pelletFixed: 1, hitRatePct: 1 }, { sgHitRate: 0.7 })?.gaugeAfter, 1000);
  setRng(null);
}

section('P6 — 逐弹丸暴击 / 核心分类（rollPelletGroups）');
{
  // 暴击率 0.5：rng 依次 0.1（暴击）/ 0.9（不暴击）交替；核心按脚本 [T, F, F, T, ...] 循环
  const seq = [0.1, 0.9];
  let i = 0;
  setRng(() => seq[i++ % 2]);
  const coreSeq = [true, false, false, true];
  let j = 0;
  const groups = rollPelletGroups(8, 0.5, () => coreSeq[j++ % 4]);
  setRng(null);
  // 弹丸 1..8：(暴,核)(非,非)(暴,非)(非,核) × 2 → 每类 2 颗，顺序：普通、仅暴击、仅核心、暴击+核心
  eq('四类齐全', groups.map(g => `${+g.isCrit}${+g.isCore}:${g.count}`).join(' '), '00:2 10:2 01:2 11:2');
  eq('弹丸数 0 的类不返回', rollPelletGroups(3, 0, () => false).length, 1);
  eq('命中 0 颗 → 空数组', rollPelletGroups(0, 1, () => true).length, 0);
}

section('P7 — SG 命中行：分类伤害之和 = 整发伤害，每弹丸系数 = 整发系数 ÷ 发射弹丸数');
{
  const state = initBattle({ squad: [sgUnit({ _computedStats: { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0.5, critDmg: 0.5 } })],
    enemy: { ...ENEMY, sgHitRate: 1 }, hitLog: true });
  for (let t = 0; t < 60 && !state.hitLog.some(h => h.label === 'normal_shot'); t++) tick(state);
  const h = state.hitLog.find(h => h.label === 'normal_shot');
  const groups = h?.pelletGroups ?? [];
  eq('分类弹丸数合计 = 10', groups.reduce((n, g) => n + g.count, 0), 10);
  eq('分类伤害之和 = 整发伤害', groups.reduce((n, g) => n + g.damage, 0), h?.damage);
  eq('每弹丸系数 = 1.0 / 10', h?.pelletHitMult, 0.1);
  eq('整发 isCrit = 存在暴击类', h?.isCrit, groups.some(g => g.isCrit));
}

summary('SG pellet charge / hit tests');
