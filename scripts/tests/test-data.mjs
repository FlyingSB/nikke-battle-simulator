/**
 * Data pipeline regression tests — all game data domains except skills.
 *
 * Covers (using local scripts/cache/ files, no live network):
 *   Attractive bond     — spot-check lv10 and lv40 per class
 *   Equipment           — T10 count, stat parsing per class/slot
 *   Recycle Room        — row count, per-row stat values
 *   Harmony Cubes       — normalization, lv10 stats for all 3 cubes
 *   Nikke base stats    — lv200 atk/hp/def for all 6 cached nikkes
 *   Nikke shot_detail   — weapon-type-specific CDN fields
 *   Favorite items      — lv10 and lv15 atk/hp/def spot-checks
 *   Research bonus      — computeResearchBonus() for a known config
 *   Full stats pipeline — computeFinalStats() for Rapi:RH at known config
 *   equipOptions        — non-zero atkFlat/critRatePct/critDmgPct/elementDmgPct
 *
 * Run: node scripts/test-data.mjs
 * Requires: scripts/cache/ to be populated (run any test-battle.mjs first).
 */

import { readFileSync }                            from 'fs';
import { dirname, join }                           from 'path';
import { fileURLToPath }                           from 'url';
import { setData }                                 from '../../src/data/loader.js';
import {
  getBondBonus,
  getAllEquipment,
  getT10Equipment,
  normalizeCube,
  getAllResearchRows,
  computeResearchBonus,
  getBaseStats,
} from '../../src/data/models.js';
import { computeFinalStats }                        from '../../src/engine/stats.js';
import { eq, near, pct, section, summary }          from '../lib/test-harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE     = join(__dirname, '../cache');

