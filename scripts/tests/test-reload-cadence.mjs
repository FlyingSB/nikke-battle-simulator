/**
 * 换弹节奏回归 — 换弹与射击间隔并行消化（§4.4 / §5.2）。
 * Pure: 无 CDN、无文件 I/O。合成单位 + simulate()。
 *
 * 实测校准（2026-07-17）：Anis: Sparkling Summer（SG 90 RPM）换弹速度总和 >100%
 * （瞬间装填）+ 爆裂弹匣 1 发时，爆裂 9s 内攻击 14 次 = 精确 40t RPM 节奏。
 * 修复前引擎"换弹完成即补射"跑出每 13t 一发（9s 内 28–31 次，快约 3 倍）。
 *
 * Covers:
 *   C1 — 瞬间装填（换弹速度 ≥100%）+ 弹匣 1 发：节奏受 RPM 下限约束，40t 一发，9s = 14 发
 *   C2 — 慢换弹（无换弹速度加成）：换弹完成第一发立即击发（旧行为保持不变）
 *   C3 — AR 常规弹匣：换弹完成 tick 即刻补射（旧行为保持不变）
 *   C4 — 蓄力武器（UP 型 SR）：开局首发与换弹后首发均应用装备/魔方蓄速
 *   C5 — UP 型蓄力武器装填 0t：每发射击当 tick 补满，弹匣始终满（§4.3.9）
 *   C6 — UP 型蓄力武器装填 ≤ 后摇：后摇内补满，弹匣始终满
 *   C7 — UP 型蓄力武器装填 > 后摇：后摇打断换弹；打空后换弹与后摇同时计时
 *
 * Run: node scripts/tests/test-reload-cadence.mjs
 */

import { simulate, initBattle, tick } from '../../src/engine/battle.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ENEMY = {
  maxHp:    1e15,
  def:      0,
  element:  'Iron',
  type:     'Boss',
  hasCore:  false,
  distance: 'NEAR',
};

let _nextId = 91000;

/** 合成 rate_of_fire 武器单位（非蓄力、非 MG 起速）。 */
function rofUnit(overrides = {}) {
  return {
    characterId:              _nextId++,
    name:                     'Cadence-Test',
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
    ...overrides,
  };
}

/** 单人模拟并返回该单位的 normal_shot tick 列表与 reload 事件 tick 列表。 */
function runSolo(unit, uptoTick) {
  const result = simulate({ squad: [unit], enemy: ENEMY, hitLog: true });
  const shots = result.hitLog
    .filter(e => e.label === 'normal_shot' && e.tick <= uptoTick)
    .map(e => e.tick);
  const reloads = result.log
    .filter(e => e.type === 'reload' && e.tick <= uptoTick)
    .map(e => e.tick);
  return { shots, reloads };
}

// ─── C1：瞬间装填 + 弹匣 1 发 → RPM 节奏 ─────────────────────────────────────
// SG 90 RPM（40t 发间），弹匣 1，reloadTicks 120 + 后摇 12。
// 换弹速度 +120%（stats.reloadSpeedPct 作为永久 Cube Reload buff 推入）→ 装填时长 0 + 12t。
// 期望：修复前每 13t 一发；修复后节奏落回 40t 一发，9s（540t）内恰好 14 发。

section('C1 — 瞬间装填 + 弹匣 1 发：射击节奏受 RPM 下限约束（Anis SS 实测校准）');
{
  const unit = rofUnit({
    rateOfFire:          90,
    baseAmmo:            1,
    reloadTicks:         120,
    reloadRecoveryTicks: 12,
    _computedStats:      { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0, reloadSpeedPct: 1.2 },
  });
  const { shots } = runSolo(unit, 540);
  eq('9s（540t）内攻击次数 = 14（实测基准）', shots.length, 14);
  // 战斗循环从 tick 1 开始（首发 @1），其后严格按 40t RPM 发间
  eq('逐发 tick = 精确 40t RPM 节奏', shots.join(','),
     [1, ...Array.from({ length: 13 }, (_, i) => (i + 1) * 40)].join(','));
}

// ─── C2：慢换弹（无换弹速度加成）→ 换弹完成立即补射（旧行为不变） ─────────────
// 同一单位但无换弹速度：装填 120 + 12 = 132t ≥ 40t 发间 → 累加器在换弹期间封顶 1，
// 换弹完成 tick 立即击发。周期 = 1（空弹等待）+ 132 = 133t。

