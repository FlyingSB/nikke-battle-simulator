/**
 * 魔方技能建模回归测试（纯本地：读取 src/data/static/cubes/*.json，无网络）。
 *
 * 建模范围：
 *   · 通用 Anti Code HC（优越代码伤害）      → stats.elementDmgPct
 *   · Adjutant 蓄力速度 / Resilience 换弹速度 → stats.chargeSpeedPct / reloadSpeedPct
 *   · Vigor / Destruction / Piercing / Rupture / Diffusion 主技能
 *                                              → stats.cubeBuffPcts → initBattle 永久「Cube」buff
 *   · 其余魔方主技能（命中率、蓄力伤害、弹匣、爆裂充能、防御、减伤、治疗、
 *     掩体 HP、濒危 Max HP）不建模
 *
 * 测试编号：
 *   CB1  五种主技能在 Lv15 时写入 cubeBuffPcts 的字段与数值
 *   CB2  不建模的魔方（Assist 濒危 Max HP / Stealth 掩体 HP / Onslaught 等）cubeBuffPcts 为空
 *   CB3  新魔方（Stealth / Diffusion）Anti Code 仍计入 elementDmgPct
 *   CB4  initBattle 将 cubeBuffPcts 推入永久 buff，getBuffSums 可读取
 *
 * Run: node scripts/tests/test-cubes.mjs
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { computeFinalStats } from '../../src/engine/stats.js';
import { initBattle } from '../../src/engine/battle.js';
import { getBuffSums } from '../../src/engine/battle-utils.js';
import { normalizeCube } from '../../src/data/models.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CUBE_DIR  = join(__dirname, '../../src/data/static/cubes');
const CUBE_LV   = 15;

function loadCube(rid) {
  return JSON.parse(readFileSync(join(CUBE_DIR, `${rid}.json`), 'utf8'));
}

/** 取魔方第 si 个技能在 CUBE_LV 下的数值（小数）。 */
function cubeSkillVal(raw, si) {
  const c  = normalizeCube(raw);
  const lv = c.levels[si][CUBE_LV - 1];
  return parseFloat(c.skills[si].description_value_list[0].description_value[lv - 1]) / 100;
}

function statsWithCube(rid) {
  const raw = loadCube(rid);
  return { raw, stats: computeFinalStats(
    { classType: 'Attacker', corporation: 'ELYSION', cube: { resourceId: rid, level: CUBE_LV }, _cubeData: raw }, 1, {}) };
}

// ── CB1 ───────────────────────────────────────────────────────────────────────
section('CB1: 五种主技能 → cubeBuffPcts');
const MODELED = [
  [13001, 'Vigor',       'maxHpPct'],
  [10007, 'Destruction', 'damageToPartsPct'],
  [10008, 'Piercing',    'pierceDamagePct'],
  [10010, 'Rupture',     'trueDamagePct'],
  [10013, 'Diffusion',   'distributedDamagePct'],
];
for (const [rid, name, field] of MODELED) {
  const { raw, stats } = statsWithCube(rid);
  eq(`${name} 仅写入 ${field}`, Object.keys(stats.cubeBuffPcts).join(','), field);
  near(`${name} ${field} = Lv${CUBE_LV} 技能值`, stats.cubeBuffPcts[field], cubeSkillVal(raw, 0), 1e-9);
}

// ── CB2 ───────────────────────────────────────────────────────────────────────
section('CB2: 不建模的魔方 cubeBuffPcts 为空');
for (const [rid, name] of [[10009, 'Assist'], [10012, 'Stealth'], [10002, 'Onslaught'],
                           [10006, 'Wingman'], [12002, 'Tempering'], [10003, 'Resilience']]) {
  eq(`${name} 无永久 buff`, Object.keys(statsWithCube(rid).stats.cubeBuffPcts).length, 0);
}

// ── CB3 ───────────────────────────────────────────────────────────────────────
section('CB3: 新魔方 Anti Code 计入 elementDmgPct');
for (const [rid, name] of [[10012, 'Stealth'], [10013, 'Diffusion']]) {
  const { raw, stats } = statsWithCube(rid);
  near(`${name} elementDmgPct`, stats.elementDmgPct, cubeSkillVal(raw, 1), 1e-9);
}