// ── Preflight: verify cache is populated ──────────────────────────────────────
{
  const SENTINEL = join(CACHE, 'static_attractive.json');
  try { readFileSync(SENTINEL); }
  catch {
    console.error('ERROR: scripts/cache/ is empty or missing.');
    console.error('Run `node scripts/test-battle.mjs` first to populate the cache.');
    process.exit(1);
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function readCache(file) {
  return JSON.parse(readFileSync(join(CACHE, file), 'utf8')).data;
}

// ── Load all static tables ────────────────────────────────────────────────────

const attractive  = readCache('static_attractive.json');
const equipment   = readCache('static_equipment.json');
const recycleRoom = readCache('static_recycleRoom.json');
setData('attractive',  attractive);
setData('equipment',   equipment);
setData('recycleRoom', recycleRoom);

// ── T1: Attractive (Bond) ─────────────────────────────────────────────────────

section('T1: Attractive bond — getBondBonus()');
{
  // Level 1 — all zeros
  const b1 = getBondBonus('Attacker', 1);
  eq('lv1 Attacker atk=0', b1.atk, 0);
  eq('lv1 Attacker hp=0',  b1.hp,  0);
  eq('lv1 Attacker def=0', b1.def, 0);
}
{
  // Level 10 (CDN values from static_attractive.json)
  const b10a = getBondBonus('Attacker', 10);
  eq('lv10 Attacker atk', b10a.atk, 403);
  eq('lv10 Attacker hp',  b10a.hp,  9_062);
  eq('lv10 Attacker def', b10a.def, 60);

  const b10d = getBondBonus('Defender', 10);
  eq('lv10 Defender atk', b10d.atk, 269);
  eq('lv10 Defender hp',  b10d.hp,  11_076);
  eq('lv10 Defender def', b10d.def, 74);

  const b10s = getBondBonus('Supporter', 10);
  eq('lv10 Supporter atk', b10s.atk, 336);
  eq('lv10 Supporter hp',  b10s.hp,  10_069);
  eq('lv10 Supporter def', b10s.def, 67);
}
{
  // Level 40 (max) — spot check
  const b40a = getBondBonus('Attacker', 40);
  eq('lv40 Attacker atk', b40a.atk, 2_340);
  eq('lv40 Attacker hp',  b40a.hp,  52_650);
  eq('lv40 Attacker def', b40a.def, 351);

  const b40d = getBondBonus('Defender', 40);
  eq('lv40 Defender atk', b40d.atk, 1_560);
  eq('lv40 Defender hp',  b40d.hp,  64_350);
  eq('lv40 Defender def', b40d.def, 429);

  const b40s = getBondBonus('Supporter', 40);
  eq('lv40 Supporter atk', b40s.atk, 1_950);
  eq('lv40 Supporter hp',  b40s.hp,  58_500);
  eq('lv40 Supporter def', b40s.def, 390);
}
{
  // Table has exactly 40 rows
  eq('attractive table row count', attractive.length, 40);
}

// ── T2: Equipment ─────────────────────────────────────────────────────────────

section('T2: Equipment — T10 stats');
{
  const t10 = getAllEquipment().filter(e => e.tier === 'T10');
  // 3 classes × 4 slots = 12 T10 entries
  eq('T10 entry count', t10.length, 12);
}
{
  // T10 Attacker Module_A (head): atk=6014, hp=49181, def=0
  const e = getT10Equipment('Attacker', 'Module_A');
  eq('T10 Att Module_A atk', e.atk, 6_014);
  eq('T10 Att Module_A hp',  e.hp,  49_181);
  eq('T10 Att Module_A def', e.def, 0);
  eq('T10 Att Module_A hasOptions', e.hasOptions, true);
}
{
  // T10 Defender Module_B (torso): atk=729, hp=195360, def=0
  const e = getT10Equipment('Defender', 'Module_B');
  eq('T10 Def Module_B atk', e.atk, 729);
  eq('T10 Def Module_B hp',  e.hp,  195_360);
  eq('T10 Def Module_B def', e.def, 0);
}
{
  // T10 Supporter Module_C (arms): atk=3189, hp=0, def=727
  const e = getT10Equipment('Supporter', 'Module_C');
  eq('T10 Sup Module_C atk', e.atk, 3_189);
  eq('T10 Sup Module_C hp',  e.hp,  0);
  eq('T10 Sup Module_C def', e.def, 727);
}
{
  // T10 Attacker Module_D (legs): atk=0, hp=36887, def=981
  const e = getT10Equipment('Attacker', 'Module_D');
  eq('T10 Att Module_D atk', e.atk, 0);
  eq('T10 Att Module_D hp',  e.hp,  36_887);
  eq('T10 Att Module_D def', e.def, 981);
}
{
  // T10 Defender Module_A: atk=4010, hp=60111, def=0
  const e = getT10Equipment('Defender', 'Module_A');
  eq('T10 Def Module_A atk', e.atk, 4_010);
  eq('T10 Def Module_A hp',  e.hp,  60_111);
}
{
  // T10 Supporter Module_B: atk=911, hp=177600, def=0
  const e = getT10Equipment('Supporter', 'Module_B');
  eq('T10 Sup Module_B atk', e.atk, 911);
  eq('T10 Sup Module_B hp',  e.hp,  177_600);
}
{
  // T10 Attacker Module_C (arms): atk=3827, hp=0, def=654
  const e = getT10Equipment('Attacker', 'Module_C');
  eq('T10 Att Module_C atk', e.atk, 3_827);
  eq('T10 Att Module_C def', e.def, 654);
}
{
  // Level multiplier: lv0 = base, lv5 = base × 1.5 (rounded)
  const e    = getT10Equipment('Attacker', 'Module_A');
  const base = e.atk; // 6014
  near('T10 lv5 atk = round(6014 × 1.5)', Math.round(base * 1.5), 9_021, 0);
}

// ── T3: Recycle Room (Research) ───────────────────────────────────────────────

section('T3: Recycle Room — getAllResearchRows()');
{
  const rows = getAllResearchRows();
  eq('recycleRoom row count', rows.length, 9);

  const personal = rows.find(r => r.type === 'Personal');
  eq('Personal hpPerLv',  personal.hpPerLv,  450);
  eq('Personal atkPerLv', personal.atkPerLv, 0);
  eq('Personal defPerLv', personal.defPerLv, 0);

  const attClass = rows.find(r => r.type === 'Class' && r.subtype === 'Attacker');
  eq('Attacker hpPerLv',  attClass.hpPerLv,  750);
  eq('Attacker atkPerLv', attClass.atkPerLv, 0);
  eq('Attacker defPerLv', attClass.defPerLv, 5);

  const defClass = rows.find(r => r.type === 'Class' && r.subtype === 'Defender');
  eq('Defender hpPerLv', defClass.hpPerLv, 750);

  const supClass = rows.find(r => r.type === 'Class' && r.subtype === 'Supporter');
  eq('Supporter hpPerLv', supClass.hpPerLv, 750);

  const elysion = rows.find(r => r.type === 'Corporation' && r.subtype === 'ELYSION');
  eq('ELYSION atkPerLv', elysion.atkPerLv, 25);
  eq('ELYSION hpPerLv',  elysion.hpPerLv,  0);
  eq('ELYSION defPerLv', elysion.defPerLv, 5);

  // All 5 corporations present with same rates
  for (const corp of ['ELYSION', 'MISSILIS', 'TETRA', 'PILGRIM', 'ABNORMAL']) {
    const row = rows.find(r => r.type === 'Corporation' && r.subtype === corp);
    eq(`${corp} atkPerLv=25`, row?.atkPerLv, 25);
    eq(`${corp} defPerLv=5`,  row?.defPerLv, 5);
  }
}
{
  // computeResearchBonus for Attacker/ELYSION at gen=10, attacker=5, ELYSION=3
  // Personal (hp=450): 10×450 = 4500
  // Class Attacker (hp=750, def=5): 5×750 = 3750 hp, 5×5 = 25 def
  // Corp ELYSION (atk=25, def=5): 3×25 = 75 atk, 3×5 = 15 def
  // Total: atk=75, hp=8250, def=40
  const res = computeResearchBonus('Attacker', 'ELYSION', {
    general:  10, attacker: 5, defender: 0, supporter: 0,
    ELYSION:  3,  MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0,
  });
  eq('research atk', res.atk, 75);
  eq('research hp',  res.hp,  8_250);
  eq('research def', res.def, 40);
}

// ── T4: Harmony Cubes ────────────────────────────────────────────────────────

section('T4: Harmony Cubes — normalizeCube()');
{
  // Resilience Cube (10003) — lv10 = index 9
  const raw   = readCache('cube_10003.json');
  const cube  = normalizeCube(raw);
  eq('Resilience lv10 atk (idx 9)', cube.atk[9], 1_380);
  eq('Resilience lv10 hp  (idx 9)', cube.hp[9],  41_500);
  eq('Resilience lv10 def (idx 9)', cube.def[9], 274);
  eq('Resilience lv15 atk (idx 14)', cube.atk[14], 2_780);
  eq('Resilience atk array length', cube.atk.length, 15);
}
{
  // Bastion Cube (10004) — lv10 = index 9
  const raw  = readCache('cube_10004.json');
  const cube = normalizeCube(raw);
  eq('Bastion lv10 atk (idx 9)', cube.atk[9], 1_380);
  eq('Bastion lv10 hp  (idx 9)', cube.hp[9],  41_500);
  eq('Bastion lv10 def (idx 9)', cube.def[9], 274);
  eq('Bastion arrays equal length', cube.atk.length === cube.hp.length && cube.hp.length === cube.def.length, true);
}
{
  // Adjutant Cube (10005) — lv10 = index 9
  const raw  = readCache('cube_10005.json');
  const cube = normalizeCube(raw);
  eq('Adjutant lv10 atk (idx 9)', cube.atk[9], 1_380);
  eq('Adjutant lv10 hp  (idx 9)', cube.hp[9],  41_500);
  eq('Adjutant lv10 def (idx 9)', cube.def[9], 274);
  eq('Adjutant arrays equal length', cube.atk.length === cube.hp.length && cube.hp.length === cube.def.length, true);
}

// Spot-check all 3 cube IDs are present in cache
for (const [label, file] of [['Resilience','cube_10003.json'], ['Bastion','cube_10004.json'], ['Adjutant','cube_10005.json']]) {
  const cube = normalizeCube(readCache(file));
  eq(`${label} id defined`, typeof cube.id, 'number');
  eq(`${label} atk non-empty`, cube.atk.length > 0, true);
}

// ── T5: Nikke base stats ──────────────────────────────────────────────────────

section('T5: Nikke base stats at lv200 (from CDN stat arrays)');
const NIKKE_CASES = [
  // [file, name, resourceId, weapon, lv200_atk, lv200_hp, lv200_def]
  ['nikke_16.json',  'Rapi: Red Hood',        16,  'MG',  21_091, 474_573, 2_646],
  ['nikke_225.json', 'Scarlet: Black Shadow', 225, 'RL',  21_091, 474_573, 3_086],
  ['nikke_330.json', 'Crown',                 330, 'MG',  14_061, 580_033, 3_234],
  ['nikke_352.json', 'Helm',                  352, 'SR',  21_091, 474_573, 2_657],
  ['nikke_513.json', 'Little Mermaid',        513, 'SMG', 17_576, 527_303, 3_027],
  ['nikke_583.json', 'Arcana: Fortune Mate',  583, 'SG',  21_091, 474_573, 3_037],
];
for (const [file, name, id, weapon, expAtk, expHp, expDef] of NIKKE_CASES) {
  const raw = readCache(file);
  eq(`${name} resource_id`, raw.resource_id, id);
  eq(`${name} weapon_type`, raw.shot_detail?.weapon_type, weapon);
  if (expAtk !== null) {
    const stats = getBaseStats(raw, 200);
    eq(`${name} lv200 atk`, stats.atk, expAtk);
    eq(`${name} lv200 hp`,  stats.hp,  expHp);
    eq(`${name} lv200 def`, stats.def, expDef);
  }
}

// ── T6: Nikke shot_detail fields ──────────────────────────────────────────────

section('T6: Nikke shot_detail — CDN field values');
{
  const sd = readCache('nikke_16.json').shot_detail;  // Rapi:RH MG
  eq('Rapi:RH damage',               sd.damage,                   557);
  eq('Rapi:RH max_ammo',             sd.max_ammo,                 300);
  eq('Rapi:RH rate_of_fire',         sd.rate_of_fire,             60);
  eq('Rapi:RH end_rate_of_fire',     sd.end_rate_of_fire,         4_200);
  eq('Rapi:RH rate_of_fire_change',  sd.rate_of_fire_change_pershot, 100);
  eq('Rapi:RH reload_time',          sd.reload_time,              250);
  eq('Rapi:RH burst_energy_pershot', sd.target_burst_energy_pershot, 1_000);
}
{
  const sd = readCache('nikke_225.json').shot_detail;  // SBS RL
  eq('SBS damage',                   sd.damage,                   5_729);
  eq('SBS full_charge_damage',       sd.full_charge_damage,       15_000);
  eq('SBS charge_time',              sd.charge_time,              30);
  eq('SBS max_ammo',                 sd.max_ammo,                 9);
  eq('SBS burst_energy_pershot',     sd.target_burst_energy_pershot, 25_000);
  eq('SBS full_charge_burst_energy', sd.full_charge_burst_energy, 15_000);
}
{
  const sd = readCache('nikke_352.json').shot_detail;  // Helm SR
  eq('Helm damage',                   sd.damage,                   6_904);
  eq('Helm full_charge_damage',       sd.full_charge_damage,       25_000);
  eq('Helm charge_time',              sd.charge_time,              100);
  eq('Helm max_ammo',                 sd.max_ammo,                 6);
  eq('Helm burst_energy_pershot',     sd.target_burst_energy_pershot, 56_000);
  eq('Helm full_charge_burst_energy', sd.full_charge_burst_energy, 25_000);
}
{
  const sd = readCache('nikke_513.json').shot_detail;  // Little Mermaid SMG
  eq('LM damage',               sd.damage,                   1_012);
  eq('LM max_ammo',             sd.max_ammo,                 120);
  eq('LM rate_of_fire',         sd.rate_of_fire,             1_440);
  eq('LM reload_time',          sd.reload_time,              100);
  eq('LM burst_energy_pershot', sd.target_burst_energy_pershot, 2_000);
}
{
  const sd = readCache('nikke_330.json').shot_detail;  // Crown MG
  eq('Crown damage',                sd.damage,                   557);
  eq('Crown max_ammo',              sd.max_ammo,                 300);
  eq('Crown rate_of_fire',          sd.rate_of_fire,             60);
  eq('Crown end_rate_of_fire',      sd.end_rate_of_fire,         4_200);
  eq('Crown rate_of_fire_change',   sd.rate_of_fire_change_pershot, 100);
  eq('Crown burst_energy_pershot',  sd.target_burst_energy_pershot, 1_000);
}
{
  const sd = readCache('nikke_583.json').shot_detail;  // Arcana SG
  eq('Arcana damage',              sd.damage,                   22_280);
  eq('Arcana max_ammo',            sd.max_ammo,                 9);
  eq('Arcana rate_of_fire',        sd.rate_of_fire,             90);
  eq('Arcana reload_time',         sd.reload_time,              233);
  eq('Arcana burst_energy_pershot',sd.target_burst_energy_pershot, 4_000);
}

// ── T7: Favorite items ────────────────────────────────────────────────────────

section('T7: Favorite items — bonus arrays');
{
  // fav_100101 — spot-check lv10 (index 10) and lv15 (index 15)
  const fav = readCache('fav_100101.json');
  eq('fav_100101 lv10 atk', fav.atk[10], 2_943);
  eq('fav_100101 lv10 hp',  fav.hp[10],  91_350);
  eq('fav_100101 lv10 def', fav.def[10], 620);
  eq('fav_100101 lv15 atk', fav.atk[15], 4_736);
  eq('fav_100101 lv15 hp',  fav.hp[15],  147_250);
  eq('fav_100101 lv15 def', fav.def[15], 1_002);
  // Array length covers levels 0–15 → 16 entries
  eq('fav_100101 atk array length', fav.atk.length, 16);
}
{
  // fav_100102 (second variant) — structural tests
  const fav = readCache('fav_100102.json');
  eq('fav_100102 arrays present', !!(fav.atk && fav.hp && fav.def), true);
  eq('fav_100102 array length', fav.atk.length, 16);
}
{
  // All cached fav items (100101..100602 = 12 files) must have consistent array lengths
  const FAV_IDS = [100101,100102,100201,100202,100301,100302,100401,100402,100501,100502,100601,100602];
  for (const id of FAV_IDS) {
    const fav = readCache(`fav_${id}.json`);
    const ok  = fav.atk?.length === 16 && fav.hp?.length === 16 && fav.def?.length === 16;
    eq(`fav_${id} all arrays length=16`, ok, true);
  }
}

// ── T8: Full computeFinalStats pipeline ───────────────────────────────────────

section('T8: computeFinalStats — Rapi:RH reference case');
// Reference (from in-game screenshot, same as test-stats.mjs):
//   Level 592, Grade 3, Core 3, Bond 40
//   All T10 Level-5, Fav 100602 Lv.15, Resilience Cube Lv.15
//   Research: General=270, Attacker=218, ELYSION=206
//   Expected: HP=7070844, ATK=301286, DEF=41180  (±0.5%)
{
  const nikkeData  = readCache('nikke_16.json');
  const cubeData   = readCache('cube_10003.json');     // Resilience
  const favData    = readCache('fav_100602.json');

  const slot = {
    _nikkeData:  nikkeData,
    _cubeData:   cubeData,
    _favItemData: favData,
    classType:   'Attacker',
    corporation: 'ELYSION',
    grade:       3,
    core:        3,
    bondLevel:   40,
    cube:        { level: 15 },
    favoriteItem:{ level: 15 },
    equipment:   {
      head:  { tier: 'T10', classReq: 'Attacker', level: 5 },
      torso: { tier: 'T10', classReq: 'Attacker', level: 5 },
      arms:  { tier: 'T10', classReq: 'Attacker', level: 5 },
      legs:  { tier: 'T10', classReq: 'Attacker', level: 5 },
    },
    equipOptions: {},
  };

  const research = {
    general: 270, attacker: 218, defender: 0, supporter: 0,
    ELYSION: 206, MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0,
  };

  const stats = computeFinalStats(slot, 592, research);
  pct('Rapi:RH ATK', stats.atk, 301_286, 0.005);
  pct('Rapi:RH HP',  stats.hp,  7_070_844, 0.005);
  pct('Rapi:RH DEF', stats.def, 41_180, 0.005);
}

// ── T9: computeFinalStats — zero config (grade/bond/equip all 0) ──────────────

section('T9: computeFinalStats — zero config (no LB, no bond, no equip)');
{
  const nikkeData = readCache('nikke_513.json');  // Little Mermaid
  const slot = {
    _nikkeData:   nikkeData,
    _cubeData:    null,
    _favItemData: null,
    classType:    'Supporter',
    corporation:  'ELYSION',
    grade:        0,
    core:         0,
    bondLevel:    0,
    cube:         { level: 0 },
    favoriteItem: { level: 0 },
    equipment:    {},
    equipOptions: {},
  };
  const stats = computeFinalStats(slot, 200, {
    general: 0, attacker: 0, defender: 0, supporter: 0,
    ELYSION: 0, MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0,
  });
  // Only base stats at lv200 (grade 0 = no multiplier beyond ×1.0 + 0):
  // LM lv200: atk=17576, hp=527303, def=3027
  // grade=0: base × (1 + 0) + 0 = base
  near('LM lv200 zero config atk', stats.atk, 17_576, 1);
  near('LM lv200 zero config hp',  stats.hp,  527_303, 1);
  near('LM lv200 zero config def', stats.def, 3_027, 1);
}

// ── T10: computeFinalStats — equipOptions non-zero ────────────────────────────

section('T10: computeFinalStats — equipOptions non-zero (atkFlat, critRate, critDmg, elementDmg)');
{
  // Same zero-config base as T9 (LM lv200, grade=0, no equip/bond/research),
  // but with non-zero equipOptions to verify each field is applied.
  const nikkeData = readCache('nikke_513.json');  // LM lv200 base atk=17576
  const slot = {
    _nikkeData:   nikkeData,
    _cubeData:    null,
    _favItemData: null,
    classType:    'Supporter',
    corporation:  'ELYSION',
    grade:        0,
    core:         0,
    bondLevel:    0,
    cube:         { level: 0 },
    favoriteItem: { level: 0 },
    equipment:    {},
    equipOptions: {
      atkFlat:       5_000,
      defFlat:       200,
      critRatePct:   0.10,
      critDmgPct:    0.25,
      elementDmgPct: 0.05,
      chargeSpeedPct: 0.15,
      bonusAmmo:     10,
    },
  };
  const stats = computeFinalStats(slot, 200, {
    general: 0, attacker: 0, defender: 0, supporter: 0,
    ELYSION: 0, MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0,
  });
  // atk = base(17576) + atkFlat(5000) = 22576
  near('atk + atkFlat',       stats.atk, 22_576, 1);
  // def = base(3027) + defFlat(200) = 3227
  near('def + defFlat',       stats.def, 3_227, 1);
  // critRate = 0.15 + 0.10 = 0.25
  near('critRate', stats.critRate, 0.25, 0.0001);
  // critDmg = 0.50 + 0.25 = 0.75
  near('critDmg',  stats.critDmg,  0.75, 0.0001);
  // elementDmgPct passed through
  near('elementDmgPct', stats.elementDmgPct, 0.05, 0.0001);
  // chargeSpeedPct passed through
  near('chargeSpeedPct', stats.chargeSpeedPct, 0.15, 0.0001);
  // bonusAmmo passed through
  eq('bonusAmmo', stats.bonusAmmo, 10);
}

// ── T11: Nikke corporation field ──────────────────────────────────────────────
//
// Confirms the CDN `corporation` key for each cached nikke.
// These values matter for synchro level bonuses in computeFinalStats().
// Warning: the game UI label can differ from the CDN string (e.g. PILGRIM ≠ TETRA
// even though Little Mermaid and Crown are often grouped under TETRA in community
// references — their CDN corporation is PILGRIM).

section('T11: nikke corporation field from CDN data');
{
  const lm    = readCache('nikke_513.json');
  const crown = readCache('nikke_330.json');
  const rapi  = readCache('nikke_16.json');
  const sbs   = readCache('nikke_225.json');
  const helm  = readCache('nikke_352.json');

  eq('Little Mermaid corporation', lm.corporation,    'PILGRIM');
  eq('Crown corporation',          crown.corporation,  'PILGRIM');
  eq('Rapi:RH corporation',        rapi.corporation,   'ELYSION');
  eq('Scarlet:BS corporation',     sbs.corporation,    'PILGRIM');
  eq('Helm corporation',           helm.corporation,   'ELYSION');
}

// ── Summary ───────────────────────────────────────────────────────────────────

summary('Data tests');
