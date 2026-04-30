/**
 * Cinderella (511) skill tests — pure, no CDN, no file I/O.
 *
 * Covers:
 *   Fix 1  — S1 Part1 triggers on ENTER_BURST_III, not ENTER_FULL_BURST
 *   Fix 2  — final Max HP includes external maxHpPct buffs
 *   Fix 3  — RELOAD_END removes Charge Speed buff; skill-refill does not
 *   Fix 6  — S3 Part2 mult = Beautiful stacks × 28.9% (one hit per Part1 trigger)
 *   Fix 7  — S3 Part2 fires once per each of the 10 S3 Part1 hits
 *   Fix 8  — S3 Part1 marked burstSkillDamage:true (no full burst bonus)
 *
 * Run: node scripts/tests/test-cinderella.mjs
 */

import { SKILL_TRAITS } from '../../src/data/skill-traits.js';
import { getBuffSums, TICK_RATE } from '../../src/engine/battle-utils.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides = {}) {
  return {
    tick: 0,
    buffs: [],
    squad: [],
    enemyHp: 1e12,
    enemyDef: 0,
    enemyDamageTakenPct: 0,
    fullBurstActive: false,
    burstGauge: 0,
    burstPhase: 0,
    pendingFireInBurstHits: [],
    buffLog: null,
    hitLog: null,
    burstEnergyLog: null,
    ...overrides,
  };
}

function makeCaster(stats = {}) {
  const caster = {
    id: 511,
    name: 'Cinderella',
    weaponType: 'RL',
    element: 'Electric',
    equipAtkPct: 0,
    totalDamage: 0,
    unitHp: 1_000_000,
    burstEnergyPerShot: 16667,
    stats: { atk: 100_000, hp: 1_000_000, critRate: 0.15, critDmg: 0.50, ...stats },
    skillState: { cinderellaBeautyStacks: 0, cinderellaDecoyActive: false },
  };
  return caster;
}

// ── Fix 1: S1 Part1 triggers on ENTER_BURST_III ───────────────────────────────

section('Fix 1: S1 Part1 fires on ENTER_BURST_III, not ENTER_FULL_BURST');
{
  const s1Triggers = SKILL_TRAITS[511]?.skill1?.triggers ?? [];

  const enterB3Trigger = s1Triggers.find(t => t.on === 'ENTER_BURST_III' &&
    t.handler?.toString().includes('cinderella_s1_atkFlat'));
  const enterFBTrigger = s1Triggers.find(t => t.on === 'ENTER_FULL_BURST' &&
    t.handler?.toString().includes('cinderella_s1_atkFlat'));

  eq('S1 Part1 has ENTER_BURST_III handler', !!enterB3Trigger, true);
  eq('S1 Part1 has no ENTER_FULL_BURST atkFlat handler', !!enterFBTrigger, false);

  const state  = makeState();
  const caster = makeCaster();
  state.squad  = [caster];

  enterB3Trigger.handler(state, caster, {});

  const atkFlatBuff = state.buffs.find(b => b.name === 'cinderella_s1_atkFlat' && b.unitId === caster.id);
  eq('atkFlat buff pushed after ENTER_BURST_III', !!atkFlatBuff, true);

  // 0 stacks → finalHp = 1,000,000 → atkFlat = round(1,000,000 × 2.71%)
  eq('atkFlat value with 0 Beautiful stacks', atkFlatBuff?.atkFlat, Math.round(1_000_000 * 0.0271));
  eq('atkFlat endTick = tick + 10s',          atkFlatBuff?.endTick, TICK_RATE * 10);
}

// ── Fix 1 (S2): S2 decoy refresh also on ENTER_BURST_III ─────────────────────

