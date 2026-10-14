/**
 * 敌人「跳起」行动回归 — 纯函数，无 CDN、无文件 I/O。合成单位 + initBattle / tick。
 *
 * 规则（射击场 BIGARMS 实测，dev/game-data.md）：跳起固定 1.85s
 *   [0, 1s)     起跳 JUMP：全队停止攻击，已打出的技能（延迟命中）仍可命中
 *   [1s, 1.85s) 空中 / 落地 HIDDEN：完全不可攻击，延迟命中落空记为「未命中」
 *   1.85s       落地到目标距离，全队恢复攻击
 *
 * Covers:
 *   J1 — 跳起 0–1.85s 内无普通射击，落地后恢复
 *   J2 — 起跳段到期的延迟命中正常结算；空中段到期的落空（damage 0、missed）
 *   J3 — 落地后敌人距离为目标距离
 *
 * Run: node scripts/tests/test-enemy-jump.mjs
 */

import { initBattle, tick } from '../../src/engine/battle.js';
import { BURST_GAUGE_MAX } from '../../src/engine/constants.js';
import { buildEnemyPhases } from '../../src/ui/enemy-config-io.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

const TICK_RATE = 60;
const JUMP_AT   = 2;                       // 2s 起跳
const JUMP_TICK = JUMP_AT * TICK_RATE;     // 120
const AIR_TICK  = JUMP_TICK + 60;          // 180：进入空中段
const LAND_TICK = Math.round((JUMP_AT + 1.85) * TICK_RATE); // 231：落地

const phases = buildEnemyPhases([
  { startTimeS: 0,       type: 'position', value: 30 },
  { startTimeS: JUMP_AT, type: 'jump',     value: 50 },
], TICK_RATE);

