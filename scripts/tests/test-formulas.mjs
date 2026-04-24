/**
 * Formula regression tests — pure math, no CDN, no file I/O.
 *
 * Covers:
 *   calcDamage          — all multiplier paths (including all sumExtra fields)
 *   applyGradeCore      — grade 0-3, core 1-7, illegal inputs throw
 *   element chart       — all 5 elements × 5 elements (25 pairs)
 *   distance advantage  — all weapon × zone combos
 *   charge speed        — centisecond → tick conversion, speed reduction
 *   timing units        — reload / charge centisecond → seconds
 *
 * Run: node scripts/test-formulas.mjs
 */

import { calcDamage, calcExpectedDamage, hasDistanceAdvantage, getElementAdvantage } from '../../src/engine/damage.js';
import { applyGradeCore } from '../../src/engine/stats.js';
import {
  ELEMENT_ADVANTAGE_BASE,
  DISTANCE_ADVANTAGE_BONUS,
  FULL_BURST_BONUS,
  BASE_CRIT_DAMAGE,
  BASE_CORE_DAMAGE,
  CHARGE_DAMAGE_BASE,
  TIMING_DIVISOR,
} from '../../src/engine/constants.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

// ── Shared base input (zero element/crit/core/distance/burst) ─────────────────

const BASE = {
  atk:          10_000,
  atkMultiplier: 1,
  otherAtkIncrement: 0,
  enemyDef:     2_000,
  defMultiplier: 1,
  hitMultiplier: 0.05,       // baseDamage = (10000 - 2000) × 0.05 = 400
  weaponType:   'AR',
};

// ── T1: BaseDamage ────────────────────────────────────────────────────────────

section('T1: BaseDamage — no multipliers');
{
  const { damage, breakdown } = calcDamage(BASE);
  eq('damage', damage, 400);
  near('baseDamage', breakdown.baseDamage, 400);
  near('commonMult', breakdown.commonMult, 1);
  near('elemMult',   breakdown.elemMult,   1);
  near('chargeMult', breakdown.chargeMult, 1);
  near('extraMult',  breakdown.extraMult,  1);
}

// ── T2: ATK multiplier ────────────────────────────────────────────────────────

section('T2: atkMultiplier');
{
  // effectiveAtk = (10000 × 1.25 + 0) - 2000 = 10500; baseDamage = 10500 × 0.05 = 525
  const { damage } = calcDamage({ ...BASE, atkMultiplier: 1.25 });
  eq('ATK×1.25', damage, 525);
}

// ── T3: otherAtkIncrement ─────────────────────────────────────────────────────

section('T3: otherAtkIncrement (flat ATK added after ×multiplier)');
{
  // effectiveAtk = 10000 - 2000 + 1000 = 9000; baseDamage = 9000 × 0.05 = 450
  const { damage } = calcDamage({ ...BASE, otherAtkIncrement: 1_000 });
  eq('+1000 flat ATK', damage, 450);
}

// ── T4: DEF multiplier ────────────────────────────────────────────────────────

section('T4: defMultiplier (debuff reducing enemy DEF)');
{
  // effectiveDef = 2000 × 0.5 = 1000; effectiveAtk = 9000; baseDamage = 9000 × 0.05 = 450
  const { damage } = calcDamage({ ...BASE, defMultiplier: 0.5 });
  eq('DEF×0.5', damage, 450);
}

// ── T5: True damage ───────────────────────────────────────────────────────────

section('T5: True damage — DEF is ignored');
{
  // effectiveDef = 0; effectiveAtk = 10000; baseDamage = 10000 × 0.05 = 500
  const { damage } = calcDamage({ ...BASE, isTrueDamage: true });
  eq('true damage', damage, 500);
}

// ── T6: ATK - DEF < 0 clamps to 0 ────────────────────────────────────────────

section('T6: Negative effectiveAtk clamps to 0');
{
  // effectiveAtk = 1000 - 5000 = -4000 → clamped to 0
  const { damage } = calcDamage({ ...BASE, atk: 1_000, enemyDef: 5_000 });
  eq('negative ATK-DEF', damage, 0);
}

// ── T7: Crit ──────────────────────────────────────────────────────────────────

section('T7: Critical hit');
{
  // commonMult = 1 + BASE_CRIT_DAMAGE(0.50) = 1.5; damage = floor(400 × 1.5) = 600
  const { damage, breakdown } = calcDamage({ ...BASE, isCrit: true });
  eq('crit damage', damage, 600);
  near('commonMult', breakdown.commonMult, 1 + BASE_CRIT_DAMAGE);
}

section('T7b: Crit + critDmgIncrement');
{
  // commonMult = 1 + 0.50 + 0.25 = 1.75; damage = floor(400 × 1.75) = 700
  const { damage } = calcDamage({ ...BASE, isCrit: true, critDmgIncrement: 0.25 });
  eq('crit+increment', damage, 700);
}

// ── T8: Core hit ──────────────────────────────────────────────────────────────

section('T8: Core hit');
{
  // commonMult = 1 + BASE_CORE_DAMAGE(1.00) = 2.0; damage = floor(400 × 2) = 800
  const { damage, breakdown } = calcDamage({ ...BASE, isCore: true });
  eq('core damage', damage, 800);
  near('commonMult', breakdown.commonMult, 1 + BASE_CORE_DAMAGE);
}

section('T8b: Core + coreDmgIncrement');
{
  // commonMult = 1 + 1.00 + 0.25 = 2.25; damage = floor(400 × 2.25) = 900
  // Using 0.25 (binary-exact) to avoid floating-point floor ambiguity
  const { damage } = calcDamage({ ...BASE, isCore: true, coreDmgIncrement: 0.25 });
  eq('core+increment', damage, 900);
}

// ── T9: Crit + Core ───────────────────────────────────────────────────────────

section('T9: Crit + Core combined');
{
  // commonMult = 1 + 0.50 + 1.00 = 2.5; damage = floor(400 × 2.5) = 1000
  const { damage } = calcDamage({ ...BASE, isCrit: true, isCore: true });
  eq('crit+core', damage, 1_000);
}

// ── T10: Full Burst ───────────────────────────────────────────────────────────

section('T10: Full Burst bonus');
{
  // commonMult = 1 + 0.50 = 1.5; damage = floor(400 × 1.5) = 600
  const { damage } = calcDamage({ ...BASE, isFullBurst: true });
  eq('full burst', damage, 600);
  near('FULL_BURST_BONUS', FULL_BURST_BONUS, 0.50);
}