section('Fix 1: S2 decoy refresh triggers on ENTER_BURST_III');
{
  const s2Triggers = SKILL_TRAITS[511]?.skill2?.triggers ?? [];

  const decoyB3 = s2Triggers.find(t => t.on === 'ENTER_BURST_III' &&
    t.handler?.toString().includes('cinderellaDecoyActive'));

  eq('S2 has ENTER_BURST_III decoy handler', !!decoyB3, true);

  const caster = makeCaster();
  caster.skillState.cinderellaDecoyActive = false;
  decoyB3.handler({}, caster, {});
  eq('decoyActive set to true', caster.skillState.cinderellaDecoyActive, true);
}

// ── Fix 2: final Max HP includes external maxHpPct buffs ─────────────────────

section('Fix 2: S1 Part1 atkFlat uses getBuffSums maxHpPct (all sources)');
{
  const enterB3Trigger = SKILL_TRAITS[511]?.skill1?.triggers
    .find(t => t.on === 'ENTER_BURST_III' && t.handler);

  // External buff from another character
  const state  = makeState();
  const caster = makeCaster({ hp: 1_000_000 });
  state.squad  = [caster];
  state.buffs.push({ name: 'external_maxHp_buff', unitId: caster.id, maxHpPct: 0.10, endTick: Infinity });

  enterB3Trigger.handler(state, caster, {});

  const atkFlatBuff = state.buffs.find(b => b.name === 'cinderella_s1_atkFlat');
  // finalHp = 1,000,000 × (1 + 0.10) = 1,100,000 → atkFlat = round(1,100,000 × 0.0271)
  eq('atkFlat includes external maxHpPct (+10%)', atkFlatBuff?.atkFlat, Math.round(1_100_000 * 0.0271));

  // Beautiful buff maxHpPct aggregated via getBuffSums
  const state2  = makeState();
  const caster2 = makeCaster({ hp: 1_000_000 });
  state2.squad  = [caster2];
  state2.buffs.push({ name: 'cinderella_beautiful', unitId: caster2.id,
    maxHpPct: 12 * 0.016, endTick: Infinity });
  near('Beautiful 12-stack maxHpPct in getBuffSums', getBuffSums(state2, caster2.id).maxHpPct, 0.192, 0.0001);

  // Beautiful 12 stacks → atkFlat = round(1,192,000 × 0.0271)
  enterB3Trigger.handler(state2, caster2, {});
  const atkFlatBuff2 = state2.buffs.find(b => b.name === 'cinderella_s1_atkFlat');
  eq('atkFlat with Beautiful 12 stacks', atkFlatBuff2?.atkFlat, Math.round(1_192_000 * 0.0271));
}

// ── Fix 3: RELOAD_END removes Charge Speed buff ───────────────────────────────

section('Fix 3: RELOAD_END removes cinderella_s1_chargeSpd (natural reload only)');
{
  const s1Triggers       = SKILL_TRAITS[511]?.skill1?.triggers ?? [];
  const fullChargeTrigger = s1Triggers.find(t => t.on === 'FULL_CHARGE' &&
    t.handler?.toString().includes('chargeSpeedPct'));
  const reloadEndTrigger  = s1Triggers.find(t => t.on === 'RELOAD_END');

  eq('S1 has FULL_CHARGE chargeSpd handler', !!fullChargeTrigger, true);
  eq('S1 has RELOAD_END handler',             !!reloadEndTrigger,  true);

  const state  = makeState();
  const caster = makeCaster();
  state.squad  = [caster];

  // Full charge → chargeSpd buff added
  fullChargeTrigger.handler(state, caster, {});
  const chargeSpdBuff = state.buffs.find(b =>
    b.name === 'cinderella_s1_chargeSpd' && b.unitId === caster.id);
  eq('chargeSpd buff present after FULL_CHARGE', !!chargeSpdBuff, true);
  eq('chargeSpd buff value = 100%', chargeSpdBuff?.chargeSpeedPct, 1.0);

  // RELOAD_END → buff removed
  reloadEndTrigger.handler(state, caster, {});
  const afterReload = state.buffs.find(b =>
    b.name === 'cinderella_s1_chargeSpd' && b.unitId === caster.id);
  eq('chargeSpd buff removed after RELOAD_END', afterReload, undefined);

  // Second FULL_CHARGE → buff re-added (before next natural reload)
  fullChargeTrigger.handler(state, caster, {});
  eq('chargeSpd buff re-added after second FULL_CHARGE',
    !!state.buffs.find(b => b.name === 'cinderella_s1_chargeSpd' && b.unitId === caster.id), true);
}

