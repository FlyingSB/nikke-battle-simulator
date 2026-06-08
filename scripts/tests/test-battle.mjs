/**
 * Core battle simulation test — Node.js, no browser / UI dependencies.
 *
 * Burst model:
 *   - Shared burst gauge (0..1,000,000) filled by all shots
 *   - Burst chain: gauge full + B1/B2/chosen-B3 all off cooldown
 *     → B1 activates → +0.6 s → B2 activates → +0.6 s → B3/Full Burst (10 s)
 *   - Two B3 nikkes alternate turns each rotation
 *   - Freeman (Helm): fires burst skill inside FB window whenever her CD is ready
 *
 * Skills implemented:
 *   - Little Mermaid Skill 1 "Bubble Order"
 *       Effect 2: on FB end  → all allies burst CD ▼ 7.48 s
 *       Effect 3: on FB start → all allies Attack Damage ↑ 4.0% for 10 s
 *       Effect 4: every 400 total team shots → burst gauge +37%
 *
 * Burst skills (placeholder values, not yet loaded from CDN):
 *   - Little Mermaid B1 burst : ATK +18.94% all allies for 10 s
 *   - Crown B2 burst          : ATK +57.38% all allies for 10 s
 *   - Rapi:RH B3 burst        : 12 rapid hits × 9% ATK skill multiplier
 *   - Scarlet:BS B3 burst     : 6 hits × 12% ATK skill multiplier (RL)
 *   - Helm Freeman burst      : ATK +16.37% all allies for 10 s
 *
 * Team : Little Mermaid · Crown · Rapi:Red Hood · Scarlet:Black Shadow · Helm
 * Stats: approximate synchro-level-400, T10-equipped placeholders
 * Run  : node scripts/test-battle.mjs
 */

import { calcDamage }                          from '../../src/engine/damage.js';
import { WEAPON_AMMO, WEAPON_HIT_MULT, CHARGE_DAMAGE_BASE } from '../../src/engine/constants.js';
import { computeFinalStats, applyGradeCore }   from '../../src/engine/stats.js';
import { getBaseStats, getBondBonus, normalizeCube, computeResearchBonus, getT10Equipment } from '../../src/data/models.js';
import { setData }                             from '../../src/data/loader.js';
import { loadNikkeData, loadFavItemData, loadStaticData, loadCubeData, getSkillValue } from '../lib/nikke-cache.mjs';

// Output adapter: browser writes to #test-output pre; Node uses process.stdout
const _lines = [];
function print(s = '') {
  _lines.push(s);
  if (typeof process !== 'undefined') process.stdout.write(s + '\n');
}
function flushToBrowser() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('test-output');
  if (el) el.textContent = _lines.join('\n');
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TICK_RATE        = 60;
const SIM_SECONDS      = 180;
const MAX_TICKS        = TICK_RATE * SIM_SECONDS;
const BURST_GAUGE_MAX  = 1_000_000;
const FULL_BURST_TICKS = TICK_RATE * 10;              // 10 s FB window
const BURST_STEP_TICKS = Math.round(TICK_RATE * 0.6); // 36 ticks — 0.6 s between B1→B2→B3

// Per-weapon burst energy per shot.
// Calibrated so a 5-nikke team fills the gauge in ~20–25 s.
const BURST_ENERGY = { AR: 1_500, SMG: 1_100, SR: 9_000, MG: 1_400, SG: 2_200, RL: 14_000 };

// MG weapons use a deterministic ramp model (see fireOneShot / MG block below).
// All other weapons use a probabilistic fire gate (probability per tick).
const ATTACK_SPEED = { AR: 0.10, SMG: 0.165, SR: 0.025, SG: 0.05, RL: 0.025 };
// Reload ticks for non-MG weapons (MG uses weaponData.reloadTimeSec from CDN).
const RELOAD_TICKS = { AR: 120, SMG: 120, SR: 90, SG: 150, RL: 180 };

// SR and RL use a deterministic charge-time model: nextShotTick is set to
// state.tick + chargeTimeTicks after each shot and after each reload completes.
const SR_RL_WEAPONS = new Set(['SR', 'RL']);
// Post-shot gap before the next charge begins for SR/RL: 25 ticks.
// Total per-shot cycle = MIN_INTERVAL + chargeTimeTicks = 25 + 18 = 43 ticks for SBS.
// Calibrated: SBS fires 20 shots in exactly 860 ticks (20 × 43 = 860).
// This cycle applies uniformly — at battle start, after each shot, and after reload.
const SR_RL_MIN_INTERVAL_TICKS = 25;

// ── Synchro level / research (applied in main() via computeFinalStats) ─────────
const NIKKE_LEVEL = 592;
const BOND_LEVEL  = 40;
const RESEARCH = {
  general:   270,
  attacker:  218,
  defender:  218,
  supporter: 218,
  ELYSION:   206,
  MISSILIS:  206,
  TETRA:     206,
  PILGRIM:   201,
  ABNORMAL:  206,
};

// ── Cube definitions (Level 15) ───────────────────────────────────────────────
// Every cube shares Anti Code HC: Elemental Advantage Attack Damage +19.09%.

// Cube values are CDN level-10 (max level) from harmonycube_skill_group.
const CUBES = {
  Resilience: {
    label: 'Resilience Cube',
    elementAdvantageDmgIncrement: 0.2757,  // Anti Code HC lv10: Elemental Advantage Attack Damage +27.57%
    reloadSpeedPct: 0.325,                  // Quick Reload HC lv10: Reload Speed +32.50%
  },
  Bastion: {
    label: 'Bastion Cube',
    elementAdvantageDmgIncrement: 0.2757,  // Anti Code HC lv10: +27.57%
    // Reload Up HC lv10: every 10 shots reload 5 rounds (CDN: 5.5 → floor 5)
    bastionPeriod: 10,
    bastionReload: 5,
  },
  Adjutant: {
    label: 'Adjutant Cube',
    elementAdvantageDmgIncrement: 0.2757,  // Anti Code HC lv10: +27.57%
    chargeSpeedPct: 0.325,                  // Charge Speed Up HC lv10: +32.50%
  },
};

// ── Helm skill constants — with SSR favorite item "Antique Compass" (resource_id 352) ───
// Antique Compass CDN URL: FAVORITE_ITEM_URLS[200701] in manifest.js — update hash after game patches.
const ANTIQUE_COMPASS_CDN_URL = 'https://sg-tools-cdn.blablalink.com/qf-35/xj-78/2cef2b4f5f105b32637e4fa0cb9b2b36.json';
// Skill 1 "Frontline Command" [favoriteitem_skill_group_data[0]]
//   Effect 1 (unchanged): last bullet hits → all allies Crit Rate ▲ for 5 s
const HELM_SK1_CRIT_RATE_PCT  = 0.1464;  // [index 0]
const HELM_SK1_DURATION_S     = 5;       // [index 1]
//   Effect 2 (new w/ Antique Compass): full charge → all allies Burst Gauge ▲ 14.31%
//   (HP recovery 0.59% Helm HP also fires — no DPS impact, skipped)
const HELM_SK1_GAUGE_FILL_PCT = 0.1431;  // [index 3]
// Skill 2 "Fire Away" [favoriteitem_skill_group_data[1]]
//   Effect 1 (passive, unchanged): +3.08% interruption part damage — no DPS impact
//   Effect 2 (enhanced): on FB entry → all allies Attack Damage ▲ 27.87% (was 11.85% base)
const HELM_SK2_ATK_DMG_PCT    = 0.2787;  // [index 1]
const HELM_SK2_DURATION_S     = 10;      // [index 2]
//   Effect 3 (new w/ Antique Compass): full charge hit → 178.98% ATK additional damage
const HELM_SK2_HIT_MULT       = 1.7898;  // [index 3]
// Burst "Aegis Cannon" [favoriteitem_skill_group_data[2]]
//   Effect 1 (massively enhanced): 1 hit → 8236.8% ATK (was 1237.5% base)
const HELM_BURST_HIT_MULT       = 82.368;  // [index 0] (8236.8 / 100)
//   Effect 2 (unchanged): all allies HP recovery 54.45% — no DPS impact
//   Effect 3 (new w/ Antique Compass): self Charge Damage Multiplier ▲ 158.4% for 10 rounds
const HELM_BURST_CHARGE_DMG_PCT = 1.584;   // [index 3]
const HELM_BURST_CHARGE_ROUNDS  = 10;      // [index 4]

// ── Scarlet: Black Shadow skill constants (CDN level 10 values, resource_id 225) ─
// Skill 1 "Fleetly Fading: Breakthrough": fires on each Full Charge (RL) shot
//   Normal thresholds : 3 / 6 / 9   → Phase 1 / 2 / 3
//   With burst buff   : 1 / 2 / 3
const SBS_SK1_PHASE1_MULT      = 2.5047;  // 250.47% ATK [index 1]
const SBS_SK1_PHASE2_MULT      = 5.00;    // 500.00% ATK [index 2]
const SBS_SK1_PHASE3_MULT      = 7.5047;  // 750.47% ATK [index 3]
const SBS_SK1_PHASE1_THRESHOLD = 3;
const SBS_SK1_PHASE2_THRESHOLD = 6;
const SBS_SK1_PHASE3_THRESHOLD = 9;
const SBS_BURST_SK1_PHASE1_THRESHOLD = 1;  // burst-reduced
const SBS_BURST_SK1_PHASE2_THRESHOLD = 2;
const SBS_BURST_SK1_PHASE3_THRESHOLD = 3;
// Skill 2 "Fleetly Fading: Asura": on every Full Burst entry
const SBS_SK2_MAX_AMMO_PCT  = 0.5332;  // +53.32% max ammo for 10 s [index 0] at skill level 7
const SBS_SK2_DURATION_S    = 10;
const SBS_SK2_RELOAD_PCT    = 1.00;  // 100% magazine reload    [index 2]
// Burst "Fleetly Fading: Strike": self buffs
const SBS_BURST_ATK_PCT               = 1.1512;  // ATK ▲ 115.12% for 10 s [index 1, 2]
const SBS_BURST_ATK_DURATION_S        = 10;
const SBS_BURST_CHARGE_DMG_PCT        = 1.5012;  // Charge Damage ▲ 150.12% for 10 s [index 3, 4]
const SBS_BURST_CHARGE_DMG_DURATION_S = 10;
const SBS_BURST_SK1_DURATION_S        = 10;      // SK1 threshold ▼ duration [index 0]

// ── Little Mermaid Skill 2 "Bubble Wave" constants (CDN level 10 values, resource_id 513) ─
// Effect 1: on battle start → enemy Damage Taken ▲ (Bubble debuff, permanent)
const LM_SK2_BUBBLE_DEBUFF_PCT  = 0.0505;  // 5.05%  [index 0]
// Effect 3: every 1s during Full Burst → LM_SK2_FB_HIT_COUNT sequential hits
const LM_SK2_FB_PERIOD_S        = 1;        //  1 s   [index 3]
const LM_SK2_FB_HIT_MULT        = 0.6336;   // 63.36% ATK per hit [index 4]
const LM_SK2_FB_HIT_COUNT       = 4;        //  4 hits [index 5]
// Effect 4: every 500 total team shots → Bubble Barrage (LM_SK2_BARRAGE_HIT_COUNT sequential hits)
const LM_SK2_BARRAGE_THRESHOLD  = 500;      //  500 shots [index 6]
const LM_SK2_BARRAGE_HIT_MULT   = 0.85;     // 85%   ATK per hit [index 7]
const LM_SK2_BARRAGE_HIT_COUNT  = 10;       // 10 hits [index 8]

// ── Rapi: Red Hood skill constants (CDN level 10 values, resource_id 16) ─────
// Skill 1 "Battlefield Assessment": team has LM (B1) → not in Combat Assist
//   → On FB entry: self ATK ▲ 95.04% for 10 s  [indices 2, 3]
const RAPI_SK1_SELF_ATK_PCT = 0.9504;
const RAPI_SK1_DURATION_S   = 10;
// Skill 2 "Attachable Projectiles"
const RAPI_SK2_BASE_MULT          = 0.8811;  // 88.11% ATK hit ratio [index 1 / 2]
const RAPI_SK2_ATTACHMENT_PASSIVE = 1.5072;  // Attack Damage +150.72% (always-on, adds to atkDmgMult) [index 4]
const RAPI_SK2_EXPLOSION_PASSIVE  = 1.0060;  // Attack Damage +100.60% (always-on, adds to atkDmgMult) [index 5]
const RAPI_SK2_TRIGGER_BASE       = 120;     // shots per projectile [index 0]
const RAPI_SK2_TRIGGER_REDUCED    = 60;      // reduced by burst     [burst index 7]
// No cap on simultaneous projectiles: each accumulates independently and all explode on FB.
// Burst "Power of Inheritance" (Stage 3 — used when B1 ally present)
const RAPI_BURST_HIT_MULT                    = 28.08; // 2808% ATK  [burst index 4]
const RAPI_BURST_ATTACHMENT_BOOST            = 4.212; // Attack Damage +421.2% for 10s (adds to atkDmgMult) [burst index 5]
const RAPI_BURST_ATTACHMENT_DURATION_S       = 10;                 // [burst index 6]
const RAPI_BURST_TRIGGER_REDUCTION_DURATION_S = 10;               // [burst index 8]

