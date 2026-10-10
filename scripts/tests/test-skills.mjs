/**
 * Skill traits registry tests — pure, no CDN（仅注册完整性检查读取 skills/ 目录列表）.
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

import { readdirSync } from 'node:fs';
import {
  SKILL_TRAITS,
  SKILL_TRAITS_BY_GROUP,
  getSkillTraits,
  hasSkillTrait,
  hasSkillTag,
} from '../../src/data/skill-traits.js';
import {
  pushBuff, getBuffSums, decrementRoundBuffs, parseSkillDuration, TICK_RATE,
  getFinalAtk, getFinalMaxHp,
  applyHeal, applyHpLoss, applyLifeSteal, clampHpToMax, getHpRatio, setMaxHpBuffValue, pushHoT,
  applyOverhealStorage, expireOverheal,
} from '../../src/engine/battle-utils.js';
import { getSkillValue } from '../../src/data/models.js';
import { onInterval, executeSkillTriggers, onShotFired, dispatchHpChanged } from '../../src/engine/skill-executor.js';
import { unitDistanceAdvantage } from '../../src/engine/battle-utils.js';
import { BUNNY_STANCE, BUNNY_ENGAGE, getBunnyMode,
         enterBunnyMode } from '../../src/data/skills/bunny-shared.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

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

  // Run all BURST_SKILL_USE handlers (burst is now split into P1/P2/P3)
  for (const t of burstTriggers.filter(t => t.on === 'BURST_SKILL_USE'))
    t.handler(state, caster, {});

  const chargeBuff = state.buffs.find(b => b.name === 'Aegis Cannon (Charge Damage)');
  eq('Aegis Cannon P3 buff pushed',     !!chargeBuff,             true);
  eq('Aegis Cannon P3 endRounds=10',    chargeBuff?.endRounds,    10);
  eq('Aegis Cannon P3 roundsLeft=10',   chargeBuff?.roundsLeft,   10);
  eq('Aegis Cannon P3 chargeDamageMultPct', chargeBuff?.chargeDamageMultPct, 0.5);
  eq('Aegis Cannon P3 无加法 chargeDamagePct', chargeBuff?.chargeDamagePct, undefined);
  eq('Aegis Cannon P3 endTick=Infinity', chargeBuff?.endTick,     Infinity);

  // After 10 decrements, buff is exhausted
  for (let i = 0; i < 10; i++) decrementRoundBuffs(state, unitId);
  eq('after 10 rounds exhausted',  chargeBuff.roundsLeft, 0);
  eq('no chargeDmgMult in sums',   getBuffSums(mockSquad, unitId).chargeDamageMultPct, 0);
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

  // Run all BURST_SKILL_USE handlers (P1 SELF + P2 ALL_ALLIES)
  for (const t of burstTriggers.filter(t => t.on === 'BURST_SKILL_USE'))
    t.handler(state, caster, {});

  // Weapon switch state written directly (equivalent to WEAPON_SWITCH effect)
  eq('weaponSwitchHitMult = lv10 value',     caster.skillState.weaponSwitchHitMult,       parseFloat('14.7') / 100);
  eq('weaponSwitchEndTick = 600 (10s)',       caster.skillState.weaponSwitchEndTick,        600);
  eq('weaponSwitchUnlimitedAmmo = true',      caster.skillState.weaponSwitchUnlimitedAmmo, true);
  eq('weaponSwitchRoundsLeft = 0',            caster.skillState.weaponSwitchRoundsLeft,     0);
  // 变更武器射速 1440 RPM（24 发/秒；来源 nikke.gg，未实测验证）
  eq('weaponSwitchRateOfFire = 1440',         caster.skillState.weaponSwitchRateOfFire,     1440);

  // Life steal buff (self only)
  const lsBuff = state.buffs.find(b => b.name === 'Fair and Square! (Life Steal)');
  eq('lifeSteal buff pushed',                 !!lsBuff,               true);
  eq('lifeStealPct = lv10 value',             lsBuff?.lifeStealPct,   parseFloat('36.14') / 100);
  eq('lifeSteal unitId = caster (self)',       lsBuff?.unitId,         unitId);

  // ATK flat buff for all allies (SSR)
  const atkBuff = state.buffs.find(b => b.name === 'Fair and Square! (ATK)');
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
        // S2 INTERVAL handler 内部也会读 rawSkill1（S1 Part2 buff 值）和 rawSkill2，故需提供最小 mock。
        rawSkill1: { group_id: 'mock_nayuta_s1', description_value_list: [
          null, null,
          { description_value: ['0','0','0','0','0','0','0','0','0','0'] },
          null,
          { description_value: ['0','0','0','0','0','0','0','0','0','0'] },
          null, null,
          { description_value: ['0','0','0','0','0','0','0','0','0','0'] },
        ] },
        rawSkill2: { group_id: 'mock_nayuta_s2', description_value_list: Array.from({ length: 9 }, () =>
          ({ description_value: ['0','0','0','0','0','0','0','0','0','0'] })
        ) },
        rawBurst: null,
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
  eq('s=1: no stage1 buff', hasStage(st1, 'Impermanence (ATK)'), false);

  // s=2: Stage 1 fires at exactly s=2 (≥2)
  const st2 = makeState();
  callN(st2, 2);
  eq('s=2: stage1 buff pushed', hasStage(st2, 'Impermanence (ATK)'), true);
  eq('s=2: no stage2 yet',      hasStage(st2, 'Impermanence (Attack Damage)'), false);

  // s=9: still no stage2
  const st9 = makeState();
  callN(st9, 9);
  eq('s=9: no stage2 buff', hasStage(st9, 'Impermanence (Attack Damage)'), false);

  // s=10: Stage 2 fires at exactly s=10 (≥10)
  const st10 = makeState();
  callN(st10, 10);
  eq('s=10: stage2 buff pushed', hasStage(st10, 'Impermanence (Attack Damage)'), true);
  eq('s=10: no stage3 yet',      hasStage(st10, 'Impermanence (Core Damage)'), false);

  // s=29: still no stage3
  const st29 = makeState();
  callN(st29, 29);
  eq('s=29: no stage3 buff', hasStage(st29, 'Impermanence (Core Damage)'), false);

  // s=30: Stage 3 fires at exactly s=30
  const st30 = makeState();
  callN(st30, 30);
  eq('s=30: stage3 buff pushed', hasStage(st30, 'Impermanence (Core Damage)'), true);

  // s=31+: capped at 30, stage1 buff not pushed twice
  const st31 = makeState();
  callN(st31, 31);
  const stage1Buffs = st31.buffs.filter(b => b.name === 'Impermanence (ATK)');
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

  // Burst P3 (SELF) handles weapon switch; find by presence of weaponSwitchEndTick
  const nayutaTraits = SKILL_TRAITS[223];
  const burstTrigger = nayutaTraits?.burst?.triggers?.find(
    t => t.on === 'BURST_SKILL_USE' && t.handler?.toString().includes('weaponSwitchEndTick'));
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
      rawSkill1: null, rawSkill2: null,
      rawBurst: { group_id: 'mock_nayuta_burst', description_value_list: Array.from({ length: 6 }, () =>
        ({ description_value: ['0','0','0','0','0','0','0','0','0','0'] })
      ) },
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

  // Simulate: Memory Incineration active, stage target → two hits: 150% (all) + 380.46% (boss)
  const unitId = 223;
  const T = 500;
  const zeroSums = {
    atkPct: 0, atkFlat: 0, attackDamagePct: 0, critRatePct: 0,
    critDamagePct: 0, chargeDamagePct: 0, lifeStealPct: 0, distributedDamagePct: 0,
    coreDamagePct: 0,
  };
  // rawSkill1 mock：index 6 = p07 (150%), index 9 = p10 (380.46%)，skillLevel=1 取 description_value[0]
  const mockS1 = {
    description_value_list: Object.assign(Array.from({ length: 10 }, () => ({})), {
      6: { description_value: ['150'] },
      9: { description_value: ['380.46'] },
    }),
  };
  const state = {
    tick: T, buffs: [], buffLog: null, hitLog: [],
    enemyHp: 1e9, enemyDef: 0, enemyDamageTakenPct: 0,
    fullBurstActive: true, isStageTarget: true,
    squad: [{ id: unitId, equipAtkPct: 0,
      stats: { atk: 100000, critRate: 1, critDmg: 0.5 },
      totalDamage: 0, skillDamage: {}, skillDamageCount: {} }],
  };
  const caster = state.squad[0];
  caster.rawSkill1  = mockS1;
  caster.skillLevels = [1, 1, 1];
  caster.skillState = { weaponSwitchEndTick: T + 600 }; // switch active
  fcTrigger.handler(state, caster, { sums: zeroSums });

  const hitAll   = state.hitLog.find(h => h.label === 'S1 P4');
  const hitBoss  = state.hitLog.find(h => h.label === 'S1 P5');
  eq('hitLog entry for S1 (all enemies) exists', !!hitAll, true);
  eq('S1 all-enemies hitMult = 1.5',             hitAll?.hitMult, 1.5);
  eq('hitLog entry for S1 Boss (stage target) exists', !!hitBoss, true);
  eq('S1 Boss hitMult = 3.8046',                 Math.round((hitBoss?.hitMult ?? 0) * 10000) / 10000, 3.8046);

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
      .find(t => t.handler?.toString().includes('burstEnergy'));
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
      state.isStageTarget = true;
      const caster = state.squad[0];
      caster.rawSkill1 = rawS1;
      fcTrigger.handler(state, caster, {});
      eq('Neon S1 FC (no SF): burstGauge += 1×ENERGY', state.burstGauge, ENERGY);
    }

    // Super Firepower 激活 → 2 hits → +2×ENERGY
    {
      const state  = makeState(18);
      state.isStageTarget = true;
      const caster = state.squad[0];
      caster.rawSkill1 = rawS1;
      caster.skillState.nveSuperFirepowerEndTick = state.tick + 600;  // 10s 有效
      fcTrigger.handler(state, caster, {});
      eq('Neon S1 FC (SF active): burstGauge += 2×ENERGY', state.burstGauge, 2 * ENERGY);
    }
  }

  // ── 充能并入伤害行：hitLog.gaugeAfter 已含本次充能，handler 路径不再单独推「爆裂槽」事件 ──
  {
    const icrTraits = SKILL_TRAITS[183];
    const fcTrigger = icrTraits.skill2.triggers.find(t => t.on === 'FULL_CHARGE');
    const state  = makeState(183);
    state.pendingSkillEvents = [];
    state._logSeq = 0;
    state._logCtx = { unitName: '183', skillLabel: 'S2', slot: 'skill2', partIdx: 2, trigger: 'FULL_CHARGE' };
    const caster = state.squad[0];
    caster.rawSkill2 = mockRawSkill([0, 0, 0, 0, 0, 0, 0, 0, 0, 100]);
    fcTrigger.handler(state, caster, {});
    eq('合并充能: hitLog 行 gaugeAfter = ENERGY', state.hitLog[0]?.gaugeAfter, ENERGY);
    eq('合并充能: 无单独「爆裂槽」事件',
      state.pendingSkillEvents.filter(e => e.target === '爆裂槽').length, 0);

    // 爆裂期间不充能
    const burstState = makeState(183);
    burstState.burstPhase = 1;
    const burstCaster = burstState.squad[0];
    burstCaster.rawSkill2 = caster.rawSkill2;
    fcTrigger.handler(burstState, burstCaster, {});
    eq('合并充能: 爆裂期间 burstGauge 不变', burstState.burstGauge, 0);
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
  // S1 P1 的 ATK▲ / Attack Damage▲ buff 与 Annihilation State 哨兵 buff 同时失效；
  // Annihilation 发动时重算 sums（不含已失效 buff），若仍在全爆裂期间享受 +50%。
  {
    // BURST_SKILL_USE：推入 Annihilation State 哨兵 buff，9s 各 buff 同步到期
    const burstTrigger = SKILL_TRAITS[835]?.burst?.triggers?.find(t => t.on === 'BURST_SKILL_USE');
    const state = makeState(835);
    const caster = state.squad[0];
    caster.ammoLeft = 0; caster.maxAmmo = 100;
    caster.skillState = { annihilationFired: false };
    caster.rawBurst   = rawSkill([21, 46.8, 6.62, 36, 9, 9]);
    burstTrigger.handler(state, caster, {});
    const annBuff = state.buffs.find(b => b.name === 'Annihilation State' && b.unitId === caster.id);
    const asEnd   = annBuff?.endTick ?? 0;
    eq('Asuka BURST_SKILL_USE 推入 Annihilation State buff，endTick = 9×TICK_RATE', asEnd, 9 * TICK_RATE);
    eq('Asuka BURST_SKILL_USE 不设置 asuka_burstSumsSnapshot（非默认不需快照）',
      caster.skillState.asuka_burstSumsSnapshot, undefined);
    // ATK▲（原 P1 L6）与 Attack Damage▲（原 P1 L7）已合并进单个 Annihilation State 哨兵 buff，
    // 与 normalAttackDamagePct 一同携带，随该 buff 同时失效（endTick = asEnd，已在上方校验）
    const bLv          = caster.skillLevels[2];
    const expAtkPct    = getSkillValue(caster.rawBurst, 1, bLv) / 100;
    const expAtkDmgPct = getSkillValue(caster.rawBurst, 3, bLv) / 100;
    eq('Annihilation State buff 携带 atkPct（合并自原 P1 L6）', annBuff?.atkPct, expAtkPct);
    eq('Annihilation State buff 携带 attackDamagePct（合并自原 P1 L7）', annBuff?.attackDamagePct, expAtkDmgPct);
    eq('Annihilation State buff 携带 normalAttackDamagePct -0.40', annBuff?.normalAttackDamagePct, -0.40);
  }
  {
    // BUFF_EXPIRE handler 在 Annihilation State 到期时发动 Annihilation；BURST_SKILL_USE 无快照（源码检查）
    const expireSrc = SKILL_TRAITS[835]?.burst?.triggers?.find(
      t => t.on === 'BUFF_EXPIRE')?.handler?.toString() ?? '';
    eq('Asuka BUFF_EXPIRE handler 检查 annihilationFired 标志', expireSrc.includes('annihilationFired'), true);
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
    // P2 contains pendingSkillHits（P1 is the self attackDmgPct buff）
    const trigger = SKILL_TRAITS[262]?.burst?.triggers?.find(
      t => t.on === 'BURST_SKILL_USE' && t.handler?.toString().includes('pendingSkillHits'));
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

// ── T17: onInterval — 同一技能多个 INTERVAL 触发器各自独立计时 ─────────────────
// 回归：计时 key 曾按 skillKey 共享，第一个触发器推进计时器后第二个永远不触发
// （Mari S2 P2 全员 ATK buff 从未出现在日志中）。

section('T17: onInterval — 同技能多 INTERVAL 触发器独立计时（Mari S2 P1/P2）');
{
  const mockVals = { description_value_list: Array.from({ length: 5 }, () =>
    ({ description_value: Array(10).fill('30.78') })
  ) };
  const state = {
    tick: 0, buffs: [], buffLog: null, pendingHealReceived: [],
    squad: [{
      id: 832, name: 'Mari', equipAtkPct: 0, equipAtkFlat: 0,
      stats: { atk: 100000 },
      rawSkill1: mockVals, rawSkill2: mockVals, rawBurst: null,
      skillLevels: [10, 10, 10],
      skillState: {},
    }],
  };

  // 同名 buff 重复触发时原地刷新 endTick，故按 endTick 变化检测触发时刻
  const p1Ticks = [], p2Ticks = [];
  let p1End = -1, p2End = -1;
  for (state.tick = 0; state.tick <= TICK_RATE * 30; state.tick++) {
    onInterval(state);
    const p1 = state.buffs.find(b => b.name === 'Full Focus P1 (ATK)');
    const p2 = state.buffs.find(b => b.name === 'Full Focus P2 (ATK)');
    if (p1 && p1.endTick !== p1End) { p1Ticks.push(state.tick); p1End = p1.endTick; }
    if (p2 && p2.endTick !== p2End) { p2Ticks.push(state.tick); p2End = p2.endTick; }
  }

  const expected = [TICK_RATE * 10, TICK_RATE * 20, TICK_RATE * 30].join(',');
  eq('P1 于 10s/20s/30s 触发', p1Ticks.join(','), expected);
  eq('P2 于 10s/20s/30s 触发（回归：曾被 P1 抢占计时器而永不触发）', p2Ticks.join(','), expected);

  const p2buff = state.buffs.find(b => b.name === 'Full Focus P2 (ATK)');
  eq('P2 为全员 buff（unitId: null）', p2buff?.unitId, null);
  eq('P2 atkFlat = ATK × p01%', p2buff?.atkFlat, Math.round(100000 * 0.3078));
}

// ── T18–T21 共用：新角色 mock 单位 / 状态 ──────────────────────────────────────
// rawSkill 仅含单等级数值（skillLevels 全为 1），数值取各技能 lv10 实际值。

function mockRawSkill(vals) {
  return { description_value_list: vals.map(v => ({ description_value: [String(v)] })) };
}
function mockUnit(id, overrides = {}) {
  return {
    id, name: `U${id}`, equipAtkPct: 0, equipAtkFlat: 0,
    stats: { atk: 100000, hp: 1000000, critRate: 0, critDmg: 0.5 },
    element: 'Fire', weaponType: 'SR', burstStep: 'Step3', fullChargeDamage: 25000,
    totalDamage: 0, skillDamage: {}, skillDamageCount: {}, skillState: {},
    skillLevels: [1, 1, 1], rawSkill1: null, rawSkill2: null, rawBurst: null,
    ...overrides,
  };
}
function mockState(squad, extra = {}) {
  return {
    tick: 0, buffs: [], buffLog: null, hitLog: null, pendingSkillEvents: null, _logSeq: 0,
    enemyHp: 1e15, enemyDef: 0, enemyDamageTakenPct: 0, enemyElement: 'Wind',
    fullBurstActive: false, burstPhase: 1, pendingHealReceived: [], pendingHpChanged: new Map(), squad, ...extra,
  };
}

// ── T18: 普攻真实伤害标记 normalAttackTrueDamage ──────────────────────────────

section('T18: getBuffSums — normalAttackTrueDamage 布尔标记聚合');
{
  const state = mockState([mockUnit(1)]);
  eq('无 buff 时为 false', getBuffSums(state, 1).normalAttackTrueDamage, false);
  pushBuff(state, { name: 'TD', unitId: 1, normalAttackTrueDamage: true, endTick: Infinity });
  eq('标记 buff 生效后为 true', getBuffSums(state, 1).normalAttackTrueDamage, true);
  eq('他人 buff 不影响', getBuffSums(mockState([mockUnit(2)], { buffs: state.buffs }), 2)
    .normalAttackTrueDamage, false);
}

// ── T19: Bunny Mode（Guilty: Mighty Bunny 404 / Sin: Swift Bunny 405）──────────

section('T19: Bunny Mode — 开局 Stance、形态带动、S2 形态 buff 切换、Mighty Stomp');
{
  const guilty = mockUnit(404, {
    rawSkill1: mockRawSkill([20.1, 1]),
    rawSkill2: mockRawSkill([370.08, 20.45, 40, 450.89]),
    rawBurst:  mockRawSkill([77.35, 10, 101.3, 1, 1400, 1]),
    ammoLeft: 4, maxAmmo: 6, targetBurstEnergyPerShot: 56000,
    backswingTicks: 10, foreswingTicks: 10, chargeTimeTicks: 60,
  });
  const sin = mockUnit(405, {
    rawSkill1: mockRawSkill([15.35, 100, 1, 52.12, 1, 1]),
    rawSkill2: mockRawSkill([35.14, 75.12, 73.22, 5]),
  });
  const state = mockState([guilty, sin]);

  executeSkillTriggers(state, 'BATTLE_START');
  eq('Guilty 开局进入 Stance', getBunnyMode(guilty), BUNNY_STANCE);
  eq('Sin 开局进入 Stance', getBunnyMode(sin), BUNNY_STANCE);
  const enhance = state.buffs.find(b => b.name === 'Chain Enhance' && b.unitId === 404);
  eq('Guilty Stance: Chain Enhance 蓄力伤害 +40%', enhance?.chargeDamagePct, 0.40);
  eq('Sin Stance: Enhanced Bullets 暴击率 +35.14%',
    state.buffs.find(b => b.name === 'Enhanced Bullets' && b.unitId === 405)?.critRatePct, 0.3514);
  eq('Stance 普攻非真实伤害', getBuffSums(state, 404).normalAttackTrueDamage, false);

  // Guilty 进入 Engage → 处于 Stance 的 Sin 被带动进入 Engage
  enterBunnyMode(state, guilty, BUNNY_ENGAGE);
  eq('Guilty 进入 Engage', getBunnyMode(guilty), BUNNY_ENGAGE);
  eq('Sin 被带动进入 Engage', getBunnyMode(sin), BUNNY_ENGAGE);
  eq('Chain Enhance 已移除', state.buffs.some(b => b.name === 'Chain Enhance'), false);
  eq('Engage: Guilty 普攻真实伤害', getBuffSums(state, 404).normalAttackTrueDamage, true);
  eq('Engage: Sin 普攻真实伤害', getBuffSums(state, 405).normalAttackTrueDamage, true);

  // Mighty Stomp：暂存原武器弹药 → 1 回合切换 → 击发后恢复
  enterBunnyMode(state, guilty, BUNNY_STANCE);
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: guilty });
  eq('Stomp 期间弹药 = 1', guilty.ammoLeft, 1);
  eq('Stomp 回合制切换 1 回合', guilty.skillState.weaponSwitchRoundsLeft, 1);
  eq('Stomp 发间固定 90t', guilty.chargeTick, 90);
  eq('1 回合蓄力伤害 +1400%',
    state.buffs.find(b => b.name === "I'm Finally Free...! (Charge Damage)")?.roundsLeft, 1);
  state.tick = 90;
  executeSkillTriggers(state, 'FULL_CHARGE', { unit: guilty, isCharged: true });
  eq('Stomp 击发后恢复原武器弹药 4', guilty.ammoLeft, 4);
  eq('Stomp 击发后按 UP 型重新前摇+蓄力（80t）', guilty.chargeTick, 90 + 80);
  eq('Stance 全蓄力追加伤害命中 1 次', guilty.skillDamageCount['S2 P2'], 1);
}

// ── T20: Persona（Queen (Makoto) 870 / Yukiko 871）────────────────────────────

section('T20: Persona — 1 More 条件、Baton Pass / Follow Up 目标与 FOLLOW_UP 派发');
{
  function personaSquad() {
    const makoto = mockUnit(870, {
      weaponType: 'SG',
      rawSkill1: mockRawSkill([13.59, 14.78, 548.99, 548.99, 50.28, 15]),
      rawSkill2: mockRawSkill([25.56, 17.95, 90.01, 10, 3, 35.2, 3, 0, 30]),
      rawBurst:  mockRawSkill([1421.69, 30.27, 10]),
    });
    const yukiko = mockUnit(871, {
      weaponType: 'MG',
      rawSkill1: mockRawSkill([3, 5.7, 400.31, 65.37, 15]),
      rawSkill2: mockRawSkill([3, 5.7, 90.01, 17.95, 48.15, 10, 3, 80.25, 25, 55.31]),
      rawBurst:  mockRawSkill([1258.79, 45.33, 10]),
    });
    const other = mockUnit(9001);   // 非 Persona 的 B3 友军
    return { makoto, yukiko, other };
  }

  // 风压代码敌人：Makoto 爆裂 → 1 More → S1 P3 伤害 + Baton Pass（仅 Persona B3 队友）
  {
    const { makoto, yukiko, other } = personaSquad();
    const state = mockState([makoto, yukiko, other]);
    executeSkillTriggers(state, 'BATTLE_START');
    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: makoto });
    eq('Makoto 获得 1 More', state.buffs.some(b => b.name === '1 More' && b.unitId === 870), true);
    eq('1 More → S1 P3 分摊伤害 1 次', makoto.skillDamageCount['S1 P3'], 1);
    const baton = state.buffs.find(b => b.name === 'Baton Pass' && b.unitId === 871);
    eq('Baton Pass → Yukiko atkFlat = 施法者 ATK × 35.2%', baton?.atkFlat, 35200);
    eq('Baton Pass 层数上限 3', baton?.stackLimit, 3);
    eq('Baton Pass 不给非 Persona 友军',
      state.buffs.some(b => b.name === 'Baton Pass' && b.unitId === 9001), false);
    eq('Baton Pass 不给自身',
      state.buffs.some(b => b.name === 'Baton Pass' && b.unitId === 870), false);

    // Yukiko 爆裂 → 1 More → Follow Up 给 Makoto → Makoto S1 P4（FOLLOW_UP）
    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: yukiko });
    const follow = state.buffs.find(b => b.name === 'Follow Up' && b.unitId === 870);
    eq('Follow Up → Makoto atkFlat = 施法者 ATK × 80.25%', follow?.atkFlat, 80250);
    eq('Follow Up 持续 25s', follow?.endTick, 25 * TICK_RATE);
    eq('FOLLOW_UP → Makoto S1 P4 分摊伤害 1 次', makoto.skillDamageCount['S1 P4'], 1);
    // Yukiko S1 仅 P3 一处伤害 → 标签为 'S1'（显示技能名）
    eq('Yukiko 1 More → S1 P3 伤害 1 次', yukiko.skillDamageCount['S1'], 1);
    eq('Scarlet Flower 分摊伤害 +90.01%',
      state.buffs.find(b => b.name === 'Scarlet Flower' && b.unitId === 871)?.distributedDamagePct,
      0.9001);

    // 全爆裂结束：解除 Fist of Justice! / Scarlet Flower
    executeSkillTriggers(state, 'FULL_BURST_END');
    eq('Fist of Justice! 于全爆裂结束解除',
      state.buffs.some(b => b.name === 'Fist of Justice!'), false);
    eq('Scarlet Flower 于全爆裂结束解除',
      state.buffs.some(b => b.name === 'Scarlet Flower'), false);
  }

  // 非风压敌人：无 1 More，不触发 S1 P3 / Baton Pass
  {
    const { makoto, yukiko, other } = personaSquad();
    const state = mockState([makoto, yukiko, other], { enemyElement: 'Iron' });
    executeSkillTriggers(state, 'BATTLE_START');
    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: makoto });
    eq('非风压敌人：无 1 More', state.buffs.some(b => b.name === '1 More'), false);
    eq('非风压敌人：无 Baton Pass', state.buffs.some(b => b.name === 'Baton Pass'), false);
    eq('非风压敌人：爆裂伤害照常', makoto.skillDamageCount['Burst'], 1);
  }
}

// ── T21: Drake: Great Villain（104）Super Duper Overdrive ────────────────────

section('T21: Drake: Great Villain — 全爆裂武器切换与结束移除弹药');
{
  const drake = mockUnit(104, {
    weaponType: 'SG', ammoLeft: 9, maxAmmo: 9, reloadTick: 0,
    rawSkill1: mockRawSkill([243.75, 6, 100]),
    rawSkill2: mockRawSkill([6.23, 10.5, 4]),
    rawBurst:  mockRawSkill([27.5, 25, 1350]),
  });
  const state = mockState([drake]);

  executeSkillTriggers(state, 'ENTER_FULL_BURST');
  const st = drake.skillState;
  eq('切换后弹匣 = 6', drake.ammoLeft, 6);
  eq('切换武器类型 Charged（获得蓄力倍率）', st.weaponSwitchType, 'Charged');
  eq('切换武器伤害 243.75%', st.weaponSwitchHitMult, 2.4375);
  eq('全蓄力伤害 300%', st.weaponSwitchFullChargeDamage, 30000);
  eq('霰弹核心率 20%', st.weaponSwitchCoreRate, 0.20);
  eq('固定蓄力 1.5s → 首发 90t', drake.chargeTick, 90);

  state.tick = 600;
  executeSkillTriggers(state, 'FULL_BURST_END');
  eq('全爆裂结束：移除 100% 弹药', drake.ammoLeft, 0);
  eq('切换已结束', st.weaponSwitchEndTick < state.tick, true);
  eq('抑制引擎「切换结束补满弹匣」', st._weaponSwitchAmmoFilled, st.weaponSwitchEndTick);
  const hpStack = state.buffs.find(b => b.name === 'Fashionably Late Villain');
  eq('S2 P1 全队 Max HP flat = 施法者 HP × 10.5%', hpStack?.maxHpFlat, 105000);
  eq('S2 P1 全队 buff（unitId: null）', hpStack?.unitId, null);
  eq('S2 P2 ATK flat 按最终 MaxHP 刷新',
    state.buffs.find(b => b.name === 'Fashionably Late')?.atkFlat,
    Math.round((1000000 + 105000) * 0.0623));
}

// ── T22: Phantom（580）S1 P4 时序与 S2 / 爆裂技能结算顺序 ─────────────────────

section('T22: Phantom — S1 P4 消耗/生成时序、S2 P1→P2→P3、爆裂技能 P1→P2');
{
  function phantomState() {
    const phantom = mockUnit(580, {
      weaponType: 'SG',
      ssrFavSkills: {
        skill1: { _activeSkillLevel: 1,
          ...mockRawSkill([19.02, 5, 15.22, 3, 5, 30, 15.22, 3, 5, 44.41, 1]) },
        skill2: { _activeSkillLevel: 1,
          ...mockRawSkill([49.82, 7.61, 3, 125, 10, 50.32, 5, 18.87, 10]) },
      },
    });
    return { phantom, state: mockState([phantom], { isStageTarget: true, hitLog: [] }) };
  }
  // 模拟引擎单发时序：普攻按此刻 buff 结算 → 实弹消耗 1 回合并移除归零 buff → onShotFired
  function shoot(state, unit) {
    const sums = getBuffSums(state, unit.id);
    let bi = state.buffs.length;
    while (bi--) {
      const b = state.buffs[bi];
      if (b.unitId !== unit.id || b.roundsLeft == null) continue;
      if (--b.roundsLeft <= 0) state.buffs.splice(bi, 1);
    }
    onShotFired(state, unit, { sums, isCharged: false, hitPart: 'body', ammoAfterShot: 5 });
    return sums.attackDamagePct;
  }
  const p4Active = (state) => getBuffSums(state, 580).attackDamagePct;
  const hasCard  = (state) => state.buffs.some(b => b.name === 'Calling Card');
  const P4_PCT   = 44.41 / 100;
  const DIST_PCT = 7.61 / 100;

  // P4 于命中 Calling Card 目标的那一发结算后生成，由下一发普攻享受并消耗
  {
    const { phantom, state } = phantomState();
    eq('第 1 发普攻不享受 P4', shoot(state, phantom), 0);
    eq('第 1 发后敌人处于 Calling Card', hasCard(state), true);
    eq('第 1 发不生成 P4（命中时目标未处于 Calling Card）', p4Active(state), 0);
    eq('第 2 发普攻不享受 P4（此前无 P4）', shoot(state, phantom), 0);
    eq('第 2 发后生成 P4', p4Active(state), P4_PCT);
    eq('第 3 发普攻享受 P4', shoot(state, phantom), P4_PCT);
    eq('第 3 发消耗旧 P4 后生成新 P4（不叠加）', p4Active(state), P4_PCT);
  }

  // 同发触发 S2：P1 / P3 不享受 P4；结算顺序 P1 → P2 → P3
  {
    const { phantom, state } = phantomState();
    state.enemyDef = 1000;
    shoot(state, phantom);                          // 施加 Calling Card + Dagger 1 层
    shoot(state, phantom);                          // 生成 P4
    phantom.skillState.phantomS1StageHitCount = 29; // 下一发达成 30 次命中 → Dagger +1
    const dagger = state.buffs.find(b => b.name === "Thief's Dagger");
    dagger.stacks = 2;                              // 再叠 1 层即满层，触发 S2
    state.hitLog.length = 0;

    eq('触发 S2 的这一发普攻享受已有 P4', shoot(state, phantom), P4_PCT);
    const s2p1 = state.hitLog.find(h => h.label === 'S2 P1');
    const s2p3 = state.hitLog.find(h => h.label === 'S2 P3');
    eq('S2 P1 已触发', !!s2p1, true);
    eq('S2 P3 已触发', !!s2p3, true);
    eq('S2 P1 不享受 P4', s2p1?.attackDamagePct, 0);
    eq('S2 P3 不享受 P4', s2p3?.attackDamagePct, 0);
    eq('S2 P1 享受 Calling Card 减防', s2p1?.enemyDef, 1000 * (1 - 19.02 / 100));
    eq('S2 P3 不享受 Calling Card 减防（已被 P1 移除）', s2p3?.enemyDef, 1000);
    eq('S2 P1 非分摊伤害，不享受 S2 P2', s2p1?.distributedDamagePct, 0);
    eq('S2 P3 享受刚触发的 S2 P2 分摊伤害 ▲', s2p3?.distributedDamagePct, DIST_PCT);
    eq('S2 P3 伤害明细列出 S2 P2',
      s2p3?.buffBreakdown.some(b => b.name === "Thief's Vision P2 (Distributed Damage)"
        && b.distributedDamagePct === DIST_PCT), true);
    eq('S2 后 Calling Card 已移除', hasCard(state), false);
    eq('S2 结算后仍生成新 P4（命中时目标处于 Calling Card）', p4Active(state), P4_PCT);

    eq('下一发普攻享受该 P4', shoot(state, phantom), P4_PCT);
    eq('该发重新施加 Calling Card', hasCard(state), true);
    eq('该发不生成 P4（命中时目标未处于 Calling Card）', p4Active(state), 0);
  }

  // 爆裂技能：P1 享受已有 P4 且不消耗；先结算 P1，再移除 S2 P2、施加 P2 承伤
  {
    const { phantom, state } = phantomState();
    state.enemyElement = 'Fire';
    phantom.ssrFavSkills.burst = { _activeSkillLevel: 1,
      ...mockRawSkill([861.12, 27.5, 10, 9, 30]) };
    shoot(state, phantom);
    shoot(state, phantom);                          // 生成 P4
    pushBuff(state, { name: "Thief's Vision P2 (Distributed Damage)", unitId: 580,
      distributedDamagePct: DIST_PCT, stackLimit: 3, endTick: Infinity });
    state.hitLog.length = 0;

    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: phantom });
    // 爆裂技能仅 P1 一处伤害 → 标签为 'Burst'
    const burstP1 = state.hitLog.find(h => h.label === 'Burst');
    eq('Burst P1 已触发', !!burstP1, true);
    eq('Burst P1 享受已有 P4', burstP1?.attackDamagePct, P4_PCT);
    eq('Burst P1 为分摊伤害', burstP1?.isDistributed, true);
    eq('Burst P1 享受 S2 P2 分摊伤害 ▲', burstP1?.distributedDamagePct, DIST_PCT);
    eq('Burst P1 不享受 Burst P2 承伤 ▲', burstP1?.damageTakenPct, DIST_PCT);
    eq('Burst P1 伤害明细列出 S2 P2',
      burstP1?.buffBreakdown.some(b => b.name === "Thief's Vision P2 (Distributed Damage)"), true);
    eq('爆裂后 S2 P2 叠层已清除',
      state.buffs.some(b => b.name === "Thief's Vision P2 (Distributed Damage)"), false);
    eq('爆裂后 Burst P2 承伤 ▲ 已施加',
      state.buffs.some(b => b.name === 'Secret Trick: Rampage of Thieves (Damage Taken)'), true);
    eq('爆裂技能不消耗 P4', p4Active(state), P4_PCT);
    eq('爆裂后的下一发普攻仍享受 P4', shoot(state, phantom), P4_PCT);
  }
}

// ── T23: Soline: Frost Ticket（74）票 buff 与 First Train Discount ─────────────

section('T23: Soline: Frost Ticket — S1 P1 票 buff 叠层、S2 P2 First Train Discount buff');
{
  const soline = mockUnit(74, {
    unitHp: 1000000,
    rawSkill1: mockRawSkill([10, 2, 7.48]),
    rawSkill2: mockRawSkill([15, 12.27, 1, 6]),
    rawBurst:  mockRawSkill([32.26]),
  });
  const ally  = mockUnit(2, { unitHp: 1000000 });
  const state = mockState([soline, ally]);
  const ticket = id => state.buffs.find(b => b.name === 'Ticket' && b.unitId === id);

  executeSkillTriggers(state, 'BATTLE_START');
  eq('开局每名队员各 1 张票', [ticket(74)?.stacks, ticket(2)?.stacks].join(','), '1,1');
  eq('每张票 Max HP ▲ 施术者 HP × 10%', ticket(2)?.maxHpFlat, 100000);
  eq('票 Max HP 计入 getBuffSums', getBuffSums(state, 2).maxHpFlat, 100000);
  const ftd = state.buffs.find(b => b.name === 'First Train Discount');
  eq('S2 P2 为全员 buff（unitId: null）', ftd?.unitId, null);
  eq('S2 P2 持续 6 秒', ftd?.endTick, TICK_RATE * 6);

  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: soline });
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: soline });
  eq('爆裂发票上限 2 张', ticket(2)?.stacks, 2);
  eq('2 张票 Max HP 叠加', getBuffSums(state, 2).maxHpFlat, 200000);

  // S2 由 HP_CHANGED（HP 下降至 15% 以下）驱动：用 applyHpLoss 模拟 HP 下降并派发事件
  // 与引擎 flushHpEvents 一致：循环派发直到队列清空（handler 内的治疗会产生新的 HP 变化）
  const dropTo = (u, hp) => { applyHpLoss(state, u, u.unitHp - hp); while (dispatchHpChanged(state)); };

  // First Train Discount 期间治疗不消耗票
  dropTo(ally, 100000);
  eq('S2 治疗低血量持票目标', ally.unitHp > 100000, true);
  eq('First Train Discount 期间不消耗票', ticket(2)?.stacks, 2);

  // 进入全爆裂移除 First Train Discount，此后治疗消耗被治疗目标的票
  executeSkillTriggers(state, 'ENTER_FULL_BURST');
  eq('全爆裂移除 First Train Discount',
    state.buffs.some(b => b.name === 'First Train Discount'), false);
  dropTo(ally, 100000);
  eq('移除后治疗消耗目标 1 张票', ticket(2)?.stacks, 1);
  eq('不消耗其他队员的票', ticket(74)?.stacks, 2);

  dropTo(ally, 100000);
  eq('票耗尽后 buff 移除', ticket(2), undefined);

  dropTo(ally, 100000);
  eq('无票目标不被 S2 治疗', ally.unitHp, 100000);
  // 治疗本身（HP 上升）不会连锁触发 S2
  state.pendingHpChanged.clear();

  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: soline });
  eq('票耗尽后再次发票从 1 张开始', ticket(2)?.stacks, 1);
}

// ── T24: 基础值 vs 最终值 — 描述未写 "final" 取基础值，写了 "final" 取含 buff 的最终值 ──

section('T24: Rouge 各 Max HP ▲ 取基础 MaxHP；getFinalAtk / getFinalMaxHp；102 按最终 ATK 选目标');
{
  // Rouge（272）：描述均为 "caster's Max HP"（未写 final）→ 自身 MaxHP buff 不应放大数值
  const rouge = mockUnit(272, {
    rawSkill1: mockRawSkill([8, 5, 5, 7]),
    rawBurst:  mockRawSkill([10, 10, 10, 10, 20, 10, 30, 10]),
    skillState: { rougeCoinLevel: 3 },
  });
  const state = mockState([rouge]);
  pushBuff(state, { name: 'test_maxhp', unitId: 272, maxHpPct: 0.5, maxHpFlat: 500000, endTick: Infinity });
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: rouge });
  const gm = n => state.buffs.find(b => b.name === `Game Master ${n} (Max HP)`)?.maxHpFlat;
  eq('Game Master P2 = 基础 MaxHP × 10%', gm('P2'), 100000);
  eq('Game Master P3 = 基础 MaxHP × 20%', gm('P3'), 200000);
  eq('Game Master P4 = 基础 MaxHP × 30%', gm('P4'), 300000);
  for (let i = 0; i < 8; i++) executeSkillTriggers(state, 'FULL_CHARGE', { unit: rouge });
  eq('Card Throw = 基础 MaxHP × 5%', state.buffs.find(b => b.name === 'Card Throw')?.maxHpFlat, 50000);

  // 最终值辅助函数：含装备词条与 buff
  const u = mockUnit(1, { equipAtkPct: 0.2, equipAtkFlat: 1000 });
  const s2 = mockState([u]);
  pushBuff(s2, { name: 'a', unitId: 1, atkPct: 0.3, atkFlat: 4000, maxHpPct: 0.5, maxHpFlat: 100, endTick: Infinity });
  eq('getFinalAtk = 100000 × 1.5 + 5000', getFinalAtk(s2, u), 155000);
  eq('getFinalMaxHp = 1000000 × 1.5 + 100', getFinalMaxHp(s2, u), 1500100);

  // 102：「highest final ATK」→ 基础 ATK 较低但 buff 后更高的队员应入选
  const caster = mockUnit(102, { stats: { atk: 50000, hp: 1000000 }, rawSkill1: mockRawSkill([10, 10, 10]) });
  const hiBase = mockUnit(2, { stats: { atk: 120000, hp: 1000000 } });
  const hiFinal = mockUnit(3, { stats: { atk: 100000, hp: 1000000 } });
  const s3 = mockState([caster, hiBase, hiFinal]);
  pushBuff(s3, { name: 'boost', unitId: 3, atkFlat: 100000, endTick: Infinity });
  pushBuff(s3, { name: 'boost', unitId: 102, atkFlat: 200000, endTick: Infinity });
  executeSkillTriggers(s3, 'ENTER_FULL_BURST');
  const picked = s3.buffs.filter(b => b.name === 'Straight Shot').map(b => b.unitId).sort().join(',');
  eq('102 选中最终 ATK 最高的 2 名（102、3）', picked, '102,3');
}

// ── T25: pushBuff unitIds（多目标合并日志）与 multiplier（动态倍率标记） ────────

section('T25: pushBuff unitIds — 逐人独立 buff，日志合并为一行；multiplier 透传');
{
  const squad = [mockUnit(1), mockUnit(2), mockUnit(3)];
  const state = mockState(squad, { pendingSkillEvents: [] });
  const logCtx = { unitName: 'U1', skillLabel: 'Test', slot: 'S1', partIdx: 0, lineIdx: null, trigger: 'BATTLE_START' };

  pushBuff(state, { name: 'Multi', unitIds: [2, 3], atkPct: 0.1, stackLimit: 2, endTick: 600 }, logCtx);
  eq('为每个目标各推入 1 条 buff', state.buffs.filter(b => b.name === 'Multi').length, 2);
  eq('目标 2 的 buff unitId=2', state.buffs.some(b => b.name === 'Multi' && b.unitId === 2), true);
  eq('未命中单位 1', getBuffSums(state, 1).atkPct, 0);
  eq('日志仅一行', state.pendingSkillEvents.length, 1);
  eq('目标列列出各单位名', state.pendingSkillEvents[0].target, 'U2、U3');
  // 回归：多目标 buff 仍须写入来源字段，否则 UI Buff 悬浮提示无法链接到技能描述（Elegg 502 Hello Ghost）
  const multi2 = state.buffs.find(b => b.name === 'Multi' && b.unitId === 2);
  eq('多目标 buff 写入 _sourceCaster', multi2?._sourceCaster, 'U1');
  eq('多目标 buff 写入 _sourceSkillLabel', multi2?._sourceSkillLabel, 'Test');
  eq('多目标 buff 写入 _sourcePartIdx', multi2?._sourcePartIdx, 0);

  // 再推一次：各目标独立叠层，仍只记一行
  pushBuff(state, { name: 'Multi', unitIds: [2, 3], atkPct: 0.1, stackLimit: 2, endTick: 600 }, logCtx);
  eq('各目标独立叠到 2 层', state.buffs.filter(b => b.name === 'Multi').every(b => b.stacks === 2), true);
  eq('刷新同样只记一行', state.pendingSkillEvents.length, 2);

  // 覆盖全队 → 目标显示「全体队友」
  pushBuff(state, { name: 'All', unitIds: [1, 2, 3], atkFlat: 100, endTick: 600 }, logCtx);
  eq('覆盖全队时目标为全体队友', state.pendingSkillEvents[2].target, '全体队友');

  // 空数组：不推入、不记日志
  pushBuff(state, { name: 'None', unitIds: [], atkFlat: 100, endTick: 600 }, logCtx);
  eq('空 unitIds 不推入 buff', state.buffs.some(b => b.name === 'None'), false);
  eq('空 unitIds 不记日志', state.pendingSkillEvents.length, 3);

  // multiplier 透传到 buff 对象，并进入伤害明细快照
  pushBuff(state, { name: 'Dyn', unitId: 1, atkFlat: 3000, multiplier: 3, endTick: Infinity });
  eq('multiplier 写入 buff', state.buffs.find(b => b.name === 'Dyn')?.multiplier, 3);
  const { snapshotBuffBreakdown } = await import('../../src/engine/battle-utils.js');
  const bd = snapshotBuffBreakdown(state, 1).find(b => b.name === 'Dyn');
  eq('伤害明细快照携带 multiplier', bd?.multiplier, 3);
  eq('无 multiplier 的 buff 快照为 null', snapshotBuffBreakdown(state, 2).find(b => b.name === 'Multi')?.multiplier, null);
}

// ── T26: Centi（SSR Metal Pendant）— S2 冷却轮询、S1 P1 冷却缩减、S1 P2 钢铁友军叠层、爆裂 DEF ▼ ──

section('T26: Centi — S2 冷却 9s 轮询施放、全蓄力缩减冷却、S2 施放联动 S1 P2、爆裂 P1/P2');
{
  function centiSquad() {
    const fav = (name, vals) => ({ ...mockRawSkill(vals), _activeSkillLevel: 1, name_localkey: name });
    const ssrFavSkills = {
      skill1: fav('Maintain Fortification', [9.16, 5.69, 10, 10, 7, 7, 5, 7, 100]),
      skill2: fav('Field Discussion',       [7, 5, 4.6, 10, 8]),
      burst:  fav('Start Construction',     [5, 145.46, 14.54, 10, 30.2]),
    };
    const centi = mockUnit(80, { weaponType: 'RL', element: 'Iron', unitHp: 1000000, ssrFavSkills,
      rawSkill1: ssrFavSkills.skill1, rawSkill2: ssrFavSkills.skill2, rawBurst: ssrFavSkills.burst });
    const iron  = mockUnit(9001, { element: 'Iron', unitHp: 500000 });
    const fire  = mockUnit(9002, { element: 'Fire', unitHp: 500000 });
    // Naga：S1 P2「when applying Shield」→ 用于验证共享护盾不派发 APPLY_SHIELD
    const naga  = mockUnit(450, { unitHp: 500000,
      rawSkill1: mockRawSkill([12, 14.57, 85.17, 10]),
      rawSkill2: mockRawSkill([5, 2, 40.07, 5, 5, 2, 9.58]),
      rawBurst:  mockRawSkill([10, 16.18, 10, 31.02, 10]) });
    return { centi, iron, fire, naga };
  }

  const { centi, iron, fire, naga } = centiSquad();
  const state = mockState([centi, iron, fire, naga], { pendingShieldReceived: [] });
  executeSkillTriggers(state, 'PROGRAM_INIT');
  eq('开局进入 9s 冷却', centi.skillState.centiS2ReadyTick, 9 * TICK_RATE);

  // S1 P3：战斗开始 → Stockpile 标记 + 全员回复 7% 最终最大 HP
  executeSkillTriggers(state, 'BATTLE_START');
  eq('Stockpile 标记为全队 buff', state.buffs.find(b => b.name === 'Stockpile')?.unitId, null);
  eq('开局回复 7% 施法者最终最大 HP', iron.unitHp, 500000 + 70000);

  // 冷却未到：不施放（INTERVAL 首次调用仅记录起点）
  state.tick = 100;
  onInterval(state);
  eq('冷却未到不施放 S2', state.buffs.some(b => b.name === 'Field Discussion (ATK)'), false);

  // S1 P1：全蓄力 → 冷却 ▼ 9s × 9.16% = 49 ticks
  onShotFired(state, centi, { sums: getBuffSums(state, 80), isCharged: true, hitPart: 'body', ammoAfterShot: 5 });
  eq('全蓄力缩减 S2 冷却 49 ticks', centi.skillState.centiS2ReadyTick, 9 * TICK_RATE - 49);

  // 就绪后由 INTERVAL 轮询施放
  state.tick = centi.skillState.centiS2ReadyTick;
  onInterval(state);
  const atk = state.buffs.find(b => b.name === 'Field Discussion (ATK)');
  eq('S2 施放：全员 ATK flat = 施法者 ATK × 4.6%', atk?.atkFlat, 4600);
  eq('S2 ATK buff 上限 10 层', atk?.stackLimit, 10);
  eq('S2 ATK buff 持续 8s', atk?.endTick, state.tick + 8 * TICK_RATE);
  eq('共享护盾 = 7% 施法者最终最大 HP', state.sharedShieldHp, 70000);
  eq('共享护盾持续 5s', state.sharedShieldEndTick, state.tick + 5 * TICK_RATE);
  eq('共享护盾不写入单位 shieldHp', fire.shieldHp ?? 0, 0);
  eq('共享护盾不进入 APPLY_SHIELD 派发队列', state.pendingShieldReceived.length, 0);
  eq('Naga S1 P2（when applying Shield）未被共享护盾触发',
    state.buffs.some(b => b.name === 'Guardian of Friendship'), false);
  // 对照：Naga 自身真正获盾 → APPLY_SHIELD 应触发 S1 P2
  executeSkillTriggers(state, 'APPLY_SHIELD', { unit: naga });
  eq('Naga 自身获盾时 S1 P2 正常触发', state.buffs.some(b => b.name === 'Guardian of Friendship'), true);
  eq('施放后重新进入 9s 冷却', centi.skillState.centiS2ReadyTick, state.tick + 9 * TICK_RATE);
  const ironBuff = state.buffs.find(b => b.name === 'Maintain Fortification (Elem Adv Damage)' && b.unitId === 9001);
  eq('S1 P2：钢铁友军属性克制攻击伤害 ▲ 5.69%', Math.round((ironBuff?.elementAdvantagePct ?? 0) * 1e6), 56900);
  eq('S1 P2 上限 10 层', ironBuff?.stackLimit, 10);
  eq('S1 P2 不给非钢铁友军',
    state.buffs.some(b => b.name === 'Maintain Fortification (Elem Adv Damage)' && b.unitId === 9002), false);

  // 第二次施放：ATK 与 Elem Adv 各叠 1 层
  state.tick = centi.skillState.centiS2ReadyTick;
  onInterval(state);
  eq('第二次施放 ATK buff 叠至 2 层', atk?.stacks, 2);
  eq('第二次施放 S1 P2 叠至 2 层', ironBuff?.stacks, 2);

  // 爆裂：P1 伤害 1 次 + 敌方 DEF ▼ 14.54% 10s；P2 全员回复 30.2%
  fire.unitHp = 100000;
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: centi });
  // 'Burst' 标签在 fireSkillHit 中解析为爆裂技能名
  eq('爆裂 P1 伤害 1 次', centi.skillDamageCount['Start Construction'], 1);
  const defDown = state.buffs.find(b => b.name === 'Start Construction (DEF Down)');
  eq('敌方 DEF ▼ 14.54%', defDown?.enemyDefDownPct, 0.1454);
  eq('DEF ▼ 作用于敌人', defDown?.unitId, '__enemy__');
  eq('DEF ▼ 持续 10s', defDown?.endTick, state.tick + 10 * TICK_RATE);
  eq('爆裂 P2 全员回复 30.2% 最终最大 HP', fire.unitHp, 100000 + 302000);
}

// ── T27: Ade: Agent Bunny (315) — Minimum Effective Range ─────────────────────
// 机制：有效下界 = bonusrange_min(45) × (1 − Σ%)；Spy Lens 每层 4.44%（=2/45），爆裂 55.56%（=25/45）。
// Spy Lens 叠层挂在 FULL_CHARGE（射后）：本发射击按叠层前的下界判定，S1P1/S2P1/S2P2 也不作用于本发。
// 实测（dev/game-data.md）：P1 → 第 10 枪首次获得距离优势（判定用 9 层，下界 27.04），第 9 枪
// （8 层，下界 29.02）未获得；同枪触发的 S1P1/S2P1/S2P2 均不作用于第 10 枪。P2 距离 20 → 10 层
// 不触发，仅开爆裂（0 层）即触发。

section('T27: Ade: Agent Bunny — Minimum Effective Range 连续下界与 Spy Lens 射后叠层');
{
  function makeAde() {
    return mockUnit(315, {
      bonusRangeMin: 45, bonusRangeMax: 100,
      rawSkill1: mockRawSkill([8.98, 5, 4.44, 10, 5]),
      rawSkill2: mockRawSkill([9.15, 5, 9.36]),
      rawBurst:  mockRawSkill([55.56, 10, 29.85, 10, 5.14, 10]),
    });
  }
  // 模拟一发全蓄力：本发距离优势判定（叠层前）→ 射后触发（Part1 有效射程判定 + Spy Lens 叠层）
  // 返回 { adv, sums }：adv 为本发是否优势，sums 为本发伤害所用的 buff 汇总
  function fullChargeShot(state, ade) {
    state.tick += TICK_RATE;   // 1s 一发，Spy Lens 5s 内持续刷新
    const sums = getBuffSums(state, 315);
    const adv  = unitDistanceAdvantage(ade, state.enemyDistance);
    onShotFired(state, ade, { sums, isCharged: true, hitPart: 'body', ammoAfterShot: 5 });
    return { adv, sums };
  }

  // P1：距离 28（实测区间 [27.04, 29.02)）
  {
    const ade   = makeAde();
    const state = mockState([ade], { enemyDistance: 28 });
    let anyAdvBefore10 = false, shot10 = null;
    for (let i = 1; i <= 10; i++) {
      const r = fullChargeShot(state, ade);
      if (i < 10) anyAdvBefore10 ||= r.adv;
      if (i === 9) {
        eq('第 9 枪射后 Spy Lens 9 层', ade.skillState.aabSpyLensStacks, 9);
        near('9 层下界 = 45 × (1 − 39.96%) = 27.018', ade.skillState.effRangeMin, 27.018);
        eq('前 9 枪未触发 S1 P1 Agent\'s Gaze', state.buffs.some(b => b.name === 'Agent\'s Gaze'), false);
      }
      if (i === 10) shot10 = r;
    }
    eq('前 9 枪均未进入有效射程（第 9 枪判定用 8 层，下界 29.02）', anyAdvBefore10, false);
    eq('第 10 枪进入有效射程（判定用 9 层）', shot10.adv, true);
    eq('第 10 枪伤害未计入 S2 P2 穿透', shot10.sums.pierce, false);
    eq('第 10 枪伤害未计入 S2 P2 ATK%', shot10.sums.atkPct ?? 0, 0);
    eq('第 10 枪射后 Spy Lens 10 层', ade.skillState.aabSpyLensStacks, 10);
    near('10 层下界 = 45 × (1 − 44.4%) = 25.02', ade.skillState.effRangeMin, 25.02);
    eq('第 10 枪射后触发 S1 P1 Agent\'s Gaze（全队 ATK flat）',
      state.buffs.find(b => b.name === 'Agent\'s Gaze')?.atkFlat, Math.round(100000 * 0.0898));
    eq('第 10 枪射后触发 S2 P1 Pierce Damage ▲9.15%',
      state.buffs.find(b => b.name === 'Agent\'s Movement (Pierce Damage)')?.pierceDamagePct, 0.0915);
    eq('第 10 枪射后满层激活 S2 P2 穿透 + ATK ▲9.36% 持续',
      state.buffs.find(b => b.name === 'Agent\'s Movement (ATK)')?.pierce, true);
    eq('第 11 枪伤害计入 S2 P2 穿透', fullChargeShot(state, ade).sums.pierce, true);
  }

  // P2：距离 20 —— 10 层也进不去，仅开爆裂即可
  {
    const ade   = makeAde();
    const state = mockState([ade], { enemyDistance: 20 });
    let anyAdv = false;
    for (let i = 1; i <= 11; i++) anyAdv ||= fullChargeShot(state, ade).adv;
    eq('10 层封顶', ade.skillState.aabSpyLensStacks, 10);
    near('10 层下界 = 45 × (1 − 44.4%) = 25.02', ade.skillState.effRangeMin, 25.02);
    eq('P2 10 层（第 11 枪判定）仍未进入有效射程', anyAdv, false);

    // 10 层 + 爆裂 → 下界 ≈ 0，任意距离均为优势
    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: ade });
    near('10 层 + 爆裂下界 = 45 × (1 − 99.96%) ≈ 0.018', ade.skillState.effRangeMin, 0.018);
    eq('10 层 + 爆裂：距离 5 也为优势', unitDistanceAdvantage(ade, 5), true);
  }
  {
    const ade   = makeAde();
    const state = mockState([ade], { enemyDistance: 20 });
    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: ade });
    near('仅爆裂（0 层）下界 = 45 × (1 − 55.56%) = 19.998', ade.skillState.effRangeMin, 19.998);
    eq('P2 仅开爆裂即进入有效射程', unitDistanceAdvantage(ade, 20), true);
    eq('爆裂 P2 全队 Attack Damage ▲29.85%',
      state.buffs.find(b => b.name === 'Cutting-Edge Agent Equipment')?.attackDamagePct, 0.2985);

    // 爆裂 10s 到期后下一发按 0 层 +1 重新判定：下界回到 43
    state.tick += TICK_RATE * 10;
    fullChargeShot(state, ade);
    near('爆裂到期后 1 层下界 = 45 × (1 − 4.44%) = 43.002', ade.skillState.effRangeMin, 43.002);
    eq('爆裂到期后距离 20 不再是优势', unitDistanceAdvantage(ade, 20), false);
  }
}

// ── T28: HP / MaxHP 机制 ──────────────────────────────────────────────────────
// 引擎：治疗效能（healPotencyPct）× 受治疗量（incomingHealPct）、上限为最终 MaxHP、
//       Max HP ▲ 同步回复当前 HP（noRestore 除外）、到期截断、HP 扣减、生命偷取派发 HEAL_RECEIVED。

section('T28a: 引擎 HP 机制 — 治疗效能 / 受治疗量 / 最终 MaxHP 上限 / Max HP 同步回复 / 扣减 / 生命偷取');
{
  const healer = mockUnit(1, { unitHp: 1000000 });
  const target = mockUnit(2, { unitHp: 500000 });
  const state  = mockState([healer, target]);

  // 治疗效能 × 受治疗量
  pushBuff(state, { name: 'Potency', unitId: 1, healPotencyPct: 0.5, endTick: Infinity });
  pushBuff(state, { name: 'Incoming', unitId: 2, incomingHealPct: 0.1, endTick: Infinity });
  applyHeal(state, target, 1000, null, healer);
  eq('回复量 = 1000 × 1.5 × 1.1', target.unitHp, 500000 + 1650);
  eq('受治疗者进入 HEAL_RECEIVED 队列', state.pendingHealReceived.includes(target), true);
  applyHeal(state, target, 1000);
  eq('无治疗者时只计受治疗量加成', target.unitHp, 500000 + 1650 + 1100);

  // 上限 = 最终 MaxHP（含 maxHpPct buff）
  pushBuff(state, { name: 'MaxHP20', unitId: 2, maxHpPct: 0.2, noRestore: true, endTick: 600 });
  applyHeal(state, target, 10_000_000);
  eq('治疗上限为最终 MaxHP = 1.2M', target.unitHp, 1200000);
  near('getHpRatio 按最终 MaxHP 计算', getHpRatio(state, target), 1);

  // 到期截断
  state.buffs = state.buffs.filter(b => b.name !== 'MaxHP20');
  clampHpToMax(state, target);
  eq('Max HP buff 移除后当前 HP 截断到 1M', target.unitHp, 1000000);

  // Max HP ▲ 同步回复（无 noRestore）：当前 HP 提升同量
  target.unitHp = 800000;
  pushBuff(state, { name: 'Restore10', unitId: 2, maxHpPct: 0.1, endTick: Infinity });
  eq('Max HP ▲10% → 当前 HP +100000', target.unitHp, 900000);
  pushBuff(state, { name: 'NoRestore', unitId: 2, maxHpFlat: 50000, noRestore: true, endTick: Infinity });
  eq('without restoring HP → 当前 HP 不变', target.unitHp, 900000);
  // 叠层 buff 每新增一层回复一层的量
  pushBuff(state, { name: 'Stack', unitId: null, maxHpFlat: 10000, stackLimit: 3, endTick: Infinity });
  eq('全队叠层 buff 第 1 层 → +10000', target.unitHp, 910000);
  pushBuff(state, { name: 'Stack', unitId: null, maxHpFlat: 10000, stackLimit: 3, endTick: Infinity });
  eq('第 2 层 → 再 +10000', target.unitHp, 920000);
  // 就地改写数值
  const stackBuff = state.buffs.find(b => b.name === 'Stack');
  setMaxHpBuffValue(state, stackBuff, { maxHpFlat: 15000 });
  eq('setMaxHpBuffValue 增量 (5000 × 2 层) 同步回复', target.unitHp, 930000);
  setMaxHpBuffValue(state, stackBuff, { maxHpFlat: 0 });
  eq('数值降低后截断：上限 1M×1.1+50000 = 1.15M，当前 930000 不变', target.unitHp, 930000);

  // HP 扣减（不低于 1）
  eq('applyHpLoss 返回实际扣减量', applyHpLoss(state, target, 30000), 30000);
  eq('扣减后 HP', target.unitHp, 900000);
  applyHpLoss(state, target, 5_000_000);
  eq('自损不致死：HP 下限 1', target.unitHp, 1);

  // 生命偷取：受自身治疗效能影响并派发 HEAL_RECEIVED
  state.pendingHealReceived.length = 0;
  healer.unitHp = 100000;
  applyLifeSteal(state, healer, 10000, { lifeStealPct: 0.5 });
  eq('生命偷取 = 10000 × 50% × (1 + 50% 效能)', healer.unitHp, 100000 + 7500);
  eq('生命偷取派发 HEAL_RECEIVED', state.pendingHealReceived.includes(healer), true);
  applyLifeSteal(state, healer, 10000, { lifeStealPct: 0 });
  eq('lifeStealPct = 0 时无回复', healer.unitHp, 107500);

  // HoT 记录 casterId
  const hotState = mockState([healer, target], { pendingHoTs: [] });
  pushHoT(hotState, target, 1000, 3, null, healer);
  eq('HoT 条目数 = 持续秒数', hotState.pendingHoTs.length, 3);
  eq('HoT 条目记录治疗者 id', hotState.pendingHoTs[0].casterId, 1);
}

section('T28b: Grave (514) — Prediction 每秒 HP ▼1%、Heat Emission 每秒回复 2% 最终 MaxHP');
{
  const grave = mockUnit(514, {
    unitHp: 1000000, targetBurstEnergyPerShot: 1000, ammoLeft: 5,
    rawSkill1: mockRawSkill([100, 50, 2, 38.96, 48.4]),
    rawSkill2: mockRawSkill([15, 15.48, 30, 20.66, 60, 30.8]),
    rawBurst:  mockRawSkill([1, 52.8, 48.2, 39.98, 3, 85.19]),
  });
  const state = mockState([grave]);
  onInterval(state);   // 记录 INTERVAL 起点
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: grave });
  eq('Prediction 结束 tick = +10s', grave.skillState.grave_predictionEndTick, 10 * TICK_RATE);
  // 「Current HP ▼1%」= 当前 HP 的 1%，逐秒复利递减
  let expect = 1000000;
  for (let s = 1; s <= 9; s++) { state.tick = s * TICK_RATE; onInterval(state); expect -= Math.round(expect * 0.01); }
  eq('前 9 秒每秒 ▼ 当前 HP 的 1%', grave.unitHp, expect);
  eq('Prediction 期间无 Heat Emission', state.buffs.some(b => b.name === 'Heat Emission'), false);
  // 第 10 秒：同秒 Prediction 到期 → S1 先激活 Heat Emission 并回复 2% 最终 MaxHP，
  // 随后爆裂触发器执行第 10 次扣血（当前 HP 已含该次回复）
  state.tick = 10 * TICK_RATE; onInterval(state);
  expect = expect + 20000; expect -= Math.round(expect * 0.01);
  eq('Prediction 到期时 Heat Emission 已激活',
    state.buffs.some(b => b.name === 'Heat Emission' && b.unitId === 514), true);
  eq('第 10 次扣血与首次回复 +20000', grave.unitHp, expect);
  eq('扣血计数归零', grave.skillState.grave_hpDrainLeft, 0);
  state.tick = 11 * TICK_RATE; onInterval(state);
  eq('Heat Emission 第 2 秒再回复 2% 且不再扣血', grave.unitHp, expect + 20000);
  eq('回复进入 HEAL_RECEIVED 队列', state.pendingHealReceived.includes(grave), true);
  eq('HP 变化进入 HP_CHANGED 队列', state.pendingHpChanged.has(514), true);
}

section('T28c: Red Hood (470) — The Last Howl：受治疗量 ▲ + S2 P3 生命偷取');
{
  const rh = mockUnit(470, { unitHp: 1000000,
    rawSkill1: mockRawSkill([3.81, 10, 5, 240]),
    rawSkill2: mockRawSkill([50.68, 10, 23.04, 10, 71.42, 10]),
    rawBurst:  mockRawSkill([77.55, 10, 0, 10, 74.88, 10, 51.46, 100, 10, 100.8, 10]),
  });
  const state = mockState([rh], { burstPhase: 2 });
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: rh });
  const incoming = state.buffs.find(b => b.name === 'The Last Howl (Incoming Healing)');
  near('自身受治疗量 ▲74.88% 10s', incoming?.incomingHealPct, 0.7488);
  eq('受治疗量持续 10s', incoming?.endTick, 10 * TICK_RATE);
  const ls = state.buffs.find(b => b.name === 'Wild Tooth (Life Steal)');
  eq('S2 P3 生命偷取 23.04%', ls?.lifeStealPct, 0.2304);
  eq('生命偷取归属 S2 P3', ls?._sourcePartIdx, 2);
  applyLifeSteal(state, rh, 100000, getBuffSums(state, 470));
  eq('The Last Howl 期间生命偷取受受治疗量放大：100000 × 23.04% × 1.7488', rh.unitHp,
    Math.min(1000000, 1000000 + Math.round(100000 * 0.2304 * 1.7488)));
  rh.unitHp = 500000;
  applyLifeSteal(state, rh, 100000, getBuffSums(state, 470));
  eq('未满血时实际回复 40292', rh.unitHp, 500000 + Math.round(100000 * 0.2304 * 1.7488));
  eq('Step2 不触发武器切换', rh.skillState.weaponSwitchEndTick ?? 0, 0);
}

section('T28d: Alice (191) — Healthy Carrot 按 HP 比例切换 Pierce / 生命偷取');
{
  const alice = mockUnit(191, { unitHp: 1000000,
    rawSkill1: mockRawSkill([2, 11.67, 10, 7, 10]),
    rawSkill2: mockRawSkill([80, 80, 8.12]),
    rawBurst:  mockRawSkill([80.15, 10, 55.12, 10]),
  });
  const state = mockState([alice]);
  const has = name => state.buffs.some(b => b.name === name && b.unitId === 191);
  executeSkillTriggers(state, 'BATTLE_START');
  eq('满血：Pierce 形态', has('Healthy Carrot (Pierce)'), true);
  eq('满血：无生命偷取', has('Healthy Carrot (Life Steal)'), false);
  applyHpLoss(state, alice, 300000); dispatchHpChanged(state);
  eq('HP 70% < 80%：切换为生命偷取', has('Healthy Carrot (Life Steal)'), true);
  eq('HP 70%：Pierce 移除', has('Healthy Carrot (Pierce)'), false);
  eq('生命偷取 8.12%', state.buffs.find(b => b.name === 'Healthy Carrot (Life Steal)')?.lifeStealPct, 0.0812);
  applyHeal(state, alice, 150000); dispatchHpChanged(state);
  eq('HP 回到 85%：恢复 Pierce', has('Healthy Carrot (Pierce)'), true);
  eq('HP 回到 85%：生命偷取移除', has('Healthy Carrot (Life Steal)'), false);
}

section('T28e: Moran (281) — Perseverance：HP < 20% 边沿触发，三阶段各一次且互不叠加');
{
  const fav = vals => ({ ...mockRawSkill(vals), _activeSkillLevel: 1 });
  const moran = mockUnit(281, { unitHp: 1000000, ssrFavSkills: {
    skill1: fav([3.51, 47.18, 5, 20]),
    skill2: fav([91, 3, 69.84, 3, 51.09, 3, 3, 4, 20, 7.48]),
    burst:  fav([14.7, 36.14, 10, 10, 35.14, 10, 14.85, 10, 42.57, 10]),
  } });
  const state = mockState([moran]);
  const persev = () => state.buffs.find(b => b.name === 'Perseverance' && b.unitId === 281);
  // 用 applyHpLoss / applyHeal 改变 HP 并派发 HP_CHANGED（边沿：变化前 ≥ 20%、变化后 < 20%）
  const setHp = hp => {
    if (hp < moran.unitHp) applyHpLoss(state, moran, moran.unitHp - hp);
    else applyHeal(state, moran, hp - moran.unitHp);
    while (dispatchHpChanged(state));
  };
  state.tick = TICK_RATE;
  setHp(250000);
  eq('HP 25% 未跌破 20%：不触发', persev(), undefined);
  setHp(150000);
  eq('跌破 20%：Once Max HP ▲91%', persev()?.maxHpPct, 0.91);
  eq('持续 3s', persev()?.endTick, TICK_RATE + 3 * TICK_RATE);
  eq('Max HP ▲ 同步回复：150000 + 910000', moran.unitHp, 150000 + 910000);
  // 再次从阈值以上跌破（Max HP 同步回复后 HP 已回到阈值以上）
  setHp(100000);
  eq('Twice：Max HP ▲69.84% 替换 Once', persev()?.maxHpPct, 0.6984);
  eq('阶段间不叠加（仅一条 Perseverance）',
    state.buffs.filter(b => b.name === 'Perseverance').length, 1);
  setHp(50000);
  eq('Three Times：Max HP ▲51.09%', persev()?.maxHpPct, 0.5109);
  eq('阶段计数 = 3', moran.skillState.moranPersevStage, 3);
  const before = persev()?.endTick;
  state.tick = 2 * TICK_RATE;
  setHp(10000);
  eq('第 4 次跌破不再触发（阶段上限 3，buff 不刷新）', persev()?.endTick, before);
}

section('T28f: 治疗效能 buff 来源 — Anchor S1 P1 / Prika S1 P2 / Crown Relax / Flora Peace of Mind 受治疗量 / Liter S2 掩体');
{
  // Anchor: Innocent Maid (355) 首次进入全爆裂 → 全员治疗效能 ▲30.96% 5s
  {
    const anchor = mockUnit(355, { unitHp: 1000000,
      rawSkill1: mockRawSkill([30.96, 5, 30.4, 10, 1, 3.04, 8]),
      rawSkill2: mockRawSkill([10.13, 10, 35.02, 10, 40.04, 15]),
      rawBurst:  mockRawSkill([60.19, 25, 40.18, 30.09, 10]) });
    const state = mockState([anchor], { pendingHoTs: [] });
    executeSkillTriggers(state, 'PROGRAM_INIT');
    executeSkillTriggers(state, 'ENTER_FULL_BURST');
    const b = state.buffs.find(x => x.name === 'Starfish (Shaped) Omurice (Incoming Healing)');
    eq('Anchor 全员受治疗量 ▲30.96%', b?.incomingHealPct, 0.3096);
    eq('Anchor 不提供治疗效能', b?.healPotencyPct, undefined);
    eq('作用于全队（unitId null）', b?.unitId, null);
    eq('持续 5s', b?.endTick, 5 * TICK_RATE);
  }
  // Prika (601) 爆裂 → Performance 期间自身治疗效能 ▲49.92%，HoT 不再预折算
  {
    const prika = mockUnit(601, { unitHp: 1000000,
      rawSkill1: mockRawSkill([20, 3, 13.09, 3, 20, 3, 49.92]),
      rawSkill2: mockRawSkill([19.98, 10, 21, 25.01, 10, 21]),
      rawBurst:  mockRawSkill([3.04, 25, 0, 0, 25, 25]) });
    const ally  = mockUnit(9100, { unitHp: 100000 });
    const state = mockState([prika, ally], { pendingHoTs: [] });
    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: prika });
    const pot = state.buffs.find(x => x.name === 'Let\'s Get the Show Started (Pierce)');
    near('Prika 自身治疗效能 ▲49.92%', pot?.healPotencyPct, 0.4992);
    eq('S1 P2 同时获得 Pierce', pot?.pierce, true);
    eq('效能 buff 随 Performance 25s 到期', pot?.endTick, 25 * TICK_RATE);
    eq('效能 buff 日志归属 S1 P2', pot?._sourcePartIdx, 1);
    const hot = state.pendingHoTs.find(h => h.targetId === 9100);
    eq('HoT 基础量 = 3.04% 最终 MaxHP（未预折算效能）', hot?.amount, 30400);
    eq('HoT 记录治疗者', hot?.casterId, 601);
    applyHeal(state, ally, hot.amount, null, prika);
    eq('HoT 触发时按效能放大：30400 × 1.4992', ally.unitHp, 100000 + Math.round(30400 * 1.4992));
  }
  // Crown (330) Relax 每层受治疗量 ▲4.06%
  {
    const crown = mockUnit(330, { unitHp: 1000000, weaponType: 'MG', ammoLeft: 100,
      rawSkill1: mockRawSkill([64.51, 15, 44.35, 15, 37.44, 15, 44.35, 15]),
      rawSkill2: mockRawSkill([43, 4.06, 20, 5, 5, 5.23, 20.99, 7]),
      rawBurst:  mockRawSkill([36.24, 15, 10.45, 15]) });
    const state = mockState([crown]);
    for (let i = 0; i < 86; i++)
      onShotFired(state, crown, { sums: getBuffSums(state, 330), isCharged: false, hitPart: 'body', ammoAfterShot: 5 });
    const relax = state.buffs.find(b => b.name === 'Relax' && b.unitId === 330);
    eq('86 发 → Relax 2 层', relax?.stacks, 2);
    near('Relax 受治疗量 = 2 × 4.06%', getBuffSums(state, 330).incomingHealPct, 0.0812);
    near('Relax 不提供治疗效能', getBuffSums(state, 330).healPotencyPct ?? 0, 0);
    // Incoming Healing 作用于一切受到的治疗：无治疗者来源（caster=null）的治疗同样被放大
    crown.unitHp = 500000;
    applyHeal(state, crown, 10000, null, null);
    near('他人治疗也受 Relax 放大：10000 × 1.0812', crown.unitHp, 500000 + 10000 * 1.0812, 1);
  }
  // Flora (411) Peace of Mind：受治疗量 ▲4%/层（上限 5），治疗按治疗者效能与受治疗者加成放大
  {
    const fav = vals => ({ ...mockRawSkill(vals), _activeSkillLevel: 1 });
    const flora = mockUnit(411, { unitHp: 1000000, element: 'Electric', ssrFavSkills: {
      skill1: fav([1, 1, 100, 1, 4, 5, 15.01, 2]),
      skill2: fav([90, 10.22, 10, 30.97, 10, 45.12, 10]),
      burst:  fav([10.45, 42.39, 10, 85.86, 10]),
    } });
    const ally  = mockUnit(9200, { unitHp: 100000 });
    const state = mockState([flora, ally]);
    executeSkillTriggers(state, 'BATTLE_START');
    const pom = state.buffs.find(b => b.name === 'Peace of Mind' && b.unitId === 9200);
    eq('相邻友军 Peace of Mind 受治疗量 ▲4%', pom?.incomingHealPct, 0.04);
    eq('受治疗量可叠至 5 层', pom?.stackLimit, 5);
    applyHeal(state, ally, 10000, null, flora);
    eq('受治疗量加成：10000 × 1.04', ally.unitHp, 100000 + 10400);
  }
  // Liter (82) S2 Volt Boost：主动技能 15s 冷却，开局先进入冷却；目标 = 站位最左 2 人
  {
    const liter = mockUnit(82, { unitHp: 1000000, ammoLeft: 10, baseAmmo: 10,
      rawSkill1: mockRawSkill([2.34, 2.7, 3.17, 45.17, 5, 12.46, 5, 14.42, 5]),
      rawSkill2: mockRawSkill([2, 52.5]),
      rawBurst:  mockRawSkill([66, 5]) });
    const a = mockUnit(9301, { unitHp: 1000000 }), b = mockUnit(9302, { unitHp: 1000000 });
    const state = mockState([a, liter, b], { pendingCoverHeal: false, pendingSkillEvents: [], _logSeq: 0 });
    executeSkillTriggers(state, 'PROGRAM_INIT');
    eq('开局进入 15s 冷却', liter.skillState.literS2ReadyTick, 15 * TICK_RATE);
    state.tick = 15 * TICK_RATE - 1; onInterval(state);
    eq('冷却未到不施放', state.pendingCoverHeal, false);
    state.tick = 15 * TICK_RATE; onInterval(state);
    eq('冷却到期施放 → 掩体治疗标记（COVER_HEAL 事件）', state.pendingCoverHeal, true);
    eq('目标为站位最左 2 人', state.pendingSkillEvents.at(-1)?.target, '掩体（U9301、U82）');
    eq('施放后重新进入 15s 冷却', liter.skillState.literS2ReadyTick, 30 * TICK_RATE);
  }
}

section('T28g: 溢出治疗储存 / 平均分摊治疗 / Noir Lucky Charm / Centi S1 P4 / Flora S2 P1、P2 / Crown Relax 顺序');
{
  // 溢出治疗储存：超出最终 MaxHP 的治疗存入储存池（上限 cap），扣减时优先扣储存池，到期移除
  {
    const u = mockUnit(1, { unitHp: 900000 });
    const state = mockState([u]);
    applyOverhealStorage(state, u, 50000, 300);
    applyHeal(state, u, 200000);
    eq('HP 补满到最终 MaxHP', u.unitHp, 1000000);
    eq('溢出 100000 存入储存池，受上限 50000 限制', u.overheal.hp, 50000);
    eq('储存池不计入 HP 比例', getHpRatio(state, u), 1);
    eq('扣减 30000 优先扣储存池', applyHpLoss(state, u, 30000), 30000);
    eq('HP 不变', u.unitHp, 1000000);
    eq('储存池剩余 20000', u.overheal.hp, 20000);
    applyHpLoss(state, u, 50000);
    eq('储存池用尽后扣 HP：1000000 − 30000', u.unitHp, 970000);
    state.tick = 300; expireOverheal(state, u);
    eq('到期移除储存部分', u.overheal, null);
    applyHeal(state, u, 100000);
    eq('到期后溢出不再储存', u.overheal, null);
  }
  // 平均分摊治疗（Nayuta S1 P2 Hypocrisy shareHeal）：原目标受到治疗，其他人仅 HP 变化
  {
    const a = mockUnit(1, { unitHp: 500000 }), b = mockUnit(2, { unitHp: 500000 });
    const c = mockUnit(3, { unitHp: 500000 }), d = mockUnit(4, { unitHp: 500000 });
    const state = mockState([a, b, c, d]);
    pushBuff(state, { name: 'Hypocrisy', unitId: null, shareHeal: true, endTick: 300 });
    applyHeal(state, b, 100000);
    eq('原目标获得 1/4', b.unitHp, 525000);
    eq('其他队员各获得 1/4', [a, c, d].map(u => u.unitHp).join(','), '525000,525000,525000');
    eq('仅原目标进入 HEAL_RECEIVED 队列', state.pendingHealReceived.map(u => u.id).join(','), '2');
    eq('四人均进入 HP_CHANGED 队列', [...state.pendingHpChanged.keys()].sort().join(','), '1,2,3,4');
    state.tick = 300;
    applyHeal(state, b, 100000);
    eq('分摊状态到期后治疗不再分摊', b.unitHp, 625000);
  }
  // Noir (271) Lucky Charm：自身 HP > 70% 时全员 ATK flat；跌破后移除；回升后恢复
  {
    const noir = mockUnit(271, { unitHp: 1000000, rawSkill1: mockRawSkill([70, 14.08]) });
    const state = mockState([noir]);
    const lc = () => state.buffs.find(b => b.name === 'Lucky Charm');
    executeSkillTriggers(state, 'BATTLE_START');
    eq('开局 HP 100% > 70%：全员 ATK flat = 14.08% Noir ATK', lc()?.atkFlat, 14080);
    applyHpLoss(state, noir, 350000); dispatchHpChanged(state);
    eq('HP 65%：Lucky Charm 移除', lc(), undefined);
    applyHeal(state, noir, 100000); dispatchHpChanged(state);
    eq('HP 75%：Lucky Charm 恢复', lc()?.atkFlat, 14080);
  }
  // Centi (80) S1 P3 Stockpile 储存 + P4：Stockpile 期间任意友军 HP 下降 → 全员回复 7% 最终 MaxHP
  {
    const fav = (name, vals) => ({ ...mockRawSkill(vals), _activeSkillLevel: 1, name_localkey: name });
    const centi = mockUnit(80, { unitHp: 1000000, ssrFavSkills: {
      skill1: fav('Maintain Fortification', [9.16, 5.69, 10, 10, 7, 7, 5, 7, 100]),
      skill2: fav('Field Discussion',       [7, 5, 4.6, 10, 8]),
      burst:  fav('Start Construction',     [5, 145.46, 14.54, 10, 30.2]) } });
    const ally = mockUnit(9400, { unitHp: 1000000 });
    const state = mockState([centi, ally]);
    executeSkillTriggers(state, 'PROGRAM_INIT');
    executeSkillTriggers(state, 'BATTLE_START');
    eq('Stockpile 储存上限 = 7% 施法者基础 MaxHP', ally.overheal?.cap, 70000);
    eq('Stockpile 持续 5s', ally.overheal?.endTick, 5 * TICK_RATE);
    eq('开局满血：P3 治疗 70000 全部进入储存池', ally.overheal?.hp, 70000);
    dispatchHpChanged(state);
    // 友军 HP 下降（先扣储存池再扣 HP）→ P4 全员回复
    applyHpLoss(state, ally, 120000); dispatchHpChanged(state);
    eq('扣减 120000：储存池 70000 先扣，HP −50000 后由 P4 回复 70000 补满', ally.unitHp, 1000000);
    eq('P4 回复溢出 20000 回到储存池', ally.overheal?.hp, 20000);
    eq('P4 对全员生效（Centi 自身满血，溢出进储存池）', centi.overheal?.hp, 70000);
    // Stockpile 到期后不再触发
    state.tick = 5 * TICK_RATE; state.buffs = state.buffs.filter(b => b.endTick > state.tick);
    expireOverheal(state, ally); state.pendingHpChanged.clear();
    applyHpLoss(state, ally, 10000); dispatchHpChanged(state);
    eq('Stockpile 到期后 P4 不触发', ally.unitHp, 990000);
  }
  // Flora (411) S2 P1：相邻友军 HP 下降至 ≤90% → 全员护盾；S2 P2：相邻友军受治疗且满血 → 真实伤害 ▲
  {
    const fav = vals => ({ ...mockRawSkill(vals), _activeSkillLevel: 1 });
    const flora = mockUnit(411, { unitHp: 1000000, element: 'Electric', ssrFavSkills: {
      skill1: fav([1, 1, 100, 1, 4, 5, 15.01, 2]),
      skill2: fav([90, 10.22, 10, 30.97, 10, 45.12, 10]),
      burst:  fav([10.45, 42.39, 10, 85.86, 10]) } });
    const adj = mockUnit(9500, { unitHp: 1000000, shieldHp: 0, shieldEndTick: 0 });
    const far = mockUnit(9501, { unitHp: 1000000, shieldHp: 0, shieldEndTick: 0 });
    flora.shieldHp = 0; flora.shieldEndTick = 0;
    const state = mockState([flora, adj, far], { pendingShieldReceived: [] });
    executeSkillTriggers(state, 'BATTLE_START'); state.pendingHpChanged.clear();
    applyHpLoss(state, far, 200000); dispatchHpChanged(state);
    eq('非相邻友军 HP 下降不触发 P1', far.shieldHp, 0);
    applyHpLoss(state, adj, 50000); dispatchHpChanged(state);
    eq('相邻友军 HP 95% 不触发 P1', adj.shieldHp, 0);
    applyHpLoss(state, adj, 50000); dispatchHpChanged(state);
    eq('相邻友军 HP 90% → 全员护盾 10.22% Flora 最终 MaxHP', far.shieldHp, 102200);
    eq('P2 未触发（相邻友军未满血）', state.buffs.some(b => b.name === 'Iris (True Damage)'), false);
    applyHeal(state, adj, 100000, null, flora); executeSkillTriggers(state, 'HEAL_RECEIVED', { unit: adj });
    eq('相邻友军受治疗回到满血 → P2 全员真实伤害 ▲30.97%',
      state.buffs.find(b => b.name === 'Iris (True Damage)')?.trueDamagePct, 0.3097);
  }
  // Crown (330) Relax 满层：先治疗（享受 20 层受治疗量加成），再移除 Relax
  {
    const crown = mockUnit(330, { unitHp: 100000, weaponType: 'MG', ammoLeft: 100,
      rawSkill1: mockRawSkill([64.51, 15, 44.35, 15, 37.44, 15, 44.35, 15]),
      rawSkill2: mockRawSkill([43, 4.06, 20, 5, 5, 5.23, 20.99, 7]),
      rawBurst:  mockRawSkill([36.24, 15, 10.45, 15]) });
    const state = mockState([crown]);
    for (let i = 0; i < 43 * 20; i++)
      onShotFired(state, crown, { sums: getBuffSums(state, 330), isCharged: false, hitPart: 'body', ammoAfterShot: 5 });
    eq('满层后 Relax 已移除', state.buffs.some(b => b.name === 'Relax'), false);
    eq('治疗 = 5.23% × 1M × (1 + 20 × 4.06%)', crown.unitHp, 100000 + Math.round(52300 * 1.812));
  }
}

// ── 注册完整性：skills/ 目录下每个技能文件都必须在 SKILL_TRAITS 中注册 ─────────
// UI 以 MODELED_IDS（= SKILL_TRAITS 的键）判断角色是否可选；
// 漏注册的技能文件会导致角色在选择器中显示为「未建模」（曾发生于 583）。

section('注册完整性：skills/*.js ⇔ SKILL_TRAITS');
{
  const skillsDir = new URL('../../src/data/skills/', import.meta.url);
  const fileIds = readdirSync(skillsDir)
    .filter(f => /^\d+\.js$/.test(f))
    .map(f => Number(f.slice(0, -3)))
    .sort((a, b) => a - b);
  const registeredIds = Object.keys(SKILL_TRAITS).map(Number);
  const unregistered = fileIds.filter(id => !(id in SKILL_TRAITS));
  const missingFile  = registeredIds.filter(id => !fileIds.includes(id));
  eq('所有技能文件均已注册', unregistered.join(','), '');
  eq('所有注册条目均有对应技能文件', missingFile.join(','), '');
}

summary('Skill traits tests');
