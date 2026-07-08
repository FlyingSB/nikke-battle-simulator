/**
 * 命中率（HitRate）核心命中模型回归测试 —— 纯函数，无 CDN，无 I/O。
 *
 * 覆盖：
 *   parseAccuracyProfile  — auto/手动回退、SR/RL→alwaysCore、数据缺失→alwaysCore
 *   ramp                  — MG 暖机收束 / 停火恢复；AR/SMG/SG 恒定
 *   coreHitChance         — 边界、单调性、实测数据回归（dev/game-data.md）
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

summary('Accuracy (HitRate core-hit model) tests');
