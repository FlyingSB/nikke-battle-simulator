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
 *
 * Run: node scripts/tests/test-reload-cadence.mjs
 */

import { simulate } from '../../src/engine/battle.js';
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

summary('换弹节奏回归（换弹与射击间隔并行消化）');
