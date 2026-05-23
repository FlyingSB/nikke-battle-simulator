/**
 * Skill traits registry tests — pure, no CDN, no file I/O.
 *
 * Covers:
 *   getSkillTraits          — null for unknown ids, correct object for registered ids (SKILL_TRAITS_BY_GROUP)
 *   hasSkillTrait           — boolean flag lookup
 *   hasSkillTag             — tag membership check
 *   SKILL_TRAITS            — declarative registry shape validation (resource_id → {skill1,skill2,burst})
 *   SKILL_TRAITS_BY_GROUP   — legacy group_id registry (backward-compat functions)
 *
 * Run: node scripts/tests/test-skills.mjs
 */

import {
  SKILL_TRAITS,
  SKILL_TRAITS_BY_GROUP,
  getSkillTraits,
  hasSkillTrait,
  hasSkillTag,
} from '../../src/data/skill-traits.js';
import {
  pushBuff, getBuffSums, decrementRoundBuffs, parseSkillDuration, TICK_RATE,
} from '../../src/engine/battle-utils.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

// ── T1: getSkillTraits — unknown ids ─────────────────────────────────────────

section('T1: getSkillTraits — unknown / null / undefined');
{
  eq('null input',      getSkillTraits(null),      null);
  eq('undefined input', getSkillTraits(undefined),  null);
  eq('zero',            getSkillTraits(0),           null);
  eq('unregistered id', getSkillTraits(99999),       null);
}

// ── T2: hasSkillTrait — fallback without registration ────────────────────────

section('T2: hasSkillTrait — unregistered id always false');
{
  eq('canHitCore on unknown', hasSkillTrait(99999, 'canHitCore'), false);
  eq('null id',               hasSkillTrait(null,  'canHitCore'), false);
}

// ── T3: hasSkillTag — fallback without registration ──────────────────────────

section('T3: hasSkillTag — unregistered id always false');
{
  eq('tag on unknown', hasSkillTag(99999, 'projectile'), false);
  eq('null id',        hasSkillTag(null,  'projectile'), false);
}

// ── T4: SKILL_TRAITS declarative registry shape validation ───────────────────

section('T4: SKILL_TRAITS — every entry is a valid declarative skill registry (resource_id keyed)');
{
  eq('registry is object', typeof SKILL_TRAITS, 'object');

  let allValid = true;
  for (const [rawId, charSkills] of Object.entries(SKILL_TRAITS)) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) {
      console.log(`  [FAIL] key ${rawId}: not a positive integer resource_id`);
      allValid = false;
      continue;
    }
    if (typeof charSkills !== 'object' || charSkills === null) {
      console.log(`  [FAIL] resource_id ${id}: value is not an object`);
      allValid = false;
      continue;
    }
    for (const skillKey of ['skill1', 'skill2', 'burst']) {
      const skill = charSkills[skillKey];
      if (!skill) continue;
      if (!Array.isArray(skill.triggers)) {
        console.log(`  [FAIL] resource_id ${id}.${skillKey}: missing triggers array`);
        allValid = false;
      }
    }
  }
  eq('all registry entries valid', allValid, true);
}

// ── T5: round-trip with synthetic entry (legacy SKILL_TRAITS_BY_GROUP) ────────

section('T5: round-trip with synthetic entry');
{
  const SYNTHETIC_ID = 999001;
  SKILL_TRAITS_BY_GROUP[SYNTHETIC_ID] = { canHitCore: true, tags: ['projectile', 'attachment'] };

  eq('getSkillTraits returns object', typeof getSkillTraits(SYNTHETIC_ID),        'object');
  eq('canHitCore is true',            getSkillTraits(SYNTHETIC_ID).canHitCore,    true);
  eq('hasSkillTrait canHitCore',      hasSkillTrait(SYNTHETIC_ID, 'canHitCore'),  true);
  eq('hasSkillTag projectile',        hasSkillTag(SYNTHETIC_ID, 'projectile'),    true);
  eq('hasSkillTag attachment',        hasSkillTag(SYNTHETIC_ID, 'attachment'),    true);
  eq('hasSkillTag nonexistent',       hasSkillTag(SYNTHETIC_ID, 'explosion'),     false);

  delete SKILL_TRAITS_BY_GROUP[SYNTHETIC_ID];
  eq('cleaned up synthetic entry', getSkillTraits(SYNTHETIC_ID), null);
}

// ── T6: parseSkillDuration — CDN 描述文本解析 ────────────────────────────────

section('T6: parseSkillDuration — "X round(s)" and time variants');
{
  eq('10 round(s)',           JSON.stringify(parseSkillDuration('10 round(s)')),          '{"type":"rounds","count":10}');
  eq('for 10 round(s)',       JSON.stringify(parseSkillDuration('for 10 round(s)')),       '{"type":"rounds","count":10}');
  eq('for 10 round(s) (upper)',JSON.stringify(parseSkillDuration('FOR 10 ROUND(S)')),      '{"type":"rounds","count":10}');
  eq('3.5 round(s)',          JSON.stringify(parseSkillDuration('3.5 round(s)')),          '{"type":"rounds","count":3.5}');
  eq('5s time-based',         JSON.stringify(parseSkillDuration('ATK ▲10% 5s')),           '{"type":"time","seconds":5}');
  eq('10.5s time-based',      JSON.stringify(parseSkillDuration('buff lasts 10.5s')),      '{"type":"time","seconds":10.5}');
  eq('null on empty string',  parseSkillDuration(''),                                       null);
  eq('null on non-string',    parseSkillDuration(null),                                     null);
  eq('null on no match',      parseSkillDuration('ATK ▲10% (permanent)'),                  null);
  // Helm Aegis Cannon — Charge Damage ▲X% for 10 round(s)
  const helmDesc = 'Charge Damage ▲50% for 10 round(s)';
  const helmDur  = parseSkillDuration(helmDesc);
  eq('helm desc type',  helmDur?.type,  'rounds');
  eq('helm desc count', helmDur?.count, 10);
}

// ── T7: round-based buff — pushBuff / getBuffSums / decrementRoundBuffs ───────

