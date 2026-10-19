/**
 * 命中率（HitRate）核心命中模型回归测试 —— 纯函数，无 CDN，无 I/O。
 *
 * 覆盖：
 *   parseAccuracyProfile  — auto/手动回退、SR/RL→alwaysCore、数据缺失→alwaysCore
 *   ramp                  — MG 暖机收束 / 停火恢复；AR/SMG/SG 恒定
 *   coreHitChance         — 边界、单调性、实测数据回归（docs/game-data.md）
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
import { CORE_K_DEFAULT, CORE_OFF_DEFAULT, HITRATE_CORE_COEF_DEFAULT, SG_MISS_HITRATE_COEF } from '../../src/engine/constants.js';
import { rollHitPellets, rollProjectileCore, distanceScaledHitRate, sgPelletHitRate, isEnemyHittable,
         enemyLateralSpeedAt, rlFlightTicks, rlCoreHitRate, logMissedSkillHit } from '../../src/engine/battle-utils.js';
import { setRng } from '../../src/engine/rng.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

const CAL = { K: CORE_K_DEFAULT, off: CORE_OFF_DEFAULT, coef: HITRATE_CORE_COEF_DEFAULT };

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
  eq('贴脸（距离 ≤ −off）→ 1', coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0, distance: 3, ...CAL }), 1);
  const far100 = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0, distance: 100, ...CAL });
  eq('远距离 → (0, 1%) 内', far100 > 0 && far100 < 0.01, true);
  const sat = coreHitChance({ alwaysCore: false, currentScale: 10, hitRatePct: 0, distance: 30, ...CAL });
  eq('散布极小（MG 收束 10）→ 接近但不超过 1', sat > 0.99 && sat <= 1, true);

  const near20 = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0, distance: 20, ...CAL });
  const far50  = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0, distance: 50, ...CAL });
  eq('距离越远核心率越低', near20 > far50, true);

  const hr0  = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0,   distance: 20, ...CAL });
  const hr50 = coreHitChance({ alwaysCore: false, currentScale: 250, hitRatePct: 0.5, distance: 20, ...CAL });
  eq('HitRate 越高核心率越高', hr50 > hr0, true);
}

// ── T4: 实测数据回归（docs/game-data.md 2026-10-19 射击场 BIGARMS 重标定）──────
// r_core = K/(d + off)；R_eff = scale/(1 + c·HR)；P = 1 − exp(−(r_core/R_eff)²)。
// 实测为单人逐档伤害反推的核心命中数 / 命中数；断言落在实测约 ±2.5σ 内。
const P = (scale, hitRatePct, distance) => coreHitChance({ alwaysCore: false, currentScale: scale, hitRatePct, distance, ...CAL });
section('T4: 实测回归 无命中率（SMG 110 / AR 75，距离 20 / 30 / 50）');
{
  near('SMG d=20 ≈ 31.7%（223/704）', P(110, 0, 20), 0.317, 0.045);
  near('SMG d=30 ≈ 12.9%（78/604）',  P(110, 0, 30), 0.129, 0.03);
  near('SMG d=50 ≈ 3.9%（25/637）',   P(110, 0, 50), 0.039, 0.02);
  near('AR d=20 ≈ 50.6%（163/322）',  P(75, 0, 20), 0.506, 0.06);
  near('AR d=30 ≈ 27.7%（165/595）',  P(75, 0, 30), 0.277, 0.04);
  near('AR d=50 ≈ 6.5%（22/339）',    P(75, 0, 50), 0.065, 0.035);
}
section('T4b: 实测回归 带命中率（距离 30，装备 / 魔方 / 技能命中率同效）');
{
  near('SMG HR 16.9%（装备+魔方）≈ 19.4%（115/594）', P(110, 0.169, 30), 0.194, 0.035);
  near('SMG HR 19.32%（Chisato 技能）≈ 18.4%（112/609）', P(110, 0.1932, 30), 0.184, 0.035);
  near('AR HR 11.81% ≈ 32.3%（100/310）', P(75, 0.1181, 30), 0.323, 0.05);
  near('AR HR 28.56% ≈ 40.9%（114/279）', P(75, 0.2856, 30), 0.409, 0.06);
  near('SG HR 0 ≈ 2.0%（似然估计 0.2–8.2%）', P(250, 0, 30), 0.02, 0.02);
  near('SG HR 28.71% ≈ 4.85%（19/392）', P(250, 0.2871, 30), 0.0485, 0.025);
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
  // SG 打空率沿用旧收圆系数 4.5（与核心命中率系数解耦，见 constants.js SG_MISS_HITRATE_COEF）
  const c = SG_MISS_HITRATE_COEF;
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

section('T7: isEnemyHittable（隐藏时段内完全不可攻击）');
{
  eq('非 HIDDEN → 可命中', isEnemyHittable({ currentPhaseZone: 20, tick: 5 }), true);
  eq('跳起起跳段 JUMP → 仍可命中', isEnemyHittable({ currentPhaseZone: 'JUMP', tick: 5 }), true);
  eq('HIDDEN 起点 → 不可命中', isEnemyHittable({ currentPhaseZone: 'HIDDEN', tick: 1000 }), false);
  eq('HIDDEN 1.5s → 不可命中', isEnemyHittable({ currentPhaseZone: 'HIDDEN', tick: 1090 }), false);
}

section('T8: logMissedSkillHit（延迟技能伤害落空）');
{
  const unit = { id: 7, rawBurst: { name_localkey: 'Big Bang' } };
  const st = { tick: 300, burstGauge: 1234, _logSeq: 0, hitLog: [] };
  logMissedSkillHit(st, unit, 2.5, 'Burst');
  const h = st.hitLog[0];
  eq('写入一条日志', st.hitLog.length, 1);
  eq('伤害为 0', h.damage, 0);
  eq('标记 missed', h.missed, true);
  eq('标签解析为技能名', h.label, 'Big Bang');
  eq('无 hitLog 时不报错', logMissedSkillHit({ tick: 1 }, unit, 1, 'Burst'), undefined);
}

summary('Accuracy (HitRate core-hit model) tests');
