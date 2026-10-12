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
 *
 * Run: node scripts/tests/test-sg-pellets.mjs
 */

import { initBattle, tick } from '../../src/engine/battle.js';
import { setRng } from '../../src/engine/rng.js';
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

summary('SG pellet charge / hit tests');