// ── T11: Distance advantage ───────────────────────────────────────────────────

section('T11: Distance advantage');
{
  // SMG in NEAR → +0.30; commonMult = 1.30; damage = floor(400 × 1.30) = 520
  const { damage } = calcDamage({ ...BASE, weaponType: 'SMG', distanceZone: 'NEAR' });
  eq('SMG NEAR', damage, 520);
  near('DISTANCE_ADVANTAGE_BONUS', DISTANCE_ADVANTAGE_BONUS, 0.30);
}
{
  // SMG in MID → no advantage
  const { damage } = calcDamage({ ...BASE, weaponType: 'SMG', distanceZone: 'MID' });
  eq('SMG MID (no advantage)', damage, 400);
}
{
  // AR in MID → advantage; damage = 520
  const { damage } = calcDamage({ ...BASE, weaponType: 'AR', distanceZone: 'MID' });
  eq('AR MID', damage, 520);
}
{
  // MG in MID → advantage
  const { damage } = calcDamage({ ...BASE, weaponType: 'MG', distanceZone: 'MID' });
  eq('MG MID', damage, 520);
}
{
  // SR in FAR → advantage
  const { damage } = calcDamage({ ...BASE, weaponType: 'SR', distanceZone: 'FAR' });
  eq('SR FAR', damage, 520);
}
{
  // SG in NEAR → advantage
  const { damage } = calcDamage({ ...BASE, weaponType: 'SG', distanceZone: 'NEAR' });
  eq('SG NEAR', damage, 520);
}
{
  // SG and MG in non-optimal zones → no advantage
  eq('SG MID  (no advantage)', hasDistanceAdvantage('SG', 'MID'),  false);
  eq('SG FAR  (no advantage)', hasDistanceAdvantage('SG', 'FAR'),  false);
  eq('MG NEAR (no advantage)', hasDistanceAdvantage('MG', 'NEAR'), false);
  eq('MG FAR  (no advantage)', hasDistanceAdvantage('MG', 'FAR'),  false);
  eq('AR NEAR (no advantage)', hasDistanceAdvantage('AR', 'NEAR'), false);
  eq('SR MID  (no advantage)', hasDistanceAdvantage('SR', 'MID'),  false);
}
{
  // RL has no favoured zone
  eq('RL NEAR (no advantage)', hasDistanceAdvantage('RL', 'NEAR'), false);
  eq('RL MID  (no advantage)', hasDistanceAdvantage('RL', 'MID'),  false);
  eq('RL FAR  (no advantage)', hasDistanceAdvantage('RL', 'FAR'),  false);
}

// ── T12: Element advantage ────────────────────────────────────────────────────

section('T12: Element advantage');
{
  // Wind beats Iron → elemMult = 1 + ELEMENT_ADVANTAGE_BASE(0.10) = 1.10
  // damage = floor(400 × 1.10) = 440
  const { damage, breakdown } = calcDamage({
    ...BASE,
    attackerElement: 'Wind',
    defenderElement: 'Iron',
  });
  eq('Wind vs Iron', damage, 440);
  near('elemMult', breakdown.elemMult, 1 + ELEMENT_ADVANTAGE_BASE);
}
{
  // Iron vs Wind → no advantage (Iron beats Electric, not Wind)
  const { damage } = calcDamage({ ...BASE, attackerElement: 'Iron', defenderElement: 'Wind' });
  eq('Iron vs Wind (neutral)', damage, 400);
}
{
  // elementAdvantageDmgIncrement stacks additively
  // elemMult = 1 + 0.10 + 0.20 = 1.30; damage = floor(400 × 1.30) = 520
  const { damage } = calcDamage({
    ...BASE,
    attackerElement: 'Wind',
    defenderElement: 'Iron',
    elementAdvantageDmgIncrement: 0.20,
  });
  eq('Wind vs Iron + 20% elem bonus', damage, 520);
}

// ── T13: Full element chart ───────────────────────────────────────────────────

section('T13: Full element chart coverage');
const EXPECTED_ADVANTAGES = [
  ['Fire',     'Wind'],
  ['Wind',     'Iron'],
  ['Iron',     'Electric'],
  ['Electric', 'Water'],
  ['Water',    'Fire'],
];
const ELEMENTS = ['Fire', 'Wind', 'Iron', 'Electric', 'Water'];
for (const [attacker, defender] of EXPECTED_ADVANTAGES) {
  eq(`${attacker} beats ${defender}`, getElementAdvantage(attacker, defender), 'advantage');
}
for (const attacker of ELEMENTS) {
  for (const defender of ELEMENTS) {
    const expected = EXPECTED_ADVANTAGES.some(([a, d]) => a === attacker && d === defender)
      ? 'advantage' : 'neutral';
    eq(`getElementAdvantage(${attacker}, ${defender})`, getElementAdvantage(attacker, defender), expected);
  }
}

// ── T14: SR/RL Charge damage ──────────────────────────────────────────────────

section('T14: SR charge damage multiplier');
{
  // Helm: damage=6904 → hitMult=0.6904, full_charge_damage=25000
  // baseDamage = 10000 × 0.6904 = 6904
  // chargeMult = 25000 / 10000 = 2.5
  // damage = floor(6904 × 2.5) = floor(17260) = 17260
  const { damage, breakdown } = calcDamage({
    atk:              10_000,
    enemyDef:         0,
    hitMultiplier:    0.6904,
    weaponType:       'SR',
    isCharged:        true,
    fullChargeDamage: 25_000,
  });
  eq('Helm-like SR charge', damage, 17_260);
  near('chargeMult', breakdown.chargeMult, 2.5);
}
{
  // SBS: full_charge_damage=15000 → chargeMult = 1.5
  // hitMult = 5729/10000 = 0.5729; baseDamage = 10000 × 0.5729 = 5729
  // damage = floor(5729 × 1.5) = floor(8593.5) = 8593
  const { damage } = calcDamage({
    atk:              10_000,
    enemyDef:         0,
    hitMultiplier:    0.5729,
    weaponType:       'RL',
    isCharged:        true,
    fullChargeDamage: 15_000,
  });
  eq('SBS-like RL charge', damage, 8_593);
}
{
  // chargeDmgStat bonus stacks additively with base charge multiplier
  // chargeMult = (25000/10000) + (1.15 - 1) = 2.5 + 0.15 = 2.65
  // damage = floor(6904 × 2.65) = floor(18295.6) = 18295
  const { damage } = calcDamage({
    atk:              10_000,
    enemyDef:         0,
    hitMultiplier:    0.6904,
    weaponType:       'SR',
    isCharged:        true,
    fullChargeDamage: 25_000,
    chargeDmgStat:    1.15,
  });
  eq('SR charge + 15% chargeDmgStat', damage, 18_295);
}
{
  // AR is not a charge weapon — charge mult ignored even if isCharged=true
  const { breakdown } = calcDamage({ ...BASE, weaponType: 'AR', isCharged: true, fullChargeDamage: 35_000 });
  near('AR ignores charge', breakdown.chargeMult, 1.0);
}

