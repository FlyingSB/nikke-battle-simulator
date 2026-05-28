/**
 * Rapi: Red Hood — burst-step & Combat Assist tests.
 * Pure: no CDN, no file I/O. Uses simulate() with synthetic _computedStats.
 *
 * Covers:
 *   R1  — No native B1 in squad → combatAssistStatus=false → Scenario D fires
 *   R2  — Has native B1, combatAssist=false → combatAssistStatus=false → Scenario D
 *   R3  — Has native B1, combatAssist=true  → combatAssistStatus=true  → Scenario C
 *   R4  — FULL_BURST_END re-evaluation: status stays consistent across multiple cycles
 *   R5  — Rapi B3, non-CA: burst fires 28.08× damage (skillDamage['burst'] > 0)
 *   R6  — Rapi B3, CA:     CA ATK-flat buff fires; no burst damage
 *   R7  — Rapi CA mode (IS_COMBAT_ASSIST): Stage 1 burst fires (no Stage 3 damage); Scenario C fires
 *
 * Run: node scripts/tests/test-rapi-burst.mjs
 */

import { simulate } from '../../src/engine/battle.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const STATS = { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 };

const ENEMY = {
  maxHp:    1e15,
  def:      0,
  element:  'Iron',
  type:     'Boss',
  hasCore:  false,
  distance: 'NEAR',
};

// IDs ≥ 90000 are not in SKILL_TRAITS — no unintended skill effects from dummy units.
let _nextId = 90000;

/**
 * Minimal dummy unit for filling B1/B2/B3 squad slots.
 * nativeBurstStep controls whether this unit counts as a "native B1"
 * in Rapi's S1 combatAssistStatus check.
 */
function dummyUnit(burstStep, nativeBurstStep, overrides = {}) {
  return {
    characterId:              _nextId++,
    name:                     `Dummy-${burstStep}`,
    element:                  'Iron',
    weaponType:               'MG',
    burstStep,
    nativeBurstStep:          nativeBurstStep ?? burstStep,
    _nikkeData:               {},
    _computedStats:           { ...STATS },
    targetBurstEnergyPerShot: 1_000_000,  // one shot fills the shared gauge
    burstEnergyPerShot:       500,
    burstSkillCooltime:       0,
    baseAmmo:                 30,
    reloadTicks:              120,
    shotDamageMult:           1.0,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    rateOfFire:               600,
    ...overrides,
  };
}

const _MOCK_VALS = Array(10).fill('100');
const _MOCK_SKILL_N = n => ({ description_value_list: Array.from({ length: n }, () => ({ description_value: _MOCK_VALS })) });

/** Rapi: Red Hood unit (characterId=16, SKILL_TRAITS entry active). */
function rapiUnit(burstStep = 'Step3', nativeBurstStep = 'Step3', overrides = {}) {
  return {
    characterId:              16,
    name:                     'Rapi: Red Hood',
    element:                  'Fire',
    weaponType:               'MG',
    burstStep,
    nativeBurstStep,
    // skill handlers 读取 rawSkill1/rawSkill2/rawBurst；提供最小 mock，值均为 '0'
    _nikkeData: {
      skill1_detail:     _MOCK_SKILL_N(10),
      skill2_detail:     _MOCK_SKILL_N(6),
      ulti_skill_detail: _MOCK_SKILL_N(6),
    },
    _computedStats:           { ...STATS },
    targetBurstEnergyPerShot: 1_000_000,
    burstEnergyPerShot:       500,
    burstSkillCooltime:       0,
    baseAmmo:                 30,
    reloadTicks:              120,
    shotDamageMult:           1.0,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    rateOfFire:               600,
    ...overrides,
  };
}

