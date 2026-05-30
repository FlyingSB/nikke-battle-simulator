/**
 * Rapi: Red Hood — burst-step & Combat Assist tests.
 * Pure: no CDN, no file I/O. Uses simulate() with synthetic _computedStats.
 *
 * Covers:
 *   R1  — No native B1 ally → CA auto-activates → combatAssistStatus=true → Rapi acts as B1
 *   R2  — Has native B1 ally → CA removed → combatAssistStatus=false → Rapi acts as B3
 *   R3  — CA mode: Rapi selected as Step1, burst sequence completes (B1→B2→B3→Full Burst)
 *   R4  — FULL_BURST_END re-evaluation: CA stays consistent across multiple cycles
 *   R5  — Non-CA (B3): burst fires Burst P4 damage
 *   R6  — CA mode: CA ATK-flat buff fires from burst; no B3 burst damage
 *   R7  — CA mode: Scenario C fires on ENTER_FULL_BURST; Scenario D absent
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

let _nextId = 90000;

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

const _MOCK_VALS = Array(10).fill('100');
const _MOCK_SKILL_N = n => ({ description_value_list: Array.from({ length: n }, () => ({ description_value: _MOCK_VALS })) });

function rapiUnit(overrides = {}) {
  return {
    characterId:              16,
    name:                     'Rapi: Red Hood',
    element:                  'Fire',
    weaponType:               'MG',
    burstStep:                'Step3',
    nativeBurstStep:          'Step3',
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

function buffFired(buffLog, name) {
  return (buffLog ?? []).some(e => e.type === 'buff_gain' && e.name === name);
}

function buffCount(buffLog, name) {
  return (buffLog ?? []).filter(e => e.type === 'buff_gain' && e.name === name).length;
}

function rapiResult(result) {
  return result.units.find(u => u.id === 16) ?? {};
}

// ─── R1: No native B1 ally → CA auto-activates → Rapi becomes B1 ─────────────

section('R1 — No native B1 ally: CA auto-activates, Rapi fires as B1');
{
  // Squad has no unit with nativeBurstStep=Step1 → hasNativeB1=false → Rapi CA=true, burstStep=Step1
  const r = simulate(mkConfig([
    rapiUnit(),
    dummyUnit('Step2'),
    dummyUnit('Step3'),
  ]));
  eq('R1.1  at least one burst fired',             r.burstCount > 0,                                         true);
  eq('R1.2  Scenario D ATK buff did NOT fire',     buffFired(r.buffLog, 'rapi_s1_enterBurst_atkPct'),        false);
  eq('R1.3  Scenario C ATK-dmg buff fired',        buffFired(r.buffLog, 'rapi_s1_ca_attackDmg'),             true);
  eq('R1.4  CA burst ATK-flat buff fired',         buffFired(r.buffLog, 'rapi_burst_ca_atkFlat'),            true);
}

// ─── R2: Has native B1 ally → CA removed → Rapi stays B3 ────────────────────

section('R2 — Has native B1 ally: CA removed, Rapi fires as B3');
{
  const r = simulate(mkConfig([
    dummyUnit('Step1', 'Step1'),   // native B1 (nativeBurstStep=Step1)
    dummyUnit('Step2'),
    rapiUnit(),
  ]));
  eq('R2.1  at least one burst fired',             r.burstCount > 0,                                         true);
  eq('R2.2  Scenario D ATK buff fired',            buffFired(r.buffLog, 'rapi_s1_enterBurst_atkPct'),        true);
  eq('R2.3  Scenario C ATK-dmg buff did NOT fire', buffFired(r.buffLog, 'rapi_s1_ca_attackDmg'),             false);
}

// ─── R3: CA mode — burst sequence completes with Rapi as B1 ─────────────────

section('R3 — CA mode: burst sequence completes (Rapi selected as Step1 unit)');
{
  const r = simulate(mkConfig([
    rapiUnit(),
    dummyUnit('Step2'),
    dummyUnit('Step3'),
  ]));
  eq('R3.1  full burst fired ≥1',                  r.burstCount >= 1,                                        true);
  eq('R3.2  CA burst ATK-flat buff fired',          buffFired(r.buffLog, 'rapi_burst_ca_atkFlat'),            true);
  eq('R3.3  Scenario C fired on ENTER_FULL_BURST', buffFired(r.buffLog, 'rapi_s1_ca_attackDmg'),             true);
  const rapi = rapiResult(r);
  eq('R3.4  no B3 burst damage (Burst P3 absent)', 'Burst P3' in (rapi.skillDamage ?? {}),                   false);
}

// ─── R4: FULL_BURST_END re-evaluation stays consistent across cycles ──────────

section('R4 — combatAssistStatus re-evaluated at FULL_BURST_END; consistent across cycles');
{
  const r = simulate(mkConfig([
    rapiUnit(),
    dummyUnit('Step2'),
    dummyUnit('Step3'),
  ], { duration: 120 }));

  const caCount = buffCount(r.buffLog, 'rapi_s1_ca_attackDmg');
  const dCount  = buffCount(r.buffLog, 'rapi_s1_enterBurst_atkPct');

  eq('R4.1  multiple bursts fired (≥3)',            r.burstCount >= 3,             true);
  eq('R4.2  Scenario C fires every cycle',          caCount >= r.burstCount,       true);
  eq('R4.3  Scenario D never fires',                dCount === 0,                  true);
}

// ─── R5: Has native B1 (non-CA) → burst fires B3 damage ─────────────────────

section('R5 — Non-CA (B3): burst fires Burst P3 damage');
{
  const r = simulate(mkConfig([
    dummyUnit('Step1', 'Step1'),
    dummyUnit('Step2'),
    rapiUnit(),
  ]));
  const rapi = rapiResult(r);
  eq('R5.1  burst damage label exists',             'Burst P3' in (rapi.skillDamage ?? {}),       true);
  eq('R5.2  burst damage > 0',                      (rapi.skillDamage?.['Burst P3'] ?? 0) > 0,    true);
}

// ─── R6: CA mode — CA burst buff fires, no B3 burst damage ──────────────────

section('R6 — CA mode: CA ATK-flat burst buff fires; burst damage absent');
{
  const r = simulate(mkConfig([
    rapiUnit(),
    dummyUnit('Step2'),
    dummyUnit('Step3'),
  ]));
  const rapi = rapiResult(r);
  eq('R6.1  CA burst ATK-flat buff fired',          buffFired(r.buffLog, 'rapi_burst_ca_atkFlat'),  true);
  eq('R6.2  burst damage label absent',             'Burst P3' in (rapi.skillDamage ?? {}),         false);
}

// ─── R7: CA mode — full behavioral check ─────────────────────────────────────

section('R7 — CA mode: Scenario C fires; Scenario D absent; no Stage 3 damage');
{
  const r = simulate(mkConfig([
    rapiUnit(),
    dummyUnit('Step2'),
    dummyUnit('Step3'),
  ]));
  const rapi = rapiResult(r);
  eq('R7.1  at least one burst fired',              r.burstCount > 0,                                          true);
  eq('R7.2  Stage 3 burst damage absent in CA mode',('Burst P3' in (rapi.skillDamage ?? {})),                  false);
  eq('R7.3  Stage 1 CA ATK-flat buff fired',        buffFired(r.buffLog, 'rapi_burst_ca_atkFlat'),             true);
  eq('R7.4  Scenario C ATK-dmg buff fired',         buffFired(r.buffLog, 'rapi_s1_ca_attackDmg'),             true);
  eq('R7.5  Scenario D ATK buff did NOT fire',      buffFired(r.buffLog, 'rapi_s1_enterBurst_atkPct'),        false);
}

summary('Rapi: Red Hood burst-step & Combat Assist tests');