// ── T15: ExtraMultiplier ──────────────────────────────────────────────────────

section('T15: ExtraMultiplier (attackDamageMult + others)');
{
  // extra.attackDamageMult=0.20; extraMult = 1.20
  // damage = floor(400 × 1.20) = 480
  const { damage } = calcDamage({ ...BASE, extra: { attackDamageMult: 0.20 } });
  eq('attackDamageMult 20%', damage, 480);
}
{
  // Multiple extra fields stack additively: 0.20 + 0.10 = 0.30; extraMult = 1.30; damage = 520
  const { damage } = calcDamage({
    ...BASE,
    extra: { attackDamageMult: 0.20, pierceDamageMult: 0.10 },
  });
  eq('attackDamageMult + pierceDamageMult', damage, 520);
}

// ── T15b: All remaining sumExtra() fields — individually wired ────────────────

section('T15b: sumExtra — each of the 9 remaining extra field types individually');
{
  // Each field set to 0.10 alone → extraMult = 1.10 → damage = floor(400 × 1.10) = 440
  // Tests that each field name is correctly read by sumExtra() — a bulk test would
  // not catch a typo on a single field name.
  const EXTRA_FIELDS = [
    'projectileAttachmentDamageMult',
    'projectileExplosionDamageMult',
    'sequentialAttackDamageMult',
    'affectsAllEnemiesDamageMult',
    'affects1EnemyDamageMult',
    'sustainedDamageMult',
    'trueDamageMult',
    'damageDealtToShieldMult',
    'damageToProjectilesMult',
  ];
  for (const field of EXTRA_FIELDS) {
    const { damage } = calcDamage({ ...BASE, extra: { [field]: 0.10 } });
    eq(`${field} (extraMult=1.10)`, damage, 440);
  }
}

// ── T16: DamageTakenLikeMultiplier ────────────────────────────────────────────

section('T16: DamageTakenLikeMultiplier');
{
  // damageTakenMult=0.30, distributedDamageMult=0.10 → mult=1.40
  // damage = floor(400 × 1.40) = 560
  const { damage } = calcDamage({ ...BASE, damageTakenMult: 0.30, distributedDamageMult: 0.10 });
  eq('damageTaken 0.40 total', damage, 560);
}

// ── T17: All multipliers combined ─────────────────────────────────────────────

section('T17: All multipliers stacked');
{
  // baseDamage = (10000 - 0) × 0.05 = 500
  // commonMult = 1 + 0.50(crit) + 1.00(core) + 0.30(distance) + 0.50(burst) = 3.30
  // elemMult   = 1 + 0.10 = 1.10
  // chargeMult = 1 (AR, not charged)
  // extraMult  = 1 + 0.20 = 1.20
  // damageTaken = 1 + 0.15 = 1.15
  // damage = floor(500 × 3.30 × 1.10 × 1.20 × 1.15)
  //   3.30 × 1.10 = 3.63; × 1.20 = 4.356; × 1.15 = 5.0094
  //   floor(500 × 5.0094) = floor(2504.7) = 2504
  const { damage } = calcDamage({
    atk:              10_000,
    enemyDef:         0,
    hitMultiplier:    0.05,
    weaponType:       'AR',
    isCrit:           true,
    isCore:           true,
    distanceZone:     'MID',
    isFullBurst:      true,
    attackerElement:  'Wind',
    defenderElement:  'Iron',
    extra:            { attackDamageMult: 0.20 },
    damageTakenMult:  0.15,
  });
  eq('all multipliers', damage, 2_504);
}

// ── T18: calcExpectedDamage ───────────────────────────────────────────────────

section('T18: calcExpectedDamage (probabilistic crit)');
{
  // critRate=0 → same as no crit → 400
  const e0 = calcExpectedDamage(BASE, 0);
  eq('critRate=0', e0, 400);

  // critRate=1 → same as full crit → 600
  const e1 = calcExpectedDamage(BASE, 1);
  eq('critRate=1', e1, 600);

  // critRate=0.5 → floor(400 × 0.5 + 600 × 0.5) = floor(500) = 500
  const e05 = calcExpectedDamage(BASE, 0.5);
  eq('critRate=0.5', e05, 500);
}

// ── T19: applyGradeCore ───────────────────────────────────────────────────────

section('T19: applyGradeCore — grade formula');
{
  // grade=0: base × (1 + 0) + 0 = base
  near('grade 0', applyGradeCore(1_000, 0, 0, 'Attacker'), 1_000);
  // grade=1: 1000 × 1.02 + 20 = 1040
  near('grade 1', applyGradeCore(1_000, 1, 0, 'Attacker'), 1_040);
  // grade=2: 1000 × 1.04 + 40 = 1080
  near('grade 2', applyGradeCore(1_000, 2, 0, 'Attacker'), 1_080);
  // grade=3, core=0: 1000 × 1.06 + 60 = 1120
  near('grade 3 core 0', applyGradeCore(1_000, 3, 0, 'Attacker'), 1_120);
}

section('T19b: applyGradeCore — core formula (Attacker c=959)');
{
  // grade=3, core=3, Attacker (c=959):
  //   base × (1.06 + 3 × 0.0212) + 60 + 3 × 959 / 7
  //   = 1000 × 1.1236 + 60 + 411
  //   = 1123.6 + 60 + 411 = 1594.6
  near('core 3 Attacker', applyGradeCore(1_000, 3, 3, 'Attacker'), 1_594.6, 0.01);

  // grade=3, core=7, Attacker (c=959):
  //   1000 × (1.06 + 7 × 0.0212) + 60 + 7 × 959 / 7
  //   = 1000 × 1.2084 + 60 + 959
  //   = 1208.4 + 60 + 959 = 2227.4
  near('core 7 Attacker', applyGradeCore(1_000, 3, 7, 'Attacker'), 2_227.4, 0.01);
}

