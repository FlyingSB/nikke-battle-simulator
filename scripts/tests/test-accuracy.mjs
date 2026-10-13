/**
 * 命中率（HitRate）核心命中模型回归测试 —— 纯函数，无 CDN，无 I/O。
 *
 * 覆盖：
 *   parseAccuracyProfile  — auto/手动回退、SR/RL→alwaysCore、数据缺失→alwaysCore
 *   ramp                  — MG 暖机收束 / 停火恢复；AR/SMG/SG 恒定
 *   coreHitChance         — 边界、单调性、实测数据回归（dev/game-data.md）
 *   rollHitPellets / rollProjectileCore — 实战命中校正（SG 弹丸命中率 / 弹道核心判定）
 *   rlFlightTicks / enemyLateralSpeedAt / rlCoreHitRate — RL 核心命中（敌人横向移动 × 飞行时间）
 *
 * Run: node scripts/tests/test-accuracy.mjs
 */

import {
  parseAccuracyProfile,
  initAccuracyState,
  rampAccuracyOnShot,
  recoverAccuracy,
  coreHitChance,
} from '../../src/engine/accuracy.js';
import { CORE0_DEFAULT, D0_DEFAULT, HITRATE_CORE_COEF_DEFAULT } from '../../src/engine/constants.js';
import { rollHitPellets, rollProjectileCore, distanceScaledHitRate, sgPelletHitRate, isEnemyHittable,
         enemyLateralSpeedAt, rlFlightTicks, rlCoreHitRate } from '../../src/engine/battle-utils.js';
import { setRng } from '../../src/engine/rng.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

const CAL = { CORE0: CORE0_DEFAULT, D0: D0_DEFAULT, coef: HITRATE_CORE_COEF_DEFAULT };

// ── T1: parseAccuracyProfile ──────────────────────────────────────────────
section('T1: parseAccuracyProfile');
{
  const sg = parseAccuracyProfile({ startAccuracyScale: 250, endAccuracyScale: 250, accuracyChangePerShot: 0, accuracyChangeSpeed: 0 }, 'SG');
  eq('SG alwaysCore=false', sg.alwaysCore, false);
  eq('SG startScale=250', sg.startScale, 250);

  const mg = parseAccuracyProfile({ startAccuracyScale: 250, endAccuracyScale: 10, accuracyChangePerShot: 7, accuracyChangeSpeed: 150 }, 'MG');
  eq('MG changePerShot=7', mg.changePerShot, 7);
  eq('MG endScale=10', mg.endScale, 10);

  const sr = parseAccuracyProfile({ startAccuracyScale: 10, endAccuracyScale: 10 }, 'SR');
  eq('SR alwaysCore=true', sr.alwaysCore, true);
  const rl = parseAccuracyProfile({ startAccuracyScale: 10 }, 'RL');
  eq('RL alwaysCore=true', rl.alwaysCore, true);

  const missing = parseAccuracyProfile({}, 'AR');
  eq('数据缺失 → alwaysCore=true', missing.alwaysCore, true);
  const nullDetail = parseAccuracyProfile(null, 'SG');
  eq('detail=null → alwaysCore=true', nullDetail.alwaysCore, true);
}

// ── T2: MG 暖机 ramp / 停火恢复 ────────────────────────────────────────────
section('T2: MG ramp 收束与恢复');
{
  const unit = {};
  initAccuracyState(unit, parseAccuracyProfile(
    { startAccuracyScale: 250, endAccuracyScale: 10, accuracyChangePerShot: 7, accuracyChangeSpeed: 150 }, 'MG'), 60);
  eq('初始 currentScale=250', unit.accCurrentScale, 250);
  rampAccuracyOnShot(unit);
  eq('射 1 发后 = 243', unit.accCurrentScale, 243);
  for (let i = 0; i < 100; i++) rampAccuracyOnShot(unit);
  eq('连续射击收束到 end=10（clamp）', unit.accCurrentScale, 10);
  recoverAccuracy(unit, 1);            // 150/60=2.5 per tick
  near('停火 1 tick 恢复 +2.5 → 12.5', unit.accCurrentScale, 12.5);
  recoverAccuracy(unit, 1000);
  eq('长时间停火恢复到 start=250（clamp）', unit.accCurrentScale, 250);
}
section('T2b: AR/SMG/SG 恒定（changePerShot=0）');
{
  const unit = {};
  initAccuracyState(unit, parseAccuracyProfile(
    { startAccuracyScale: 110, endAccuracyScale: 110, accuracyChangePerShot: 0, accuracyChangeSpeed: 0 }, 'SMG'), 60);
  rampAccuracyOnShot(unit);
  recoverAccuracy(unit, 100);
  eq('SMG scale 恒定=110', unit.accCurrentScale, 110);
}

