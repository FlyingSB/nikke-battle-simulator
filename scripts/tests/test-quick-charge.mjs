/**
 * 速充回归 — Focus 的 UP 型 SR/RL 手动打法（config.quickChargeMode）。
 * Pure: 无 CDN、无文件 I/O。合成单位 + simulate()。
 *
 * 速充：按 Alice 快速攻击节奏（蓄力 13 帧 + 空闲 2 帧、规避前后摇）连发短蓄力攻击。仍算蓄力攻击，
 * 蓄力比例 r = min(1, 13 / 有效蓄力帧数)，蓄力伤害倍率与 Focus 全蓄力充能倍率按 r 线性插值；
 * 全爆裂结束前预留「换弹 + 前摇 + 全蓄力」手动换弹，全蓄力发恰好在全爆裂结束 tick 打出。
 *
 * Covers:
 *   Q1 — off：行为不变（首发 = 前摇 + 蓄力）
 *   Q2 — always：开局 15t 一发、蓄力倍率与充能按 13/60 插值；打空后常规换弹，换弹完成 + 15t 续发
 *   Q2b — 有效蓄力 ≤ 13 帧：速充发即满蓄
 *   Q3 — always：全爆裂收尾（手动换弹 → 前摇 + 全蓄力 → 全爆裂结束 tick 打出，全蓄力充能），之后继续速充
 *   Q4 — untilFull：槽满后（爆裂阶段 / 全爆裂）全蓄力攻击，收尾后恢复速充
 *   Q5 — DOWN_Charge 型 / 非 Focus 不启用速充
 *
 * Run: node scripts/tests/test-quick-charge.mjs
 */

import { simulate } from '../../src/engine/battle.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