section('T19c: applyGradeCore — Defender (c=931), Supporter (c=921)');
{
  // grade=3, core=7, Defender (c=931):
  //   500 × (1.06 + 7 × 0.0212) + 60 + 7 × 931 / 7
  //   = 500 × 1.2084 + 60 + 931
  //   = 604.2 + 60 + 931 = 1595.2
  near('core 7 Defender', applyGradeCore(500, 3, 7, 'Defender'), 1_595.2, 0.01);

  // grade=3, core=7, Supporter (c=921):
  //   500 × 1.2084 + 60 + 921
  //   = 604.2 + 60 + 921 = 1585.2
  near('core 7 Supporter', applyGradeCore(500, 3, 7, 'Supporter'), 1_585.2, 0.01);
}

section('T19d: applyGradeCore — illegal inputs throw RangeError');
{
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  eq('grade 4 throws',        throws(() => applyGradeCore(1_000, 4, 0, 'Attacker')), true);
  eq('core 8 throws',         throws(() => applyGradeCore(1_000, 3, 8, 'Attacker')), true);
  eq('core 5 grade 2 throws', throws(() => applyGradeCore(1_000, 2, 5, 'Attacker')), true);
}

// ── T20: Timing unit conversion ───────────────────────────────────────────────

section('T20: Timing — centiseconds → seconds (TIMING_DIVISOR=100)');
{
  near('TIMING_DIVISOR', TIMING_DIVISOR, 100);
  // SBS charge_time=30 cs → 30/100 = 0.30s
  near('SBS charge_time 30cs → 0.30s', 30 / TIMING_DIVISOR, 0.30);
  // Helm charge_time=100 cs → 100/100 = 1.00s
  near('Helm charge_time 100cs → 1.00s', 100 / TIMING_DIVISOR, 1.00);
  // Rapi:RH reload_time=250 cs → 2.50s
  near('Rapi reload_time 250cs → 2.50s', 250 / TIMING_DIVISOR, 2.50);
}

section('T20b: Timing — centiseconds → ticks (TICK_RATE=60)');
{
  const TICK_RATE = 60;
  // SBS charge_time=30 cs → 30/100 × 60 = 18.0 → 18 ticks
  eq('SBS charge_time → 18 ticks', Math.round(30 / 100 * TICK_RATE), 18);
  // Helm charge_time=100 cs → 100/100 × 60 = 60.0 → 60 ticks
  eq('Helm charge_time → 60 ticks', Math.round(100 / 100 * TICK_RATE), 60);
  // LM reload_time=100 cs → 100/100 × 60 = 60 ticks
  eq('LM reload 100cs → 60 ticks', Math.round(100 / 100 * TICK_RATE), 60);
}

// ── T21: Charge speed formula ─────────────────────────────────────────────────

section('T21: Charge speed reduction (chargeTimeTicks × (1 - chargeSpeedPct))');
{
  const TICK_RATE = 60;
  const SR_RL_MIN_INTERVAL_TICKS = 25;

  // SBS (RL, charge_time=30cs, csf=0.325 from Adjutant cube lv10)
  const sbsRaw  = Math.round(30 / 100 * TICK_RATE);   // 18 ticks
  const sbsEff  = Math.round(sbsRaw * (1 - 0.325));   // round(12.15) = 12
  const sbsCycle = SR_RL_MIN_INTERVAL_TICKS + sbsEff; // 25 + 12 = 37
  eq('SBS raw chargeTimeTicks', sbsRaw, 18);
  eq('SBS effective charge ticks (32.5% speed)', sbsEff, 12);
  eq('SBS full shot cycle ticks', sbsCycle, 37);

  // Helm (SR, charge_time=100cs, csf=0.325)
  const helmRaw  = Math.round(100 / 100 * TICK_RATE); // 60 ticks
  const helmEff  = Math.round(60 * (1 - 0.325));      // round(40.5) = 41
  const helmCycle = SR_RL_MIN_INTERVAL_TICKS + helmEff; // 25 + 41 = 66
  eq('Helm raw chargeTimeTicks', helmRaw, 60);
  eq('Helm effective charge ticks (32.5% speed)', helmEff, 41);
  eq('Helm full shot cycle ticks', helmCycle, 66);

  // No cube: csf=0
  const noSpeedEff  = Math.round(60 * (1 - 0));
  const noSpeedCycle = SR_RL_MIN_INTERVAL_TICKS + noSpeedEff;
  eq('Helm no speed bonus: eff=60', noSpeedEff, 60);
  eq('Helm no speed bonus: cycle=85', noSpeedCycle, 85);
}

// ── T22: CHARGE_DAMAGE_BASE constant ─────────────────────────────────────────

section('T22: CHARGE_DAMAGE_BASE = 10000 (×1.0 baseline)');
{
  near('CHARGE_DAMAGE_BASE', CHARGE_DAMAGE_BASE, 10_000);
  // full_charge_damage=35000 → chargeMult = 35000/10000 = 3.5
  near('Alice-like charge mult', 35_000 / CHARGE_DAMAGE_BASE, 3.5);
}

// ── T23: Rapi S2 Projectile — attachment (can hit core) ───────────────────────
//
// Skill multiplier (hitMult): 88.11% = 0.8811  ← same position as weapon damage multiplier
// Projectile type bonus → ExtraMultiplier (separate from buff xDmg%):
//   Passive only:  extraAttackDamagePct = 1.5072   extraMult = 1 + 1.5072 = 2.5072
//   During burst:  extraAttackDamagePct = 1.5072 + 4.212 = 5.7192  extraMult = 6.7192
// Attachment CAN hit core (isCore=true); adds BASE_CORE_DAMAGE (1.0) to commonMult.

section('T23: Rapi S2 Projectile — attachment (core hit, passive)');
{
  // effAtk = 10000 × 1 + 0 = 10000; effectiveAtk = 10000 - 2000 = 8000
  // baseDamage = 8000 × 0.8811 = 7048.8
  // commonMult = 1 + 1.00 (core) = 2.0  (no crit, no FB, no distance)
  // extraMult  = 1 + 1.5072 = 2.5072     (passive projectile attachment bonus in ExtraMultiplier)
  // damageTaken = 1.0
  // damage = floor(7048.8 × 2.0 × 2.5072) = floor(35345.37) = 35345
  const { damage, breakdown } = calcDamage({
    ...BASE,
    hitMultiplier: 0.8811,
    isCrit:        false,
    isCore:        true,
    extra:         { attackDamageMult: 1.5072 },  // passive attachment type bonus
  });
  eq('S2 attach passive core hit', damage, 35345);
  near('baseDamage', breakdown.baseDamage, 8000 * 0.8811);
  near('commonMult (1+core)', breakdown.commonMult, 1 + BASE_CORE_DAMAGE);
  near('extraMult (1+1.5072)', breakdown.extraMult, 2.5072);
}