section('T7: round-based buff lifecycle');
{
  const unitId = 352;  // Helm resource_id used for clarity
  const state  = { tick: 0, buffs: [], buffLog: null };
  const mockSquad = { squad: [{ id: unitId, equipAtkPct: 0 }], buffs: state.buffs };

  // Push round-based buff
  pushBuff(state, { name: 'test_round_buff', unitId, chargeDamagePct: 0.5, endTick: Infinity, endRounds: 3 });
  eq('buff created',          state.buffs.length,          1);
  eq('roundsLeft initialized', state.buffs[0].roundsLeft,  3);

  // getBuffSums includes it while roundsLeft > 0
  eq('buff active (round 3)', getBuffSums(mockSquad, unitId).chargeDamagePct, 0.5);

  decrementRoundBuffs(state, unitId);
  eq('roundsLeft after 1 shot', state.buffs[0].roundsLeft, 2);
  eq('buff active (round 2)', getBuffSums(mockSquad, unitId).chargeDamagePct, 0.5);

  decrementRoundBuffs(state, unitId);
  decrementRoundBuffs(state, unitId);
  eq('roundsLeft exhausted',  state.buffs[0].roundsLeft,   0);
  eq('buff expired in sums',  getBuffSums(mockSquad, unitId).chargeDamagePct, 0);

  // decrementRoundBuffs does not go below 0
  decrementRoundBuffs(state, unitId);
  eq('roundsLeft not negative', state.buffs[0].roundsLeft, 0);

  // Refresh (re-push same buff name) resets roundsLeft
  pushBuff(state, { name: 'test_round_buff', unitId, chargeDamagePct: 0.5, endTick: Infinity, endRounds: 3 });
  eq('roundsLeft refreshed', state.buffs[0].roundsLeft, 3);
  eq('buff active again',    getBuffSums(mockSquad, unitId).chargeDamagePct, 0.5);

  // decrementRoundBuffs does not touch buffs belonging to other units
  const otherId = 999;
  pushBuff(state, { name: 'other_buff', unitId: otherId, chargeDamagePct: 0.2, endTick: Infinity, endRounds: 2 });
  decrementRoundBuffs(state, unitId);  // only decrements unitId=352 buffs
  const otherBuff = state.buffs.find(b => b.name === 'other_buff');
  eq('other unit buff untouched', otherBuff.roundsLeft, 2);
}

// ── T8: Helm burst — for 10 round(s) charge damage buff ──────────────────────

section('T8: Helm burst uses round-based charge damage buff');
{
  const helmTraits   = SKILL_TRAITS[352];
  const burstTriggers = helmTraits?.burst?.triggers ?? [];
  const burstUseTrigger = burstTriggers.find(t => t.on === 'BURST_SKILL_USE');

  eq('Helm has burst BURST_SKILL_USE trigger', !!burstUseTrigger, true);
  eq('Helm burst has handler (not pure declarative)', typeof burstUseTrigger?.handler, 'function');

  // No FULL_CHARGE trigger on Helm burst (removed — decrementRoundBuffs handles it)
  const fullChargeTrigger = burstTriggers.find(t => t.on === 'FULL_CHARGE');
  eq('Helm burst has no FULL_CHARGE trigger', fullChargeTrigger, undefined);

  // Simulate burst handler: push round-based buff
  const unitId = 352;
  const state  = {
    tick: 0, buffs: [],
    squad: [{ id: unitId, equipAtkPct: 0, stats: { atk: 10000 }, totalDamage: 0 }],
    enemyHp: 1e9, enemyDef: 0, enemyDamageTakenPct: 0,
    fullBurstActive: false, buffLog: null, hitLog: null,
    pendingSkillHits: [],
  };
  const mockSquad = { squad: state.squad, buffs: state.buffs };
  const caster = state.squad[0];
  caster.ssrFavSkills = {
    burst: {
      _activeSkillLevel: 1,
      description_value_list: [
        { description_value: ['1237.5'] },   // dmg
        { description_value: ['54.45'] },    // life steal
        {},
        { description_value: ['50'] },       // charge dmg buff 50%
      ],
    },
  };
  caster.skillState = { helmChargeShots: 0, helmChargeDmgBuff: 0 };

  burstUseTrigger.handler(state, caster, {});

  const chargeBuff = state.buffs.find(b => b.name === 'helm_burst_chargeDmg');
  eq('helm_burst_chargeDmg buff pushed',     !!chargeBuff,             true);
  eq('helm_burst_chargeDmg endRounds=10',    chargeBuff?.endRounds,    10);
  eq('helm_burst_chargeDmg roundsLeft=10',   chargeBuff?.roundsLeft,   10);
  eq('helm_burst_chargeDmg chargeDamagePct', chargeBuff?.chargeDamagePct, 0.5);
  eq('helm_burst_chargeDmg endTick=Infinity', chargeBuff?.endTick,     Infinity);

  // After 10 decrements, buff is exhausted
  for (let i = 0; i < 10; i++) decrementRoundBuffs(state, unitId);
  eq('after 10 rounds exhausted',  chargeBuff.roundsLeft, 0);
  eq('no chargeDmg in sums',       getBuffSums(mockSquad, unitId).chargeDamagePct, 0);
}

// ── T9: Moran SSR burst — handler reads ssrFavSkills (Peony Hairpin skill lv10) ──