const ENEMY = { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', hasCore: false, distance: 'NEAR' };

const STATS = { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 };
let _nextId = 92000;

/** 合成单位公共字段。 */
function baseUnit(overrides) {
  return {
    characterId: _nextId++, name: `QC-${_nextId}`, element: 'Iron', burstStep: 'Step3',
    _nikkeData: {}, _computedStats: STATS, burstSkillCooltime: 0, coreDmgIncrement: 0,
    fullChargeDamage: 10000, reloadFraction: 1.0, shotDamageMult: 1.0,
    targetBurstEnergyPerShot: 0, burstEnergyPerShot: 0,
    ...overrides,
  };
}

/** Focus UP 型 SR：前摇 12、后摇 12、蓄力 60，装填 120；速充发充能 1 万（100 发充满），全蓄力 ×3。 */
function focusSr(overrides = {}) {
  return baseUnit({
    weaponType: 'SR', rateOfFire: 60, baseAmmo: 1000, reloadTicks: 120,
    chargeTimeTicks: 60, foreswingTicks: 12, backswingTicks: 12,
    fullChargeDamage: 25000, fullChargeBurstEnergy: 30000, targetBurstEnergyPerShot: 10_000,
    isFocus: true, ...overrides,
  });
}

/** 不充能的 B1 / B2 陪练（AR）。 */
const filler = step => baseUnit({ weaponType: 'AR', rateOfFire: 600, baseAmmo: 999, reloadTicks: 60, burstStep: step });

const round3 = x => Math.round(x * 1000) / 1000;
const isQuick = s => s.chargeRatio != null && s.chargeRatio < 1;

/** 运行并返回 Focus 单位的射击记录与战斗日志。 */
function run(sr, quickChargeMode, squadExtra = [filler('Step1'), filler('Step2')]) {
  const r = simulate({ squad: [...squadExtra, sr], enemy: ENEMY, hitLog: true, quickChargeMode, duration: 60 });
  const shots = r.hitLog.filter(h => h.unitId === sr.characterId && h.label === 'normal_shot');
  return { shots, log: r.log };
}

section('Q1 — off：行为不变');
{
  const { shots } = run(focusSr(), 'off');
  eq('首发 @72（前摇 12 + 蓄力 60）', shots[0].tick, 72);
  eq('首发为全蓄力（蓄力倍率 2.5）', shots[0].chargeMult, 2.5);
}

section('Q2 — always：开局速充节奏与换弹');
{
  const { shots } = run(focusSr({ baseAmmo: 10 }), 'always');
  eq('前 10 发每 15t 一发', shots.slice(0, 10).map(s => s.tick).join(','),
     Array.from({ length: 10 }, (_, i) => (i + 1) * 15).join(','));
  eq('速充发蓄力比例 = 13/60', shots.slice(0, 10).every(s => s.chargeRatio === 13 / 60), true);
  eq('蓄力倍率插值 = 1 + 1.5 × 13/60 = 1.325', round3(shots[0].chargeMult), 1.325);
  eq('充能插值 = round(1 万 × (1 + 2 × 13/60)) = 14333', shots[1].gaugeAfter - shots[0].gaugeAfter, 14_333);
  // 第 10 发 @150 打空 → 151 起换弹 120t → 271 完成 → +15t 续发
  eq('换弹后首发 @286（换弹完成 + 15t）', shots[10].tick, 286);
}

section('Q2b — 有效蓄力 ≤ 13 帧：速充发即满蓄');
{
  // 蓄速 +80% → 有效蓄力 12 帧 ≤ 13
  const { shots } = run(focusSr({ _computedStats: { ...STATS, chargeSpeedPct: 0.8 } }), 'always');
  eq('首发 @15 满蓄（无 chargeRatio、倍率 2.5）',
     shots[0].tick === 15 && shots[0].chargeRatio === undefined && shots[0].chargeMult === 2.5, true);
  eq('满蓄充能 3 万', shots[0].gaugeAfter, 30_000);
}

section('Q3 — always：全爆裂收尾全蓄力在全爆裂结束 tick 打出');
{
  const { shots, log } = run(focusSr(), 'always');
  const fbEnd  = log.find(e => e.type === 'burst_end').tick;
  const fbFrom = log.find(e => e.type === 'full_burst').tick;
  const fin    = shots.find(s => s.tick === fbEnd);
  eq('全爆裂期间速充（未蓄满）',
     shots.filter(s => s.tick > fbFrom && s.tick < fbEnd - 192).every(isQuick), true);
  // 收尾：F − (换弹 120 + 前摇 12 + 蓄力 60) 开始手动换弹 → F − 72 换弹完成 → F 打出
  eq('收尾手动换弹在全爆裂结束前 72t 完成',
     log.some(e => e.type === 'reload' && e.tick === fbEnd - 72), true);
  eq('收尾期间不再开火', shots.some(s => s.tick > fbEnd - 192 && s.tick < fbEnd), false);
  eq('全爆裂结束 tick 打出全蓄力', fin?.chargeMult, 2.5);
  eq('收尾发全蓄力充能 3 万计入下一轮', fin?.gaugeAfter, 30_000);
  const next = shots.find(s => s.tick > fbEnd);
  eq('之后继续速充（+15t、未蓄满）', next?.tick === fbEnd + 15 && isQuick(next), true);
}

section('Q4 — untilFull：槽满后恢复全蓄力，收尾后恢复速充');
{
  const { shots, log } = run(focusSr(), 'untilFull');
  const full   = log.find(e => e.type === 'burst_i').tick;
  const fbEnd  = log.find(e => e.type === 'burst_end').tick;
  eq('槽满前为速充', shots.filter(s => s.tick < full - 15).every(isQuick), true);
  eq('爆裂阶段 / 全爆裂期间为全蓄力',
     shots.filter(s => s.tick > full + 15 && s.tick <= fbEnd).every(s => s.chargeMult === 2.5), true);
  eq('全爆裂结束 tick 打出全蓄力', shots.find(s => s.tick === fbEnd)?.chargeMult, 2.5);
  eq('之后恢复速充', isQuick(shots.find(s => s.tick > fbEnd)), true);
}

section('Q5 — DOWN_Charge 型 / 非 Focus 不启用速充');
{
  const down = run(focusSr({ isDownCharge: true }), 'always').shots;
  eq('DOWN_Charge 首发仍为全蓄力', down[0].chargeMult, 2.5);
  const nonFocus = run(focusSr({ isFocus: false }), 'always').shots;
  eq('非 Focus 首发 @72 全蓄力', nonFocus[0].tick === 72 && nonFocus[0].chargeMult === 2.5, true);
}

summary('速充回归（Focus UP 型 SR/RL 手动打法）');