// ── Team definition ───────────────────────────────────────────────────────────
// Approximate synchro-level-400, T10-equipped stats (~2× level-200 values).

// ── Equipment option effects ────────────────────────────────────────────────
// equipOptions: summed total of all 4 equipment slot option bonuses.
// Omit a field or set to 0 if no options are obtained for that effect type.
//
// Fields:
//   atkFlat        — flat ATK from "Increase ATK" options
//   elementDmgPct  — "Increase Element Damage Dealt"  (decimal: 0.05 = 5%)
//   hitRatePct     — "Increase Hit Rate"              (tracked; not simulated)
//   equipMaxAmmoPct — "Increase Max Ammunition Capacity" (flat rounds)
//   chargeDmgPct   — "Increase Charge Damage"         (decimal added to charge multiplier)
//   chargeSpeedPct — "Increase Charge Speed"          (tracked; not in current model)
//   critRatePct    — "Increase Critical Rate"         (decimal: 0.03 = 3%)
//   critDamagePct     — "Increase Critical Damage"       (decimal added to crit damage increment)
//   defFlat        — flat DEF from "Increase DEF" options

// ── Favorite item collection skill parser ─────────────────────────────────────
/**
 * Parse collection_skill_group_data from an R/SR favorite item JSON.
 * Determines the current skill level from favData.level1[itemLevel], then
 * reads each skill's description template to identify and extract effect values.
 *
 * Modelled DPS effects:
 *   chargeDmgPct    — "Charge Damage Multiplier ▲ X%" → added to chargeDmgStat for SR/RL shots
 *   normalAtkDmgPct — "Normal Attack Damage Multiplier ▲ X%" → added to attackDamageMult for weapon shots
 *   maxAmmoPct      — "Max Ammunition Capacity ▲ X%" → extra ammo at init and reload cap
 *   coreDmgBonusPct — "Damage dealt when attacking core ▲ X%" → tracked, not modelled (no-core enemy)
 *
 * Defensive effects (tracked, not applied to DPS):
 *   selfDmgReduction — "Damage Taken ▼ X%"
 *   defPct           — "DEF ▲ X%"
 *   coverHpPct       — "Cover's Max HP ▲ X%"
 */
function parseFavItemSkills(favData, itemLevel) {
  const skillLevel = favData.level1?.[itemLevel] ?? 1;
  const skillIdx   = skillLevel - 1;
  const effects    = { chargeDmgPct: 0, normalAtkDmgPct: 0, maxAmmoPct: 0, coreDmgBonusPct: 0 };
  const parsed     = [];

  for (const sk of (favData.collection_skill_group_data ?? [])) {
    const clean = (sk.description_localkey ?? '').replace(/<[^>]+>/g, '');
    const lines = clean.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('■'));
    const entry = { name: sk.name_localkey, level: skillLevel, lines: [] };

    for (const line of lines) {
      const pm = line.match(/\{description_value_0(\d)\}/);
      if (!pm) continue;
      const paramIdx = parseInt(pm[1]) - 1;
      const vals     = sk.description_value_list?.[paramIdx]?.description_value;
      if (!vals?.length) continue;
      const val = parseFloat(vals[Math.min(skillIdx, vals.length - 1)]);
      if (!val) continue;

      let type;
      if      (/Charge Damage.*Multiplier.*▲/i.test(line))        { type = 'chargeDmgPct';     effects.chargeDmgPct    += val / 100; }
      else if (/Normal Attack Damage.*Multiplier.*▲/i.test(line)) { type = 'normalAtkDmgPct';  effects.normalAtkDmgPct += val / 100; }
      else if (/Max Ammunition Capacity.*▲/i.test(line))          { type = 'maxAmmoPct';       effects.maxAmmoPct      += val / 100; }
      else if (/Damage dealt when attacking core.*▲/i.test(line)) { type = 'coreDmgBonusPct';  effects.coreDmgBonusPct += val / 100; }
      else if (/Damage Taken.*▼/i.test(line))                     { type = 'selfDmgReduction'; }
      else if (/DEF.*▲/i.test(line))                              { type = 'defPct'; }
      else if (/Cover.*Max HP.*▲/i.test(line))                    { type = 'coverHpPct'; }
      else                                                         { type = 'unknown'; }

      const label = line.replace(`{description_value_0${pm[1]}}`, `${val % 1 === 0 ? val : val.toFixed(2)}`);
      entry.lines.push({ type, value: val, label });
    }
    if (entry.lines.length) parsed.push(entry);
  }
  return { effects, parsed, skillLevel };
}

const TEAM = [
  {
    id: 1, name: 'Little Mermaid',
    weaponType: 'SMG', element: 'Wind',
    classType: 'Supporter', corporation: 'ELYSION',
    burstStep: 'Step1', burstCd: 20,
    hp: 0, atk: 0, def: 0,   // filled from CDN in main()
    grade: 3, core: 0,
    cube: 'Resilience',
    critRate: 0.15, critDmg: 0.50,
    equipOptions: {},
    bondLevel: 40,
    weaponData: { maxAmmo: 120, reloadTimeSec: 1.0, hitMult: 0.1012 }, // overwritten from CDN
    _equipConfig: {},
  },
  {
    id: 2, name: 'Crown',
    weaponType: 'MG', element: 'Iron',
    classType: 'Defender', corporation: 'PILGRIM',
    burstStep: 'Step2', burstCd: 20,
    hp: 0, atk: 0, def: 0,
    grade: 3, core: 0,
    cube: 'Bastion',
    critRate: 0.15, critDmg: 0.50,
    equipOptions: {},
    bondLevel: 40,
    weaponData: { maxAmmo: 150, reloadTimeSec: 1.5, hitMult: 0.03, rateOfFire: 60, endRateOfFire: 4200, rateOfFireChangePerShot: 100 },
    _equipConfig: {},
  },
  {
    id: 3, name: 'Rapi: Red Hood',
    weaponType: 'MG', element: 'Fire',
    classType: 'Attacker', corporation: 'ELYSION',
    burstStep: 'Step3', burstCd: 20,
    hp: 0, atk: 0, def: 0,
    grade: 3, core: 0,
    cube: 'Resilience',
    critRate: 0.15, critDmg: 0.50,
    equipOptions: {},
    bondLevel: 40,
    weaponData: { maxAmmo: 150, reloadTimeSec: 1.5, hitMult: 0.03, rateOfFire: 60, endRateOfFire: 4200, rateOfFireChangePerShot: 100 },
    _equipConfig: {},
  },
  {
    id: 4, name: 'Scarlet: Black Shadow',
    weaponType: 'RL', element: 'Wind',
    classType: 'Attacker', corporation: 'PILGRIM',
    burstStep: 'Step3', burstCd: 20,
    hp: 0, atk: 0, def: 0,
    grade: 3, core: 0,
    cube: 'Adjutant',
    critRate: 0.15, critDmg: 0.50,
    equipOptions: {},
    bondLevel: 40,
    weaponData: { maxAmmo: 9, reloadTimeSec: 2.0, hitMult: 0.45 }, // overwritten from CDN
    _equipConfig: {},
  },
  {
    id: 5, name: 'Helm',
    weaponType: 'SR', element: 'Water',
    classType: 'Attacker', corporation: 'ELYSION',
    burstStep: 'Free', burstCd: 40,
    hp: 0, atk: 0, def: 0,
    grade: 3, core: 0,
    cube: 'Adjutant',
    critRate: 0.15, critDmg: 0.50,
    equipOptions: {},
    bondLevel: 40,
    weaponData: { maxAmmo: 5, reloadTimeSec: 2.5, hitMult: 0.50 }, // overwritten from CDN
    _equipConfig: {},
  },
];

// Distance phases: each entry is { zone: 'NEAR'|'MID'|'FAR'|null, durationS: number }.
// Zones are applied sequentially; after all phases the last zone is held.
const DISTANCE_PHASES = [
  { zone: 'NEAR', durationS: 60 },
  { zone: 'MID',  durationS: 60 },
  { zone: 'FAR',  durationS: 60 },
];

/** Return the active distance zone for a given tick. */
function getDistanceZone(tick) {
  let elapsed = tick / TICK_RATE;
  for (const phase of DISTANCE_PHASES) {
    if (elapsed < phase.durationS) return phase.zone;
    elapsed -= phase.durationS;
  }
  return DISTANCE_PHASES[DISTANCE_PHASES.length - 1].zone;
}

const ENEMY = { def: 102.45, element: 'Iron', hasCore: true };

// ── fmtN / fmtT helpers (needed at module level) ──────────────────────────────

function fmtN(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.floor(n).toString();
}

function fmtT(tick) {
  const s  = tick / TICK_RATE;
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = (s % 60).toFixed(1).padStart(4, '0');
  return `${mm}:${ss}`;
}

// ── Run simulation ─────────────────────────────────────────────────────────────