// ── Fix 6: S3 Part2 mult = Beautiful stacks × 28.9% ─────────────────────────

section('Fix 6: S3 Part2 mirrors Beautiful stack count (mult = stacks × 0.289)');
{
  const burstUseTrigger = SKILL_TRAITS[511]?.burst?.triggers.find(t => t.on === 'BURST_SKILL_USE');
  eq('Burst has BURST_SKILL_USE handler', !!burstUseTrigger, true);

  // 12 Beautiful stacks → mult = 12 × 0.289 = 3.468
  const state  = makeState();
  const caster = makeCaster();
  caster.skillState.cinderellaBeautyStacks = 12;
  state.squad = [caster];

  burstUseTrigger.handler(state, caster, {});

  const expectedMult = 12 * 0.289;
  const allCorrectMult = state.pendingFireInBurstHits.every(h =>
    Math.abs(h.mult - expectedMult) < 0.0001);
  eq('all burst_beautiful hits mult = 12 × 0.289', allCorrectMult, true);

  near('expected mult value', expectedMult, 3.468, 0.0001);

  // label should be 'burst_beautiful'
  eq('all burst_beautiful label correct',
    state.pendingFireInBurstHits.every(h => h.label === 'burst_beautiful'), true);

  // sums = null (recomputed after ENTER_FULL_BURST)
  eq('all burst_beautiful sums = null',
    state.pendingFireInBurstHits.every(h => h.sums === null), true);
}

// ── Fix 7: S3 Part2 fires 10 times (once per S3 Part1 hit) ───────────────────

section('Fix 7: S3 Part2 enqueued exactly 10 times (one per Part1 hit)');
{
  const burstUseTrigger = SKILL_TRAITS[511]?.burst?.triggers.find(t => t.on === 'BURST_SKILL_USE');

  // With Beautiful stacks > 0
  const state  = makeState();
  const caster = makeCaster();
  caster.skillState.cinderellaBeautyStacks = 7;
  state.squad = [caster];

  burstUseTrigger.handler(state, caster, {});

  eq('pendingFireInBurstHits count = 10', state.pendingFireInBurstHits.length, 10);
  eq('burst_seq hit count = 10', caster.skillDamageCount?.burst_seq ?? 0, 10);

  // With 0 stacks: no Part2 enqueued
  const state2  = makeState();
  const caster2 = makeCaster();
  caster2.skillState.cinderellaBeautyStacks = 0;
  state2.squad = [caster2];

  burstUseTrigger.handler(state2, caster2, {});

  eq('no pendingFireInBurstHits when Beautiful = 0', state2.pendingFireInBurstHits.length, 0);
  eq('Part1 still fires 10 times', caster2.skillDamageCount?.burst_seq ?? 0, 10);
}

// ── Fix 8: S3 Part1 marked burstSkillDamage:true ─────────────────────────────

section('Fix 8: S3 Part1 opts contain burstSkillDamage:true');
{
  const burstUseTrigger = SKILL_TRAITS[511]?.burst?.triggers.find(t => t.on === 'BURST_SKILL_USE');
  const handlerSrc      = burstUseTrigger?.handler?.toString() ?? '';

  eq('handler contains burstSkillDamage: true', handlerSrc.includes('burstSkillDamage: true'), true);
  eq('handler labels Part1 as burst_seq',       handlerSrc.includes('burst_seq'),              true);
  eq('handler labels Part2 as burst_beautiful', handlerSrc.includes('burst_beautiful'),         true);
}

// ─────────────────────────────────────────────────────────────────────────────
summary('Cinderella skill tests');