section('T9: Moran SSR burst — handler sets weaponSwitch + lifeSteal + ATK buff');
{
  const moranTraits    = SKILL_TRAITS[281];
  const burstTriggers  = moranTraits?.burst?.triggers ?? [];
  const burstUseTrigger = burstTriggers.find(t => t.on === 'BURST_SKILL_USE');

  eq('Moran has burst BURST_SKILL_USE trigger',     !!burstUseTrigger,               true);
  eq('Moran burst uses handler (SSR-dynamic)',       typeof burstUseTrigger?.handler, 'function');

  // S1: SHOT_COUNT checks weaponSwitchEndTick; no stale moranBurstEndTick reference
  const s1Triggers  = moranTraits?.skill1?.triggers ?? [];
  const shotTrigger = s1Triggers.find(t => t.on === 'SHOT_COUNT');
  const handlerSrc  = shotTrigger?.handler?.toString() ?? '';
  eq('S1 does not reference moranBurstEndTick', handlerSrc.includes('moranBurstEndTick'), false);
  eq('S1 checks weaponSwitchEndTick',           handlerSrc.includes('weaponSwitchEndTick'), true);

  // S1: BATTLE_START sets Fervor
  eq('S1 has BATTLE_START (Fervor) trigger',
    !!s1Triggers.find(t => t.on === 'BATTLE_START'), true);

  // S2: ENTER_FULL_BURST Fervor CD reduction
  const s2Triggers = moranTraits?.skill2?.triggers ?? [];
  eq('S2 has ENTER_FULL_BURST (Fervor CD) trigger',
    !!s2Triggers.find(t => t.on === 'ENTER_FULL_BURST'), true);

  // Simulate burst handler — Peony Hairpin skill lv10 (index 9)
  const unitId = 281;
  const state  = {
    tick: 0, buffs: [], buffLog: null,
    squad: [{ id: unitId, equipAtkPct: 0, stats: { atk: 100000, hp: 500000 } }],
  };
  const caster = state.squad[0];
  caster.skillState                = { weaponSwitchEndTick: 0, moranFervorActive: true };
  caster.burstCdRemaining = 1200;  // simulated CD remaining: 20s × 60 ticks = 1200
  caster.ssrFavSkills = {
    burst: {
      _activeSkillLevel: 10,
      description_value_list: [
        { description_value: ['11.46','11.82','12.18','12.54','12.9','13.26','13.62','13.98','14.34','14.7'] },
        { description_value: ['19.89','21.7','23.51','25.31','27.12','28.92','30.73','32.53','34.34','36.14'] },
        { description_value: ['10','10','10','10','10','10','10','10','10','10'] },
        { description_value: ['10','10','10','10','10','10','10','10','10','10'] },
        { description_value: ['21.78','23.26','24.75','26.23','27.72','29.2','30.69','32.17','33.66','35.14'] },
        { description_value: ['10','10','10','10','10','10','10','10','10','10'] },
        { description_value: ['8.16','8.91','9.65','10.39','11.13','11.88','12.62','13.36','14.1','14.85'] },
        { description_value: ['10','10','10','10','10','10','10','10','10','10'] },
        { description_value: ['23.41','25.54','27.67','29.79','31.92','34.05','36.18','38.31','40.44','42.57'] },
        { description_value: ['10','10','10','10','10','10','10','10','10','10'] },
      ],
    },
    skill1: {
      _activeSkillLevel: 10,
      description_value_list: [
        { description_value: ['1.93','2.1','2.28','2.45','2.63','2.81','2.98','3.16','3.33','3.51'] },
        { description_value: ['25.95','28.31','30.67','33.03','35.38','37.74','40.1','42.46','44.82','47.18'] },
        { description_value: ['5','5','5','5','5','5','5','5','5','5'] },
        { description_value: ['20','20','20','20','20','20','20','20','20','20'] },
      ],
    },
  };

  burstUseTrigger.handler(state, caster, {});

  // Weapon switch state written directly (equivalent to WEAPON_SWITCH effect)
  eq('weaponSwitchHitMult = lv10 value',     caster.skillState.weaponSwitchHitMult,       parseFloat('14.7') / 100);
  eq('weaponSwitchEndTick = 600 (10s)',       caster.skillState.weaponSwitchEndTick,        600);
  eq('weaponSwitchUnlimitedAmmo = true',      caster.skillState.weaponSwitchUnlimitedAmmo, true);
  eq('weaponSwitchRoundsLeft = 0',            caster.skillState.weaponSwitchRoundsLeft,     0);

  // Life steal buff (self only)
  const lsBuff = state.buffs.find(b => b.name === 'moran_burst_lifeSteal');
  eq('lifeSteal buff pushed',                 !!lsBuff,               true);
  eq('lifeStealPct = lv10 value',             lsBuff?.lifeStealPct,   parseFloat('36.14') / 100);
  eq('lifeSteal unitId = caster (self)',       lsBuff?.unitId,         unitId);

  // ATK flat buff for all allies (SSR)
  const atkBuff = state.buffs.find(b => b.name === 'moran_burst_atkFlat');
  eq('ATK flat buff pushed (SSR)',            !!atkBuff,              true);
  eq('ATK flat unitId = null (global)',        atkBuff?.unitId,        null);
  eq('ATK flat = round(atk * 42.57%)',         atkBuff?.atkFlat,       Math.round(100000 * parseFloat('42.57') / 100));

  // S1 Fervor: burst CD reduced by 20s (1200 ticks) → max(0, 1200 - 1200) = 0
  eq('Fervor reduced own burst CD by 20s',    caster.burstCdRemaining, 0);
}

// ── T10: WEAPON_SWITCH round-based expiry ────────────────────────────────────