section('C2 — 慢换弹：换弹完成第一发立即击发（与修复前行为一致）');
{
  const unit = rofUnit({
    rateOfFire:          90,
    baseAmmo:            1,
    reloadTicks:         120,
    reloadRecoveryTicks: 12,
  });
  const { shots, reloads } = runSolo(unit, 540);
  eq('前 4 发 tick（周期 133t）', shots.slice(0, 4).join(','), '1,134,267,400');
  eq('换弹完成 tick 与补射 tick 重合', reloads.slice(0, 3).join(','), '134,267,400');
}

// ─── C3：AR 常规弹匣 → 换弹完成 tick 即刻补射（旧行为不变） ───────────────────
// AR 600 RPM（6t 发间）、弹匣 30：第 30 发 @175t，空弹后 176t 起装填 132t → 308t 完成即补射。

section('C3 — AR 常规弹匣：换弹完成 tick 即刻补射');
{
  const unit = rofUnit({
    weaponType:          'AR',
    rateOfFire:          600,
    baseAmmo:            30,
    reloadTicks:         120,
    reloadRecoveryTicks: 12,
  });
  const { shots, reloads } = runSolo(unit, 320);
  eq('首弹匣末发 @175t', shots[29], 175);
  eq('首次换弹完成 @308t', reloads[0], 308);
  eq('换弹后第一发与换弹完成同 tick', shots[30], 308);
}

// ─── C4：蓄力武器开局首发 / 换弹后首发均应用蓄速加成 ────────────────────────
// UP 型 SR：前摇 12t、后摇 12t、基础蓄力 60t，弹匣 2，装填 120t；装备/魔方蓄速 +50% → 有效蓄力 30t。
// 装备词条 / 魔方开局即生效，蓄速作用于每一次蓄力（§4.3.4 / §4.3.6）：
//   首发 = 12 + 30 = 42；第 2 发 = 42 + 12 + 12 + 30 = 96（弹匣打空）；
//   射击当 tick 即开始装填（后摇与换弹同时计时，§4.3.6）→ 216 完成；
//   换弹后首发 = max(216, 96 + 12) + 12 + 30 = 258。
// 修复前首发与换弹后首发均用基础 60t：首发 72、换弹后首发 289。

section('C4 — 蓄力武器：开局首发与换弹后首发应用装备/魔方蓄速');
{
  const unit = rofUnit({
    weaponType:      'SR',
    rateOfFire:      60,   // UP 型蓄力武器的 rate_of_fire 与发间无关（§4.3.5），仅满足必填校验
    baseAmmo:        2,
    reloadTicks:     120,
    chargeTimeTicks: 60,
    foreswingTicks:  12,
    backswingTicks:  12,
    _computedStats:  { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0, chargeSpeedPct: 0.5 },
  });
  const { shots, reloads } = runSolo(unit, 300);
  eq('开局首发 @42t（前摇 12 + 有效蓄力 30）', shots[0], 42);
  eq('第 2 发 @96t（后摇 + 前摇 + 有效蓄力）', shots[1], 96);
  eq('换弹完成 @216t（末发 tick 起算）', reloads[0], 216);
  eq('换弹后首发 @258t（前摇 12 + 有效蓄力 30）', shots[2], 258);
}

// ─── C5–C7：UP 型蓄力武器后摇期间换弹（§4.3.9） ────────────────────────────
// UP 型 SR：前摇 12t、后摇 12t、蓄力 60t（发间 84t），弹匣 3，基础装填 120t。
// 每发射击后进入后摇即开始换弹：换弹时长 ≤ 后摇则后摇内补满（记录装填事件），否则被后摇结束打断。

/** UP 型 SR 合成单位（换弹速度作为永久 Cube Reload buff 推入）。 */
function srUnit(reloadSpeedPct) {
  return rofUnit({
    weaponType:      'SR',
    rateOfFire:      60,   // UP 型蓄力武器的 rate_of_fire 与发间无关（§4.3.5），仅满足必填校验
    baseAmmo:        3,
    reloadTicks:     120,
    chargeTimeTicks: 60,
    foreswingTicks:  12,
    backswingTicks:  12,
    _computedStats:  { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0, reloadSpeedPct },
  });
}