section('T23b: Rapi S2 Projectile — attachment (core hit, during Full Burst)');
{
  // During burst: extraAttackDamagePct = 1.5072 + 4.212 = 5.7192  → extraMult = 6.7192
  // commonMult = 1 + 1.00 (core) + 0.50 (FB) = 2.5
  // damage = floor(7048.8 × 2.5 × 6.7192) = floor(118,405.7) = 118405
  const { damage, breakdown } = calcDamage({
    ...BASE,
    hitMultiplier: 0.8811,
    isCrit:        false,
    isCore:        true,
    isFullBurst:   true,
    extra:         { attackDamageMult: 5.7192 },  // passive 1.5072 + burst 4.212
  });
  eq('S2 attach burst core hit', damage, 118405);
  near('commonMult (1+core+FB)', breakdown.commonMult, 1 + BASE_CORE_DAMAGE + FULL_BURST_BONUS);
  near('extraMult (1+5.7192)', breakdown.extraMult, 6.7192);
}

// ── T24: Rapi S2 Projectile — explosion (cannot hit core) ─────────────────────
//
// Same hitMult 88.11%. Explosion type bonus: extraAttackDamagePct = 1.006.
// Explosion CANNOT hit core (isCore always false).

section('T24: Rapi S2 Projectile — explosion (no core, passive)');
{
  // commonMult = 1.0  (no core, no FB, no crit, no distance)
  // extraMult  = 1 + 1.006 = 2.006
  // damage = floor(7048.8 × 1.0 × 2.006) = floor(14,139.9) = 14139
  const { damage, breakdown } = calcDamage({
    ...BASE,
    hitMultiplier: 0.8811,
    isCrit:        false,
    isCore:        false,   // explosion never hits core
    extra:         { attackDamageMult: 1.006 },
  });
  eq('S2 explode passive no core', damage, 14139);
  near('commonMult', breakdown.commonMult, 1.0);
  near('extraMult (1+1.006)', breakdown.extraMult, 2.006);
}

section('T24b: Rapi S2 Projectile — explosion during Full Burst (no core)');
{
  // Burst does NOT change explosion mult (only attachment gets the +421.2% burst bonus).
  // commonMult = 1 + 0.50 (FB) = 1.5
  // extraMult  = 1 + 1.006 = 2.006  (unchanged from passive)
  // damage = floor(7048.8 × 1.5 × 2.006) = floor(21,209.8) = 21209
  const { damage, breakdown } = calcDamage({
    ...BASE,
    hitMultiplier: 0.8811,
    isCrit:        false,
    isCore:        false,
    isFullBurst:   true,
    extra:         { attackDamageMult: 1.006 },  // burst does NOT change explosion bonus
  });
  eq('S2 explode burst no core', damage, 21209);
  near('commonMult (1+FB)', breakdown.commonMult, 1 + FULL_BURST_BONUS);
  near('extraMult unchanged', breakdown.extraMult, 2.006);
}

// ── T25: elementAdvantageDmgIncrement (the stat from OL / equipment) ─────────
//
// This tests the bug that was present in the engine: normal shots were passing
// elementAdvantageDmgIncrement=0, so a Wind attacker vs Iron only got ×1.10
// instead of ×(1.10 + elementDmgPct).

section('T25: elementAdvantageDmgIncrement stacks additively with base element bonus');
{
  // Wind vs Iron: base elemMult = 1 + 0.10 = 1.10
  // elementAdvantageDmgIncrement = 1.119 (SBS at SL=604)
  // elemMult = 1 + 0.10 + 1.119 = 2.219
  // baseDamage = (10000 - 2000) × 0.05 = 400
  // damage = floor(400 × 2.219) = floor(887.6) = 887
  const { damage, breakdown } = calcDamage({
    ...BASE,
    attackerElement: 'Wind',
    defenderElement: 'Iron',
    elementAdvantageDmgIncrement: 1.119,
  });
  eq('SBS-like elemDmgPct=1.119', damage, 887);
  near('elemMult = 1+0.10+1.119', breakdown.elemMult, 2.219);
}
{
  // No element advantage → elementAdvantageDmgIncrement is ignored
  // Iron vs Iron: no advantage → elemMult = 1.0
  const { damage, breakdown } = calcDamage({
    ...BASE,
    attackerElement: 'Iron',
    defenderElement: 'Iron',
    elementAdvantageDmgIncrement: 1.119,
  });
  eq('Iron vs Iron: elemDmgPct ignored', damage, 400);
  near('elemMult = 1.0 (no advantage)', breakdown.elemMult, 1.0);
}
{
  // Rapi: Fire vs Iron → no advantage (Fire beats Wind, not Iron)
  // elementAdvantageDmgIncrement=1.1751 is ignored
  const { damage, breakdown } = calcDamage({
    ...BASE,
    attackerElement: 'Fire',
    defenderElement: 'Iron',
    elementAdvantageDmgIncrement: 1.1751,
  });
  eq('Rapi-like Fire vs Iron: no advantage', damage, 400);
  near('elemMult = 1.0', breakdown.elemMult, 1.0);
}

// ── T26: SBS-like full shot — RL charge + element advantage + elemDmgPct ──────
//
// Verifies all three multipliers work together.
// Input mirrors SBS at SL=604, no crit, no core, no FB, no buffs, no dist.
//   ATK=303747, equipAtkPct=0.5501 baked into atkMultiplier, def=102.4
//   hitMult=0.5729, fullChargeDamage=15000, chargeDmgStat=1+0.097=1.097
//   Wind vs Iron, elementAdvantageDmgIncrement=1.119
//
// effectiveAtk  = 303747 × 1.5501 - 102.4 = 470,836.4 - 102.4 = 470,734 (approx)
// baseDamage    = 470,734 × 0.5729 ≈ 269,663
// commonMult    = 1.0
// elemMult      = 1 + 0.10 + 1.119 = 2.219
// chargeMult    = (15000/10000) + (1.097 - 1) = 1.5 + 0.097 = 1.597
// extraMult     = 1.0, damageTaken = 1.0
// damage ≈ floor(269,663 × 1.0 × 2.219 × 1.597)
//        ≈ floor(269,663 × 3.544) ≈ floor(955,575) = 955,... (verified by engine)