section('T10: WEAPON_SWITCH endRounds — round-based weapon switch');
{
  // Simulate executeSkillTriggers applying WEAPON_SWITCH with endRounds
  const unitId = 281;
  const skillState = { weaponSwitchEndTick: 0, weaponSwitchRoundsLeft: 0, weaponSwitchHitMult: 0 };

  // Inline the WEAPON_SWITCH handler logic (as skill-executor would apply it)
  function applyWeaponSwitch(skillState, tick, eff) {
    skillState.weaponSwitchHitMult    = eff.hitMult;
    skillState.weaponSwitchType       = eff.weaponType ?? null;
    skillState.weaponSwitchEndTick    = eff.endRounds !== undefined ? Infinity : tick + 60 * eff.seconds;
    skillState.weaponSwitchRoundsLeft = eff.endRounds ?? 0;
  }

  // Inline the per-shot decrement logic (as onShotFired does)
  function shotDecrement(skillState) {
    if ((skillState.weaponSwitchRoundsLeft ?? 0) > 0) {
      skillState.weaponSwitchRoundsLeft--;
      if (skillState.weaponSwitchRoundsLeft <= 0)
        skillState.weaponSwitchEndTick = 0;
    }
  }

  // Helper: weaponSwitchActive check (same as battle.js)
  function isActive(skillState, tick) {
    return (skillState.weaponSwitchEndTick ?? 0) > 0 && tick <= skillState.weaponSwitchEndTick;
  }

  // Time-based (seconds) — reference behaviour unchanged
  applyWeaponSwitch(skillState, 0, { hitMult: 0.147, seconds: 10 });
  eq('time-based: endTick set',       skillState.weaponSwitchEndTick,    600);
  eq('time-based: roundsLeft = 0',    skillState.weaponSwitchRoundsLeft, 0);
  eq('time-based: active at tick 0',  isActive(skillState, 0),           true);
  eq('time-based: active at tick 599',isActive(skillState, 599),         true);
  eq('time-based: inactive at 601',   isActive(skillState, 601),         false);

  // Round-based (endRounds)
  applyWeaponSwitch(skillState, 0, { hitMult: 0.147, endRounds: 5 });
  eq('round-based: endTick = Infinity',   skillState.weaponSwitchEndTick,    Infinity);
  eq('round-based: roundsLeft = 5',       skillState.weaponSwitchRoundsLeft, 5);
  eq('round-based: active initially',     isActive(skillState, 999999),      true);

  shotDecrement(skillState);
  eq('after 1 shot: roundsLeft = 4',      skillState.weaponSwitchRoundsLeft, 4);
  eq('after 1 shot: still active',        isActive(skillState, 0),           true);

  shotDecrement(skillState); shotDecrement(skillState);
  shotDecrement(skillState); shotDecrement(skillState);
  eq('after 5 shots: roundsLeft = 0',     skillState.weaponSwitchRoundsLeft, 0);
  eq('after 5 shots: endTick cleared',    skillState.weaponSwitchEndTick,    0);
  eq('after 5 shots: inactive',           isActive(skillState, 0),           false);

  // Extra shot after exhaustion must not go below 0
  shotDecrement(skillState);
  eq('extra shot: roundsLeft stays 0',    skillState.weaponSwitchRoundsLeft, 0);

  // Re-activation (burst fired again) resets rounds
  applyWeaponSwitch(skillState, 1000, { hitMult: 0.147, endRounds: 3 });
  eq('reactivated: roundsLeft = 3',       skillState.weaponSwitchRoundsLeft, 3);
  eq('reactivated: active',               isActive(skillState, 1000),        true);
}

// ── T11: Nayuta S2 "exceeds N stack(s)" — 阶段触发阈值 ≥N，不是 >N ───────────

section('T11: Nayuta S2 stage thresholds — ≥2, ≥10, ≥30 (not >2, >10, >30)');
{
  const nayutaTraits = SKILL_TRAITS[223];
  const s2Trigger    = nayutaTraits?.skill2?.triggers?.find(t => t.on === 'INTERVAL');
  eq('Nayuta has S2 INTERVAL trigger', !!s2Trigger, true);

  const unitId = 223;
  function makeState() {
    return {
      tick: 0, buffs: [], buffLog: null, pendingHealReceived: [],
      squad: [{ id: unitId, equipAtkPct: 0,
        stats: { atk: 100000, hp: 500000 },
        unitHp: 500000,
        rawSkill1: null, rawSkill2: null, rawBurst: null,
        skillLevels: [10, 10, 10],
        skillState: { nayutaMemAbsStacks: 0 } }],
    };
  }
  function callN(state, n) {
    const caster = state.squad[0];
    for (let i = 0; i < n; i++) s2Trigger.handler(state, caster);
  }
  function hasStage(state, name) { return !!state.buffs.find(b => b.name === name); }

  // s=1: no stage buffs
  const st1 = makeState();
  callN(st1, 1);
  eq('s=1: no stage1 buff', hasStage(st1, 'nayuta_s2_stage1_atkPct'), false);

  // s=2: Stage 1 fires at exactly s=2 (≥2)
  const st2 = makeState();
  callN(st2, 2);
  eq('s=2: stage1 buff pushed', hasStage(st2, 'nayuta_s2_stage1_atkPct'), true);
  eq('s=2: no stage2 yet',      hasStage(st2, 'nayuta_s2_stage2_attackDmg'), false);

  // s=9: still no stage2
  const st9 = makeState();
  callN(st9, 9);
  eq('s=9: no stage2 buff', hasStage(st9, 'nayuta_s2_stage2_attackDmg'), false);

  // s=10: Stage 2 fires at exactly s=10 (≥10)
  const st10 = makeState();
  callN(st10, 10);
  eq('s=10: stage2 buff pushed', hasStage(st10, 'nayuta_s2_stage2_attackDmg'), true);
  eq('s=10: no stage3 yet',      hasStage(st10, 'nayuta_s2_stage3_coreDmg'), false);

  // s=29: still no stage3
  const st29 = makeState();
  callN(st29, 29);
  eq('s=29: no stage3 buff', hasStage(st29, 'nayuta_s2_stage3_coreDmg'), false);

  // s=30: Stage 3 fires at exactly s=30
  const st30 = makeState();
  callN(st30, 30);
  eq('s=30: stage3 buff pushed', hasStage(st30, 'nayuta_s2_stage3_coreDmg'), true);

  // s=31+: capped at 30, stage1 buff not pushed twice
  const st31 = makeState();
  callN(st31, 31);
  const stage1Buffs = st31.buffs.filter(b => b.name === 'nayuta_s2_stage1_atkPct');
  eq('s=31: stage1 not pushed twice', stage1Buffs.length, 1);
}

// ── T12: Memory Incineration FC count time-based + full magazine on switch ────