/** 单人模拟，返回 normal_shot 的 [tick, ammoBeforeShot] 与 reload 事件 tick。 */
function runSoloAmmo(unit, uptoTick) {
  const result = simulate({ squad: [unit], enemy: ENEMY, hitLog: true });
  const shots = result.hitLog
    .filter(e => e.label === 'normal_shot' && e.tick <= uptoTick)
    .map(e => [e.tick, e.ammoBeforeShot]);
  const reloads = result.log
    .filter(e => e.type === 'reload' && e.tick <= uptoTick)
    .map(e => e.tick);
  return { shots, reloads };
}

section('C5 — 换弹速度 ≥100%（装填 0t）：每发射击当 tick 即补满，弹匣始终满');
{
  const { shots, reloads } = runSoloAmmo(srUnit(1.2), 500);
  eq('射击节奏不变（84t 发间）', shots.map(s => s[0]).join(','), '72,156,240,324,408,492');
  eq('每发射击前弹药均为满弹匣 3', shots.every(s => s[1] === 3), true);
  eq('每发射击当 tick 记录装填', reloads.join(','), '72,156,240,324,408,492');
}

section('C6 — 换弹时长 ≤ 后摇（6t）：后摇内补满，弹匣始终满');
{
  // 换弹速度 +95% → round(120 × 0.05) = 6t ≤ 后摇 12t
  const { shots, reloads } = runSoloAmmo(srUnit(0.95), 500);
  eq('射击节奏不变（84t 发间）', shots.map(s => s[0]).join(','), '72,156,240,324,408,492');
  eq('每发射击前弹药均为满弹匣 3', shots.every(s => s[1] === 3), true);
  eq('装填在射击后 6t 完成', reloads.join(','), '78,162,246,330,414,498');
}

section('C7 — 换弹时长 > 后摇（60t）：后摇打断换弹，打空后换弹与后摇同时计时');
{
  // 换弹速度 +50% → 60t > 后摇 12t：前两发的后摇换弹被打断，不恢复弹药
  const { shots, reloads } = runSoloAmmo(srUnit(0.5), 500);
  eq('弹药逐发递减 3 → 2 → 1', shots.slice(0, 3).map(s => s[1]).join(','), '3,2,1');
  // 第 3 发 @240 打空：当 tick 开始装填 → 300 完成；下一发 = max(300, 252) + 12 + 60 = 372
  eq('仅打空后装填一次 @300t', reloads.join(','), '300');
  eq('换弹后首发 @372t', shots[3]?.[0], 372);
  eq('换弹后首发为满弹匣', shots[3]?.[1], 3);
}

// ─── C8：帧率封顶 — 每 tick 最多 1 发（§4.4） ───────────────────────────────
// 客户端每帧最多一次射击：MG 顶速 4200 RPM（1.17 发/tick）实际只打出 60 发/s。
// 实测校准（2026-10-09）：Rapi: Red Hood 913 发弹匣 ≈16s 打空（≈57–60 发/s），3 分钟 9101 次普攻。

section('C8 — 帧率封顶：4200 RPM 每 tick 最多 1 发（Rapi: Red Hood 实测校准）');
{
  // 无起速的 4200 RPM 合成 MG：封顶前 600t 内 700 发，封顶后恰好 600 发（每 tick 1 发）
  const flat = rofUnit({
    weaponType:  'MG',
    rateOfFire:  4200,
    baseAmmo:    2000,
    reloadTicks: 150,
  });
  const { shots } = runSolo(flat, 600);
  eq('4200 RPM 600t 内射击数 = 600（每 tick 1 发）', shots.length, 600);
  eq('任意相邻两发间隔 ≥ 1t（同 tick 绝不出现两发）',
     shots.every((t, i) => i === 0 || t - shots[i - 1] >= 1), true);

  // 带 CDN 起速参数的 MG（Rapi: Red Hood 口径）：起速完成后同样 1 发/tick
  const ramp = rofUnit({
    weaponType:  'MG',
    rateOfFire:  60,
    baseAmmo:    2000,
    reloadTicks: 150,
    _nikkeData:  { shot_detail: { rate_of_fire: 60, end_rate_of_fire: 4200,
                                  rate_of_fire_change_pershot: 100, rate_of_fire_reset_time: 100 } },
  });
  const { shots: rampShots } = runSolo(ramp, 1200);
  eq('起速 MG 首发 @60t（60 RPM 首发间隔）', rampShots[0], 60);
  const steady = rampShots.filter(t => t > 600);
  eq('起速完成后 600t 内恰好 600 发', steady.length, 600);
  eq('起速完成后相邻两发间隔恒为 1t', steady.every((t, i) => i === 0 || t - steady[i - 1] === 1), true);
}