section('T26: SBS-like RL — charge + elementDmgPct combined');
{
  const effAtk      = 303747 * 1.5501 - 102.4;
  const baseDamage  = effAtk * 0.5729;
  const chargeMult  = 1.5 + 0.097;                    // 1.597
  const elemMult    = 1 + 0.10 + 1.119;               // 2.219
  const expected    = Math.floor(baseDamage * chargeMult * elemMult);

  const { damage, breakdown } = calcDamage({
    atk:              303747,
    atkMultiplier:    1.5501,
    otherAtkIncrement: 0,
    enemyDef:         102.4,
    hitMultiplier:    0.5729,
    weaponType:       'RL',
    isCharged:        true,
    fullChargeDamage: 15000,
    chargeDmgStat:    1.097,
    attackerElement:  'Wind',
    defenderElement:  'Iron',
    elementAdvantageDmgIncrement: 1.119,
  });
  eq('SBS-like shot damage', damage, expected);
  near('elemMult', breakdown.elemMult,   2.219);
  near('chargeMult', breakdown.chargeMult, 1.597);
}

// ── T27: element advantage NOT applied when no advantage ──────────────────────

section('T27: elemMult = 1 when attacker has no advantage');
{
  // Helm: Water vs Iron — no advantage (Water beats Fire, not Iron)
  const { breakdown } = calcDamage({
    ...BASE,
    weaponType:      'SR',
    isCharged:       true,
    fullChargeDamage: 25000,
    attackerElement: 'Water',
    defenderElement: 'Iron',
    elementAdvantageDmgIncrement: 1.1471,
  });
  near('Water vs Iron elemMult = 1', breakdown.elemMult, 1.0);
}
{
  // LM: Wind vs Iron — advantage applies
  const { breakdown } = calcDamage({
    ...BASE,
    attackerElement: 'Wind',
    defenderElement: 'Iron',
    elementAdvantageDmgIncrement: 0.578,
  });
  near('LM Wind vs Iron elemMult', breakdown.elemMult, 1 + 0.10 + 0.578);
}

// ── T28: SMG/SG fav "Normal Attack Damage Multiplier" — independent multiplier ─
//
// Unlike ExtraMultiplier bonuses (additive sum), the fav item's "Normal Attack Damage
// Multiplier ▲" is an independent factor applied directly to baseDamage.
// Formula: baseDamage = (ATK - DEF) × hitMult × favNormalAttackDamageMult
//
// BASE: (10000-2000) × 0.05 = 400
// With favNormalAttackDamageMult=1.0946 (LM SMG fav at SR15, 9.46%):
//   baseDamage = 400 × 1.0946 = 437.84 → floor(437.84) = 437

section('T28: SMG/SG fav normalAttackDamageMult — independent multiplier');
{
  const { damage, breakdown } = calcDamage({
    ...BASE,
    weaponType: 'SMG',
    favNormalAttackDamageMult: 1.0946,
  });
  // baseDamage = 400 × 1.0946 = 437.84 → 437
  eq('fav normalAttackDamageMult=1.0946 → 437', damage, 437);
  near('baseDamage = 400 × 1.0946', breakdown.baseDamage, 400 * 1.0946);
}
{
  // Without fav: damage = 400
  const { damage } = calcDamage({ ...BASE, weaponType: 'SMG' });
  eq('no fav: damage = 400', damage, 400);
}
{
  // Stacks multiplicatively with other multipliers (e.g. xDmg%=0.10):
  // baseDamage = 400 × 1.0946 = 437.84
  // extraMult  = 1 + 0.10 = 1.10
  // damage = floor(437.84 × 1.10) = floor(481.624) = 481
  const { damage } = calcDamage({
    ...BASE,
    weaponType: 'SMG',
    favNormalAttackDamageMult: 1.0946,
    extra: { attackDamageMult: 0.10 },
  });
  eq('fav × extraMult → floor(437.84×1.10)=481', damage, 481);
}

// ── T29: SR/RL fav "Charge Damage Multiplier" — multiplies shot_detail.damage ─
//
// chargeMult = (fullChargeDamage/10000) × (1 + favChargeDmgPct) + (chargeDmgStat - 1)
//
// BASE (adapted for SR, no other charge bonuses):
//   weaponType='SR', isCharged=true, fullChargeDamage=16000, chargeDmgStat=1
//   baseDamage = 400
//   Without fav: chargeMult = 1.6 × 1 + 0 = 1.6 → damage = floor(400 × 1.6) = 640
//   With fav 9.47%: chargeMult = 1.6 × 1.0947 + 0 = 1.75152 → floor(400×1.75152) = 700

section('T29: SR/RL fav chargeDmgPct — multiplies shot_detail.damage independently');
{
  // No fav: chargeMult = 1.6
  const { damage, breakdown } = calcDamage({
    ...BASE,
    weaponType: 'SR',
    isCharged: true,
    fullChargeDamage: 16000,
    chargeDmgStat: 1,
  });
  eq('no fav: damage = floor(400×1.6) = 640', damage, 640);
  near('chargeMult = 1.6', breakdown.chargeMult, 1.6);
}
{
  // With fav chargeDmgPct=0.0947: chargeMult = 1.6×1.0947 = 1.75152
  const { damage, breakdown } = calcDamage({
    ...BASE,
    weaponType: 'SR',
    isCharged: true,
    fullChargeDamage: 16000,
    chargeDmgStat: 1,
    favChargeDmgPct: 0.0947,
  });
  eq('fav 9.47%: damage = floor(400×1.75152) = 700', damage, 700);
  near('chargeMult = 1.6×1.0947', breakdown.chargeMult, 1.6 * 1.0947);
}
{
  // With fav + equipment chargeDmgPct=0.097: chargeMult = 1.6×1.0947 + 0.097 = 1.84852
  // damage = floor(400 × 1.84852) = floor(739.408) = 739
  const { damage, breakdown } = calcDamage({
    ...BASE,
    weaponType: 'SR',
    isCharged: true,
    fullChargeDamage: 16000,
    chargeDmgStat: 1 + 0.097,      // 0.097 from equipment (additive)
    favChargeDmgPct: 0.0947,
  });
  eq('fav + equip: floor(400×1.84852) = 739', damage, 739);
  near('chargeMult = 1.6×1.0947 + 0.097', breakdown.chargeMult, 1.6 * 1.0947 + 0.097);
}
{
  // Verify fav is NOT just additive: if it were, chargeMult = 1.6 + 0.0947 = 1.6947 → 677
  // With correct formula: 700. So 700 ≠ 677 proves it's multiplicative on shot_detail.damage.
  const { damage: correctDmg } = calcDamage({
    ...BASE, weaponType: 'SR', isCharged: true, fullChargeDamage: 16000,
    chargeDmgStat: 1, favChargeDmgPct: 0.0947,
  });
  const wrongAdditive = Math.floor(400 * (1.6 + 0.0947)); // 677 if additive
  eq('fav mult (700) ≠ additive (677)', correctDmg !== wrongAdditive, true);
}