section('T12: Memory Incineration — time-based FC count (duration÷chargeTime), full mag');
{
  const DURATION_S    = 10;
  const CHARGE_TIME_S = 1.8;
  const TICK_RATE_VAL = 60;

  // floor(10 / 1.8) = 5; 6th would fire at t=10.8s (outside the 10s window)
  const fcCount = Math.floor(DURATION_S / CHARGE_TIME_S);
  eq('FC count = floor(10 / 1.8) = 5', fcCount, 5);

  // Last valid FC fires at tick 5 × 1.8 × 60 = 540 (≤ window end 600)
  const lastFcTick    = fcCount * CHARGE_TIME_S * TICK_RATE_VAL;
  const windowEndTick = DURATION_S * TICK_RATE_VAL;
  eq('5th FC tick (540) ≤ window end (600)', lastFcTick <= windowEndTick, true);

  // 6th FC tick = 6 × 1.8 × 60 = 648 — past the 10s window
  const sixthFcTick = (fcCount + 1) * CHARGE_TIME_S * TICK_RATE_VAL;
  eq('6th FC tick (648) > window end (600)', sixthFcTick > windowEndTick, true);

  // Burst handler must use weapon switch, not pendingSkillHits
  const nayutaTraits = SKILL_TRAITS[223];
  const burstTrigger = nayutaTraits?.burst?.triggers?.find(t => t.on === 'BURST_SKILL_USE');
  const handlerSrc   = burstTrigger?.handler?.toString() ?? '';
  eq('burst handler writes weaponSwitchEndTick',   handlerSrc.includes('weaponSwitchEndTick'), true);
  eq('burst handler does not use pendingSkillHits', handlerSrc.includes('pendingSkillHits'), false);

  // Simulate burst handler — verify full magazine: chargeTick = T + chargeTimeTicks
  const unitId = 223;
  const T = 1000;
  const state = {
    tick: T, buffs: [], buffLog: null, hitLog: null,
    enemyHp: 1e9, enemyDef: 0, enemyDamageTakenPct: 0,
    fullBurstActive: true,
    squad: [{ id: unitId, equipAtkPct: 0,
      stats: { atk: 100000, critRate: 0.15, critDmg: 0.5 },
      totalDamage: 0,
      rawSkill1: null, rawSkill2: null, rawBurst: null,
      skillLevels: [10, 10, 10],
      skillState: {} }],
  };
  const caster = state.squad[0];
  burstTrigger.handler(state, caster, {});

  const expectedChargeTicks = Math.round(CHARGE_TIME_S * TICK_RATE_VAL); // 108
  eq('weaponSwitchChargeTimeTicks = 108 (1.8s × 60)',
    caster.skillState.weaponSwitchChargeTimeTicks, expectedChargeTicks);
  eq('weaponSwitchEndTick = T + 600 (10s window)',
    caster.skillState.weaponSwitchEndTick, T + windowEndTick);
  eq('chargeTick = T + 108 (full magazine: first FC ready at t+1.8s)',
    caster.chargeTick, T + expectedChargeTicks);
  eq('weaponSwitchFullChargeDamage = 25000 (250% FC)',
    caster.skillState.weaponSwitchFullChargeDamage, 25000);
  eq('weaponSwitchUnlimitedAmmo = true',
    caster.skillState.weaponSwitchUnlimitedAmmo, true);
}

// ── T13: S1 Part3 — 150% + 380.46% = 530.46% total for boss during FC ────────

section('T13: Nayuta S1 Part3 — FULL_CHARGE during Memory Incineration fires 530.46%');
{
  const nayutaTraits = SKILL_TRAITS[223];
  const s1Triggers   = nayutaTraits?.skill1?.triggers ?? [];
  const fcTrigger    = s1Triggers.find(t => t.on === 'FULL_CHARGE');

  eq('S1 has FULL_CHARGE trigger', !!fcTrigger, true);
  eq('S1 FULL_CHARGE uses handler', typeof fcTrigger?.handler, 'function');

  // 150% (all enemies) + 380.46% (stage target / boss) = 530.46% total for boss
  const allEnemiesMult = 1.50;
  const additionalMult = 3.8046;
  const totalBossMult  = allEnemiesMult + additionalMult;
  eq('150% + 380.46% = 530.46%', Math.round(totalBossMult * 10000) / 10000, 5.3046);

  // Simulate: Memory Incineration active → handler fires hit with mult=5.3046
  const unitId = 223;
  const T = 500;
  const zeroSums = {
    atkPct: 0, atkFlat: 0, attackDamagePct: 0, critRateBonus: 0,
    critDmgBonus: 0, chargeDamagePct: 0, lifeStealPct: 0, distributedDamagePct: 0,
    coreDamagePct: 0,
  };
  const state = {
    tick: T, buffs: [], buffLog: null, hitLog: [],
    enemyHp: 1e9, enemyDef: 0, enemyDamageTakenPct: 0,
    fullBurstActive: true,
    squad: [{ id: unitId, equipAtkPct: 0,
      stats: { atk: 100000, critRate: 1, critDmg: 0.5 },
      totalDamage: 0, skillDamage: {}, skillDamageCount: {} }],
  };
  const caster = state.squad[0];
  caster.skillState = { weaponSwitchEndTick: T + 600 }; // switch active
  fcTrigger.handler(state, caster, { sums: zeroSums });

  const hitEntry = state.hitLog.find(h => h.label === 'S1');
  eq('hitLog entry for S1 exists', !!hitEntry, true);
  eq('hitMult = 5.3046', hitEntry?.hitMult, 5.3046);

  // When Memory Incineration is NOT active, handler must not fire
  const stateOff = {
    tick: T, buffs: [], buffLog: null, hitLog: [],
    enemyHp: 1e9, enemyDef: 0, enemyDamageTakenPct: 0, fullBurstActive: false,
    squad: [{ id: unitId, equipAtkPct: 0,
      stats: { atk: 100000, critRate: 1, critDmg: 0.5 },
      totalDamage: 0, skillDamage: {}, skillDamageCount: {} }],
  };
  const casterOff = stateOff.squad[0];
  casterOff.skillState = { weaponSwitchEndTick: 0 };
  fcTrigger.handler(stateOff, casterOff, { sums: zeroSums });
  eq('S1 Part3 does NOT fire when Memory Incineration inactive', stateOff.hitLog.length, 0);

  // Verify Indomitability sets 9s end tick at battle start
  const battleStartTrigger = s1Triggers.find(t => t.on === 'BATTLE_START');
  eq('S1 has BATTLE_START trigger (Indomitability)', !!battleStartTrigger, true);
  const bsState  = { tick: 0 };
  const bsCaster = { skillState: {} };
  battleStartTrigger.handler(bsState, bsCaster);
  eq('Indomitability endTick = 9 × 60 = 540', bsCaster.skillState.nayutaIndomitabilityEndTick, 540);
}

// ── T14: FC 追加技能伤害充能 — Helm · Maiden: Ice Rose · Liberalio · Neon: Vision Eye ──