const ENEMY = { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', hasCore: false, phases };

const SMG = {
  characterId:              94001,
  name:                     'Jump-Test-SMG',
  element:                  'Iron',
  weaponType:               'SMG',
  burstStep:                'Step3',
  _nikkeData:               { shot_detail: {} },
  _computedStats:           { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 },
  targetBurstEnergyPerShot: 100,
  burstEnergyPerShot:       100,
  burstSkillCooltime:       0,
  coreDmgIncrement:         0,
  fullChargeDamage:         10000,
  reloadFraction:           1.0,
  shotDamageMult:           0.05,
  rateOfFire:               1440,
  baseAmmo:                 1000,
  reloadTicks:              60,
};

const state = initBattle({ squad: [SMG], enemy: ENEMY, hitLog: true });
const caster = state.squad[0];
// 两条延迟技能命中：起跳段（150）到期 → 命中；空中段（200）到期 → 落空
state.pendingSkillHits.push({ fireTick: 150, caster, mult: 1, label: 'Jump-Test JUMP-hit', opts: {} });
state.pendingSkillHits.push({ fireTick: 200, caster, mult: 1, label: 'Jump-Test AIR-hit',  opts: {} });

let distAtLanding = null;
for (let t = 0; t < LAND_TICK + 60; t++) {
  tick(state);
  if (state.tick === LAND_TICK) distAtLanding = state.enemyDistance;
}

const shots = state.hitLog.filter(h => h.ammoBeforeShot !== undefined).map(h => h.tick);

section('J1 — 跳起期间停火，落地后恢复');
{
  eq('起跳前有射击', shots.some(t => t < JUMP_TICK), true);
  eq('跳起 0–1.85s 内无普通射击', shots.filter(t => t >= JUMP_TICK && t < LAND_TICK).length, 0);
  eq('落地后恢复射击', shots.some(t => t >= LAND_TICK), true);
}

section('J2 — 延迟技能命中：起跳段命中，空中段落空');
{
  const jumpHit = state.hitLog.find(h => h.label === 'Jump-Test JUMP-hit');
  const airHit  = state.hitLog.find(h => h.label === 'Jump-Test AIR-hit');
  eq('起跳段（150t）到期 → 有伤害', jumpHit?.damage > 0, true);
  eq('起跳段命中未标记 missed', !!jumpHit?.missed, false);
  eq('空中段（200t）到期 → 伤害 0', airHit?.damage, 0);
  eq('空中段命中标记 missed', airHit?.missed, true);
}

section('J3 — 落地距离');
{
  eq('落地后距离 = 50', distAtLanding, 50);
  eq('起跳 / 空中区段依次出现', phases.map(p => p.zone).join(','), '30,JUMP,HIDDEN,50');
  eq('空中段起点 tick', phases.find(p => p.zone === 'HIDDEN')?.startTick, AIR_TICK);
}

// J4：自动战斗实测——敌人跳起 / 隐藏期间不自动施放爆裂，落地后才继续（Raven 队 BIGARMS 实测）。
//   模拟选项 burstDuringHidden=true 时按手动操作，隐藏期间照常施放。
//   起跳 tick 将爆裂槽置满：槽满 → B1 延迟（0.4s）在跳起区段内到期。
function runBurstJump(burstDuringHidden) {
  const squad = ['Step1', 'Step2', 'Step3'].map((burstStep, i) => ({
    ...SMG, characterId: 94010 + i, name: `Jump-Burst-${burstStep}`, burstStep,
    targetBurstEnergyPerShot: 0, burstEnergyPerShot: 0,
  }));
  const s = initBattle({ squad, enemy: ENEMY, burstDuringHidden });
  const casts = [];
  for (let t = 0; t < LAND_TICK + 120; t++) {
    if (s.tick === JUMP_TICK) s.burstGauge = BURST_GAUGE_MAX;
    const { events } = tick(s);
    for (const e of events) {
      if (['burst_i', 'burst_ii', 'burst_iii', 'full_burst'].includes(e.type)) casts.push({ type: e.type, tick: e.tick });
    }
  }
  return casts;
}

section('J4 — 跳起期间不自动施放爆裂（选项 burstDuringHidden）');
{
  const auto = runBurstJump(false);
  eq('默认：跳起区段内无爆裂施放', auto.filter(c => c.tick < LAND_TICK).length, 0);
  eq('默认：落地 tick 施放 B1', auto.find(c => c.type === 'burst_i')?.tick, LAND_TICK);
  eq('默认：落地后完成全爆裂', auto.some(c => c.type === 'full_burst'), true);

  const manual = runBurstJump(true);
  eq('勾选：B1 在跳起区段内施放', (manual.find(c => c.type === 'burst_i')?.tick ?? Infinity) < LAND_TICK, true);
  eq('勾选：全爆裂在落地前进入', (manual.find(c => c.type === 'full_burst')?.tick ?? Infinity) < LAND_TICK, true);
}

// J5：出停火区段后蓄力武器首发 = 落地 + spot_last 后摇 + 前摇 + 蓄力（不取 maintain_fire_stance）。
//   Raven 实测（BIGARMS）：落地 → 首发 84–87t ≈ 12 + 12 + 58 = 82t，而非 50 + 12 + 58 = 120t。
function runRlJump(extra) {
  const rl = {
    ...SMG, characterId: 94020, name: 'Jump-Test-RL', weaponType: 'RL',
    rateOfFire: 60, baseAmmo: 1000, reloadTicks: 120, fullChargeDamage: 25000,
    chargeTimeTicks: 58, foreswingTicks: 12, backswingTicks: 50, ...extra,
  };
  const s = initBattle({ squad: [rl], enemy: ENEMY, hitLog: true });
  for (let t = 0; t < LAND_TICK + 200; t++) tick(s);
  return s.hitLog.filter(h => h.ammoBeforeShot !== undefined).map(h => h.tick);
}

section('J5 — 落地后蓄力武器首发：后摇取 spot_last_delay');
{
  const withSpotLast = runRlJump({ spotLastTicks: 12 });
  eq('后摇 50 / spot_last 12：落地 + 82t 首发', withSpotLast.find(t => t >= LAND_TICK), LAND_TICK + 82);
  const noSpotLast = runRlJump({});
  eq('未提供 spotLastTicks：回退 backswingTicks（落地 + 120t）', noSpotLast.find(t => t >= LAND_TICK), LAND_TICK + 120);
}

summary('Enemy jump tests');