// ── T3: coreHitChance 边界与单调性 ────────────────────────────────────────
section('T3: coreHitChance 边界');
{
  eq('alwaysCore → 1', coreHitChance({ alwaysCore: true, currentScale: 250, hitRatePct: 0, distance: 50, ...CAL }), 1);
  eq('currentScale=0（无数据）→ 1', coreHitChance({ alwaysCore: false, currentScale: 0, hitRatePct: 0, distance: 10, ...CAL }), 1);
  eq('distance ≥ D0 → 0', coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0, distance: 77, ...CAL }), 0);

  const near20 = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0, distance: 20, ...CAL });
  const far50  = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0, distance: 50, ...CAL });
  eq('距离越远核心率越低', near20 > far50, true);

  const hr0  = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0,   distance: 20, ...CAL });
  const hr50 = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0.5, distance: 20, ...CAL });
  eq('HitRate 越高核心率越高', hr50 > hr0, true);
}

// ── T4: 实测数据回归（dev/game-data.md 2026-07-07）────────────────────────
// r_core(d)=55·(1−d/77)；R_eff=R/(1+4.5·HR)；P=(r_core/R_eff)²。断言落在实测 ±泊松误差内。
section('T4: 实测回归 SMG(R=110, HR=0)');
{
  // SMG d=20 实测 105/761=13.8%，d=30 66/719=9.2%，d=50 25/808=3.1%
  const p20 = coreHitChance({ alwaysCore: false, currentScale: 110, hitRatePct: 0, distance: 20, ...CAL });
  const p30 = coreHitChance({ alwaysCore: false, currentScale: 110, hitRatePct: 0, distance: 30, ...CAL });
  const p50 = coreHitChance({ alwaysCore: false, currentScale: 110, hitRatePct: 0, distance: 50, ...CAL });
  near('SMG d=20 ≈ 13.8%', p20, 0.138, 0.015);
  near('SMG d=30 ≈ 9.2%',  p30, 0.092, 0.015);
  near('SMG d=50 ≈ 3.1%',  p50, 0.031, 0.012);
}
section('T4b: 实测回归 Drake SG(R=250) 三档 HitRate');
{
  // 近距离(d=20)拟合最好：base 11.27%, drake 48.47%, noir 74.01%
  const p20_base = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0.1127, distance: 20, ...CAL });
  const p20_drk  = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0.4847, distance: 20, ...CAL });
  const p20_noir = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0.7401, distance: 20, ...CAL });
  // 实测 P2 d=20：9/150=6.0%、165/510=32.4%、158/270=58.5%；P5：12%、26.9%、49.7%
  near('SG d=20 HR11% ≈ 6%',   p20_base, 0.06, 0.05);
  near('SG d=20 HR48% ≈ 27–32%', p20_drk, 0.29, 0.06);
  near('SG d=20 HR74% ≈ 50–58%', p20_noir, 0.54, 0.08);
}

// ── T5: 实战命中校正（SG 弹丸命中率 / RL 核心命中率）────────────────────────
section('T5: rollHitPellets / rollProjectileCore');
{
  eq('hitRate=1 → 全部命中', rollHitPellets(10, 1), 10);
  setRng(() => 0.5);
  eq('hitRate=0.6, rng=0.5 → 全部命中', rollHitPellets(10, 0.6), 10);
  eq('hitRate=0.4, rng=0.5 → 全部打空', rollHitPellets(10, 0.4), 0);
  let i = 0;
  setRng(() => (i++ % 2 ? 0.9 : 0.1));
  eq('rng 交替 0.1/0.9，hitRate=0.5 → 命中一半', rollHitPellets(10, 0.5), 5);

  const exposed = { enemyHasCore: true, enemyCoreProtected: false };
  setRng(() => 0.5);
  eq('核心率缺省（1）→ 恒中', rollProjectileCore(exposed), true);
  eq('rate=0.6, rng=0.5 → 命中核心', rollProjectileCore(exposed, 0.6), true);
  eq('rate=0.4, rng=0.5 → 未命中核心', rollProjectileCore(exposed, 0.4), false);
  eq('核心被保护 → 不命中', rollProjectileCore({ enemyHasCore: true, enemyCoreProtected: true }), false);
  eq('无核心 → 不命中', rollProjectileCore({ enemyHasCore: false, enemyCoreProtected: false }), false);
  setRng(null);
}

section('T6: distanceScaledHitRate（敌人越近命中率越高）');
{
  eq('系数 1 → 任意距离恒为 1', distanceScaledHitRate(1, 80), 1);
  eq('d=0 → 1', distanceScaledHitRate(0.6, 0), 1);
  near('d=50（参考距离）→ 系数本身', distanceScaledHitRate(0.6, 50), 0.6);
  near('d=25 → 0.8', distanceScaledHitRate(0.6, 25), 0.8);
  near('d=75 → 0.4（继续线性下降）', distanceScaledHitRate(0.6, 75), 0.4);
  eq('远距离夹到 0', distanceScaledHitRate(0.2, 100), 0);
  near('距离未知（null）→ 按参考距离', distanceScaledHitRate(0.7, null), 0.7);
}