section('T14: FC 追加技能伤害充能 — Helm · Maiden · Liberalio · Neon: Vision Eye');
{
  const ENERGY = 15000;

  function makeState(unitId) {
    return {
      tick: 500, burstPhase: 0, burstGauge: 0, burstEnergyLog: null,
      buffs: [], buffLog: null, hitLog: [],
      enemyHp: 1e9, enemyDef: 0, enemyDamageTakenPct: 0, enemyElement: null,
      fullBurstActive: false,
      squad: [{
        id: unitId, name: String(unitId), equipAtkPct: 0,
        stats: { atk: 100000, critRate: 0, critDmg: 0.5 },
        element: null, weaponType: 'SR',
        totalDamage: 0, skillDamage: {}, skillDamageCount: {},
        targetBurstEnergyPerShot: ENERGY,
        skillState: {},
        skillLevels: [1, 1, 1],
        rawSkill1: null, rawSkill2: null, rawBurst: null,
      }],
    };
  }

  // rawSkill 辅助：vals[paramIndex] 对应 description_value[0]（skillLevel=1）
  function mockRawSkill(vals) {
    return { description_value_list: vals.map(v => ({ description_value: [String(v)] })) };
  }

  // ── Helm (352): S2 SSR FULL_CHARGE → 1 hit → +1×ENERGY ──
  {
    const helmTraits = SKILL_TRAITS[352];
    const fcTrigger  = helmTraits.skill2.triggers.find(t => t.on === 'FULL_CHARGE');
    const state  = makeState(352);
    const caster = state.squad[0];
    caster.ssrFavSkills = {
      skill2: {
        _activeSkillLevel: 1,
        description_value_list: [{}, {}, {}, { description_value: ['100'] }],
      },
    };
    fcTrigger.handler(state, caster, {});
    eq('Helm S2 FC: burstGauge += 1×ENERGY', state.burstGauge, ENERGY);
  }

  // ── Maiden: Ice Rose (183): S2 FULL_CHARGE → 1 hit → +1×ENERGY ──
  {
    const icrTraits = SKILL_TRAITS[183];
    const fcTrigger = icrTraits.skill2.triggers.find(t => t.on === 'FULL_CHARGE');
    const state  = makeState(183);
    const caster = state.squad[0];
    caster.rawSkill2 = mockRawSkill([0, 0, 0, 0, 0, 0, 0, 0, 0, 100]);  // param9 = 100%
    fcTrigger.handler(state, caster, {});
    eq('Maiden S2 FC: burstGauge += 1×ENERGY', state.burstGauge, ENERGY);
  }

  // ── Liberalio (262): S1 T3 FULL_CHARGE → 5 hits → +5×ENERGY ──
  {
    const libTraits = SKILL_TRAITS[262];
    const fcTrigger = libTraits.skill1.triggers
      .filter(t => t.on === 'FULL_CHARGE')
      .find(t => t.handler?.toString().includes('addBurstGauge'));
    const state  = makeState(262);
    const caster = state.squad[0];
    caster.rawSkill1 = mockRawSkill([0, 0, 0, 0, 100, 0]);  // param4 = 100%
    fcTrigger.handler(state, caster, {});
    eq('Liberalio S1 T3 FC: burstGauge += 5×ENERGY', state.burstGauge, 5 * ENERGY);
  }

  // ── Neon: Vision Eye (18): S1 FULL_CHARGE ──
  {
    const nveTraits = SKILL_TRAITS[18];
    const fcTrigger = nveTraits.skill1.triggers.find(t => t.on === 'FULL_CHARGE');
    // rawSkill1: param6 = baseMult (100%), param7 = sfMult (100%)
    const rawS1 = mockRawSkill([0, 0, 0, 0, 0, 0, 100, 100]);

    // 无 Super Firepower → 1 hit → +1×ENERGY
    {
      const state  = makeState(18);
      const caster = state.squad[0];
      caster.rawSkill1 = rawS1;
      fcTrigger.handler(state, caster, {});
      eq('Neon S1 FC (no SF): burstGauge += 1×ENERGY', state.burstGauge, ENERGY);
    }

    // Super Firepower 激活 → 2 hits → +2×ENERGY
    {
      const state  = makeState(18);
      const caster = state.squad[0];
      caster.rawSkill1 = rawS1;
      caster.skillState.nveSuperFirepowerEndTick = state.tick + 600;  // 10s 有效
      fcTrigger.handler(state, caster, {});
      eq('Neon S1 FC (SF active): burstGauge += 2×ENERGY', state.burstGauge, 2 * ENERGY);
    }
  }
}

// ── T15: Blanc S2 Part2 — CD 减少仅在同小队友军存活时触发 ──────────────────────

section('T15: Blanc S2 Part2 — Burst CD ▼40.76s fires only when a same-squad ally is alive');
{
  const blancTraits = SKILL_TRAITS[270];
  const s2Triggers  = blancTraits?.skill2?.triggers ?? [];
  // 第一个 FULL_BURST_END = Part1（HoT），第二个 = Part2（CD 减少）
  const fbeTriggers = s2Triggers.filter(t => t.on === 'FULL_BURST_END');
  const cdTrigger   = fbeTriggers[1];

  eq('Blanc S2 has 2 FULL_BURST_END triggers', fbeTriggers.length, 2);
  eq('Part2 (CD reduction) trigger exists',    !!cdTrigger,         true);

  // _nikkeData.squad 必须非 null——same-squad 条件的前置要求。
  // 模拟 unit 构造器从 CDN 数据推导 squad 字段的过程：
  const blancNikkeData = { squad: '777' };  // Blanc CDN: squad = "777"
  const derivedSquad   = blancNikkeData?.squad ?? null;
  eq('_nikkeData.squad 非 null', derivedSquad !== null, true);
  eq('_nikkeData.squad 为字符串', typeof derivedSquad,  'string');

  const REDUCTION = Math.round(40.76 * TICK_RATE);  // 2446 ticks
  const INIT_CD   = 5000;
  const TICK      = 500;

  function makeBlancState(...allies) {
    const caster = {
      id: 270, squad: derivedSquad, unitHp: 100000,
      burstCdRemaining: INIT_CD,
      skillState: {}, skillLevels: [1, 1, 1],
      rawSkill2: { description_value_list: [
        { description_value: ['1.78'] },   // p01（HoT%，Part2 不读）
        { description_value: ['5'] },
        { description_value: ['40.76'] },
      ]},
    };
    return { tick: TICK, buffs: [], pendingHoTs: [], squad: [caster, ...allies], caster };
  }

  // 场景 A：无友军 → 条件不满足，CD 不变
  {
    const st = makeBlancState();
    cdTrigger.handler(st, st.caster);
    eq('A: 无友军 → CD 不变', st.caster.burstCdRemaining, INIT_CD);
  }

  // 场景 B：同小队友军但已阵亡（unitHp=0）→ 条件不满足，CD 不变
  {
    const st = makeBlancState({ id: 271, squad: '777', unitHp: 0 });
    cdTrigger.handler(st, st.caster);
    eq('B: 同队友军阵亡 → CD 不变', st.caster.burstCdRemaining, INIT_CD);
  }

  // 场景 C：同小队友军存活 → 条件满足，CD ▼2446 ticks
  {
    const st = makeBlancState({ id: 271, squad: '777', unitHp: 50000 });
    cdTrigger.handler(st, st.caster);
    eq('C: 同队友军存活 → CD 减少 2446 ticks',
      st.caster.burstCdRemaining, Math.max(0, INIT_CD - REDUCTION));
  }

  // 场景 D：不同小队友军存活 → 条件不满足，CD 不变
  {
    const st = makeBlancState({ id: 300, squad: 'Counters', unitHp: 80000 });
    cdTrigger.handler(st, st.caster);
    eq('D: 不同小队友军存活 → CD 不变', st.caster.burstCdRemaining, INIT_CD);
  }
}