// ── CB4 ───────────────────────────────────────────────────────────────────────
section('CB4: initBattle 推入永久 Cube buff');
{
  let id = 93000;
  const unit = (cubeBuffPcts) => ({
    characterId: id++, name: `Dummy-${id}`, element: 'Iron', weaponType: 'SR',
    burstStep: 'Step1', nativeBurstStep: 'Step1',
    _nikkeData: { shot_detail: { reload_bullet: 10000 } },
    _computedStats: { atk: 10_000, hp: 1_000_000, def: 500, critRate: 0, critDmg: 0.5, cubeBuffPcts },
    targetBurstEnergyPerShot: 0, burstEnergyPerShot: 0, burstSkillCooltime: 0,
    baseAmmo: 6, reloadTicks: 120, shotDamageMult: 1.0, coreDmgIncrement: 0,
    fullChargeDamage: 10000, reloadFraction: 1.0, rateOfFire: 60,
  });
  const state = initBattle({ squad: [
    unit({ trueDamagePct: 0.2, distributedDamagePct: 0.3 }),
    unit({ maxHpPct: 0.1 }),
    unit(undefined),   // 合成 stats 无 cubeBuffPcts 字段：不推 buff、不报错
  ], enemy: { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', distance: 'NEAR', hasCore: false } });
  const [a, b, c] = state.squad;
  const sa = getBuffSums(state, a.id);
  near('A trueDamagePct',        sa.trueDamagePct,        0.2, 1e-9);
  near('A distributedDamagePct', sa.distributedDamagePct, 0.3, 1e-9);
  near('A maxHpPct（不串到他人）',  sa.maxHpPct,             0,   1e-9);
  near('B maxHpPct',             getBuffSums(state, b.id).maxHpPct, 0.1, 1e-9);
  eq('C 无 Cube buff', state.buffs.some(x => x.name === 'Cube' && x.unitId === c.id), false);
  eq('Cube buff 永久', state.buffs.filter(x => x.name === 'Cube').every(x => x.endTick === Infinity), true);
}

// ── CB5 ───────────────────────────────────────────────────────────────────────
section('CB5: 魔方 buff 名取魔方技能原名（stats.cubeBuffs）');
{
  const state = initBattle({ squad: [{
    characterId: 93100, name: 'Dummy-CB5', element: 'Iron', weaponType: 'SR',
    burstStep: 'Step1', nativeBurstStep: 'Step1',
    _nikkeData: { shot_detail: { reload_bullet: 10000 } },
    _computedStats: {
      atk: 10_000, hp: 1_000_000, def: 500, critRate: 0, critDmg: 0.5,
      reloadSpeedPct: 0.25, cubeBuffPcts: { trueDamagePct: 0.2 },
      cubeBuffs: [
        { name: 'Quick Reload HC',   reloadSpeedPct: 0.25 },
        { name: 'True Damage Up HC', trueDamagePct:  0.2  },
      ],
    },
    targetBurstEnergyPerShot: 0, burstEnergyPerShot: 0, burstSkillCooltime: 0,
    baseAmmo: 6, reloadTicks: 120, shotDamageMult: 1.0, coreDmgIncrement: 0,
    fullChargeDamage: 10000, reloadFraction: 1.0, rateOfFire: 60,
  }], enemy: { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', distance: 'NEAR', hasCore: false } });
  const u = state.squad[0];
  const names = state.buffs.filter(b => b.unitId === u.id && b.endTick === Infinity).map(b => b.name);
  eq('Quick Reload HC 已推入',   names.includes('Quick Reload HC'), true);
  eq('True Damage Up HC 已推入', names.includes('True Damage Up HC'), true);
  eq('不再推入合计 buff（Cube / Cube Reload）', names.some(n => n === 'Cube' || n === 'Cube Reload'), false);
  const sums = getBuffSums(state, u.id);
  near('换弹速度合计不变', sums.reloadSpeedPct, 0.25, 1e-9);
  near('真实伤害合计不变', sums.trueDamagePct,  0.2,  1e-9);
}

summary('魔方技能建模');