function mkConfig(squad, extraCfg = {}) {
  return { squad, enemy: ENEMY, duration: 60, hitLog: true, ...extraCfg };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** True if any buff_gain entry with the given name appears in buffLog. */
function buffFired(buffLog, name) {
  return (buffLog ?? []).some(e => e.type === 'buff_gain' && e.name === name);
}

/** Count buff_gain entries with the given name. */
function buffCount(buffLog, name) {
  return (buffLog ?? []).filter(e => e.type === 'buff_gain' && e.name === name).length;
}

/** Result entry for Rapi (id=16). */
function rapiResult(result) {
  return result.units.find(u => u.id === 16) ?? {};
}

// ─── R1: No native B1 → combatAssistStatus=false → Scenario D fires ─────────

section('R1 — No native B1: combatAssistStatus=false, Scenario D fires on ENTER_FULL_BURST');
{
  // B1 slot filled by unit whose nativeBurstStep is NOT Step1 → hasNativeB1=false
  const r = simulate(mkConfig([
    dummyUnit('Step1', 'Step2'),
    dummyUnit('Step2'),
    rapiUnit('Step3', 'Step3'),    // combatAssist defaults to false
  ]));
  eq('R1.1  at least one burst fired',         r.burstCount > 0,                                        true);
  eq('R1.2  Scenario D ATK buff fired',        buffFired(r.buffLog, 'rapi_s1_enterBurst_atkPct'),       true);
  eq('R1.3  Scenario D parts-dmg buff fired',  buffFired(r.buffLog, 'rapi_s1_enterBurst_partsDmg'),     true);
  eq('R1.4  Scenario C buff did NOT fire',     buffFired(r.buffLog, 'rapi_s1_ca_attackDmg'),            false);
}

// ─── R2: Has native B1, combatAssist=false → Scenario D fires ───────────────

section('R2 — Has native B1, combatAssist=false: Scenario D fires');
{
  const r = simulate(mkConfig([
    dummyUnit('Step1', 'Step1'),   // native B1 (nativeBurstStep=Step1)
    dummyUnit('Step2'),
    rapiUnit('Step3', 'Step3', { combatAssist: false }),
  ]));
  eq('R2.1  at least one burst fired',         r.burstCount > 0,                                        true);
  eq('R2.2  Scenario D ATK buff fired',        buffFired(r.buffLog, 'rapi_s1_enterBurst_atkPct'),       true);
  eq('R2.3  Scenario C buff did NOT fire',     buffFired(r.buffLog, 'rapi_s1_ca_attackDmg'),            false);
}

// ─── R3: Has native B1, combatAssist=true → Scenario C fires ────────────────

section('R3 — Has native B1 + combatAssist=true: Scenario C fires on ENTER_FULL_BURST');
{
  const r = simulate(mkConfig([
    dummyUnit('Step1', 'Step1'),   // native B1
    dummyUnit('Step2'),
    rapiUnit('Step3', 'Step3', { combatAssist: true }),
  ]));
  eq('R3.1  at least one burst fired',         r.burstCount > 0,                                        true);
  eq('R3.2  Scenario C ATK-dmg buff fired',    buffFired(r.buffLog, 'rapi_s1_ca_attackDmg'),            true);
  eq('R3.3  Scenario D ATK buff did NOT fire', buffFired(r.buffLog, 'rapi_s1_enterBurst_atkPct'),       false);
}

// ─── R4: FULL_BURST_END re-evaluation persists across multiple cycles ────────

section('R4 — combatAssistStatus re-evaluated at FULL_BURST_END; consistent across cycles');
{
  // 120s ensures ≥3 burst cycles; verify correct buff fires every cycle, wrong one never fires.
  const r = simulate(mkConfig([
    dummyUnit('Step1', 'Step1'),
    dummyUnit('Step2'),
    rapiUnit('Step3', 'Step3', { combatAssist: true }),
  ], { duration: 120 }));

  const caCount = buffCount(r.buffLog, 'rapi_s1_ca_attackDmg');
  const dCount  = buffCount(r.buffLog, 'rapi_s1_enterBurst_atkPct');

  eq('R4.1  multiple bursts fired (≥3)',        r.burstCount >= 3,           true);
  eq('R4.2  Scenario C fires every cycle',      caCount >= r.burstCount,     true);
  eq('R4.3  Scenario D never fires',            dCount === 0,                true);
}

// ─── R5: Rapi B3, non-CA → fires burst damage (0.1s delay, label 'Burst P4') ─

section('R5 — Rapi B3, non-CA: burst fires 28.08× skill damage');
{
  const r = simulate(mkConfig([
    dummyUnit('Step1', 'Step2'),   // no native B1
    dummyUnit('Step2'),
    rapiUnit('Step3', 'Step3'),
  ]));
  const rapi = rapiResult(r);
  // 爆裂伤害经 0.1s pendingSkillHit 延迟触发，partOverride:3 → label='Burst P4'
  eq('R5.1  burst damage label exists',        'Burst P4' in (rapi.skillDamage ?? {}),      true);
  eq('R5.2  burst damage > 0',                 (rapi.skillDamage?.['Burst P4'] ?? 0) > 0,   true);
}

// ─── R6: Rapi B3, CA → CA burst buff fires, no B3 damage ────────────────────

section('R6 — Rapi B3, Combat Assist: CA ATK-flat buff fires; burst damage absent');
{
  const r = simulate(mkConfig([
    dummyUnit('Step1', 'Step1'),   // native B1
    dummyUnit('Step2'),
    rapiUnit('Step3', 'Step3', { combatAssist: true }),
  ]));
  const rapi = rapiResult(r);
  eq('R6.1  CA burst buff fired',              buffFired(r.buffLog, 'rapi_burst_ca_atkFlat'),            true);
  eq('R6.2  burst damage label absent',        'Burst P4' in (rapi.skillDamage ?? {}),                  false);
}

// ─── R7: Rapi in CA mode → Stage 1 burst fires (no Stage 3 damage) ──────────

section('R7 — Rapi CA mode (IS_COMBAT_ASSIST): Stage 1 burst fires, no Stage 3 damage');
{
  // burst 技能描述："When used in Stage 1: Squad Support Action Style"→ CD 减少 + ATK flat，无伤害
  // "When used in Stage 3: High-Mobility Close-Range Combat Weapon" → 有伤害
  // IS_COMBAT_ASSIST = hasNativeB1(true) && combatAssist(true) → Stage 1 burst → 无伤害
  const r = simulate(mkConfig([
    dummyUnit('Step1', 'Step1'),   // native B1 → hasNativeB1=true
    dummyUnit('Step2'),
    rapiUnit('Step3', 'Step3', { combatAssist: true }),
  ]));
  const rapi = rapiResult(r);
  eq('R7.1  at least one burst fired',                 r.burstCount > 0,                                         true);
  eq('R7.2  Stage 3 burst damage absent in CA mode',   ('Burst P4' in (rapi.skillDamage ?? {})),                false);
  eq('R7.3  Stage 1 CA ATK-flat buff fired',           buffFired(r.buffLog, 'rapi_burst_ca_atkFlat'),           true);
  eq('R7.4  Scenario C ATK-dmg buff fired',            buffFired(r.buffLog, 'rapi_s1_ca_attackDmg'),            true);
  eq('R7.5  Scenario D ATK buff did NOT fire',         buffFired(r.buffLog, 'rapi_s1_enterBurst_atkPct'),       false);
}

summary('Rapi: Red Hood burst-step & Combat Assist tests');