// ─── C9：爆裂阶段延迟 — 槽满→B1 同样延迟，默认 0.4s 且为上限（§6.2） ─────────────
// 三名合成单位（B1/B2/B3），首发（tick 1）即把共享槽充满：
//   tick 1 射击充满 → tick 2 爆裂状态机进入阶段 1 → B1 @2+24 → B2 @+24 → B3/全爆裂 @+24；
//   传入 0.6s 被压到 0.4s，结果相同。

section('C9 — 爆裂阶段延迟：槽满→B1 延迟 0.4s，0.4s 为上限（自动战斗实测）');
{
  const squadWith = () => ['Step1', 'Step2', 'Step3'].map(step => rofUnit({
    weaponType: 'AR', rateOfFire: 600, baseAmmo: 300, reloadTicks: 120,
    burstStep: step, targetBurstEnergyPerShot: 1_000_000,
  }));
  const run = (burstStepSecs) => {
    const r = simulate({ squad: squadWith(), enemy: ENEMY, burstStepSecs });
    const at = type => r.log.find(e => e.type === type)?.tick;
    return [at('burst_i'), at('burst_ii'), at('burst_iii'), at('full_burst')].join(',');
  };
  eq('默认延迟：B1 @26、B2 @50、B3 @74、全爆裂 @98（进入阶段 1 @2 + 3×24t，B3 后固定 24t）', run(undefined), '26,50,74,98');
  eq('传入 0.6s 被压到上限 0.4s，时序不变', run(0.6), '26,50,74,98');
  eq('0.1s：B1 @8、B2 @14、B3 @20；B3→全爆裂固定 0.4s 不随之缩短 @44', run(0.1), '8,14,20,44');
}

// ─── C10：蓄力中途蓄力时长变化按新时长结算（§4.3.10） ────────────────────────────
// DOWN_Charge RL（Anis: Star 口径）：前摇 12t、蓄力 60t、120 RPM（下限 30t）。
// 实测：爆裂固定蓄力 0.7s（42t）在两发之间生效 → 该发 42t 打出；在两发之间过期 → 该发 60t 打出；
// 已蓄力时长 ≥ 新时长 → 视为已满蓄，当 tick 立即打出。

section('C10 — 蓄力中途时长变化：生效即按新时长结算，已超过则立即击发');
{
  const mk = () => rofUnit({
    weaponType: 'RL', rateOfFire: 120, baseAmmo: 50, reloadTicks: 120,
    chargeTimeTicks: 60, foreswingTicks: 12, backswingTicks: 12, isDownCharge: true,
  });
  // 固定蓄力在 tick 200 生效（上一发 @192，已蓄 8t）→ 下一发 @192+42=234，之后 42t 一发
  {
    const state = initBattle({ squad: [mk()], enemy: ENEMY, hitLog: true });
    const u = state.squad[0];
    for (let t = 0; t < 300; t++) {
      if (state.tick === 200) { u.skillState.fixedChargeTimeTicks = 42; u.skillState.fixedChargeEndTick = 10_000; }
      tick(state);
    }
    const shots = state.hitLog.filter(h => h.label === 'normal_shot').map(h => h.tick);
    eq('固定蓄力中途生效：72,132,192 后改为 234,276', shots.join(','), '72,132,192,234,276');
  }
  // 固定蓄力在 tick 250 过期（上一发 @234，原定 @276）→ 该发按 60t @294，之后 60t 一发
  {
    const state = initBattle({ squad: [mk()], enemy: ENEMY, hitLog: true });
    const u = state.squad[0];
    for (let t = 0; t < 400; t++) {
      if (state.tick === 200) { u.skillState.fixedChargeTimeTicks = 42; u.skillState.fixedChargeEndTick = 249; }
      tick(state);
    }
    const shots = state.hitLog.filter(h => h.label === 'normal_shot').map(h => h.tick);
    eq('固定蓄力中途过期：234 后该发按 60t @294，再 @354', shots.join(','), '72,132,192,234,294,354');
  }
  // 已蓄力 50t 时（上一发 @192，tick 242）固定蓄力 42t 生效 → 已超过新时长，当 tick 立即打出
  {
    const state = initBattle({ squad: [mk()], enemy: ENEMY, hitLog: true });
    const u = state.squad[0];
    for (let t = 0; t < 300; t++) {
      if (state.tick === 242) { u.skillState.fixedChargeTimeTicks = 42; u.skillState.fixedChargeEndTick = 10_000; }
      tick(state);
    }
    const shots = state.hitLog.filter(h => h.label === 'normal_shot').map(h => h.tick);
    eq('已蓄力超过新时长：tick 243 立即击发，之后 42t 一发', shots.join(','), '72,132,192,243,285');
  }
}

