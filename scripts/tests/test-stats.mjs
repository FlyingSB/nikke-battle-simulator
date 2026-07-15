/**
 * Stat calculation test suite — verifies all 7 pipeline layers against real CDN data.
 *
 * Test case (from in-game fact):
 *   Rapi: Red Hood — Level 592, Grade 3, Core 3
 *   Equipment: all T10 Level-5
 *   Favorite Item: SR-weapon-SR (100602) Lv.15
 *   Cube: Resilience Cube (10003) Lv.15
 *   Bond Level: 40
 *   Research: General Lv.270 (= max for Lv.592), Attacker Lv.218, ELYSION Lv.206
 *   Expected: HP 7070844, ATK 301286, DEF 41180  (±1%)
 *
 * Run: node scripts/test-stats.mjs
 */

import { loadNikkeData, loadStaticData, loadCubeData, loadFavItemData } from '../lib/nikke-cache.mjs';
import { setData }                                                        from '../../src/data/loader.js';
import { computeFinalStats, applyGradeCore }                             from '../../src/engine/stats.js';
import { getBaseStats, getBondBonus, normalizeCube, computeResearchBonus,
         maxGeneralResearchLevel }                                          from '../../src/data/models.js';

// ── Tolerance ─────────────────────────────────────────────────────────────────
const TOLERANCE = 0.01; // 1%
let passed = 0, failed = 0;

