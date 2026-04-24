/**
 * Classic team simulation: Little Mermaid / Crown / Rapi:RH / Scarlet:BS / Helm
 *
 * Resource IDs (verified from CDN cache):
 *   513 — Little Mermaid        (Supporter, Wind,  SMG, Step1, PILGRIM)
 *   330 — Crown                 (Defender,  Iron,  MG, Step2, PILGRIM)
 *   16  — Rapi: Red Hood        (Attacker,  Fire,  MG, Step3, ELYSION)
 *   225 — Scarlet: Black Shadow (Attacker,  Wind,  RL, Step3, PILGRIM)
 *   352 — Helm                  (Attacker,  Water, SR, Step3, ELYSION)
 *
 * NOTE: Helm uses SSR favorite item in-game, but SSR favorites share the same
 * base ATK/HP/DEF arrays as their SR counterparts (the SSR only unlocks
 * additional collection skills). Using SR Napping Doll Ltd. (100602) Lv.15
 * as the item; base stats are accurate.
 * Rapi: Red Hood is an 'Overspec' nikke — can reach Bond Lv.40 like PILGRIMs.
 *
 * Run: node scripts/test-team-classic.mjs
 */

import { loadNikkeData, loadStaticData, loadFavItemData, loadCubeData } from '../lib/nikke-cache.mjs';
import { setData }                                         from '../../src/data/loader.js';
import { computeFinalStats, applyGradeCore, SLOT_MAP }      from '../../src/engine/stats.js';
import { getBaseStats, getBondBonus, computeResearchBonus,
         getT10Equipment, normalizeCube,
         maxGeneralResearchLevel }                         from '../../src/data/models.js';
import { simulateMonteCarlo }                              from '../../src/engine/battle.js';

// ─── Global settings ──────────────────────────────────────────────────────────

const SYNCHRO_LEVEL = 592;

const GENERAL_RESEARCH_LEVEL = maxGeneralResearchLevel(SYNCHRO_LEVEL);

const RESEARCH = {
  general:   GENERAL_RESEARCH_LEVEL,
  attacker:  218,
  defender:  218,
  supporter: 218,
  ELYSION:   206,
  MISSILIS:  206,
  TETRA:     206,
  PILGRIM:   201,
  ABNORMAL:  206,
};

// ─── Team definition ──────────────────────────────────────────────────────────
//
// equipPct fields are converted to flat values via two-pass computation:
//   atkPct / defPct → flat from percentage of total ATK/DEF (before options)
//   ammoPct         → flat from percentage of shot_detail.max_ammo