function runBattle(lmSkill1, lmBurst, crownBurst, crownSkills) {
  const units = TEAM.map(def => {
    const opts     = def.equipOptions ?? {};
    const baseMax  = def.weaponData?.maxAmmo ?? WEAPON_AMMO[def.weaponType] ?? 30;
    // Formula B: separate floors for equipment and fav collection ammo bonuses.
    // _equipConfig.bonusAmmoPct is equipment-only; fav collection maxAmmoPct is added separately.
    const equipMaxAmmoFlat = Math.round(baseMax * (def._equipConfig?.bonusAmmoPct ?? 0));
    const favMaxAmmoFlat   = Math.round(baseMax * (def._favSkills?.maxAmmoPct ?? 0));
    return {
    ...def,
    _equipOpts:      opts,
    _favMaxAmmoFlat: favMaxAmmoFlat,
    // Equipment "Increase ATK: X%" is a combat multiplier (added to atkMultiplier in getAtkMult),
    // not a flat stat. Stored permanently on the unit.
    equipAtkPct:     def._equipConfig?.atkPct ?? 0,
    // Apply flat equipment option effects at init:
    atk:             def.atk,
    def:             def.def      + (opts.defFlat      ?? 0),
    critRate:        def.critRate + (opts.critRatePct  ?? 0),
    critDmgIncrement: opts.critDamagePct ?? 0,  // crit damage increment above BASE_CRIT_DAMAGE (0.50)
    _maxAmmo:        baseMax + equipMaxAmmoFlat + favMaxAmmoFlat,
    ammoLeft:        baseMax + equipMaxAmmoFlat + favMaxAmmoFlat,
    reloadTick:      0,
    burstCdTick:     0,
    totalDamage:     0,
    fbDamage:        0,
    skillDamage:     0,
    hitCount:        0,
    critCount:       0,
    burstUses:       0,
    shotsFiredTotal: 0,   // for Bastion cube: every 10 shots, reload 3 rounds
    // SR/RL deterministic charge model: fire when state.tick >= nextShotTick
    nextShotTick:    (() => {
      const chargeRaw = def.weaponData?.chargeTimeTicks ?? 0;
      if (chargeRaw <= 0) return 0;
      const csf = (CUBES[def.cube]?.chargeSpeedPct ?? 0) + (opts.chargeSpeedPct ?? 0);
      return SR_RL_MIN_INTERVAL_TICKS + Math.round(chargeRaw * (1 - csf)); // full cycle from battle start
    })(),
    // MG ramp state
    currentRPM:      def.weaponData?.rateOfFire ?? null,
    shotAccum:       0,
    // Crown skill 2 state
    relaxStacks:     0,
    // Rapi: Red Hood skill 2 state
    projectilesReady:         0,
    shotsSinceLastProjectile: 0,
    sk2TriggerReducedTick:    0,  // tick until trigger count reduction expires
    // Rapi damage-type breakdown
    _dmgBurstHit:   0,
    _dmgAttach:     0,
    _dmgExplode:    0,
    // Scarlet: Black Shadow skill 1 state
    chargeCount:              0,  // full-charge shot counter for SK1 phases
    sk1BurstTick:             0,  // tick until burst's SK1 threshold reduction expires
    // Helm burst "Aegis Cannon" — Charge Damage buff (rounds-based, not time-based)
    burstChargeDmgRoundsLeft: 0,  // shots remaining with Charge Damage ▲ 158.4%
    };
  });

  const b1     = units.find(u => u.burstStep === 'Step1');
  const b2     = units.find(u => u.burstStep === 'Step2');
  const b3List = units.filter(u => u.burstStep === 'Step3');
  // Freeman (Helm): burstStep === 'Free' — does NOT fire burst in a full team.
  // She fills all three burst-chain slots (B1/B2/B3) with LM·Crown·Rapi/SBS, so
  // no slot is ever open for Helm. Her burst skill is effectively unused here.
  const rapi   = units.find(u => u.id === 3);
  const sbs    = units.find(u => u.id === 4);

  const state = {
    tick:                    0,
    gauge:                   0,
    fullBurst:               false,
    fbEndTick:               0,
    burstPhase:              0,    // 0=idle 1=B1-fired 2=B2-fired 3=FB-active
    burstPhaseTick:          0,
    burstExpireTick:         0,    // tick at which burst step 1 expires (no-B2 scenario)
    b3Turn:                  0,
    totalTeamShots:          0,    // cumulative shots by all units (for LM SK1 Effect 4 + SK2 Effect 4)
    enemyDamageTakenMult:    0,  // solo SBS: no Bubble debuff
    lmSk2FbTickNext:         0,    // next tick to fire LM SK2 FB periodic (set at FB start)
    // IDs of units who fired their burst skill in the current rotation.
    // Reset when B1 fires. Used by Crown Skill 1 for Group A/B split.
    burstsUsedThisRotation:  new Set(),
    log:                     [],
    burstCycles:             [],
    // Active buffs: { buffKey, displayName, unitId, atkPct, flatAtk, attackDamageMult, reloadSpeedPct, endTick }
    buffs:                   [],
  };

  // ── Timestamp helper ──────────────────────────────────────────────────────

  function ts(tick = state.tick) {
    const s  = tick / TICK_RATE;
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = (s % 60).toFixed(2).padStart(5, '0');
    return `[${mm}:${ss}]`;
  }

  function log(msg) { state.log.push(`${ts()} ${msg}`); }

  // ── Buff system ───────────────────────────────────────────────────────────

  /**
   * Remove expired buffs, logging each expiry.
   */
  function cleanExpiredBuffs() {
    const expired = state.buffs.filter(b => b.endTick <= state.tick);
    for (const b of expired) {
      const unit = units.find(u => u.id === b.unitId);
      const name = unit?.name ?? `unit#${b.unitId}`;
      log(`${name} - Buff expired [${b.displayName}]`);
    }
    state.buffs = state.buffs.filter(b => b.endTick > state.tick);
  }

  /**
   * Apply a buff to one unit. Non-stackable: same buffKey on same unit refreshes endTick.
   * @param {object} unit
   * @param {{ buffKey, displayName, atkPct?, attackDamageMult?, durationS }} def
   */
  function applyBuff(unit, { buffKey, displayName, atkPct = 0, attackDamageMult = 0, flatAtk = 0, reloadSpeedPct = 0, durationS }) {
    const endTick  = state.tick + durationS * TICK_RATE;
    const existing = state.buffs.find(b => b.buffKey === buffKey && b.unitId === unit.id);
    if (existing) {
      existing.endTick    = endTick; // refresh (non-stackable)
      existing.flatAtk    = flatAtk; // update value (e.g. Crown SK1 recalculates each FB)
    } else {
      state.buffs.push({ buffKey, displayName, unitId: unit.id, atkPct, attackDamageMult, flatAtk, reloadSpeedPct, endTick });
      log(`${unit.name} - Acquire Buff [${displayName}]`);
    }
  }

  /** Apply a buff to all units. */
  function applyBuffAll(buffDef) {
    for (const unit of units) applyBuff(unit, buffDef);
  }

  /** Sum active ATK% multiplier for a unit (returns 1 + total).
   *  Includes permanent equipment "Increase ATK: X%" plus active skill/buff ATK% bonuses.
   *  All are additive increments inside the (ATK × atkMultiplier - DEF) base damage formula. */
  function getAtkMult(unitId) {
    const unit = units.find(u => u.id === unitId);
    let sum = unit?.equipAtkPct ?? 0;   // permanent equipment ATK% increment
    for (const b of state.buffs) {
      if (b.unitId === unitId) sum += b.atkPct ?? 0;
    }
    return 1 + sum;
  }

  /** Sum flat ATK increment for a unit (otherAtkIncrement, e.g. Crown Skill 1). */
  function getFlatAtk(unitId) {
    let sum = 0;
    for (const b of state.buffs) {
      if (b.unitId === unitId) sum += b.flatAtk ?? 0;
    }
    return sum;
  }

  /** Sum active Attack Damage extra multiplier for a unit. */
  function getAtkDmgMult(unitId) {
    let sum = 0;
    for (const b of state.buffs) {
      if (b.unitId === unitId) sum += b.attackDamageMult ?? 0;
    }
    return sum;
  }

  /** Sum active reload speed bonus for a unit (e.g. Crown Skill 1). */
  function getReloadSpeedPct(unitId) {
    let sum = 0;
    for (const b of state.buffs) {
      if (b.unitId === unitId) sum += b.reloadSpeedPct ?? 0;
    }
    return sum;
  }

  /**
   * Log one LM skill hit with its full damage formula.
   * Format (single line):
   *   hit N/total [flags]: (atk × atkMult + flatAtk − DEF) × hitMult% = base
   *   | ×common(components) | ×atkDmg(1+X%) | ×bubble(1+X%) = finalDmg
   */
  function logLmHit(hitIdx, hitTotal, hitMultVal, isCrit, input, breakdown) {
    const { atk, atkMultiplier, otherAtkIncrement, enemyDef, isCore, isFullBurst } = input;
    const { baseDamage, commonMult, elemMult, extraMult, damageTakenMult_, damage } =
      { ...breakdown, damage: Math.floor(
          breakdown.baseDamage * breakdown.commonMult * breakdown.elemMult *
          breakdown.chargeMult * breakdown.extraMult * breakdown.damageTakenMult_) };

    // Flags
    const flags = [];
    if (isCrit)        flags.push('CRIT');
    if (isCore)        flags.push('CORE');
    if (isFullBurst)   flags.push('FB');

    // Base line: (atk × atkMult [+ flatAtk] − DEF) × hitMult%
    const flatStr = otherAtkIncrement ? ` + ${fmtN(otherAtkIncrement)}` : '';
    const baseLine = `(${fmtN(atk)} × ${atkMultiplier.toFixed(4)}${flatStr} − ${fmtN(enemyDef)}) × ${(hitMultVal * 100).toFixed(2)}%`;

    // CommonMult components
    const comParts = ['1'];
    if (isCrit)       comParts.push(`CRIT+${(0.50 + (input.critDmgIncrement ?? 0)).toFixed(2)}`);
    if (isCore)       comParts.push(`CORE+${(1.00 + (input.coreDmgIncrement ?? 0)).toFixed(2)}`);
    if (isFullBurst)  comParts.push(`FB+0.50`);
    // LM SMG favors NEAR zone; distance advantage applies only when getDistanceZone returns NEAR
    const comLine = `×com(${comParts.join(' ')}=${commonMult.toFixed(4)})`;

    // Element line (Wind vs Iron = no advantage, elemMult = 1.0)
    const elemLine = elemMult !== 1 ? ` ×elem(${elemMult.toFixed(4)})` : '';

    // Extra = atkDmgMult
    const extraLine = extraMult !== 1 ? ` ×atkDmg(1+${((extraMult - 1) * 100).toFixed(2)}%=${extraMult.toFixed(4)})` : '';

    // DamageTakenMult = Bubble debuff
    const bubbleLine = ` ×bubble(1+${((damageTakenMult_ - 1) * 100).toFixed(2)}%=${damageTakenMult_.toFixed(4)})`;

    const flagStr = flags.length ? `[${flags.join(' ')}] ` : '';
    log(`    hit ${hitIdx}/${hitTotal} ${flagStr}: ${baseLine} = base ${fmtN(Math.round(baseDamage))} ${comLine}${elemLine}${extraLine}${bubbleLine} = ${fmtN(damage)}`);
  }

  /** Print all active buffs on LM and the resulting damage multipliers. */
  function logLmBuffState(label) {
    const lm   = units.find(u => u.id === 1);
    const tick = state.tick;
    log(`  ── LM buff state [${label}] ──`);
    const lmBuffs = state.buffs.filter(b => b.unitId === 1);
    if (!lmBuffs.length) {
      log('    (no active buffs)');
    } else {
      for (const b of lmBuffs) {
        const remS    = ((b.endTick - tick) / TICK_RATE).toFixed(1);
        const parts   = [];
        if (b.atkPct)            parts.push(`atkPct +${(b.atkPct * 100).toFixed(2)}%`);
        if (b.flatAtk)           parts.push(`flatAtk +${fmtN(b.flatAtk)}`);
        if (b.attackDamageMult)  parts.push(`atkDmg +${(b.attackDamageMult * 100).toFixed(2)}%`);
        if (b.reloadSpeedPct)    parts.push(`reload +${(b.reloadSpeedPct * 100).toFixed(2)}%`);
        log(`    [${remS}s left] ${b.displayName}${parts.length ? ' → ' + parts.join(', ') : ''}`);
      }
    }
    // Totals
    const atkMult    = getAtkMult(lm.id);
    const flatAtk    = getFlatAtk(lm.id);
    const atkDmgMult = getAtkDmgMult(lm.id);
    log(`  ── Totals: atkMult=${atkMult.toFixed(4)} (1+equipAtkPct${(lm.equipAtkPct??0)*100>0?'+'+((lm.equipAtkPct??0)*100).toFixed(2)+'%':''}+buffs) | flatAtk=+${fmtN(flatAtk)} | atkDmgMult=+${(atkDmgMult*100).toFixed(2)}%`);
  }

  /** Sum active Charge Damage boost for a unit (SBS burst). */
  function getChargeDmgMult(unitId) {
    let sum = 0;
    for (const b of state.buffs) {
      if (b.unitId === unitId) sum += b.chargeDamageMult ?? 0;
    }
    return sum;
  }

  /** Sum active Projectile Attachment Damage boost for a unit (Rapi burst). */
  function getAttachmentBoost(unitId) {
    let sum = 0;
    for (const b of state.buffs) {
      if (b.unitId === unitId) sum += b.attachmentDmgBoost ?? 0;
    }
    return sum;
  }

  /** Sum active Crit Rate bonus for a unit (Helm Skill 1). */
  function getCritRatePct(unitId) {
    let sum = 0;
    for (const b of state.buffs) {
      if (b.unitId === unitId) sum += b.critRatePct ?? 0;
    }
    return sum;
  }

  // ── Burst skill activation ────────────────────────────────────────────────

  /**
   * Fire instant burst-skill damage hits for a unit.
   * @param {object} [overrides]  optional per-call overrides: { isCore, coreDmgIncrement, extraAttackDamageMult }
   *   extraAttackDamageMult — added to atkDmgMult (e.g. SK2 passive Attack Damage bonuses)
   * @returns {number} total damage dealt
   */
  function fireBurstSkillDamage(unit, hits, hitMult, overrides = {}) {
    const atkMult    = getAtkMult(unit.id);
    const atkDmgMult = getAtkDmgMult(unit.id) + (overrides.extraAttackDamageMult ?? 0);
    const cube       = CUBES[unit.cube] ?? {};
    let total = 0;
    for (let i = 0; i < hits; i++) {
      const isCrit = Math.random() < unit.critRate;
      const { damage } = calcDamage({
        atk:             unit.atk,
        atkMultiplier:   atkMult,
        enemyDef:        ENEMY.def,
        hitMultiplier:   hitMult,
        weaponType:      unit.weaponType,
        isCrit,
        critDmgIncrement: unit.critDmgIncrement ?? 0,
        isCore:          overrides.isCore ?? false,
        coreDmgIncrement: overrides.coreDmgIncrement ?? 0,
        distanceZone:    getDistanceZone(state.tick),
        isFullBurst:     true,
        attackerElement: unit.element,
        defenderElement: ENEMY.element,
        elementAdvantageDmgIncrement: (cube.elementAdvantageDmgIncrement ?? 0) + (unit._equipOpts?.elementDmgPct ?? 0),
        extra: { attackDamageMult: atkDmgMult },
        damageTakenMult:  state.enemyDamageTakenMult,
      });
      unit.totalDamage += damage;
      unit.fbDamage    += damage;
      unit.skillDamage += damage;
      unit.hitCount++;
      if (isCrit) unit.critCount++;
      total += damage;
    }
    log(`  Burst skill — ${unit.name}: ${hits} hits → ${fmtN(total)}`);
    return total;
  }

  // ── LM Burst Skill "Siren's Song" ────────────────────────────────────────

  function lmBurstActivate(unit) {
    const { name, atkDmgPct, atkDmgDurationS, reloadPct, selfAtkPct, selfAtkDurationS } = lmBurst;

    // Effect 1: all allies — Attack Damage ↑ + instant magazine reload
    const atkPctStr    = (atkDmgPct * 100).toFixed(2);
    const reloadPctStr = (reloadPct  * 100).toFixed(2);
    log(`Little Mermaid - ${name} - All allies Attack Damage ↑ ${atkPctStr}% for ${atkDmgDurationS}s, Reload ${reloadPctStr}%`);
    applyBuffAll({
      buffKey:          'LM_SirensSong_AtkDmg',
      displayName:      `${name}: Attack Damage ↑ ${atkPctStr}% for ${atkDmgDurationS}s`,
      attackDamageMult: atkDmgPct,
      durationS:        atkDmgDurationS,
    });
    // Do NOT interrupt an active reload (ammoLeft <= 0): the unit fills to
    // maxAmmo when the reload completes anyway; adding ammo early would
    // skip the remaining reload wait.
    for (const u of units) {
      if (u.ammoLeft <= 0) continue;
      const maxA      = (u.weaponData?.maxAmmo ?? WEAPON_AMMO[u.weaponType] ?? 30) + getBonusMaxAmmo(u.id);
      const reloadAmt = Math.round(maxA * reloadPct);
      u.ammoLeft      = Math.min(u.ammoLeft + reloadAmt, maxA);
    }

    // Effect 2: self only — ATK ↑ selfAtkPct for selfAtkDurationS
    const selfStr = (selfAtkPct * 100).toFixed(2);
    log(`Little Mermaid - ${name} - Self ATK ↑ ${selfStr}% for ${selfAtkDurationS}s`);
    applyBuff(unit, {
      buffKey:     'LM_SirensSong_SelfAtk',
      displayName: `${name}: ATK ↑ ${selfStr}% for ${selfAtkDurationS}s`,
      atkPct:      selfAtkPct,
      durationS:   selfAtkDurationS,
    });
  }

  /** Activate a unit's burst skill effect (buff or damage hits). */
  function activateBurstSkill(unit) {
    if (unit.id === 1) { lmBurstActivate(unit);   return; }
    if (unit.id === 2) { crownBurstActivate(unit); return; }
    if (unit.id === 3) { rapiBurstActivate(unit);  return; }
    if (unit.id === 4) { sbsBurstActivate(unit);   return; }
    if (unit.id === 5) { helmBurstActivate(unit);  return; }
    const sk = unit.burstSkill;
    if (!sk) return;
    if (sk.buffAll) {
      const { atkPct, durationS } = sk.buffAll;
      const pctStr = (atkPct * 100).toFixed(2);
      applyBuffAll({
        buffKey:     `${unit.id}_burst_atk`,
        displayName: `${unit.name} (Burst): ATK ↑ ${pctStr}% for ${durationS}s`,
        atkPct,
        durationS,
      });
    }
    if (sk.hits) {
      fireBurstSkillDamage(unit, sk.hits, sk.hitMult);
    }
  }

  // ── LM Skill 1 "Bubble Order" ─────────────────────────────────────────────

  /** Effect 3: on Full Burst start — all allies Attack Damage ↑ 4% for 10s */
  function lmSkill1_onFBStart() {
    if (!units.find(u => u.id === 1)) return;
    const { name, atkDmgPct, atkDmgDurationS } = lmSkill1;
    const pctStr = (atkDmgPct * 100).toFixed(0);
    log(`Little Mermaid - ${name} - All allies Attack Damage ↑ ${pctStr}% for ${atkDmgDurationS}s`);
    applyBuffAll({
      buffKey:          'LM_BubbleOrder_AtkDmg',
      displayName:      `${name}: Attack Damage ↑ ${pctStr}% for ${atkDmgDurationS}s`,
      attackDamageMult: atkDmgPct,
      durationS:        atkDmgDurationS,
    });
  }

  /** Effect 2: on Full Burst end — all allies burst CD ▼ by burstCdReductionS */
  function lmSkill1_onFBEnd() {
    if (!units.find(u => u.id === 1)) return;
    const { name, burstCdReductionS } = lmSkill1;
    log(`Little Mermaid - ${name} - All allies Burst CD ▼ ${burstCdReductionS}s`);
    const reductionTicks = Math.round(burstCdReductionS * TICK_RATE);
    for (const unit of units) {
      unit.burstCdTick = Math.max(state.tick, unit.burstCdTick - reductionTicks);
    }
  }

  /** Effect 4: check after each team shot — every 400 shots fills gauge +37% */
  function lmSkill1_checkAmmoThreshold() {
    if (state.totalTeamShots % lmSkill1.ammoThreshold !== 0) return;
    const fill = Math.floor(BURST_GAUGE_MAX * lmSkill1.gaugeRefillPct);
    state.gauge = Math.min(BURST_GAUGE_MAX, state.gauge + fill);
    const pctStr = (lmSkill1.gaugeRefillPct * 100).toFixed(0);
    log(`Little Mermaid - ${lmSkill1.name} - Fills Burst Gauge by ${pctStr}%`);
  }

  // ── LM Skill 2 "Bubble Wave" ──────────────────────────────────────────────
  // Effect 1: on battle start — Bubble debuff on enemy (Damage Taken ▲ 5.05%).
  //   Represented by state.enemyDamageTakenMult, passed to every calcDamage call.
  //
  // Effect 3: every 1s during Full Burst → 4 sequential hits of 63.36% LM ATK.
  function lmSk2_fbPeriodic() {
    const lm = units.find(u => u.id === 1);
    if (!lm) return;
    const atkMult    = getAtkMult(lm.id);
    const flatAtk    = getFlatAtk(lm.id);
    const atkDmgMult = getAtkDmgMult(lm.id);
    const cube       = CUBES[lm.cube] ?? {};
    let total = 0;
    logLmBuffState('FB periodic');
    log(`Little Mermaid - Bubble Wave - FB periodic (${LM_SK2_FB_HIT_COUNT} hits × ${(LM_SK2_FB_HIT_MULT * 100).toFixed(2)}% ATK):`);
    for (let i = 0; i < LM_SK2_FB_HIT_COUNT; i++) {
      const isCrit = Math.random() < (lm.critRate + getCritRatePct(lm.id));
      const dmgInput = {
        atk:              lm.atk,
        atkMultiplier:    atkMult,
        otherAtkIncrement: flatAtk,
        enemyDef:         ENEMY.def,
        hitMultiplier:    LM_SK2_FB_HIT_MULT,
        weaponType:       lm.weaponType,
        isCrit,
        critDmgIncrement: lm.critDmgIncrement ?? 0,
        isCore:           false,  // skills cannot hit core
        distanceZone:     getDistanceZone(state.tick),
        isFullBurst:      true,
        attackerElement:  lm.element,
        defenderElement:  ENEMY.element,
        elementAdvantageDmgIncrement: (cube.elementAdvantageDmgIncrement ?? 0) + (lm._equipOpts?.elementDmgPct ?? 0),
        extra:            { attackDamageMult: atkDmgMult },
        damageTakenMult:  state.enemyDamageTakenMult,
      };
      const { damage, breakdown } = calcDamage(dmgInput);
      logLmHit(i + 1, LM_SK2_FB_HIT_COUNT, LM_SK2_FB_HIT_MULT, isCrit, dmgInput, breakdown);
      lm.totalDamage += damage;
      lm.fbDamage    += damage;
      lm.skillDamage += damage;
      lm.hitCount++;
      if (isCrit) lm.critCount++;
      total += damage;
    }
    log(`Little Mermaid - Bubble Wave - FB periodic total: ${fmtN(total)}`);
    state.lmSk2FbTickNext = state.tick + LM_SK2_FB_PERIOD_S * TICK_RATE;
  }

  // Effect 4: every 500 total team shots → Bubble Barrage: 10 hits of 85% LM ATK.
  function lmSk2_checkBarrageThreshold() {
    if (state.totalTeamShots % LM_SK2_BARRAGE_THRESHOLD !== 0) return;
    const lm = units.find(u => u.id === 1);
    if (!lm) return;
    const atkMult    = getAtkMult(lm.id);
    const flatAtk    = getFlatAtk(lm.id);
    const atkDmgMult = getAtkDmgMult(lm.id);
    const cube       = CUBES[lm.cube] ?? {};
    let total = 0;
    logLmBuffState(`Barrage @${state.totalTeamShots} shots`);
    log(`Little Mermaid - Bubble Wave Barrage @${state.totalTeamShots} shots (${LM_SK2_BARRAGE_HIT_COUNT} hits × ${(LM_SK2_BARRAGE_HIT_MULT * 100).toFixed(2)}% ATK):`);
    for (let i = 0; i < LM_SK2_BARRAGE_HIT_COUNT; i++) {
      const isCrit = Math.random() < (lm.critRate + getCritRatePct(lm.id));
      const dmgInput = {
        atk:              lm.atk,
        atkMultiplier:    atkMult,
        otherAtkIncrement: flatAtk,
        enemyDef:         ENEMY.def,
        hitMultiplier:    LM_SK2_BARRAGE_HIT_MULT,
        weaponType:       lm.weaponType,
        isCrit,
        critDmgIncrement: lm.critDmgIncrement ?? 0,
        isCore:           false,  // skills cannot hit core
        distanceZone:     getDistanceZone(state.tick),
        isFullBurst:      state.fullBurst,
        attackerElement:  lm.element,
        defenderElement:  ENEMY.element,
        elementAdvantageDmgIncrement: (cube.elementAdvantageDmgIncrement ?? 0) + (lm._equipOpts?.elementDmgPct ?? 0),
        extra:            { attackDamageMult: atkDmgMult },
        damageTakenMult:  state.enemyDamageTakenMult,
      };
      const { damage, breakdown } = calcDamage(dmgInput);
      logLmHit(i + 1, LM_SK2_BARRAGE_HIT_COUNT, LM_SK2_BARRAGE_HIT_MULT, isCrit, dmgInput, breakdown);
      lm.totalDamage += damage;
      if (state.fullBurst) lm.fbDamage += damage;
      lm.skillDamage += damage;
      lm.hitCount++;
      if (isCrit) lm.critCount++;
      total += damage;
    }
    log(`Little Mermaid - Bubble Wave Barrage total: ${fmtN(total)}`);
  }

  // ── Crown Burst Skill "Last Kingdom" ─────────────────────────────────────

  function crownBurstActivate(unit) {
    const { name, atkDmgPct, atkDmgDurationS, shieldPct, shieldDurationS } = crownBurst;

    // Effect 1: all allies — Attack Damage ↑ atkDmgPct% for atkDmgDurationS s
    const pctStr = (atkDmgPct * 100).toFixed(2);
    log(`Crown - ${name} - All allies Attack Damage ↑ ${pctStr}% for ${atkDmgDurationS}s`);
    applyBuffAll({
      buffKey:          'Crown_LastKingdom_AtkDmg',
      displayName:      `${name}: Attack Damage ↑ ${pctStr}% for ${atkDmgDurationS}s`,
      attackDamageMult: atkDmgPct,
      durationS:        atkDmgDurationS,
    });

    // Effect 2: Shield = shieldPct × Crown's Max HP for shieldDurationS s (no DPS impact)
    const shieldHp = Math.round(unit.hp * shieldPct);
    log(`Crown - ${name} - All allies Shield ${fmtN(shieldHp)} HP for ${shieldDurationS}s`);
  }

  // ── Rapi: Red Hood Skill 1 "Battlefield Assessment" ──────────────────────
  // Team has LM (B1) → Rapi is never in Combat Assist.
  // Fires on every Full Burst entry: self ATK ▲ RAPI_SK1_SELF_ATK_PCT for 10 s.
  function rapiSk1_onFBStart() {
    if (!rapi) return;
    const pctStr = (RAPI_SK1_SELF_ATK_PCT * 100).toFixed(2);
    log(`Rapi: Red Hood - Battlefield Assessment - Self ATK ↑ ${pctStr}% for ${RAPI_SK1_DURATION_S}s`);
    applyBuff(rapi, {
      buffKey:     'Rapi_BattlefieldAssessment_SelfAtk',
      displayName: `Battlefield Assessment: ATK ↑ ${pctStr}% for ${RAPI_SK1_DURATION_S}s`,
      atkPct:      RAPI_SK1_SELF_ATK_PCT,
      durationS:   RAPI_SK1_DURATION_S,
    });
  }

  // ── Rapi: Red Hood Burst Skill "Power of Inheritance" (Stage 3) ──────────
  // Fires when Rapi is the active B3 (team has B1 ally → Stage 3 mode).
  function rapiBurstActivate(unit) {
    // Single hit: 2808% of final ATK
    unit._dmgBurstHit += fireBurstSkillDamage(unit, 1, RAPI_BURST_HIT_MULT);

    // Self: Projectile attachment damage ▲ 421.2% for 10 s
    const boostStr = (RAPI_BURST_ATTACHMENT_BOOST * 100).toFixed(1);
    const endTick  = state.tick + RAPI_BURST_ATTACHMENT_DURATION_S * TICK_RATE;
    const buffKey  = 'Rapi_PoI_AttachmentBoost';
    const existing = state.buffs.find(b => b.buffKey === buffKey && b.unitId === unit.id);
    if (existing) {
      existing.endTick = endTick;
    } else {
      state.buffs.push({
        buffKey,
        displayName:        `Power of Inheritance: Attachment Dmg ↑ ${boostStr}% for ${RAPI_BURST_ATTACHMENT_DURATION_S}s`,
        unitId:             unit.id,
        attachmentDmgBoost: RAPI_BURST_ATTACHMENT_BOOST,
        endTick,
      });
      log(`Rapi: Red Hood - Acquire Buff [Power of Inheritance: Attachment Dmg ↑ ${boostStr}% for ${RAPI_BURST_ATTACHMENT_DURATION_S}s]`);
    }

    // Self: Skill 2 trigger count ▼ 60 for 10 s (shots needed drops to 60)
    unit.sk2TriggerReducedTick = state.tick + RAPI_BURST_TRIGGER_REDUCTION_DURATION_S * TICK_RATE;
    log(`Rapi: Red Hood - Power of Inheritance - SK2 trigger ▼ ${RAPI_SK2_TRIGGER_REDUCED} shots for ${RAPI_BURST_TRIGGER_REDUCTION_DURATION_S}s`);
  }

  // ── Rapi: Red Hood Skill 2 "Attachable Projectiles" ──────────────────────

  /**
   * Called after each Rapi shot.
   * - Outside FB: every N shots a projectile sticks on the enemy (queued for next FB).
   * - During FB:  every N shots a projectile immediately fires both attach + explode damage.
   * No cap on simultaneously queued projectiles.
   */
  function rapiSk2_onShot(unit) {
    unit.shotsSinceLastProjectile++;
    const trigger = (state.tick < unit.sk2TriggerReducedTick)
      ? RAPI_SK2_TRIGGER_REDUCED
      : RAPI_SK2_TRIGGER_BASE;
    if (unit.shotsSinceLastProjectile >= trigger) {
      unit.shotsSinceLastProjectile = 0;
      if (state.fullBurst) {
        // During FB: projectile immediately deals attach + explode
        log(`Rapi: Red Hood - Attachable Projectiles - Projectile fired during FB → immediate attach+explode`);
        _rapiFireProjectile(unit);
      } else {
        // Before FB: sticks on enemy, queued for next FB start
        unit.projectilesReady++;
        log(`Rapi: Red Hood - Attachable Projectiles - Projectile attached (${unit.projectilesReady} pending)`);
      }
    }
  }

  /** Fire one projectile's attach + explode damage (used by both on-shot-during-FB and onFBStart). */
  function _rapiFireProjectile(unit) {
    const attachAtkDmg  = RAPI_SK2_ATTACHMENT_PASSIVE + getAttachmentBoost(unit.id);
    const explodeAtkDmg = RAPI_SK2_EXPLOSION_PASSIVE;
    const attachOpts  = { isCore: ENEMY.hasCore, coreDmgIncrement: unit.coreDmgIncrement ?? 0, extraAttackDamageMult: attachAtkDmg };
    const explodeOpts = { isCore: false, extraAttackDamageMult: explodeAtkDmg };
    const dAttach  = fireBurstSkillDamage(unit, 1, RAPI_SK2_BASE_MULT, attachOpts);
    const dExplode = fireBurstSkillDamage(unit, 1, RAPI_SK2_BASE_MULT, explodeOpts);
    unit._dmgAttach  += dAttach;
    unit._dmgExplode += dExplode;
    log(`    attach ${fmtN(dAttach)} | explode ${fmtN(dExplode)}`);
  }

  /** Called at FB start: explode all projectiles that were queued before FB. */
  function rapiSk2_onFBStart() {
    if (!rapi || rapi.projectilesReady <= 0) return;
    const count = rapi.projectilesReady;
    rapi.projectilesReady = 0;
    log(`Rapi: Red Hood - Attachable Projectiles - ${count} queued projectile(s) explode at FB start`);
    for (let i = 0; i < count; i++) _rapiFireProjectile(rapi);
  }

  // ── Scarlet: Black Shadow Burst "Fleetly Fading: Strike" ─────────────────
  function sbsBurstActivate(unit) {
    // Self: ATK ▲ 115.12% for 10 s
    const atkStr = (SBS_BURST_ATK_PCT * 100).toFixed(2);
    log(`Scarlet: Black Shadow - Fleetly Fading: Strike - Self ATK ↑ ${atkStr}% for ${SBS_BURST_ATK_DURATION_S}s`);
    applyBuff(unit, {
      buffKey:     'SBS_Strike_Atk',
      displayName: `Strike: ATK ↑ ${atkStr}% for ${SBS_BURST_ATK_DURATION_S}s`,
      atkPct:      SBS_BURST_ATK_PCT,
      durationS:   SBS_BURST_ATK_DURATION_S,
    });

    // Self: Charge Damage ▲ 150.12% for 10 s
    const cdStr = (SBS_BURST_CHARGE_DMG_PCT * 100).toFixed(2);
    log(`Scarlet: Black Shadow - Fleetly Fading: Strike - Self Charge Damage ↑ ${cdStr}% for ${SBS_BURST_CHARGE_DMG_DURATION_S}s`);
    const cdEndTick = state.tick + SBS_BURST_CHARGE_DMG_DURATION_S * TICK_RATE;
    const cdKey     = 'SBS_Strike_ChargeDmg';
    const cdExist   = state.buffs.find(b => b.buffKey === cdKey && b.unitId === unit.id);
    if (cdExist) { cdExist.endTick = cdEndTick; }
    else {
      state.buffs.push({
        buffKey: cdKey,
        displayName: `Strike: Charge Damage ↑ ${cdStr}% for ${SBS_BURST_CHARGE_DMG_DURATION_S}s`,
        unitId: unit.id,
        chargeDamageMult: SBS_BURST_CHARGE_DMG_PCT,
        endTick: cdEndTick,
      });
      log(`Scarlet: Black Shadow - Acquire Buff [Strike: Charge Damage ↑ ${cdStr}% for ${SBS_BURST_CHARGE_DMG_DURATION_S}s]`);
    }

    // Self: SK1 thresholds → 1/2/3 for 10 s; reset counter so cycle starts cleanly at 0
    unit.sk1BurstTick = state.tick + SBS_BURST_SK1_DURATION_S * TICK_RATE;
    unit.chargeCount  = 0;
    log(`Scarlet: Black Shadow - Fleetly Fading: Strike - SK1 thresholds → 1/2/3 for ${SBS_BURST_SK1_DURATION_S}s`);
  }

  // ── Scarlet: Black Shadow Skill 2 "Fleetly Fading: Asura" ────────────────
  // Activates on every Full Burst entry: max ammo ▲ 60% for 10 s + 100% reload.
  function sbsSk2_onFBStart() {
    if (!sbs) return;
    const baseAmmo  = sbs.weaponData?.maxAmmo ?? WEAPON_AMMO[sbs.weaponType] ?? 9;
    const finalMaxAmmoIncrement = Math.floor(baseAmmo * SBS_SK2_MAX_AMMO_PCT);
    const finalMaxAmmo          = baseAmmo + finalMaxAmmoIncrement;
    log(`Scarlet: Black Shadow - Fleetly Fading: Asura - Max Ammo ↑ ${finalMaxAmmoIncrement} (${baseAmmo}→${finalMaxAmmo}) for ${SBS_SK2_DURATION_S}s + 100% reload`);
    // Instant full reload to boosted max (replaces any in-progress reload)
    sbs.ammoLeft   = finalMaxAmmo;
    sbs.reloadTick = 0;
    // Store boosted max ammo as a timed buff so the reload code uses it
    const endTick  = state.tick + SBS_SK2_DURATION_S * TICK_RATE;
    const key      = 'SBS_Asura_MaxAmmo';
    const exist    = state.buffs.find(b => b.buffKey === key && b.unitId === sbs.id);
    if (exist) { exist.endTick = endTick; exist.finalMaxAmmoIncrement = finalMaxAmmoIncrement; }
    else {
      state.buffs.push({ buffKey: key, displayName: `Asura: Max Ammo +${finalMaxAmmoIncrement}`, unitId: sbs.id, finalMaxAmmoIncrement, endTick });
      log(`Scarlet: Black Shadow - Acquire Buff [Asura: Max Ammo +${finalMaxAmmoIncrement} for ${SBS_SK2_DURATION_S}s]`);
    }
  }

  /** Returns total bonus ammo for a unit from active buffs (SBS SK2). */
  function getBonusMaxAmmo(unitId) {
    // Equipment option equipMaxAmmoPct + fav item ammo (both baked into unit._maxAmmo at init,
    // but also returned here so reload logic and Bastion cap use a single formula).
    const unit = units.find(u => u.id === unitId);
    let sum = (unit?._equipOpts?.equipMaxAmmoPct ?? 0) + (unit?._favMaxAmmoFlat ?? 0);
    for (const b of state.buffs) {
      if (b.unitId === unitId) sum += b.finalMaxAmmoIncrement ?? 0;
    }
    return sum;
  }

  // ── Scarlet: Black Shadow Skill 1 "Fleetly Fading: Breakthrough" ─────────
  // Fires on each RL full-charge shot (every shot for RL).
  // Accumulates charge counter; at each threshold, fires the corresponding phase.
  function sbsSk1_firePhase(unit, phase, hitMult) {
    const atkMult     = getAtkMult(unit.id);
    const atkDmgMult  = getAtkDmgMult(unit.id);
    const flatAtk     = getFlatAtk(unit.id);
    const cube        = CUBES[unit.cube] ?? {};
    const isCrit      = Math.random() < unit.critRate;
    const { damage }  = calcDamage({
      atk:              unit.atk,
      atkMultiplier:    atkMult,
      otherAtkIncrement: flatAtk,
      enemyDef:         ENEMY.def,
      hitMultiplier:    hitMult,
      weaponType:       unit.weaponType,
      isCrit,
      critDmgIncrement: unit.critDmgIncrement ?? 0,
      isCore:           false,  // skills cannot hit core
      distanceZone:     getDistanceZone(state.tick),
      isFullBurst:      state.fullBurst,
      attackerElement:  unit.element,
      defenderElement:  ENEMY.element,
      elementAdvantageDmgIncrement: (cube.elementAdvantageDmgIncrement ?? 0) + (unit._equipOpts?.elementDmgPct ?? 0),
      extra: { attackDamageMult: atkDmgMult },  // Charge Damage does NOT apply to skill damage
      damageTakenMult:  state.enemyDamageTakenMult,
    });
    unit.totalDamage += damage;
    unit.skillDamage += damage;
    if (state.fullBurst) unit.fbDamage += damage;
    unit.hitCount++;
    if (isCrit) unit.critCount++;
    log(`  SK1 Phase ${phase} — Scarlet: Black Shadow: ×${hitMult.toFixed(4)} → ${fmtN(damage)}`);
  }

  function sbsSk1_onShot(unit) {
    unit.chargeCount++;
    const inBurst   = state.tick < unit.sk1BurstTick;
    const t1 = inBurst ? SBS_BURST_SK1_PHASE1_THRESHOLD : SBS_SK1_PHASE1_THRESHOLD;
    const t2 = inBurst ? SBS_BURST_SK1_PHASE2_THRESHOLD : SBS_SK1_PHASE2_THRESHOLD;
    const t3 = inBurst ? SBS_BURST_SK1_PHASE3_THRESHOLD : SBS_SK1_PHASE3_THRESHOLD;

    if (unit.chargeCount === t1) sbsSk1_firePhase(unit, 1, SBS_SK1_PHASE1_MULT);
    if (unit.chargeCount === t2) sbsSk1_firePhase(unit, 2, SBS_SK1_PHASE2_MULT);
    if (unit.chargeCount === t3) {
      sbsSk1_firePhase(unit, 3, SBS_SK1_PHASE3_MULT);
      unit.chargeCount = 0;  // reset cycle
    }
  }

  // ── Helm Skill 1 "Frontline Command" (w/ Antique Compass) ───────────────
  // Effect 1: last bullet hits → all allies Crit Rate ▲ 14.64% for 5 s.
  function helmSk1_onLastBullet() {
    const pctStr = (HELM_SK1_CRIT_RATE_PCT * 100).toFixed(2);
    log(`Helm - Frontline Command - All allies Crit Rate ↑ ${pctStr}% for ${HELM_SK1_DURATION_S}s`);
    applyBuffAll({
      buffKey:     'Helm_FrontlineCommand_CritRate',
      displayName: `Frontline Command: Crit Rate ↑ ${pctStr}% for ${HELM_SK1_DURATION_S}s`,
      critRatePct: HELM_SK1_CRIT_RATE_PCT,
      durationS:   HELM_SK1_DURATION_S,
    });
  }

  // Effect 2 (Antique Compass): full charge → all allies Burst Gauge ▲ 14.31%.
  // (HP recovery 0.59% Helm HP also fires — no DPS impact, not logged.)
  function helmSk1_onShot() {
    if (state.fullBurst) return; // gauge doesn't fill during FB
    const fill = Math.floor(BURST_GAUGE_MAX * HELM_SK1_GAUGE_FILL_PCT);
    state.gauge = Math.min(BURST_GAUGE_MAX, state.gauge + fill);
  }

  // ── Helm Skill 2 "Fire Away" (w/ Antique Compass) ────────────────────────
  // Effect 2 (enhanced): on FB entry → all allies Attack Damage ▲ 27.87% for 10 s.
  function helmSk2_onFBStart() {
    if (!units.find(u => u.id === 5)) return;
    const pctStr = (HELM_SK2_ATK_DMG_PCT * 100).toFixed(2);
    log(`Helm - Fire Away - All allies Attack Damage ↑ ${pctStr}% for ${HELM_SK2_DURATION_S}s`);
    applyBuffAll({
      buffKey:          'Helm_FireAway_AtkDmg',
      displayName:      `Fire Away: Attack Damage ↑ ${pctStr}% for ${HELM_SK2_DURATION_S}s`,
      attackDamageMult: HELM_SK2_ATK_DMG_PCT,
      durationS:        HELM_SK2_DURATION_S,
    });
  }

  // Effect 3 (Antique Compass): full charge hit → 178.98% ATK additional damage.
  // Charge Damage buff from Helm burst also applies to this hit.
  // Not logged individually to avoid spam (every SR shot).
  function helmSk2_onShot(unit) {
    const atkMult        = getAtkMult(unit.id);
    const flatAtk        = getFlatAtk(unit.id);
    const atkDmgMult     = getAtkDmgMult(unit.id);
    const chargeDmgStat  = 1 + (unit.burstChargeDmgRoundsLeft > 0 ? HELM_BURST_CHARGE_DMG_PCT : 0)
                             + (unit._equipOpts?.chargeDmgPct ?? 0) + (unit._favSkills?.chargeDmgPct ?? 0);
    const fullChargeDamage = unit.weaponData?.fullChargeDamage ?? CHARGE_DAMAGE_BASE;
    const cube           = CUBES[unit.cube] ?? {};
    const isCrit         = Math.random() < (unit.critRate + getCritRatePct(unit.id));
    const { damage } = calcDamage({
      atk:               unit.atk,
      atkMultiplier:     atkMult,
      otherAtkIncrement: flatAtk,
      enemyDef:          ENEMY.def,
      hitMultiplier:     HELM_SK2_HIT_MULT,
      weaponType:        unit.weaponType,
      isCrit,
      critDmgIncrement:  unit.critDmgIncrement ?? 0,
      isCore:            false,  // skills cannot hit core
      distanceZone:      getDistanceZone(state.tick),
      isFullBurst:       state.fullBurst,
      attackerElement:   unit.element,
      defenderElement:   ENEMY.element,
      elementAdvantageDmgIncrement: (cube.elementAdvantageDmgIncrement ?? 0) + (unit._equipOpts?.elementDmgPct ?? 0),
      isCharged: true,
      fullChargeDamage,
      chargeDmgStat,
      extra: { attackDamageMult: atkDmgMult },
      damageTakenMult:   state.enemyDamageTakenMult,
    });
    unit.totalDamage += damage;
    unit.skillDamage += damage;
    if (state.fullBurst) unit.fbDamage += damage;
    unit.hitCount++;
    if (isCrit) unit.critCount++;
  }

  // ── Helm Burst Skill "Aegis Cannon" (w/ Antique Compass) ─────────────────
  // Effect 1 (enhanced): 1 hit → 8236.8% of final ATK (was 1237.5% base).
  // Effect 2 (unchanged): all allies HP recovery 54.45% ATK for 10 s (no DPS impact).
  // Effect 3 (Antique Compass): self Charge Damage Multiplier ▲ 158.4% for 10 rounds.
  function helmBurstActivate(unit) {
    fireBurstSkillDamage(unit, 1, HELM_BURST_HIT_MULT);
    unit.burstChargeDmgRoundsLeft = HELM_BURST_CHARGE_ROUNDS;
    const cdStr = (HELM_BURST_CHARGE_DMG_PCT * 100).toFixed(1);
    log(`Helm - Aegis Cannon - Self Charge Dmg ↑ ${cdStr}% for ${HELM_BURST_CHARGE_ROUNDS} rounds + HP recovery for all`);
  }

  // ── Crown Skill 1 "One for All" ───────────────────────────────────────────

  /**
   * Fires at the start of Full Burst (after B3 fires its burst skill).
   * Group A = units who fired their burst skill this rotation (B1, B2, active B3).
   * Group B = units who did not fire (B3 on CD, Helm/Free who fires during FB).
   */
  function crownSkill1_onFBStart() {
    const crown = units.find(u => u.id === 2);
    if (!crown) return;
    const { sk1 } = crownSkills;
    const flatAtkAmount = Math.round(crown.atk * sk1.atkPctOfCrownAtk); // base ATK only, no multipliers
    log(`Crown - ${sk1.name} - Group A: ATK ↑ ${fmtN(flatAtkAmount)} + Reload ↑ ${(sk1.reloadSpeedA*100).toFixed(2)}% for ${sk1.durationS}s`);
    log(`Crown - ${sk1.name} - Group B: Reload ↑ ${(sk1.reloadSpeedB*100).toFixed(2)}% for ${sk1.durationS}s`);
    for (const unit of units) {
      const inGroupA = state.burstsUsedThisRotation.has(unit.id);
      if (inGroupA) {
        // ATK ▲ X% of Crown's ATK (flat increment) for 15s
        applyBuff(unit, {
          buffKey:     'Crown_OneForAll_FlatAtk',
          displayName: `${sk1.name}: ATK ↑ ${fmtN(flatAtkAmount)} for ${sk1.durationS}s`,
          flatAtk:     flatAtkAmount,
          durationS:   sk1.durationS,
        });
        // Reload Speed for Group A
        applyBuff(unit, {
          buffKey:        'Crown_OneForAll_ReloadA',
          displayName:    `${sk1.name}: Reload Speed ↑ ${(sk1.reloadSpeedA*100).toFixed(2)}% for ${sk1.durationS}s`,
          reloadSpeedPct: sk1.reloadSpeedA,
          durationS:      sk1.durationS,
        });
      } else {
        // Group B: DEF buff skipped (no DPS impact), Reload Speed only
        applyBuff(unit, {
          buffKey:        'Crown_OneForAll_ReloadB',
          displayName:    `${sk1.name}: Reload Speed ↑ ${(sk1.reloadSpeedB*100).toFixed(2)}% for ${sk1.durationS}s`,
          reloadSpeedPct: sk1.reloadSpeedB,
          durationS:      sk1.durationS,
        });
      }
    }
  }

  // ── Crown Skill 2 "Royal Attire" ──────────────────────────────────────────

  /** Fires Attack Damage buff to all allies. Called on HP recovery on Crown. */
  function crownSkill2_onHpRecovery() {
    const { sk2 } = crownSkills;
    const pctStr = (sk2.atkDmgPct * 100).toFixed(2);
    log(`Crown - ${sk2.name} - All allies Attack Damage ↑ ${pctStr}% for ${sk2.atkDmgDurationS}s`);
    applyBuffAll({
      buffKey:          'Crown_RoyalAttire_AtkDmg',
      displayName:      `${sk2.name}: Attack Damage ↑ ${pctStr}% for ${sk2.atkDmgDurationS}s`,
      attackDamageMult: sk2.atkDmgPct,
      durationS:        sk2.atkDmgDurationS,
    });
  }

  /**
   * Called after each Crown shot. Accumulates Relax stacks (every 43 shots).
   * At 20 stacks: triggers heal → Attack Damage buff for all allies.
   * TODO: also call crownSkill2_onHpRecovery() from Helm's full-charge heal.
   */
  function crownSkill2_onShot(unit) {
    const { sk2 } = crownSkills;
    if (unit.shotsFiredTotal % sk2.shotsPerStack !== 0) return;
    unit.relaxStacks++;
    if (unit.relaxStacks < sk2.maxStacks) return;
    // Full stacks — trigger heal + Attack Damage buff
    unit.relaxStacks = 0;
    log(`Crown - ${sk2.name} - Relax fully stacked (${sk2.maxStacks}×) → Heal + Taunt`);
    crownSkill2_onHpRecovery();
  }

  // ── Main loop ───────────────────────────────────────────────────────────────

  // LM SK2 Effect 1: Bubble debuff on enemy at battle start (permanent)
  if (units.find(u => u.id === 1)) {
    state.enemyDamageTakenMult = LM_SK2_BUBBLE_DEBUFF_PCT;
    log(`Little Mermaid - Bubble Wave - Battle start: enemy Damage Taken ▲ ${(LM_SK2_BUBBLE_DEBUFF_PCT * 100).toFixed(2)}% (permanent)`);
  }

  for (state.tick = 1; state.tick <= MAX_TICKS; state.tick++) {

    // Expire old buffs (with logging)
    cleanExpiredBuffs();

    // 1. Full Burst window expires
    if (state.fullBurst && state.tick > state.fbEndTick) {
      state.fullBurst  = false;
      state.burstPhase = 0;
      log('Full Burst ended');
      // LM Skill 1 Effect 2: reduce all burst CDs
      lmSkill1_onFBEnd();
    }

    // 2a. B1-fired + B2 exists → B2 fires after 0.6 s
    if (b2 && state.burstPhase === 1 && state.tick >= state.burstPhaseTick) {
      state.burstPhase     = 2;
      state.burstPhaseTick = state.tick + BURST_STEP_TICKS;
      state.burstsUsedThisRotation.add(b2.id);
      b2.burstUses++;
      b2.burstCdTick = state.tick + b2.burstCd * TICK_RATE;
      log(`  Burst II   — ${b2.name}`);
      activateBurstSkill(b2);
    }

    // 2b. No B2: burst step 2 window (10 s) expires → reset chain
    if (!b2 && state.burstPhase === 1 && state.tick >= state.burstExpireTick) {
      state.burstPhase = 0;
      log(`Burst chain expired — step 2 window elapsed with no B2`);
    }

    // 3. B2-fired → B3 fires → Full Burst activates
    if (state.burstPhase === 2 && state.tick >= state.burstPhaseTick) {
      const b3 = b3List[state.b3Turn % b3List.length];
      state.b3Turn++;
      state.burstPhase  = 3;
      state.fullBurst   = true;
      state.fbEndTick   = state.tick + FULL_BURST_TICKS;
      state.gauge       = 0;
      state.burstsUsedThisRotation.add(b3.id); // B3 fires before FB starts
      b3.burstUses++;
      b3.burstCdTick = state.tick + b3.burstCd * TICK_RATE;

      log(`  Full Burst — ${b3.name} (B3)`);
      // Rapi Skill 1: self ATK buff on every FB entry (fires before burst so it
      // boosts her burst damage when she is the active B3 this rotation)
      rapiSk1_onFBStart();
      activateBurstSkill(b3);

      // Crown Skill 1: activates at start of FB, after all burst skills fired
      crownSkill1_onFBStart();

      // LM Skill 1 Effect 3: Attack Damage buff on FB start
      lmSkill1_onFBStart();

      // Rapi Skill 2: projectile explosion on FB start (after burst attachment
      // boost is already applied, so the boosted multiplier is used)
      rapiSk2_onFBStart();

      // SBS Skill 2: max ammo buff + instant reload on every FB entry
      sbsSk2_onFBStart();

      // Helm Skill 2: all allies Attack Damage buff on every FB entry
      helmSk2_onFBStart();

      // LM Skill 2: set FB periodic start tick (fires immediately this same tick below)
      state.lmSk2FbTickNext = state.tick;

      state.burstCycles.push({ tick: state.tick, b3: b3.name });
    }

    // 4. Gauge full + required CDs ready → start burst chain (B1 fires).
    // B1 can fire alone; B2/B3 are optional (their CD checks are skipped if absent).
    if (b1 && state.burstPhase === 0 && !state.fullBurst && state.gauge >= BURST_GAUGE_MAX) {
      const nextB3  = b3List[state.b3Turn % b3List.length];
      const b2Ready = !b2     || b2.burstCdTick    <= state.tick;
      const b3Ready = !nextB3 || nextB3.burstCdTick <= state.tick;
      if (b1.burstCdTick <= state.tick && b2Ready && b3Ready) {
        state.burstPhase      = 1;
        state.burstPhaseTick  = state.tick + BURST_STEP_TICKS;
        state.burstExpireTick = state.tick + FULL_BURST_TICKS;  // 10 s window for B2
        state.gauge           = 0;  // gauge consumed when burst chain starts
        state.burstsUsedThisRotation.clear();
        state.burstsUsedThisRotation.add(b1.id);
        b1.burstUses++;
        b1.burstCdTick = state.tick + b1.burstCd * TICK_RATE;
        const b3Str = nextB3 ? `next B3: ${nextB3.name}` : 'no B3';
        log(`Burst I    — ${b1.name}  (gauge 100%, ${b3Str})`);
        activateBurstSkill(b1);
      }
    }

    // LM Skill 2 Effect 3: fire periodic burst damage (every 1s during Full Burst)
    if (state.fullBurst && state.tick >= state.lmSk2FbTickNext) {
      lmSk2_fbPeriodic();
    }

    // 5. Each unit attacks
    // ── Single-shot helper (used by both probabilistic and MG ramp paths) ──
    function fireOneShot(unit) {
      const cube        = CUBES[unit.cube] ?? {};
      const maxAmmo     = (unit.weaponData?.maxAmmo ?? WEAPON_AMMO[unit.weaponType] ?? 30) + getBonusMaxAmmo(unit.id);
      const atkMult     = getAtkMult(unit.id);
      const flatAtk     = getFlatAtk(unit.id);
      const atkDmgMult  = getAtkDmgMult(unit.id);
      // SR / RL always fire full-charge shots. Apply the weapon's full_charge_damage multiplier.
      // chargeDmgStat = 1 + all active "Charge Damage ▲" buffs on this unit.
      const isCharged        = SR_RL_WEAPONS.has(unit.weaponType);
      const fullChargeDamage = unit.weaponData?.fullChargeDamage ?? CHARGE_DAMAGE_BASE;
      let chargeDmgStat = 1;
      if (unit.weaponType === 'RL') {
        chargeDmgStat = 1 + getChargeDmgMult(unit.id) + (unit._equipOpts?.chargeDmgPct ?? 0)
                          + (unit._favSkills?.chargeDmgPct ?? 0);
      } else if (unit.weaponType === 'SR') {
        chargeDmgStat = 1 + (unit.burstChargeDmgRoundsLeft > 0 ? HELM_BURST_CHARGE_DMG_PCT : 0)
                          + (unit._equipOpts?.chargeDmgPct ?? 0) + (unit._favSkills?.chargeDmgPct ?? 0);
      }

      const effectiveCritRate = unit.critRate + getCritRatePct(unit.id);
      const isCrit = Math.random() < effectiveCritRate;
      const { damage } = calcDamage({
        atk:              unit.atk,
        atkMultiplier:    atkMult,
        otherAtkIncrement: flatAtk,
        enemyDef:         ENEMY.def,
        hitMultiplier:    unit.weaponData?.hitMult ?? WEAPON_HIT_MULT[unit.weaponType] ?? 0.03,
        weaponType:       unit.weaponType,
        isCrit,
        critDmgIncrement: unit.critDmgIncrement ?? 0,
        coreDmgIncrement: unit.coreDmgIncrement ?? 0,
        isCore:           ENEMY.hasCore,
        distanceZone:     getDistanceZone(state.tick),
        isFullBurst:      state.fullBurst,
        attackerElement:  unit.element,
        defenderElement:  ENEMY.element,
        elementAdvantageDmgIncrement: (cube.elementAdvantageDmgIncrement ?? 0) + (unit._equipOpts?.elementDmgPct ?? 0),
        isCharged,
        fullChargeDamage,
        chargeDmgStat,
        extra: { attackDamageMult: atkDmgMult + (unit._favSkills?.normalAtkDmgPct ?? 0) },
        damageTakenMult:  state.enemyDamageTakenMult,
      });

      unit.ammoLeft--;
      unit.shotsFiredTotal++;
      unit.hitCount++;
      if (isCrit) unit.critCount++;
      unit.totalDamage += damage;
      if (state.fullBurst) unit.fbDamage += damage;

      // Bastion cube: every N shots reload M rounds (counter never resets)
      if (cube.bastionPeriod && unit.shotsFiredTotal % cube.bastionPeriod === 0) {
        unit.ammoLeft = Math.min(unit.ammoLeft + cube.bastionReload, maxAmmo);
      }

      // Crown Skill 2: every N shots → Relax stack
      if (unit.id === 2) crownSkill2_onShot(unit);

      // Rapi Skill 2: accumulate projectile every 120 shots (60 during burst)
      if (unit.id === 3) rapiSk2_onShot(unit);

      // SBS Skill 1: fire phase damage at charge count thresholds
      if (unit.id === 4) sbsSk1_onShot(unit);

      // Helm Skill 1: last bullet hit → all allies Crit Rate buff
      if (unit.id === 5 && unit.ammoLeft === 0) helmSk1_onLastBullet();
      // Helm SK1 (full charge gauge fill) + SK2 (full charge extra hit) — every SR shot
      if (unit.id === 5) { helmSk1_onShot(); helmSk2_onShot(unit); }
      // Helm burst Charge Damage countdown — decrement AFTER SK2 uses it
      if (unit.id === 5 && unit.burstChargeDmgRoundsLeft > 0) unit.burstChargeDmgRoundsLeft--;

      // Global shot counter — LM SK1 Effect 4 + SK2 Effect 4
      state.totalTeamShots++;
      lmSkill1_checkAmmoThreshold();
      lmSk2_checkBarrageThreshold();

      // Fill shared burst gauge (only outside FB window)
      if (!state.fullBurst) {
        const baseEnergy   = unit.weaponData?.burstEnergy ?? BURST_ENERGY[unit.weaponType] ?? 1_500;
        const chargeBonus  = (isCharged && unit.ammoLeft >= 0) ? (unit.weaponData?.fullChargeBurstEnergy ?? 0) : 0;
        state.gauge = Math.min(BURST_GAUGE_MAX, state.gauge + baseEnergy + chargeBonus);
      }
    }

    for (const unit of units) {
      const cube    = CUBES[unit.cube] ?? {};
      // SBS SK2 boosts max ammo while the Asura buff is active
      const maxAmmo = (unit.weaponData?.maxAmmo ?? WEAPON_AMMO[unit.weaponType] ?? 30)
                    + getBonusMaxAmmo(unit.id);
      // Total reload speed: cube bonus + active buff bonus
      const reloadSpeedTotal = (cube.reloadSpeedPct ?? 0) + getReloadSpeedPct(unit.id);
      const baseReloadT = unit.weaponData
        ? Math.round(unit.weaponData.reloadTimeSec * TICK_RATE)
        : (RELOAD_TICKS[unit.weaponType] ?? 120);
      const reloadT = Math.round(baseReloadT / (1 + reloadSpeedTotal));

      // Reload
      if (unit.ammoLeft <= 0) {
        if (unit.reloadTick === 0) {
          unit.reloadTick = state.tick + reloadT;
          log(`${unit.name} — RELOAD START  (${(reloadT / TICK_RATE).toFixed(3)}s = base/${(1 + reloadSpeedTotal).toFixed(4)}, finishes at ${fmtT(unit.reloadTick)})`);
          // MG: reset fire ramp on reload start
          if (unit.weaponType === 'MG') {
            unit.currentRPM = unit.weaponData?.rateOfFire ?? 60;
            unit.shotAccum  = 0;
          }
        }
        if (state.tick < unit.reloadTick) continue;
        unit.ammoLeft   = maxAmmo;
        unit.reloadTick = 0;
        log(`${unit.name} — RELOAD COMPLETE  ammo restored to ${maxAmmo}`);
        // SR / RL: full cycle delay after reload (same min interval + charge as between shots)
        if (SR_RL_WEAPONS.has(unit.weaponType)) {
          const csf     = (cube.chargeSpeedPct ?? 0) + (unit._equipOpts?.chargeSpeedPct ?? 0);
          const rawTick = unit.weaponData?.chargeTimeTicks ?? 60;
          unit.nextShotTick = state.tick + SR_RL_MIN_INTERVAL_TICKS + Math.round(rawTick * (1 - csf));
        }
      }

      if (unit.weaponType === 'MG') {
        // ── MG: deterministic ramp model ──────────────────────────────────
        // Accumulate fractional shots per tick based on current RPM.
        // Fire all accumulated whole shots; ramp RPM up after each shot.
        unit.shotAccum += unit.currentRPM / 3600; // RPM/60/60 = shots per tick
        while (unit.shotAccum >= 1 && unit.ammoLeft > 0) {
          unit.shotAccum -= 1;
          fireOneShot(unit);
          unit.currentRPM = Math.min(
            unit.currentRPM + (unit.weaponData?.rateOfFireChange ?? 100),
            unit.weaponData?.endRateOfFire ?? 4200,
          );
        }
      } else if (SR_RL_WEAPONS.has(unit.weaponType)) {
        // ── SR / RL: deterministic charge-time model ──────────────────────
        // Fire when the charge is complete; reset nextShotTick after each shot.
        if (state.tick < unit.nextShotTick) continue;
        fireOneShot(unit);
        // Last bullet: reload starts immediately — no min-interval delay, reload block handles nextShotTick.
        if (unit.ammoLeft > 0) {
          const csf     = (cube.chargeSpeedPct ?? 0) + (unit._equipOpts?.chargeSpeedPct ?? 0);
          const rawTick = unit.weaponData?.chargeTimeTicks ?? 60;
          // Cycle = MIN_INTERVAL (fixed gap after shot) + chargeTime (before next shot)
          unit.nextShotTick = state.tick + SR_RL_MIN_INTERVAL_TICKS + Math.round(rawTick * (1 - csf));
        }
      } else {
        // ── AR / SMG / SG: probabilistic fire gate ────────────────────────
        if (Math.random() > (unit.weaponData?.rateOfFireProb ?? ATTACK_SPEED[unit.weaponType] ?? 0.10)) continue;
        fireOneShot(unit);
      }
    }
  }

  return { units, state };
}