function check(label, got, expected) {
  const err = Math.abs(got - expected) / Math.abs(expected);
  const ok  = err <= TOLERANCE;
  const pct = (err * 100).toFixed(3);
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}: got ${got.toLocaleString()} expected ${expected.toLocaleString()} (err ${pct}%)`);
  if (ok) passed++; else failed++;
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading CDN data…');

  // Load all static CDN tables and inject into loader._store so models.js works.
  const [attractive, recycleRoom, equipment] = await Promise.all([
    loadStaticData('attractive'),
    loadStaticData('recycleRoom'),
    loadStaticData('equipment'),
  ]);
  setData('attractive',  attractive);
  setData('recycleRoom', recycleRoom);
  setData('equipment',   equipment);

  // Load per-nikke, cube, and favorite item data.
  // Rapi: Red Hood resource_id = 16
  const RAPI_ID    = 16;
  const CUBE_RESIL = 10003; // Resilience Cube
  const FAV_SR_SR  = 100602; // Napping Commander Doll Ltd. (SR-weapon SR)

  const [rapiData, cubeData, favData] = await Promise.all([
    loadNikkeData(RAPI_ID, 'Rapi: Red Hood'),
    loadCubeData(CUBE_RESIL),
    loadFavItemData(FAV_SR_SR),
  ]);

  console.log('Data loaded.\n');

  // ── T1: Max General Research Level formula ─────────────────────────────────
  section('T1: Max General Research Level formula');
  const SL = 592;
  const maxGen = maxGeneralResearchLevel(SL);
  check('Max General Lv for SL=592', maxGen, 270);
  console.log(`  Formula: (FLOOR(${SL}/20)-2)×10 = (${Math.floor(SL/20)}-2)×10 = ${maxGen}`);

  // ── T2: Base level stats from CDN arrays ────────────────────────────────────
  section('T2: Base level stats (character_level_*_list)');
  const baseLv1   = getBaseStats(rapiData, 1);
  const baseLv592 = getBaseStats(rapiData, 592);
  console.log(`  Lv1:   ATK=${baseLv1.atk}  HP=${baseLv1.hp}  DEF=${baseLv1.def}`);
  // Attacker Lv1 class baseline: ATK≈600, HP≈13500, DEF≈76
  check('Rapi ATK Lv1 ≈ 600', baseLv1.atk, 600);
  check('Rapi HP  Lv1 ≈ 13500', baseLv1.hp,  13500);
  console.log(`  Lv592: ATK=${baseLv592.atk.toLocaleString()}  HP=${baseLv592.hp.toLocaleString()}  DEF=${baseLv592.def.toLocaleString()}`);
  // Lv592 base is ground truth from CDN — just log, no tolerance check needed
  console.log('  (Lv592 base values from CDN — used as ground truth for subsequent tests)');

  // ── T3: Grade / Core formula ────────────────────────────────────────────────
  section('T3: Grade / Core formula (grade=3, core=3, Attacker)');
  const gcATK = applyGradeCore(baseLv592.atk, 3, 3, 'Attacker');
  const gcHP  = applyGradeCore(baseLv592.hp,  3, 3, 'Attacker');
  const gcDEF = applyGradeCore(baseLv592.def, 3, 3, 'Attacker');
  console.log(`  After grade/core: ATK=${Math.round(gcATK).toLocaleString()}  HP=${Math.round(gcHP).toLocaleString()}  DEF=${Math.round(gcDEF).toLocaleString()}`);
  // Verify grade=0 leaves base unchanged
  const gc00 = applyGradeCore(baseLv592.atk, 0, 0, 'Attacker');
  check('applyGradeCore(grade=0,core=0) == base', Math.round(gc00), baseLv592.atk);
  // Verify grade=3, core=0 formula: base*1.06 + 60
  const gc30 = applyGradeCore(baseLv592.atk, 3, 0, 'Attacker');
  const gc30expected = baseLv592.atk * 1.06 + 60;
  check('grade=3 core=0 ATK formula', Math.round(gc30), Math.round(gc30expected));

  // ── T4: Bond level (Attractive) ─────────────────────────────────────────────
  section('T4: Bond level 40 (Attacker)');
  const bond40 = getBondBonus('Attacker', 40);
  console.log(`  Bond lv40 Attacker: ATK+${bond40.atk}  HP+${bond40.hp}  DEF+${bond40.def}`);
  // From CDN: attacker_attack_rate=2340, attacker_hp_rate=52650, attacker_defence_rate=351
  check('Bond lv40 ATK bonus', bond40.atk, 2340);
  check('Bond lv40 HP  bonus', bond40.hp,  52650);
  check('Bond lv40 DEF bonus', bond40.def, 351);

  // ── T5: Cube (Resilience lv15) ──────────────────────────────────────────────
  section('T5: Harmony Cube — Resilience lv15');
  const cube = normalizeCube(cubeData);
  const cubeIdx = 14; // level 15 → index 14
  console.log(`  Resilience lv15: ATK+${cube.atk[cubeIdx]}  HP+${cube.hp[cubeIdx]}  DEF+${cube.def[cubeIdx]}`);
  check('Resilience lv15 ATK', cube.atk[cubeIdx], 2780);
  check('Resilience lv15 HP',  cube.hp[cubeIdx],  83400);
  check('Resilience lv15 DEF', cube.def[cubeIdx], 552);

  // ── T6: Favorite Item (SR-weapon-SR lv15) ──────────────────────────────────
  section('T6: Favorite Item — SR-weapon-SR (100602) lv15');
  const favATK = favData.atk?.[15];
  const favHP  = favData.hp?.[15];
  const favDEF = favData.def?.[15];
  console.log(`  id=${favData.id}  name="${favData.name_localkey}"`);
  console.log(`  Lv15: ATK+${favATK}  HP+${favHP}  DEF+${favDEF}`);
  if (favATK !== undefined) {
    // Spot check: lv5 stats (grade 1 threshold)
    console.log(`  Lv5:  ATK+${favData.atk[5]}  HP+${favData.hp[5]}  DEF+${favData.def[5]}`);
    console.log(`  Lv10: ATK+${favData.atk[10]}  HP+${favData.hp[10]}  DEF+${favData.def[10]}`);
    check('FAV 100602 id', favData.id, 100602);
    // Verify lv15 > lv10 > lv5 (ascending)
    const ascending = favData.atk[5] < favData.atk[10] && favData.atk[10] < favData.atk[15];
    console.log(`  [${ascending ? 'PASS' : 'FAIL'}] ATK is ascending lv5 < lv10 < lv15`);
    if (ascending) passed++; else failed++;
  } else {
    console.log('  [FAIL] fav atk array missing');
    failed++;
  }

  // ── T7: Research ────────────────────────────────────────────────────────────
  section('T7: Research (General=270, Attacker=218, ELYSION=206)');
  const research = {
    general:   270,
    attacker:  218,
    defender:  0,
    supporter: 0,
    ELYSION:   206,
    MISSILIS:  0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0,
  };
  const res = computeResearchBonus('Attacker', 'ELYSION', research);
  console.log(`  Research bonus: ATK+${res.atk}  HP+${res.hp}  DEF+${res.def}`);
  // From CDN:
  //   Personal (General): hp=450/lv  → HP += 270*450 = 121500
  //   Class Attacker:     hp=750/lv, def=5/lv → HP += 218*750=163500, DEF += 218*5=1090
  //   Corp ELYSION:       atk=25/lv, def=5/lv → ATK += 206*25=5150, DEF += 206*5=1030
  check('Research ATK (ELYSION only)', res.atk, 206 * 25);
  check('Research HP (General+Attacker)', res.hp, 270 * 450 + 218 * 750);
  check('Research DEF (Attacker+ELYSION)', res.def, 218 * 5 + 206 * 5);

  // ── T8: Full pipeline integration test ────────────────────────────────────
  section('T8: Full pipeline — Rapi (Lv592, G3C3, T10L5, Resil15, SR-SR15, Bond40)');

  const slot = {
    resourceId:  RAPI_ID,
    classType:   'Attacker',
    corporation: 'ELYSION',
    element:     'Electric',
    weaponType:  'SR',
    grade:       3,
    core:        3,
    bondLevel:   40,
    skills:      [10, 10, 10],
    cube:        { resourceId: CUBE_RESIL, level: 15 },
    favoriteItem: { resourceId: FAV_SR_SR, level: 15, rare: 'SR' },
    equipment: {
      head:  { classReq: 'Attacker', tier: 'T10', level: 5, options: [] },
      torso: { classReq: 'Attacker', tier: 'T10', level: 5, options: [] },
      arms:  { classReq: 'Attacker', tier: 'T10', level: 5, options: [] },
      legs:  { classReq: 'Attacker', tier: 'T10', level: 5, options: [] },
    },
    _nikkeData:   rapiData,
    _cubeData:    cubeData,
    _favItemData: favData,
  };

  const stats = computeFinalStats(slot, 592, research);

  console.log(`\n  Result:   HP ${stats.hp.toLocaleString()}  ATK ${stats.atk.toLocaleString()}  DEF ${stats.def.toLocaleString()}`);
  console.log(`  Expected: HP 7,070,844  ATK 301,286  DEF 41,180`);

  check('T8 ATK', stats.atk, 301286);
  check('T8 HP',  stats.hp,  7070844);
  check('T8 DEF', stats.def, 41180);

  // Print breakdown for debugging
  const base     = getBaseStats(rapiData, 592);
  const gcA      = applyGradeCore(base.atk, 3, 3, 'Attacker');
  const gcH      = applyGradeCore(base.hp,  3, 3, 'Attacker');
  const gcD      = applyGradeCore(base.def, 3, 3, 'Attacker');
  const bond     = getBondBonus('Attacker', 40);
  const c        = normalizeCube(cubeData);
  const resBonus = computeResearchBonus('Attacker', 'ELYSION', research);

  console.log('\n  Breakdown:');
  console.log(`    Base lv592        ATK ${base.atk.toLocaleString().padStart(10)}  HP ${base.hp.toLocaleString().padStart(12)}  DEF ${base.def.toLocaleString().padStart(8)}`);
  console.log(`    After grade/core  ATK ${Math.round(gcA).toLocaleString().padStart(10)}  HP ${Math.round(gcH).toLocaleString().padStart(12)}  DEF ${Math.round(gcD).toLocaleString().padStart(8)}`);
  console.log(`    +Bond lv40        ATK ${bond.atk.toLocaleString().padStart(10)}  HP ${bond.hp.toLocaleString().padStart(12)}  DEF ${bond.def.toLocaleString().padStart(8)}`);
  console.log(`    +Cube Resil lv15  ATK ${c.atk[14].toLocaleString().padStart(10)}  HP ${c.hp[14].toLocaleString().padStart(12)}  DEF ${c.def[14].toLocaleString().padStart(8)}`);
  console.log(`    +Fav SR-SR lv15   ATK ${(favData.atk?.[15]??0).toLocaleString().padStart(10)}  HP ${(favData.hp?.[15]??0).toLocaleString().padStart(12)}  DEF ${(favData.def?.[15]??0).toLocaleString().padStart(8)}`);
  console.log(`    +Research         ATK ${resBonus.atk.toLocaleString().padStart(10)}  HP ${resBonus.hp.toLocaleString().padStart(12)}  DEF ${resBonus.def.toLocaleString().padStart(8)}`);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