// ─── C11：DOWN_Charge 换弹后首发 = 换弹完成 + 后摇 + 前摇 + 蓄力（串联，§4.3.6） ──────
// 实测（Anis: Star，后摇 12t、前摇 12t、固定蓄力 42t）：换弹速度 114%（换弹 0t）→ 66t；
// 换弹速度 74%（换弹 31t）→ 96t ≈ 31 + 24 + 42。并行模型对后者只能给出 73t，排除。
section('C11 — DOWN_Charge 换弹后首发：换弹完成 + 后摇 + 前摇 + 蓄力（串联）');
{
  const mk = (reloadSpeedPct) => rofUnit({
    weaponType: 'RL', rateOfFire: 120, baseAmmo: 2, reloadTicks: 120,
    chargeTimeTicks: 60, foreswingTicks: 12, backswingTicks: 12, isDownCharge: true,
    _computedStats: { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0, reloadSpeedPct },
  });
  // 瞬间换弹：第 2 发 @132 打空 → 换弹 @133 完成 → 首发 = 133 + 24 + 60 = 217
  const fast = runSolo(mk(1.14), 400);
  eq('瞬间换弹完成 @133', fast.reloads[0], 133);
  eq('换弹后首发 @217（换弹完成 + 后摇 12 + 前摇 12 + 蓄力 60）', fast.shots[2], 217);
  // 换弹速度 74%：换弹 round(120 × 0.26) = 31t @164 完成 → 首发 = 164 + 24 + 60 = 248
  const mid = runSolo(mk(0.74), 400);
  eq('换弹速度 74% 完成 @164', mid.reloads[0], 164);
  eq('换弹后首发 @248（Anis: Star 96t 口径：31 + 24 + 42 → 此处蓄力 60）', mid.shots[2], 248);
}

// ─── C12：非蓄力武器换弹后对准期（spot_first_delay）——Rapi: Red Hood MG 实测 ──────
// 弹匣打空 → 换弹（下一 tick 起）→ 末发后摇 12 → 对准 12 → 首发（MG 衰减不深时立即）。
// 实测：换弹速度 114%（换弹 0t）23t；84%（无魔方，换弹 round(150 × 0.156) = 23t）48t。
section('C12 — MG 换弹后对准期：Rapi: Red Hood 114% → 24t、84% → 48t（含换弹起算 1t）');
{
  const mk = (reloadSpeedPct) => rofUnit({
    weaponType: 'MG', rateOfFire: 60, baseAmmo: 100, reloadTicks: 150,
    reloadRecoveryTicks: 12, reloadAimTicks: 12,
    _nikkeData: { shot_detail: { rate_of_fire: 60, end_rate_of_fire: 4200,
                                 rate_of_fire_change_pershot: 100, rate_of_fire_reset_time: 100 } },
    _computedStats: { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0, reloadSpeedPct },
  });
  const gap = (unit) => {
    const { shots } = runSolo(unit, 1200);
    return shots[100] - shots[99];   // 第 100 发打空 → 第 101 发为换弹后首发
  };
  eq('114%：末发到换弹后首发 = 1 + 0 + 12 + 12 = 25t（实测 23）', gap(mk(1.14)), 25);
  eq('84%：末发到换弹后首发 = 1 + 23 + 12 + 12 = 48t（实测 48）', gap(mk(0.8439)), 48);
}

summary('换弹节奏回归（换弹与射击间隔并行消化）');