const TEAM_DEF = [
  {
    resourceId:  513,
    name:        'Little Mermaid',
    classType:   'Supporter',
    element:     'Wind',
    weaponType:  'SMG',
    burstStep:   'Step1',        // CDN: use_burst_skill="Step1"
    corporation: 'PILGRIM',
    grade: 3, core: 0,
    bondLevel: 40,       // PILGRIM cap
    cubeId: 10003,       // Resilience Cube Lv.15
    favItemId: 100502,   // Coffee Commander Doll Ltd. (SMG-SR) Lv.15
    favLevel:  15,
    equipPct: {
      elementDmgPct:  0.3871,
      atkPct:         0.0900,
      ammoPct:        1.8214,
      hitRatePct:     0.0688,
      critRatePct:    0.0528,
      defPct:         0.0900,
    },
  },
  {
    resourceId:  330,
    name:        'Crown',
    classType:   'Defender',
    element:     'Iron',
    weaponType:  'MG',
    burstStep:   'Step2',        // CDN: use_burst_skill="Step2"
    corporation: 'PILGRIM',
    grade: 3, core: 1,
    bondLevel: 40,       // PILGRIM cap
    cubeId: 10004,       // Bastion Cube Lv.15
    favItemId: 100202,   // Shopping Commander Doll Ltd. (MG-SR) Lv.15
    favLevel:  15,
    equipPct: {
      elementDmgPct:  0.1655,
      atkPct:         0.2151,
      ammoPct:        1.1321,
      chargeSpeedPct: 0.0925,
      critRatePct:    0.0571,
      critDmgPct:     0.2700,
    },
  },
  {
    resourceId:  16,
    name:        'Rapi: Red Hood',
    classType:   'Attacker',
    element:     'Fire',
    weaponType:  'MG',
    burstStep:   'Step3',        // CDN: use_burst_skill="Step3"; LM is B1 → Stage 3
    corporation: 'ELYSION',
    grade: 3, core: 3,
    bondLevel: 40,       // Overspec nikke — reaches PILGRIM cap
    cubeId: 10004,       // Bastion Cube Lv.15
    favItemId: 100202,   // Shopping Commander Doll Ltd. (MG-SR) Lv.15
    favLevel:  15,
    equipPct: {
      elementDmgPct:  0.9842,
      atkPct:         0.5289,
      ammoPct:        1.8625,
      critDmgPct:     0.0664,
    },
  },
  {
    resourceId:  225,
    name:        'Scarlet: Black Shadow',
    classType:   'Attacker',
    element:     'Wind',
    weaponType:  'RL',
    burstStep:   'Step3',        // CDN: use_burst_skill="Step3"
    corporation: 'PILGRIM',
    grade: 3, core: 0,
    bondLevel: 40,       // PILGRIM cap
    cubeId: 10003,       // Resilience Cube Lv.15
    favItemId: 100302,   // Exercising Commander Doll Ltd. (RL-SR) Lv.15
    favLevel:  15,
    equipPct: {
      elementDmgPct:  0.9281,
      atkPct:         0.5501,
      ammoPct:        1.2143,
      chargeDmgPct:   0.0970,
      critRatePct:    0.0435,
    },
  },
  {
    resourceId:  352,
    name:        'Helm',
    classType:   'Attacker',
    element:     'Water',
    weaponType:  'SR',
    burstStep:   'Step3',        // CDN: use_burst_skill="Step3"
    corporation: 'ELYSION',
    grade: 3, core: 6,
    bondLevel: 30,       // ELYSION cap
    cubeId: 10005,       // Adjutant Cube Lv.15
    favItemId: 200701,   // Antique Compass (Helm SSR unique fav item) Lv.2
    favLevel:  2,
    ssrFavSkillLevel: 10,  // SSR fav skills levelled to 10/10/10
    canBurst:  false,      // Rapi/SBS handle Step3 rotation; Helm never fires burst skill
    equipPct: {
      elementDmgPct:  0.9562,
      atkPct:         0.1659,
      ammoPct:        1.8533,
      chargeDmgPct:   0.1940,
    },
  },
];

