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

summary('Enemy jump tests');