// ── Stat computation helper ───────────────────────────────────────────────────

/**
 * Compute final ATK/HP/DEF for a NIKKE using the stats pipeline (stats.js).
 * "Increase ATK: X%" from equipment is NOT a flat bonus — it is stored as unit.equipAtkPct
 * and added to atkMultiplier in getAtkMult() during combat (additive with skill ATK% buffs).
 *
 * @param {object}  nikkeData  raw CDN nikke JSON (from loadNikkeData)
 * @param {object}  cubeData   raw CDN cube JSON (from loadCubeData)
 * @param {object|null} favItemData  raw CDN fav-item JSON (null if none)
 * @param {object}  teamEntry  TEAM[i] (must have classType, corporation, grade, core, weaponData, favItem, _equipConfig)
 * @returns {{ atk, hp, def, critRate, critDmg, bonusAmmo }}
 */
function computeNikkeStats(nikkeData, cubeData, favItemData, teamEntry) {
  const raw = teamEntry._equipConfig ?? {};
  const favLevel = (favItemData && teamEntry.favItem?.level) ? teamEntry.favItem.level : 0;

  const baseEquipOpts = {
    atkFlat:        0,
    defFlat:        0,
    bonusAmmo:      0,
    elementDmgPct:  raw.elementDmgPct  ?? 0,
    critRatePct:    raw.critRatePct    ?? 0,
    critDamagePct:     raw.critDamagePct     ?? 0,
    chargeDmgPct:   raw.chargeDmgPct   ?? 0,
    chargeSpeedPct: raw.chargeSpeedPct ?? 0,
    hitRatePct:     raw.hitRatePct     ?? 0,
  };

  const equipment = {
    head:  { classReq: teamEntry.classType, tier: 'T10', level: 5, options: [] },
    torso: { classReq: teamEntry.classType, tier: 'T10', level: 5, options: [] },
    arms:  { classReq: teamEntry.classType, tier: 'T10', level: 5, options: [] },
    legs:  { classReq: teamEntry.classType, tier: 'T10', level: 5, options: [] },
  };

  // Equipment "Increase ATK: X%" is an ATK multiplier increment applied in combat (atkMultiplier),
  // NOT a flat ATK bonus — see calcDamage. Do not bake atkPct into the stat here.
  const slot0 = {
    classType:   teamEntry.classType,
    corporation: teamEntry.corporation,
    grade:       teamEntry.grade,
    core:        teamEntry.core,
    bondLevel:   teamEntry.bondLevel ?? BOND_LEVEL,
    cube:        { resourceId: null, level: 15 },
    favoriteItem:{ resourceId: null, level: favLevel, rare: 'SR' },
    equipment,
    _nikkeData:  nikkeData,
    _cubeData:   cubeData,
    _favItemData: favItemData,
    equipOptions: baseEquipOpts,
  };

  return computeFinalStats(slot0, NIKKE_LEVEL, RESEARCH);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  // Load static CDN tables required by computeFinalStats / models.js
  const [attractive, recycleRoom, equipment] = await Promise.all([
    loadStaticData('attractive'),
    loadStaticData('recycleRoom'),
    loadStaticData('equipment'),
  ]);
  setData('attractive',  attractive);
  setData('recycleRoom', recycleRoom);
  setData('equipment',   equipment);

  // Load harmony cube CDN data for all cubes in the team
  const [resilCubeData, bastionCubeData, adjutantCubeData] = await Promise.all([
    loadCubeData(10003),   // Resilience
    loadCubeData(10004),   // Bastion
    loadCubeData(10005),   // Adjutant
  ]);
  const CUBE_DATA = { Resilience: resilCubeData, Bastion: bastionCubeData, Adjutant: adjutantCubeData };

  // Load all nikke CDN data in parallel
  const [lmData, crownData, rapiData, sbsData, helmData] = await Promise.all([
    loadNikkeData(513, 'Little Mermaid'),
    loadNikkeData(330, 'Crown'),
    loadNikkeData(16,  'Rapi: Red Hood'),
    loadNikkeData(225, 'Scarlet: Black Shadow'),
    loadNikkeData(352, 'Helm'),
  ]);

  // ── Verify LM SK2 bubble constant ──────────────────────────────────────────
  const lSk1 = lmData.skill1_detail;
  const lSk2 = lmData.skill2_detail;
  const lBsk = lmData.ulti_skill_detail;
  const cdnBubble = getSkillValue(lSk2, 0, 10) / 100;
  if (Math.abs(cdnBubble - LM_SK2_BUBBLE_DEBUFF_PCT) > 0.0001)
    print(`  ⚠ LM SK2 bubble mismatch: CDN=${cdnBubble} constant=${LM_SK2_BUBBLE_DEBUFF_PCT}`);

  // ── Helper: populate weaponData + coreDmgIncrement + stats for a unit ──────
  function setupUnit(teamEntry, nikkeData, cubeData, favItemData = null) {
    const sd = nikkeData.shot_detail;
    teamEntry.weaponData.hitMult       = sd.damage / 10000;
    teamEntry.weaponData.maxAmmo       = sd.max_ammo;
    teamEntry.weaponData.reloadTimeSec = sd.reload_time / 100;
    teamEntry.weaponData.burstEnergy          = sd.target_burst_energy_pershot;
    teamEntry.weaponData.fullChargeBurstEnergy = sd.full_charge_burst_energy ?? 0;
    // MG ramp fields
    if (sd.weapon_type === 'MG') {
      teamEntry.weaponData.rateOfFire            = sd.rate_of_fire;
      teamEntry.weaponData.endRateOfFire         = sd.end_rate_of_fire;
      teamEntry.weaponData.rateOfFireChangePerShot = sd.rate_of_fire_change_pershot;
    } else {
      // Non-MG: convert rate_of_fire (RPM) to per-tick probability
      teamEntry.weaponData.rateOfFireProb = sd.rate_of_fire / 3600;
    }
    // Full charge damage & charge time (SR / RL)
    // charge_time is in centiseconds (same unit as reload_time ÷100 = seconds), convert to ticks.
    teamEntry.weaponData.fullChargeDamage = sd.full_charge_damage ?? 10000;
    teamEntry.weaponData.chargeTimeTicks  = Math.round((sd.charge_time ?? 0) / 100 * TICK_RATE);
    // Core damage increment: CDN core_damage_rate is ×10000; e.g. 25000 = 250% = base(200%) + 50%
    teamEntry.coreDmgIncrement = (sd.core_damage_rate ?? 20000) / 10000 - 2.0;
    teamEntry._favSkills = { chargeDmgPct: 0, normalAtkDmgPct: 0, maxAmmoPct: 0, coreDmgBonusPct: 0 };
    const stats = computeNikkeStats(nikkeData, cubeData, favItemData, teamEntry);
    teamEntry.atk = stats.atk;
    teamEntry.hp  = stats.hp;
    teamEntry.def = stats.def;
    teamEntry.equipOptions = { atkFlat: 0, defFlat: 0, bonusAmmo: 0 };
  }

  setupUnit(TEAM[0], lmData,   CUBE_DATA.Resilience);
  setupUnit(TEAM[1], crownData, CUBE_DATA.Bastion);
  setupUnit(TEAM[2], rapiData,  CUBE_DATA.Resilience);
  setupUnit(TEAM[3], sbsData,   CUBE_DATA.Adjutant);
  setupUnit(TEAM[4], helmData,  CUBE_DATA.Adjutant);

  // LM SK1 "Bubble Order" — CDN level-10 values from skill1_detail
  const lmSkill1 = {
    name:              'Bubble Order',
    burstCdReductionS: getSkillValue(lSk1, 0, 10),        // on FB end: burst CD ▼ 7.48 s
    atkDmgPct:         getSkillValue(lSk1, 1, 10) / 100,  // on FB start: Attack Damage ▲ 4.0%
    atkDmgDurationS:   getSkillValue(lSk1, 2, 10),        // 10 s
    ammoThreshold:     getSkillValue(lSk1, 3, 10),        // every 400 total ammo → gauge fill
    gaugeRefillPct:    getSkillValue(lSk1, 4, 10) / 100,  // 37.00%
  };
  // LM burst "Siren's Song" — CDN level-10 values from ulti_skill_detail
  const lmBurst = {
    name:            'Siren\'s Song',
    atkDmgPct:       getSkillValue(lBsk, 0, 10) / 100,  // Attack Damage ▲ 10.13% all allies
    atkDmgDurationS: getSkillValue(lBsk, 1, 10),         // 10 s
    reloadPct:       getSkillValue(lBsk, 2, 10) / 100,  // reload 33.26% magazine all allies
    selfAtkPct:      getSkillValue(lBsk, 3, 10) / 100,  // self ATK ▲ 17.28%
    selfAtkDurationS: getSkillValue(lBsk, 4, 10),        // 10 s
  };
  // Crown burst "Last Kingdom" — CDN level-10 values
  const crownBsk = crownData.ulti_skill_detail;
  const crownBurst = {
    name:           'Last Kingdom',
    atkDmgPct:      getSkillValue(crownBsk, 0, 10) / 100,  // Attack Damage ▲ 36.24% all allies
    atkDmgDurationS: getSkillValue(crownBsk, 1, 10),        // 15 s
    shieldPct:      getSkillValue(crownBsk, 2, 10) / 100,  // Shield = 10.45% Crown max HP
    shieldDurationS: getSkillValue(crownBsk, 3, 10),        // 15 s
  };
  // Crown skills — stub (0 values): Crown SK1/SK2 not yet modelled
  const crownSkillsStub = {
    sk1: { name: '', atkPctOfCrownAtk: 0, durationS: 0, reloadSpeedA: 0, reloadSpeedB: 0 },
    sk2: { name: '', shotsPerStack: Number.MAX_SAFE_INTEGER, maxStacks: Number.MAX_SAFE_INTEGER, atkDmgPct: 0, atkDmgDurationS: 0 },
  };
  const { units, state } = runBattle(lmSkill1, lmBurst, crownBurst, crownSkillsStub);

  print('\n══════════════════════════════════════════════════════════════════');
  print('  NIKKE Battle Simulation — LM · Crown · Rapi:RH · SBS · Helm · 3 min · 60 fps · Synchro Lv 592');
  print('══════════════════════════════════════════════════════════════════');
  print(`  LM SK2 "Bubble Wave":`);
  print(`    Battle start : enemy Damage Taken ▲ ${(LM_SK2_BUBBLE_DEBUFF_PCT * 100).toFixed(2)}% (permanent)`);
  print(`    Barrage      : every ${LM_SK2_BARRAGE_THRESHOLD} team shots → ${LM_SK2_BARRAGE_HIT_COUNT} hits × ${(LM_SK2_BARRAGE_HIT_MULT * 100).toFixed(2)}% ATK`);
  print(`    FB periodic  : every ${LM_SK2_FB_PERIOD_S}s during Full Burst → ${LM_SK2_FB_HIT_COUNT} hits × ${(LM_SK2_FB_HIT_MULT * 100).toFixed(2)}% ATK`);
  print();

  const totalDmg = units.reduce((s, u) => s + u.totalDamage, 0);
  const squadDps = totalDmg / SIM_SECONDS;
  const W = 26;

  print('  Team   : ' + units.map(u => u.name).join(' · '));
  const phaseStr = DISTANCE_PHASES.map(p => `${p.zone} ${p.durationS}s`).join(' → ');
  print('  Enemy  : DEF ' + fmtN(ENEMY.def) + '  Element ' + ENEMY.element +
        '  Core ' + ENEMY.hasCore + '  Distance phases: ' + phaseStr);
  print();

  // Unit property table
  print('── Unit Properties ──────────────────────────────────────────────────');
  const PW = 26, NW = 9;
  print(
    'NIKKE'.padEnd(PW) +
    'Weapon'.padStart(7) + 'Element'.padStart(10) +
    'Base HP'.padStart(NW+4) + 'Base ATK'.padStart(NW+1) + 'Base DEF'.padStart(NW+1) +
    'Grade'.padStart(7) + 'Core'.padStart(6) + '  Cube'
  );
  print('─'.repeat(PW + 7 + 10 + NW+4 + NW+1 + NW+1 + 7 + 6 + 18));
  for (const u of TEAM) {
    const cubeLabel = CUBES[u.cube]?.label ?? '—';
    print(
      u.name.padEnd(PW) +
      u.weaponType.padStart(7) +
      u.element.padStart(10) +
      fmtN(u.hp).padStart(NW+4) +
      fmtN(u.atk).padStart(NW+1) +
      fmtN(u.def).padStart(NW+1) +
      String(u.grade).padStart(7) +
      String(u.core).padStart(6) +
      '  ' + cubeLabel
    );
  }
  print();

  // Damage table
  print('── Damage Dealt (' + SIM_SECONDS + ' s) ─────────────────────────────────────────');
  print(
    'NIKKE'.padEnd(W) + 'Total Dmg'.padStart(13) + 'DPS'.padStart(12) +
    'FB Dmg'.padStart(12) + 'Skill Dmg'.padStart(12) + 'Share'.padStart(7) + 'Crit%'.padStart(7) + 'Bursts'.padStart(8)
  );
  print('─'.repeat(W + 13 + 12 + 12 + 12 + 7 + 7 + 8));

  for (const u of units) {
    const share   = totalDmg > 0 ? (u.totalDamage / totalDmg * 100).toFixed(1) : '0.0';
    const crit    = u.hitCount > 0 ? (u.critCount / u.hitCount * 100).toFixed(1) : '0.0';
    const dps     = fmtN(u.totalDamage / SIM_SECONDS);
    const burstLbl = u.burstStep === 'Free' ? `${u.burstUses} (Free)` : String(u.burstUses);
    print(
      u.name.padEnd(W) +
      fmtN(u.totalDamage).padStart(13) +
      dps.padStart(12) +
      fmtN(u.fbDamage).padStart(12) +
      fmtN(u.skillDamage).padStart(12) +
      `${share}%`.padStart(7) +
      `${crit}%`.padStart(7) +
      burstLbl.padStart(8)
    );
  }
  print('─'.repeat(W + 13 + 12 + 12 + 12 + 7 + 7 + 8));
  print(
    'TOTAL'.padEnd(W) +
    fmtN(totalDmg).padStart(13) +
    fmtN(squadDps).padStart(12)
  );

  // ── Little Mermaid detail stats ─────────────────────────────────────────────
  {
    const lm   = units.find(u => u.id === 1);
    const lmDef = TEAM.find(t => t.id === 1);
    if (lm) {
      const pct = v => (v * 100).toFixed(2) + '%';
      const cube  = CUBES[lm.cube] ?? {};
      const bubble = 1 + state.enemyDamageTakenMult;
      print();
      print('── Little Mermaid Detail Stats ──────────────────────────────────────');
      print(`  ATK (base stat)  : ${fmtN(lm.atk)}`);
      print(`  Crit Rate        : ${pct(lm.critRate)}  (base 15%)`);
      {
        const ELEMENT_BEATS = { Fire:'Wind', Wind:'Iron', Iron:'Electric', Electric:'Water', Water:'Fire' };
        const hasAdv = ELEMENT_BEATS[lm.element] === ENEMY.element;
        const cube   = CUBES[lm.cube] ?? {};
        const elemM  = hasAdv ? 1 + 0.10 + (cube.elementAdvantageDmgIncrement ?? 0) + (lm._equipOpts?.elementDmgPct ?? 0) : 1.0;
        const advStr = hasAdv ? `ADVANTAGE (elemMult ×${elemM.toFixed(4)})` : `no advantage (elemMult ×1.0000)`;
        print(`  Element          : ${lm.element} vs enemy ${ENEMY.element} → ${advStr}`);
      }
      print(`  Ammo             : ${lm._maxAmmo}  |  hitMult: ${pct(lmDef.weaponData?.hitMult ?? 0)}`);
      print(`  Reload (base)    : ${lmDef.weaponData?.reloadTimeSec}s / (1 + ${pct(cube.reloadSpeedPct ?? 0)}) = ${((lmDef.weaponData?.reloadTimeSec ?? 1.5) / (1 + (cube.reloadSpeedPct ?? 0))).toFixed(3)}s`);
      print(`  Bubble debuff    : enemy Damage Taken ▲ ${pct(LM_SK2_BUBBLE_DEBUFF_PCT)}  → bubble ×${bubble.toFixed(4)}`);
      print(`  Barrage          : every ${LM_SK2_BARRAGE_THRESHOLD} shots — ${LM_SK2_BARRAGE_HIT_COUNT} hits × ${pct(LM_SK2_BARRAGE_HIT_MULT)} ATK`);
      print(`  Burst uses (B1)  : ${lm.burstUses}  (Siren's Song fires; Crown advances chain to step 2)`);
      print();
      print(`  ── Damage by Type (actual sim totals, 180s) ──────────────────────`);
      const dmgSkill = lm.skillDamage;
      const dmgTotal = lm.totalDamage;
      const dmgShots = dmgTotal - dmgSkill;
      print(`  Barrage (SK2)  : ${fmtN(dmgSkill).padStart(8)}  (${(dmgSkill/dmgTotal*100).toFixed(1)}%)`);
      print(`  Normal shots   : ${fmtN(dmgShots).padStart(8)}  (${(dmgShots/dmgTotal*100).toFixed(1)}%)`);
      print(`  ────────────────────────────`);
      print(`  Total          : ${fmtN(dmgTotal).padStart(8)}`);
    }
  }

  // Burst rotation summary
  print();
  print('── Burst Rotation ───────────────────────────────────────────────────');
  print(`  Full Burst activations : ${state.burstCycles.length}`);
  print(`  Total team shots       : ${state.totalTeamShots}`);
  print();
  if (state.burstCycles.length) {
    print(`  Burst cycles: ${state.burstCycles.map(c => fmtT(c.tick) + ' [' + c.b3 + ']').join('  ')}`);
  }

  print('── Battle Log ───────────────────────────────────────────────────────');
  state.log.forEach(l => print('  ' + l));
  print();
  print('══════════════════════════════════════════════════════════════════\n');
  flushToBrowser();
}

main().catch(err => { console.error(err); process.exit(1); });