// ── T16: B3 直接伤害默认/非默认结算配置审计 ──────────────────────────────────
//
// 汇总表（所有 B3 且 S3 造成直接伤害的角色）：
//
// | 角色              | ID  | sums 捕获时机             | 标记（新机制）          | 类别          |
// |-------------------|-----|---------------------------|------------------------|---------------|
// | Privaty           | 170 | BURST_SKILL_USE 即时      | 无（引擎 firing 抑制）  | 默认          |
// | Scarlet           | 222 | BURST_SKILL_USE 即时      | 无（引擎 suppress）     | 默认          |
// | Noir              | 271 | BURST_SKILL_USE 即时      | 无（引擎 firing 抑制）  | 默认          |
// | Raven             | 851 | BURST_SKILL_USE 预捕获    | 无（引擎 suppress）     | 默认          |
// | Drake             | 101 | BURST_SKILL_USE 即时      | 无（引擎 firing 抑制）  | 默认          |
// | Maiden: Ice Rose  | 183 | BURST_SKILL_USE 预捕获    | 无（引擎 suppress）     | 默认          |
// | Cinderella Part1  | 511 | BURST_SKILL_USE 即时      | 无（引擎 firing 抑制）  | 默认          |
// | Soda              | 314 | Stage2/3 buff 后即时      | 无（引擎 firing 抑制）  | 默认          |
// | EVE               | 850 | BURST_SKILL_USE 即时      | 无（声明式，引擎处理）  | 默认          |
// | Elegg: BaS        | 502 | BURST_SKILL_USE 预捕获    | 无（引擎 suppress）     | 默认          |
// | Asuka: WILLE      | 835 | Annihilation 发动时重算   | 无                     | 非默认【已实测】|
// | Rapi: Red Hood    |  16 | 延迟命中时重算            | affectedByFullBurst:true| 非默认【已实测】|
// | Liberalio         | 262 | 延迟命中时重算            | affectedByFullBurst:true| 非默认【已实测】|
// | Cinderella Part2  | 511 | sums:null，EFBF 后重算    | 无                     | 非默认【已实测】|