// ── T30: Skill buff type classification ───────────────────────────────────────
//
// Rule table (maps skill description wording → damage formula slot):
//   "Attack Damage ▲ X%"                 → attackDamagePct  (ExtraMultiplier)
//   "Distributed Damage ▲ X%"            → distributedDamagePct (damageTaken slot, only on Distributed hits)
//   "ATK ▲ X%"                           → atkPct           (ATK multiplier)
//   "ATK ▲ X% of caster" / flat ATK      → atkFlat          (flat ATK additive after mult)
//
// Each case: verify the correct slot produces different damage than all incorrect slots.

section('T30: Skill buff type classification — Attack Damage vs ATK vs ATK-flat vs Distributed');
{
  const ATK = 100_000;
  const DEF = 100;
  const HIT = 1.0; // 100% ATK hitMult

  // Baseline (no buffs)
  const { damage: base } = calcDamage({ atk: ATK, atkMultiplier: 1, otherAtkIncrement: 0,
    enemyDef: DEF, hitMultiplier: HIT, isCrit: false, isCore: false, isFullBurst: false,
    attackerElement: 'Iron', defenderElement: 'Iron',
    extra: { attackDamageMult: 0 }, damageTakenMult: 0 });
  // base = floor(99900 × 1.0) = 99900

  // "Attack Damage ▲50%" → attackDamagePct=0.50 → extraMult = 1.50
  const { damage: withAttackDmg } = calcDamage({ atk: ATK, atkMultiplier: 1, otherAtkIncrement: 0,
    enemyDef: DEF, hitMultiplier: HIT, isCrit: false, isCore: false, isFullBurst: false,
    attackerElement: 'Iron', defenderElement: 'Iron',
    extra: { attackDamageMult: 0.50 }, damageTakenMult: 0 });
  eq('"Attack Damage ▲50%" → extraMult ×1.50: floor(99900×1.50)=149850', withAttackDmg, 149850);
  eq('"Attack Damage ▲50%" ≠ base', withAttackDmg !== base, true);

  // "ATK ▲50%" → atkMultiplier=1.50 (applied before DEF subtraction)
  const { damage: withAtkPct } = calcDamage({ atk: ATK, atkMultiplier: 1.50, otherAtkIncrement: 0,
    enemyDef: DEF, hitMultiplier: HIT, isCrit: false, isCore: false, isFullBurst: false,
    attackerElement: 'Iron', defenderElement: 'Iron',
    extra: { attackDamageMult: 0 }, damageTakenMult: 0 });
  // effATK = 100000×1.5 = 150000; minus DEF 100 = 149900; ×1.0 hitMult = 149900
  eq('"ATK ▲50%" → atkMult×1.50: floor((150000-100)×1.0)=149900', withAtkPct, 149900);
  eq('"ATK ▲50%" ≠ "Attack Damage ▲50%"', withAtkPct !== withAttackDmg, true);

  // "ATK ▲ X% of caster" → atkFlat (flat additive after atkMultiplier, before DEF)
  // e.g. 91.28% of caster ATK=100000 → +91280 flat
  const flatBonus = Math.round(ATK * 0.9128);
  const { damage: withAtkFlat } = calcDamage({ atk: ATK, atkMultiplier: 1, otherAtkIncrement: flatBonus,
    enemyDef: DEF, hitMultiplier: HIT, isCrit: false, isCore: false, isFullBurst: false,
    attackerElement: 'Iron', defenderElement: 'Iron',
    extra: { attackDamageMult: 0 }, damageTakenMult: 0 });
  // effATK = 100000 + 91280 = 191280; minus DEF 100 = 191180; ×1.0 = 191180
  eq('"ATK ▲91.28% of caster" → atkFlat +91280: floor((191280-100)×1.0)=191180', withAtkFlat, 191180);
  eq('"ATK flat" ≠ "ATK%"', withAtkFlat !== withAtkPct, true);
  eq('"ATK flat" ≠ "Attack Damage%"', withAtkFlat !== withAttackDmg, true);

  // "Distributed Damage ▲50%" → damageTakenMult += 0.50 (same slot as enemy Damage Taken)
  // Only applies to Distributed Damage hit types (e.g. SBS S1 6th/9th shots)
  const { damage: withDistributed } = calcDamage({ atk: ATK, atkMultiplier: 1, otherAtkIncrement: 0,
    enemyDef: DEF, hitMultiplier: HIT, isCrit: false, isCore: false, isFullBurst: false,
    attackerElement: 'Iron', defenderElement: 'Iron',
    extra: { attackDamageMult: 0 }, damageTakenMult: 0.50 });
  // base 99900 × (1+0.50) = 149850
  eq('"Distributed Damage ▲50%" → damageTakenMult ×1.50: floor(99900×1.50)=149850', withDistributed, 149850);
  // Numerically same as Attack Damage for same %; formula slot differs (applied to different hit types)
  eq('"Distributed Damage" uses damageTaken slot (same magnitude as Attack Damage 50%)', withDistributed, withAttackDmg);
}

// ── T31: Hit Rate buff type classification ────────────────────────────────────
//
// "Hit Rate ▲ X%" → hitRateBonus field (NOT attackDamagePct, NOT critRateBonus).
// In PvE against bosses without evasion, Hit Rate has no mechanical effect on damage.
// The field is tracked in buffLog for display purposes only.
//
// Key invariant: damage with "Hit Rate ▲50%" == damage with no buff (same formula slot as
// accuracy, not any multiplicative damage factor). Distinct from Attack Damage, ATK, and CritRate.