// Enemy config
const ENEMY = {
  maxHp:    1e12,   // effectively infinite — run full 180s
  def:      102.4,
  element:  'Iron',
  type:     'Boss',
  hasCore:  true,
  distance: 'NEAR',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Two-pass stat computation for equipment option percentages.
 *
 * atkPct — Equipment "ATK ▲X%" option. Applied as a multiplier in stats.js on top of
 *           all flat additions (base + equipment + cube + research + etc.).
 *           Passed directly; no flat conversion needed.
 *
 * defPct — "DEF ▲X%" option. Expressed as a percentage of pre-option DEF.
 *           Requires pass-1 to get base DEF, then converted to a flat defFlat.
 *
 * ammoPct — "Max Ammo ▲X%" option. Converted to flat bonusAmmo from CDN max_ammo.
 *
 * @param {object} slotBase   slot config (without equipOptions)
 * @param {object} equipPct   { atkPct, defPct, ammoPct, ...direct pcts }
 * @param {number} baseAmmo   shot_detail.max_ammo from character CDN JSON
 */
function computeStatsFromPct(slotBase, equipPct, baseAmmo) {
  const { atkPct = 0, defPct = 0, ammoPct = 0, ...directOpts } = equipPct;

  // Pass 1: get base DEF to derive defFlat (atkPct doesn't affect DEF, exclude it)
  const pass1 = computeFinalStats({ ...slotBase, equipOptions: directOpts }, SYNCHRO_LEVEL, RESEARCH);

  // defPct is % of base DEF → convert to flat
  const defFlat   = Math.round(pass1.def * defPct);
  const bonusAmmo = Math.round(baseAmmo  * ammoPct);

  // Pass 2: full options — atkPct goes into FinalStats.equipAtkPct (not baked into atk)
  return computeFinalStats({
    ...slotBase,
    equipOptions: { ...directOpts, atkPct, defFlat, bonusAmmo },
  }, SYNCHRO_LEVEL, RESEARCH);
}

function fmtN(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(1) + 'K';
  return Math.floor(n).toString();
}
function fmtT(s) {
  const m = Math.floor(s / 60);
  const ss = (s % 60).toFixed(1);
  return m > 0 ? `${m}m ${ss}s` : `${ss}s`;
}

// ─── Stat Breakdown Helpers ───────────────────────────────────────────────────


/**
 * Returns each additive component of base ATK/HP/DEF (before any % multipliers).
 */
function statBreakdown(char, nd, cubeRaw, favRaw) {
  const rawBase = getBaseStats(nd, SYNCHRO_LEVEL);
  const afterGC = {
    atk: applyGradeCore(rawBase.atk, char.grade, char.core, char.classType),
    hp:  applyGradeCore(rawBase.hp,  char.grade, char.core, char.classType),
    def: applyGradeCore(rawBase.def, char.grade, char.core, char.classType),
  };
  const bond = getBondBonus(char.classType, char.bondLevel);

  // Equipment flat per slot (T10 Lv5, ×1.5)
  const equip = { atk: {}, hp: {}, def: {} };
  for (const [slotKey, moduleId] of Object.entries(SLOT_MAP)) {
    const e = getT10Equipment(char.classType, moduleId);
    equip.atk[slotKey] = e ? Math.round(e.atk * 1.5) : 0;
    equip.hp[slotKey]  = e ? Math.round(e.hp  * 1.5) : 0;
    equip.def[slotKey] = e ? Math.round(e.def * 1.5) : 0;
  }
  const equipTotal = {
    atk: Object.values(equip.atk).reduce((s, v) => s + v, 0),
    hp:  Object.values(equip.hp).reduce((s, v) => s + v, 0),
    def: Object.values(equip.def).reduce((s, v) => s + v, 0),
  };

  let cube = { atk: 0, hp: 0, def: 0 };
  if (cubeRaw && char.cubeId) {
    const c   = normalizeCube(cubeRaw);
    const idx = Math.min(14, (c.atk?.length ?? 0) - 1);
    cube = { atk: c.atk?.[idx] ?? 0, hp: c.hp?.[idx] ?? 0, def: c.def?.[idx] ?? 0 };
  }

  const fav = {
    atk: favRaw?.atk?.[char.favLevel] ?? 0,
    hp:  favRaw?.hp?.[char.favLevel]  ?? 0,
    def: favRaw?.def?.[char.favLevel] ?? 0,
  };
  const res = computeResearchBonus(char.classType, char.corporation, RESEARCH);

  return { rawBase, afterGC, bond, equip, equipTotal, cube, fav, res };
}

/**
 * Returns the "Increase ATK" option multiplier.
 */
function equipAtkBreakdown(char) {
  return { optionPct: char.equipPct.atkPct ?? 0 };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Classic Team Simulation  (Synchro Lv.592)');
  console.log('  Little Mermaid / Crown / Rapi:RH / Scarlet:BS / Helm');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load static data
  process.stdout.write('Loading static data…');
  const statics = ['levels', 'attractive', 'recycleRoom', 'charLevels', 'equipment', 'harmonyCubes', 'equipmentEffects'];
  for (const key of statics) setData(key, await loadStaticData(key));
  console.log(' done');

  // Load per-nikke, cube, and favorite item data
  console.log('Loading character data…');
  const nikkeData   = {};
  const cubeData    = {};
  const favItemData = {};
  const uniqueFavIds  = [...new Set(TEAM_DEF.map(c => c.favItemId))];
  const uniqueCubeIds = [...new Set(TEAM_DEF.map(c => c.cubeId).filter(Boolean))];

  for (const char of TEAM_DEF) {
    nikkeData[char.resourceId] = await loadNikkeData(char.resourceId, char.name);
    console.log(`  ✓ ${nikkeData[char.resourceId].name_localkey} (id=${char.resourceId})`);
  }
  for (const cubeId of uniqueCubeIds) {
    cubeData[cubeId] = await loadCubeData(cubeId);
  }
  for (const favId of uniqueFavIds) {
    favItemData[favId] = await loadFavItemData(favId);
  }

  console.log('\n─── Stat Summary (Synchro 592, research applied) ──────────────\n');

  const squadStats  = [];
  const bonusAmmos  = [];

  for (const char of TEAM_DEF) {
    const nd = nikkeData[char.resourceId];
    const fd = favItemData[char.favItemId];

    const baseAmmo = nd.shot_detail?.max_ammo ?? 30;

    const slotBase = {
      resourceId:  char.resourceId,
      classType:   char.classType,
      corporation: char.corporation,
      element:     char.element,
      weaponType:  char.weaponType,
      burstStep:   char.burstStep,
      grade:       char.grade,
      core:        char.core,
      bondLevel:   char.bondLevel,
      skills:      [10, 10, 10],
      cube:        { resourceId: char.cubeId ?? null, level: char.cubeId ? 15 : 0 },
      favoriteItem:{ resourceId: char.favItemId, level: char.favLevel, rare: 'SR' },
      equipment: {
        head:  { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
        torso: { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
        arms:  { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
        legs:  { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
      },
      _nikkeData:   nd,
      _cubeData:    char.cubeId ? cubeData[char.cubeId] : null,
      _favItemData: fd,
    };

    const stats = computeStatsFromPct(slotBase, char.equipPct, baseAmmo);
    squadStats.push(stats);
    bonusAmmos.push(Math.round(baseAmmo * char.equipPct.ammoPct));

    const effectiveAtk = Math.round(stats.atk * (1 + stats.equipAtkPct));
    const cubeName     = char.cubeId ? (cubeData[char.cubeId]?.name_localkey ?? `Cube ${char.cubeId}`) : 'None';
    const favName      = fd?.name_localkey ?? `Item ${char.favItemId}`;
    const bonusAmmo    = bonusAmmos.at(-1);

    // Full stat breakdown
    const sb = statBreakdown(char, nd, char.cubeId ? cubeData[char.cubeId] : null, fd);
    const eb = equipAtkBreakdown(char);

    const n = (v) => Math.round(v).toLocaleString('en-US');
    const p = (v, w=9) => n(v).padStart(w);
    const d = (v) => (v >= 0 ? '+' : '') + n(v);

    console.log(`  ${char.name}  [${char.classType} | ${char.element} | ${char.weaponType} | B${char.burstStep.replace('Step','')}]  Grade ${char.grade} Core ${char.core}, Bond ${char.bondLevel}`);
    console.log(`    ATK (base) ${p(stats.atk)}   effective ${p(effectiveAtk)}   HP ${p(stats.hp,12)}   DEF ${p(stats.def,8)}`);
    // Compute equip vs cube elem split locally (not from FinalStats)
    const cubeRawForElem = char.cubeId ? cubeData[char.cubeId] : null;
    let cubeElemPct = 0;
    if (cubeRawForElem) {
      const cn = normalizeCube(cubeRawForElem);
      const cubeLevel = 15;
      const l2 = cn.level2?.[cubeLevel - 1] ?? 0;
      for (let si = 0; si < cn.skills.length; si++) {
        const sk = cn.skills[si];
        const desc = sk.description_localkey ?? '';
        if (desc.includes('Elemental Advantage')) {
          const vals = sk.description_value_list?.[0]?.description_value ?? [];
          cubeElemPct += parseFloat(vals[Math.max(0, l2 - si)] ?? '0') / 100;
        }
      }
    }
    const equipElemPct = stats.elementDmgPct - cubeElemPct;

    const pct = (v) => (v*100).toFixed(2) + '%';
    console.log(`    EquipATK  +${(stats.equipAtkPct*100).toFixed(2).padStart(6)}%   CritRate ${pct(stats.critRate).padStart(6)}   CritDmg +${pct(stats.critDmg).padStart(6)}`);
    console.log(`    ElemDmg  equip +${pct(equipElemPct).padStart(6)}   cube +${pct(cubeElemPct).padStart(6)}   total +${pct(stats.elementDmgPct).padStart(6)}`);
    console.log(`    Ammo ${baseAmmo}+${bonusAmmo}=${baseAmmo+bonusAmmo}   ChargeDmg +${pct(stats.chargeDmgPct)}   ChargeSpd +${pct(stats.chargeSpeedPct)}   ReloadSpd +${pct(stats.reloadSpeedPct)}   HitRate +${pct(stats.hitRatePct)}`);
    console.log(`    Cube: ${cubeName} Lv.15   Fav: ${favName} Lv.${char.favLevel}`);

    // Per-component breakdown table: ATK | HP | DEF
    const gcFlatAtk = sb.afterGC.atk - sb.rawBase.atk;
    console.log(`    ── Stat breakdown (flat additions)           ATK          HP        DEF`);
    console.log(`       Level stat (Lv.${SYNCHRO_LEVEL})         ${p(sb.rawBase.atk,9)}  ${p(sb.rawBase.hp,11)}  ${p(sb.rawBase.def,8)}`);
    console.log(`     + Grade ${char.grade} Core ${char.core}                  ${d(gcFlatAtk).padStart(9)}  ${d(Math.round(sb.afterGC.hp - sb.rawBase.hp)).padStart(11)}  ${d(Math.round(sb.afterGC.def - sb.rawBase.def)).padStart(8)}`);
    console.log(`     + Bond Lv.${String(char.bondLevel).padEnd(2)}               ${d(sb.bond.atk).padStart(9)}  ${d(sb.bond.hp).padStart(11)}  ${d(sb.bond.def).padStart(8)}`);
    console.log(`     + Equip head (×1.5)             ${d(sb.equip.atk.head).padStart(9)}  ${d(sb.equip.hp.head).padStart(11)}  ${d(sb.equip.def.head).padStart(8)}`);
    console.log(`     + Equip torso(×1.5)             ${d(sb.equip.atk.torso).padStart(9)}  ${d(sb.equip.hp.torso).padStart(11)}  ${d(sb.equip.def.torso).padStart(8)}`);
    console.log(`     + Equip arms (×1.5)             ${d(sb.equip.atk.arms).padStart(9)}  ${d(sb.equip.hp.arms).padStart(11)}  ${d(sb.equip.def.arms).padStart(8)}`);
    console.log(`     + Equip legs (×1.5)             ${d(sb.equip.atk.legs).padStart(9)}  ${d(sb.equip.hp.legs).padStart(11)}  ${d(sb.equip.def.legs).padStart(8)}`);
    console.log(`     + Cube Lv.15                    ${d(sb.cube.atk).padStart(9)}  ${d(sb.cube.hp).padStart(11)}  ${d(sb.cube.def).padStart(8)}`);
    console.log(`     + Fav item Lv.${char.favLevel}                ${d(sb.fav.atk).padStart(9)}  ${d(sb.fav.hp).padStart(11)}  ${d(sb.fav.def).padStart(8)}`);
    console.log(`     + Research                      ${d(Math.round(sb.res.atk)).padStart(9)}  ${d(Math.round(sb.res.hp)).padStart(11)}  ${d(Math.round(sb.res.def)).padStart(8)}`);
    console.log(`     = Total                         ${p(stats.atk,9)}  ${p(stats.hp,11)}  ${p(stats.def,8)}`);
    console.log(`    ── EquipATK% (option only): +${(eb.optionPct*100).toFixed(2)}%  →  effective ${n(effectiveAtk)}\n`);
  }

  console.log('─── Battle Config ──────────────────────────────────────────────\n');
  console.log(`  Enemy HP: ${fmtN(ENEMY.maxHp)}  DEF: ${ENEMY.def}  Type: ${ENEMY.type}  Element: ${ENEMY.element}`);
  console.log(`  Has Core: ${ENEMY.hasCore}  Distance: ${ENEMY.distance} (all time)\n`);

  // Build engine config
  // reloadTicks: CDN reload_time is in centiseconds (÷100 → seconds × 60 → ticks)
  const config = {
    squad: TEAM_DEF.map((char, idx) => {
      const nd = nikkeData[char.resourceId];
      return {
        characterId:      char.resourceId,
        name:             char.name,
        classType:        char.classType,
        element:          char.element,
        weaponType:       char.weaponType,
        burstStep:        char.burstStep,
        canBurst:         char.canBurst ?? true,
        level:            SYNCHRO_LEVEL,
        _computedStats:   squadStats[idx],
        // Fav item data — required by initBattle for collection skill permanent buffs and ammo bonus
        _favItemData:     favItemData[char.favItemId],
        favoriteItem:     { resourceId: char.favItemId, level: char.favLevel },
        ssrFavSkillLevel: char.ssrFavSkillLevel ?? undefined,
        baseAmmo:               nd.shot_detail?.max_ammo ?? undefined,
        fullChargeDamage:       nd.shot_detail?.full_charge_damage ?? 10000,
        reloadTicks:            Math.round((nd.shot_detail?.reload_time ?? 200) / 100 * 60),
        burstEnergyPerShot:     nd.shot_detail?.burst_energy_pershot ?? 500,
        fullChargeBurstEnergy:  nd.shot_detail?.full_charge_burst_energy ?? 0,
        // SR/RL: hold-to-charge delay between shots (centiseconds → ticks)
        chargeTimeTicks:        ['SR','RL'].includes(char.weaponType)
          ? Math.round((nd.shot_detail?.charge_time ?? 0) / 100 * 60) : 0,
        // CDN skill_cooltime is centiseconds → seconds → ticks (60 ticks/s)
        burstSkillCooltime: Math.round((nd.ulti_skill_detail?.skill_cooltime ?? 4000) / 100 * 60),
      };
    }),
    enemy:       ENEMY,
    useMonteCarlo: true,
    iterations:  500,
  };

  console.log('Running simulation (500 iterations)…\n');
  const result = simulateMonteCarlo(config, 500);

  // ─── Results ──────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`  Duration:     ${fmtT(result.timeSeconds)}`);
  console.log(`  Total Dmg:    ${fmtN(result.totalDamage)}`);
  console.log(`  Full Bursts:  ${result.burstCount.toFixed(1)}`);
  console.log('');

  const maxDmg = Math.max(...result.units.map(u => u.totalDamage));
  for (const u of result.units) {
    const share = result.totalDamage > 0 ? (u.totalDamage / result.totalDamage * 100).toFixed(1) : '0.0';
    const bar   = '█'.repeat(Math.round(u.totalDamage / maxDmg * 20)).padEnd(20, '░');
    console.log(`  ${u.name.padEnd(22)} ${bar} ${share.padStart(5)}%  Dmg ${fmtN(u.totalDamage).padStart(9)}  Crit ${(u.critRate*100).toFixed(0).padStart(2)}%`);
  }
  console.log('');

  // ── LM skill damage breakdown ──────────────────────────────────────────────
  const lmResult = result.units.find(u => u.name === 'Little Mermaid');
  if (lmResult?.skillDamage) {
    const sd = lmResult.skillDamage;
    const sc = lmResult.skillDamageCount;
    const totalLM = lmResult.totalDamage;
    const normalDmg = sd.normal_shot ?? 0;
    const bubbleDmg = sd.S2_bubble_wave ?? 0;
    const barrageDmg = sd.S2_barrage ?? 0;
    const skillTotal = bubbleDmg + barrageDmg;
    const fmt = v => fmtN(Math.round(v));

    console.log('─── Little Mermaid Damage Breakdown ────────────────────────────\n');
    console.log(`  Total LM damage:    ${fmt(totalLM).padStart(12)}`);
    console.log('');
    console.log(`  Normal shots:       ${fmt(normalDmg).padStart(12)}  ${sc.normal_shot ?? 0} hits  (${(normalDmg/totalLM*100).toFixed(1)}%)`);
    console.log('');
    console.log(`  Skill 2 — Bubble Wave (4×63.36% ATK/s during FB):`);
    console.log(`    Total:            ${fmt(bubbleDmg).padStart(12)}  ${sc.S2_bubble_wave ?? 0} hits  (${(bubbleDmg/totalLM*100).toFixed(1)}%)`);
    if ((sc.S2_bubble_wave ?? 0) > 0)
      console.log(`    Per hit avg:      ${fmt(bubbleDmg/(sc.S2_bubble_wave)).padStart(12)}`);
    console.log('');
    console.log(`  Skill 2 — Barrage (10×85% ATK per 500 total ammo):`);
    console.log(`    Total:            ${fmt(barrageDmg).padStart(12)}  ${sc.S2_barrage ?? 0} hits  ${Math.round((sc.S2_barrage ?? 0)/10)} procs  (${(barrageDmg/totalLM*100).toFixed(1)}%)`);
    if ((sc.S2_barrage ?? 0) > 0)
      console.log(`    Per hit avg:      ${fmt(barrageDmg/(sc.S2_barrage)).padStart(12)}`);
    console.log('');
    console.log(`  Burst (Siren's Song): no direct damage — buffs only`);
    console.log(`    All allies: Attack Damage ▲10.13% for 10s, Reload ${33.26}%`);
    console.log(`    Self: ATK ▲17.28% of own ATK flat for 10s`);
    console.log('');
    console.log(`  Verify: normal(${fmt(normalDmg)}) + S2_bubble(${fmt(bubbleDmg)}) + S2_barrage(${fmt(barrageDmg)}) = ${fmt(normalDmg+skillTotal)}`);
    console.log(`  Engine total: ${fmt(totalLM)}  diff: ${fmt(totalLM - normalDmg - skillTotal)}`);
    console.log('');
  }

  // Burst rotation
  if (result.log?.length) {
    console.log('  Burst Rotation (first run):');
    for (const e of result.log) {
      const totalMs = Math.round(e.tick / 60 * 1000);
      const mm  = String(Math.floor(totalMs / 60000)).padStart(2, '0');
      const ss  = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, '0');
      const ms  = String(totalMs % 1000).padStart(3, '0');
      const lbl = { burst_i: 'Burst I  ', burst_ii: 'Burst II ', full_burst: '⚡ Full Burst', burst_end: 'Burst End' }[e.type] ?? e.type;
      const who = e.unitName ? ` — ${e.unitName}` : '';
      console.log(`    [${mm}:${ss}.${ms}] ${lbl}${who}`);
    }
  }

  console.log('\n  Skill coverage:');
  console.log('    ✓ LM   Bubble debuff (Dmg Taken ▲5.05% passive, +5.05% after 50 shots)');
  console.log('    ✓ LM   Siren\'s Song burst (Atk Dmg ▲10.13% + reload; self ATK flat)');
  console.log('    ✓ LM   Bubble Order (Atk Dmg ▲4% on FB; gauge ▲37% per 400 ammo)');
  console.log('    ✓ LM   Bubble Wave (4×63.36% ATK/s during FB; barrage ×10 per 500 ammo)');
  console.log('    ✓ Crown Last Kingdom burst (Atk Dmg ▲36.24% for 15s)');
  console.log('    ✓ Crown One for All (ATK flat ▲64.51%×Crown + Reload Speed ▲44.35%)');
  console.log('    ✓ Rapi  Skill 1 Stage 3 (ATK ▲95.04% self on FB; LM is B1 → no Combat Assist)');
  console.log('    ✓ Rapi  Power of Inheritance Stage 3 (2808% ATK burst hit)');
  console.log('    ✓ Rapi  Attachable Projectile (every 120s/60s during FB; ×5.72 attach, ×1.01 explode)');
  console.log('    ✓ SBS   Skill 1 charge procs (250/500/750% ATK on 3/6/9; 1/2/3 in FB)');
  console.log('    ✓ SBS   Fleetly Fading: Asura (ammo ×1.6 + reload on FB)');
  console.log('    ✓ SBS   Fleetly Fading: Strike burst (ATK ▲115.12% + ChgDmg ▲150.12%)');
  console.log('    ✓ Helm  Frontline Command SSR lv10 (CritRate ▲14.64% on last bullet; 0.59% HP + Gauge ▲14.31% on FC)');
  console.log('    ✓ Helm  Fire Away SSR lv10 (Atk Dmg ▲27.87% on FB; extra 178.98% ATK on FC; IRQ dmg not modelled)');
  console.log('    ✓ Helm  Aegis Cannon SSR lv10 (8236.8% ATK burst; lifesteal 54.45%; ChgDmg ▲158.4% 10 rounds)');
  console.log('    ✓ Burst CD reduction (LM Bubble Order on burst end: all allies ▼7.48s)');
  console.log('    ✓ Burst CD tracking (20s LM/Crown; 40s Rapi/SBS/Helm; priority by squad order)');
  console.log('    ✗ Crown Royal Attire (Relax stacks → invuln + 20.99% Atk Dmg — skipped)');
  console.log('    ✗ LM   Focusing / fire concentrate mechanic');
  console.log('  Helm SSR favorite item: SSR shares base stats with SR — SR-15 base correct.');
  console.log('  General (Personal) research: set to 0 (not specified).\n');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(e => { console.error(e); process.exit(1); });