section('T6a: RL 核心命中（敌人横向移动 × 飞行时间）');
{
  // 飞行帧 = max(0, 0.603d − 3.3) × 100 / 弹速（实测：d20 → 7/9，d30 → 18，d40 → 19，d50 → 27 帧）
  near('飞行帧 d=50 → 26.85', rlFlightTicks(50), 26.85, 0.01);
  near('飞行帧 d=20 → 8.76', rlFlightTicks(20), 8.76, 0.01);
  near('弹速 300 → 飞行帧 ÷3', rlFlightTicks(50, 300), 8.95, 0.01);
  near('无弹速数据 → 按 100', rlFlightTicks(50, null), 26.85, 0.01);
  eq('距离 0 → 飞行帧不为负', rlFlightTicks(0), 0);

  const moves = [{ startTick: 100, endTick: 200, speed: 'SLOW' }];
  eq('区间内 → SLOW', enemyLateralSpeedAt({ enemyLateralMoves: moves }, 150), 'SLOW');
  eq('结束 tick 不含 → 静止', enemyLateralSpeedAt({ enemyLateralMoves: moves }, 200), null);
  eq('无移动配置 → 静止', enemyLateralSpeedAt({}, 150), null);

  const st = (tick, d) => ({ tick, enemyDistance: d, enemyLateralMoves: moves });
  eq('静止 → 必中核心', rlCoreHitRate(st(10, 50)), 1);
  // d=50：出手 tick 80 + 飞行 27 → 命中 tick 107 在移动区间内；打偏率 0.028 × (26.85 − 10.8) ≈ 0.449
  near('出手时静止、命中时移动 → 按命中时刻判定', rlCoreHitRate(st(80, 50)), 1 - 0.028 * (26.85 - 10.8), 0.001);
  near('d=30 移动 → ≈0.888', rlCoreHitRate(st(150, 30)), 1 - 0.028 * (14.79 - 10.8), 0.001);
  eq('d=20 移动（飞行 < 阈值）→ 必中核心', rlCoreHitRate(st(150, 20)), 1);
  eq('弹速 300 移动 → 必中核心', rlCoreHitRate(st(150, 50), 300), 1);
  // 命中时刻已离开移动区间（出手 190 + 27 = 217）→ 必中
  eq('命中时移动已结束 → 必中核心', rlCoreHitRate(st(190, 50)), 1);
}

section('T6b: sgPelletHitRate（散布收束 / 命中率 ▲ 减少弹丸打空）');
{
  const c = HITRATE_CORE_COEF_DEFAULT;
  eq('系数 1 → 恒为 1', sgPelletHitRate(1, 50, 250, 0, c), 1);
  near('标定条件（250、HR 0）→ 等于距离缩放命中率', sgPelletHitRate(0.7, 50, 250, 0, c), 0.7);
  near('无散布数据（scale 0）→ 按标定散布', sgPelletHitRate(0.7, 50, 0, 0, c), 0.7);
  // Privaty: Unkind Maid 收束到 75：打空率 0.3 × 75/250 = 0.09
  near('散布 75 → 0.91', sgPelletHitRate(0.7, 50, 75, 0, c), 0.91);
  // Dorothy: Serendipity Flash HR 98.18%：打空率 0.3 / (1 + 4.5×0.9818) ≈ 0.0553
  near('HR 98.18% → ≈0.945', sgPelletHitRate(0.7, 50, 250, 0.9818, c), 1 - 0.3 / (1 + c * 0.9818));
  near('距离与散布叠加：d=25、散布 125 → 1 − 0.15×0.5', sgPelletHitRate(0.7, 25, 125, 0, c), 0.925);
  eq('散布大于标定 → 不放大打空率', sgPelletHitRate(0.7, 50, 400, 0, c), 0.7);
}

section('T7: isEnemyHittable（HIDDEN 前 0.9s 仍可命中）');
{
  const hidden = (elapsedTicks) => ({ currentPhaseZone: 'HIDDEN', hiddenStartTick: 1000, tick: 1000 + elapsedTicks });
  eq('非 HIDDEN → 可命中', isEnemyHittable({ currentPhaseZone: 'NEAR', tick: 5 }), true);
  eq('HIDDEN 起点 → 可命中', isEnemyHittable(hidden(0)), true);
  eq('HIDDEN 0.88s（53t）→ 可命中', isEnemyHittable(hidden(53)), true);
  eq('HIDDEN 0.9s（54t）→ 不可命中', isEnemyHittable(hidden(54)), false);
  eq('HIDDEN 1.5s → 不可命中', isEnemyHittable(hidden(90)), false);
}

summary('Accuracy (HitRate core-hit model) tests');