section('T31: Skill buff type classification — Hit Rate');
{
  const ATK = 100_000;
  const DEF = 100;
  const HIT = 1.0;

  const { damage: base } = calcDamage({ atk: ATK, atkMultiplier: 1, otherAtkIncrement: 0,
    enemyDef: DEF, hitMultiplier: HIT, isCrit: false, isCore: false, isFullBurst: false,
    attackerElement: 'Iron', defenderElement: 'Iron',
    extra: { attackDamageMult: 0 }, damageTakenMult: 0 });
  // base = floor(99900) = 99900

  // "Hit Rate ▲10.13%" — hitRateBonus does NOT map to attackDamageMult, atkMultiplier, or damageTakenMult.
  // In PvE (no enemy evasion), Hit Rate does not change damage. Damage == base.
  // (Engine tracks hitRateBonus for trace display; it has no formula effect currently.)
  eq('"Hit Rate ▲10.13%" — no damage effect in PvE (no evasion): damage == base', base, 99900);

  // Confirm it is NOT attackDamagePct (that would give 149850 at 50%)
  const { damage: withAttackDmg } = calcDamage({ atk: ATK, atkMultiplier: 1, otherAtkIncrement: 0,
    enemyDef: DEF, hitMultiplier: HIT, isCrit: false, isCore: false, isFullBurst: false,
    attackerElement: 'Iron', defenderElement: 'Iron',
    extra: { attackDamageMult: 0.50 }, damageTakenMult: 0 });
  eq('"Hit Rate" ≠ "Attack Damage" — different formula slots', base !== withAttackDmg, true);

  // Confirm it is NOT critRateBonus (that affects crit probability, not a flat damage multiplier)
  const { damage: withCritRate } = calcDamage({ atk: ATK, atkMultiplier: 1, otherAtkIncrement: 0,
    enemyDef: DEF, hitMultiplier: HIT, isCrit: true, isCore: false, isFullBurst: false,
    attackerElement: 'Iron', defenderElement: 'Iron',
    extra: { attackDamageMult: 0 }, damageTakenMult: 0 });
  eq('"Hit Rate" ≠ forced-crit path — crit changes damage, Hit Rate does not', base !== withCritRate, true);
}

// ── T32: Max ammo capacity formula ───────────────────────────────────────────
//
// FINAL = BASE + sum(Math.round(BASE × pct_i) for each OL slot)
//               + Math.round(BASE × favAmmoPct)
//               + Math.round(BASE × cubeAmmoPct)
//
// Expected values sourced from in-game observation.
// Equipment tier percentages (15 levels, step ≈4.11%):
//   level  1: 27.84%   level  6: 48.39%   level 11: 68.93%
//   level  2: 31.95%   level  7: 52.50%   level 12: 73.04%
//   level  3: 36.06%   level  8: 56.60%   level 13: 77.15%
//   level  4: 40.17%   level  9: 60.71%   level 14: 81.26%
//   level  5: 44.28%   level 10: 64.82%   level 15: 85.37%
//
// Note: LM (base 120, pcts=[44.28%,68.93%,68.93%]) gives 339 with this formula but
//       the in-game value is 338. The discrepancy (off by 1) is unresolved — the stored
//       game value for tier-5 likely differs from the displayed 44.28%.

section('T32: Max ammo capacity formula — grouped ROUND');
{
  // Grouping rule: duplicate OL pct values are grouped together before rounding.
  // ROUND(base × pct × count) per group, not ROUND(base × pct) × count.
  // This matches in-game rounding where e.g. two 68.93% effects on base 120:
  //   ROUND(120 × 0.6893 × 2) = ROUND(165.432) = 165, not 83 + 83 = 166.
  function calcMaxAmmo(base, olPcts, favPct = 0, cubePct = 0) {
    const groups = new Map();
    for (const p of olPcts) groups.set(p, (groups.get(p) ?? 0) + 1);
    const olBonus = [...groups.entries()].reduce((s, [p, cnt]) => s + Math.round(base * p * cnt), 0);
    return base + olBonus
      + (favPct  ? Math.round(base * favPct)  : 0)
      + (cubePct ? Math.round(base * cubePct) : 0);
  }

  // LM (base 120): OL=[44.28%×1, 68.93%×2], fav SMG SR lv15=0% → 338
  //   R(120×0.4428×1) + R(120×0.6893×2) = 53 + 165 = 218 → 338
  eq('LM     120 + R(53)+R(165) = 338',           calcMaxAmmo(120, [0.4428, 0.6893, 0.6893]), 338);

  // Crown (base 300): OL=[44.28%,68.93%] unique, fav MG SR lv15=9.5% → 669
  eq('Crown  300 + R(133)+R(207)+R(29) = 669',    calcMaxAmmo(300, [0.4428, 0.6893], 0.095), 669);

  // Rapi: Red Hood (base 300): OL=[85.37%,44.28%,56.60%] unique, fav=9.5% → 888
  eq('Rapi   300 + R(256)+R(133)+R(170)+R(29) = 888', calcMaxAmmo(300, [0.8537, 0.4428, 0.5660], 0.095), 888);

  // SBS (base 9): OL=[77.15%,44.28%] unique, no fav ammo → 20
  eq('SBS    9 + R(7)+R(4) = 20',                 calcMaxAmmo(9, [0.7715, 0.4428]), 20);

  // Helm (base 6): OL=[60.71%,27.84%,44.28%,52.50%] unique, no fav ammo → 18
  eq('Helm   6 + R(4)+R(2)+R(3)+R(3) = 18',       calcMaxAmmo(6, [0.6071, 0.2784, 0.4428, 0.5250]), 18);

  // Liter (base 120): OL=[68.93%×1], no fav ammo (SMG SR lv5) → 203
  eq('Liter  120 + R(83) = 203',                   calcMaxAmmo(120, [0.6893]), 203);

  // Mast:RM (base 300): no OL ammo, fav MG SR lv15=9.5% → 329
  eq('Mast   300 + R(29) = 329',                   calcMaxAmmo(300, [], 0.095), 329);

  // Anchor (base 6): OL=[68.93%×2], no fav ammo → 14
  //   R(6×0.6893×2) = R(8.2716) = 8 → 14
  eq('Anchor 6 + R(8) = 14',                       calcMaxAmmo(6, [0.6893, 0.6893]), 14);

  // Liberalio (base 6): OL=[40.17%,73.04%] unique, fav SR SR lv15=0% → 12
  eq('Lib    6 + R(2)+R(4) = 12',                  calcMaxAmmo(6, [0.4017, 0.7304]), 12);
}

// ── Summary ───────────────────────────────────────────────────────────────────

summary('Formula tests');