section('T16: B3 直接伤害默认/非默认结算配置审计');
{
  function makeState(unitId) {
    return {
      tick: 0, buffs: [], buffLog: null, hitLog: [],
      enemyHp: 1e9, enemyDef: 0, enemyDamageTakenPct: 0,
      fullBurstActive: true,
      pendingSkillHits: [], pendingFireInBurstHits: [],
      squad: [{
        id: unitId, equipAtkPct: 0,
        stats: { atk: 100000, critRate: 0, critDmg: 0.5 },
        element: null, totalDamage: 0, skillDamage: {}, skillDamageCount: {},
        skillState: {}, skillLevels: [1, 1, 1],
        rawSkill1: null, rawSkill2: null, rawBurst: null,
      }],
    };
  }
  function rawSkill(vals) {
    return { description_value_list: vals.map(v => ({ description_value: [String(v)] })) };
  }

  // ── EVE (850): declarative SKILL_DAMAGE effects[0] — 无 burstSkillDamage ──
  {
    const trigger = SKILL_TRAITS[850]?.burst?.triggers?.find(
      t => t.on === 'BURST_SKILL_USE' && Array.isArray(t.effects));
    eq('EVE burst: declarative SKILL_DAMAGE trigger 存在', !!trigger, true);
    eq('EVE SKILL_DAMAGE opts.burstSkillDamage 未设置（引擎处理）', trigger?.effects?.[0]?.opts?.burstSkillDamage, undefined);
  }

  // ── Elegg: BaS (502): pendingSkillHits — 无 burstSkillDamage ───────────────
  {
    const trigger = SKILL_TRAITS[502]?.burst?.triggers?.find(t => t.on === 'BURST_SKILL_USE');
    const state   = makeState(502);
    const caster  = state.squad[0];
    caster.skillState = { ebs_ghostCount: 6 };
    caster.rawBurst   = rawSkill([500, 6, 6, 500]);
    trigger.handler(state, caster, {});
    eq('Elegg burst 非13模式: 6 hits 入队', state.pendingSkillHits.length, 6);
    eq('Elegg pendingSkillHits[0].opts.burstSkillDamage 未设置（引擎 suppress）', state.pendingSkillHits[0].opts?.burstSkillDamage, undefined);
    eq('Elegg pendingSkillHits[0].sums 预捕获（非空）', !!state.pendingSkillHits[0].sums, true);
  }

  // ── Elegg 13幽灵模式 ─────────────────────────────────────────────────────────
  {
    const trigger = SKILL_TRAITS[502]?.burst?.triggers?.find(t => t.on === 'BURST_SKILL_USE');
    const state   = makeState(502);
    const caster  = state.squad[0];
    caster.skillState = { ebs_ghostCount: 13 };
    caster.rawBurst   = rawSkill([500, 6, 6, 500]);
    trigger.handler(state, caster, {});
    eq('Elegg burst 13幽灵模式: 13 hits 入队', state.pendingSkillHits.length, 13);
    eq('Elegg 13幽灵 pendingSkillHits[0].opts.burstSkillDamage 未设置（引擎 suppress）', state.pendingSkillHits[0].opts?.burstSkillDamage, undefined);
  }

  // ── Asuka: WILLE (835): 【已实测】非默认 — Annihilation 在 Annihilation State 结束时（≈9s 后）发动 ──
  // S1 Part1 的 ATK▲ / Attack Damage▲ buff 与 annihilationStateEndTick 同时失效；
  // Annihilation 发动时重算 sums（不含已失效 buff），若仍在全爆裂期间享受 +50%。
  {
    // BURST_SKILL_USE：正确设置 annihilationStateEndTick，9s buff 同步到期
    const burstTrigger = SKILL_TRAITS[835]?.burst?.triggers?.find(t => t.on === 'BURST_SKILL_USE');
    const state = makeState(835);
    const caster = state.squad[0];
    caster.ammoLeft = 0; caster.maxAmmo = 100;
    caster.skillState = { annihilationStateEndTick: 0, annihilationFired: false };
    caster.rawBurst   = rawSkill([21, 46.8, 6.62, 36, 9, 9]);
    burstTrigger.handler(state, caster, {});
    const asEnd = caster.skillState.annihilationStateEndTick;
    eq('Asuka BURST_SKILL_USE 设置 annihilationStateEndTick = 9×TICK_RATE', asEnd, 9 * TICK_RATE);
    eq('Asuka BURST_SKILL_USE 不设置 asuka_burstSumsSnapshot（非默认不需快照）',
      caster.skillState.asuka_burstSumsSnapshot, undefined);
    // ATK▲ 和 AttackDmg▲ buff 的 endTick 与 annihilationStateEndTick 相同（同时失效）
    const atkBuff    = state.buffs.find(b => b.name === 'asuka_w_burst_atk');
    const atkDmgBuff = state.buffs.find(b => b.name === 'asuka_w_burst_atkDmg');
    eq('asuka_w_burst_atk.endTick === annihilationStateEndTick（buff 与 Annihilation 同时到期）',
      atkBuff?.endTick, asEnd);
    eq('asuka_w_burst_atkDmg.endTick === annihilationStateEndTick（buff 与 Annihilation 同时到期）',
      atkDmgBuff?.endTick, asEnd);
  }
  {
    // INTERVAL 调用 fireAnnihilation；BURST_SKILL_USE 无快照（源码检查）
    const intervalSrc = SKILL_TRAITS[835]?.burst?.triggers?.find(
      t => t.on === 'INTERVAL')?.handler?.toString() ?? '';
    eq('Asuka INTERVAL handler 调用 fireAnnihilation', intervalSrc.includes('fireAnnihilation'), true);
    const burstSrc = SKILL_TRAITS[835]?.burst?.triggers?.find(
      t => t.on === 'BURST_SKILL_USE')?.handler?.toString() ?? '';
    eq('Asuka BURST_SKILL_USE 源码不含 asuka_burstSumsSnapshot（非默认，不预捕获）',
      burstSrc.includes('asuka_burstSumsSnapshot'), false);
  }

  // ── Cinderella (511): Part1 默认（无标记），Part2 非默认（源码检查）──────────
  {
    const src = SKILL_TRAITS[511]?.burst?.triggers?.find(
      t => t.on === 'BURST_SKILL_USE')?.handler?.toString() ?? '';
    eq('Cinderella Part1 源码不含 burstSkillDamage（默认结算）', src.includes('burstSkillDamage'), false);
    eq('Cinderella Part2 源码含 sums: null（EFBF 后重算）', src.includes('sums: null'), true);
  }

  // ── Soda (314): 无 burstSkillDamage（源码检查）──────────────────────────────
  {
    const src = SKILL_TRAITS[314]?.burst?.triggers?.find(
      t => t.on === 'BURST_SKILL_USE')?.handler?.toString() ?? '';
    eq('Soda burst 源码不含 burstSkillDamage（默认结算）', src.includes('burstSkillDamage'), false);
  }

  // ── Rapi: Red Hood (16): 非默认 — affectedByFullBurst:true，sums 不预捕获 ──
  {
    const trigger = SKILL_TRAITS[16]?.burst?.triggers?.find(
      t => t.on === 'BURST_SKILL_USE' && t.handler?.toString().includes('pendingSkillHits'));
    const state   = makeState(16);
    const caster  = state.squad[0];
    caster.combatAssistStatus = false;
    caster.skillState = {
      rapiShotCount: 0, rapiProjectileThreshold: 120, rapiProjectileAttachMult: 1,
    };
    caster.rawBurst  = rawSkill([100, 10, 18.01, 10, 2808, 421.2]);
    caster.rawSkill2 = rawSkill([0, 0, 0, 0, 150.72]);
    trigger.handler(state, caster, {});
    const hit = state.pendingSkillHits[0];
    eq('Rapi burst: 1 pendingSkillHit 入队', state.pendingSkillHits.length, 1);
    eq('Rapi pendingSkillHits[0].sums 未设置（非默认）', hit.sums, undefined);
    eq('Rapi pendingSkillHits[0].opts.affectedByFullBurst = true（非默认）', hit.opts?.affectedByFullBurst, true);
  }

  // ── Liberalio (262): 非默认 — affectedByFullBurst:true，sums 不预捕获 ────────
  {
    const trigger = SKILL_TRAITS[262]?.burst?.triggers?.find(t => t.on === 'BURST_SKILL_USE');
    const state   = makeState(262);
    const caster  = state.squad[0];
    caster.rawBurst = rawSkill([29.54, 10, 925]);
    trigger.handler(state, caster, {});
    const hit = state.pendingSkillHits[0];
    eq('Liberalio burst: 1 pendingSkillHit 入队', state.pendingSkillHits.length, 1);
    eq('Liberalio pendingSkillHits[0].sums 未设置（非默认）', hit.sums, undefined);
    eq('Liberalio pendingSkillHits[0].opts.affectedByFullBurst = true（非默认）', hit.opts?.affectedByFullBurst, true);
  }
}

summary('Skill traits tests');
