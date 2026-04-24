/**
 * trace-energy-phase0.mjs
 * Prints every burst gauge contribution during Phase 0 (pre-first-burst)
 * for both team builds. No damage output — energy only.
 */
import { readFileSync } from 'fs';
import { simulate }     from '../src/engine/battle.js';

function load(p) { try { const r = JSON.parse(readFileSync(p, 'utf8')); return r.data ?? r; } catch { return null; } }

const TICK_RATE     = 60;
const BURST_GAUGE_MAX = 1_000_000;
const fmtT = tick => {
  const s = tick / TICK_RATE;
  return `${String(Math.floor(s / 60)).padStart(2,'0')}:${(s % 60).toFixed(3).padStart(6,'0')}`;
};
const fmtN = v => Math.round(v).toLocaleString('en-US').padStart(11);
const fmtPct = v => (v * 100).toFixed(2).padStart(6) + '%';

// ── Shared config builder ─────────────────────────────────────────────────────
function buildConfig(teamDef, squadStats, nd, fd, cubeData) {
  return {
    squad: teamDef.map((char, idx) => {
      const n = nd[char.key];
      const sd = n.shot_detail;
      return {
        characterId:        n.resource_id,
        name:               char.name,
        classType:          char.classType,
        corporation:        char.corporation,
        element:            char.element,
        weaponType:         char.weaponType,
        burstStep:          char.burstStep,
        canBurst:           char.canBurst ?? true,
        level:              605,
        _computedStats:     squadStats[idx],
        _nikkeData:         n,
        _cubeData:          cubeData[char.cubeId] ?? null,
        cubeLevel:          char.cubeLevel ?? 14,
        _favItemData:       fd[char.key],
        favoriteItem:       { resourceId: char.favItemId, level: char.favLevel },
        baseAmmo:           sd?.max_ammo,
        shotDamageMult:     sd?.damage != null ? sd.damage / 10000 : null,
        coreDmgIncrement:   sd?.core_damage_rate != null ? (sd.core_damage_rate / 10000) - 1 - 1 : 0,
        fullChargeDamage:   sd?.full_charge_damage ?? 10000,
        reloadTicks:        Math.round((sd?.reload_time ?? 200) / 100 * 60),
        burstEnergyPerShot: sd?.target_burst_energy_pershot ?? 500,
        chargeTimeTicks:    ['SR','RL'].includes(char.weaponType) ? Math.round((sd?.charge_time ?? 0) / 100 * 60) : 0,
        foreswingTicks:     char.foreswingTicks,
        backswingTicks:     char.backswingTicks,
        burstSkillCooltime: Math.round((n.ulti_skill_detail?.skill_cooltime ?? 4000) / 100 * 60),
        coreHitRateMult:    char.coreHitRateMult,
        ssrFavSkillLevel:   char.ssrFavSkillLevel,
        immuneSkillChargeSpeed: char.immuneSkillChargeSpeed,
      };
    }),
    enemy: { maxHp: 1e15, def: 100, element: 'Iron', hasCore: true, distance: 'NEAR' },
    hitLog: false,
    burstEnergyLog: true,
  };
}

// ── Print energy trace for one team ──────────────────────────────────────────
function printPhase0Trace(label, result) {
  const fullLog = result.burstEnergyLog ?? [];
  if (fullLog.length === 0) { console.log('  (no energy log)'); return; }
  // Only show the very first phase-0 fill (t=0 → first time gauge hits BURST_GAUGE_MAX).
  const firstFillIdx = fullLog.findIndex(e => e.gaugeAfter >= BURST_GAUGE_MAX);
  const log = firstFillIdx >= 0 ? fullLog.slice(0, firstFillIdx + 1) : fullLog;

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(80)}`);
  console.log(`  ${'Time'.padEnd(10)}  ${'Unit'.padEnd(26)}  ${'Source'.padEnd(20)}  ${'Energy'.padStart(8)}  ${'Gauge'.padStart(12)}  ${'Fill%'}`);
  console.log(`  ${'-'.repeat(10)}  ${'-'.repeat(26)}  ${'-'.repeat(20)}  ${'-'.repeat(8)}  ${'-'.repeat(12)}  ${'-'.repeat(7)}`);

  for (const e of log) {
    const pct = (e.gaugeAfter / BURST_GAUGE_MAX * 100).toFixed(1).padStart(6);
    console.log(
      `  ${fmtT(e.tick).padEnd(10)}  ${e.unitName.padEnd(26)}  ${e.source.padEnd(20)}  ` +
      `${String(e.energyAdded).padStart(8)}  ${fmtN(e.gaugeAfter)}  ${pct}%`
    );
  }

  // Per-source/unit summary
  const byUnit = new Map();
  for (const e of log) {
    const k = `${e.unitName}|${e.source}`;
    byUnit.set(k, (byUnit.get(k) ?? 0) + e.energyAdded);
  }
  const totalEnergy = [...byUnit.values()].reduce((s, v) => s + v, 0);
  const firstBurstTick = log[log.length - 1]?.tick ?? 0;

  console.log(`\n  Gauge reached ${BURST_GAUGE_MAX.toLocaleString()} at t=${fmtT(firstBurstTick)}  (${log.length} events)`);
  console.log(`\n  Contribution summary:`);
  console.log(`  ${'Unit'.padEnd(26)}  ${'Source'.padEnd(20)}  ${'Total energy'.padStart(12)}  ${'% of fill'}`);
  console.log(`  ${'-'.repeat(26)}  ${'-'.repeat(20)}  ${'-'.repeat(12)}  ${'-'.repeat(9)}`);
  const sorted = [...byUnit.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) {
    const [unit, src] = k.split('|');
    console.log(`  ${unit.padEnd(26)}  ${src.padEnd(20)}  ${fmtN(v)}  ${fmtPct(v / totalEnergy)}`);
  }
  console.log(`  ${' '.repeat(26)}  ${'TOTAL'.padEnd(20)}  ${fmtN(totalEnergy)}  100.00%`);
}

// ── Team 1: LM / Crown / Rapi / SBS / Helm ───────────────────────────────────
{
  const nd = {
    lm:    load('./scripts/cache/nikke_513.json'),
    crown: load('./scripts/cache/nikke_330.json'),
    rapi:  load('./scripts/cache/nikke_16.json'),
    sbs:   load('./scripts/cache/nikke_225.json'),
    helm:  load('./scripts/cache/nikke_352.json'),
  };
  const fd = {
    lm:    load('./scripts/cache/fav_100502.json'),
    crown: load('./scripts/cache/fav_100202.json'),
    rapi:  load('./scripts/cache/fav_100202.json'),
    sbs:   load('./scripts/cache/fav_100302.json'),
    helm:  load('./scripts/cache/fav_200701.json'),
  };
  const cubeData = {
    10003: load('./scripts/cache/cube_10003.json'),
    10004: load('./scripts/cache/cube_10004.json'),
    10005: load('./scripts/cache/cube_10005.json'),
  };
  const squadStats = [
    { atk:256573, hp:7844413, def:50308, critRate:0.2028, critDmg:0.5,    equipAtkPct:0.09,   elementDmgPct:0.578,  bonusAmmo:218, chargeDmgPct:0,     chargeSpeedPct:0,      reloadSpeedPct:0.2969 },
    { atk:212496, hp:8708666, def:50281, critRate:0.2071, critDmg:0.77,   equipAtkPct:0.2151, elementDmgPct:0.3564, bonusAmmo:340, chargeDmgPct:0,     chargeSpeedPct:0.0925, reloadSpeedPct:0 },
    { atk:320969, hp:7489834, def:43684, critRate:0.15,   critDmg:0.5666, equipAtkPct:0.5289, elementDmgPct:1.1751, bonusAmmo:559, chargeDmgPct:0,     chargeSpeedPct:0,      reloadSpeedPct:0 },
    { atk:304256, hp:7127674, def:46796, critRate:0.1935, critDmg:0.5,    equipAtkPct:0.5501, elementDmgPct:1.119,  bonusAmmo:11,  chargeDmgPct:0.097, chargeSpeedPct:0,      reloadSpeedPct:0.2969 },
    { atk:336758, hp:7836241, def:46153, critRate:0.15,   critDmg:0.5,    equipAtkPct:0.1659, elementDmgPct:1.1471, bonusAmmo:12,  chargeDmgPct:0.194, chargeSpeedPct:0.0212, reloadSpeedPct:0 },
  ];
  const teamDef = [
    { name:'Little Mermaid',        key:'lm',    classType:'Supporter', corporation:'PILGRIM',  element:'Wind',  weaponType:'SMG', burstStep:'Step1', grade:3,core:0,bondLevel:40, cubeId:10003, cubeLevel:14, favItemId:100502, favLevel:15 },
    { name:'Crown',                 key:'crown', classType:'Defender',  corporation:'PILGRIM',  element:'Iron',  weaponType:'MG',  burstStep:'Step2', grade:3,core:1,bondLevel:40, cubeId:10003, cubeLevel:14, favItemId:100202, favLevel:15 },
    { name:'Rapi: Red Hood',        key:'rapi',  classType:'Attacker',  corporation:'ELYSION',  element:'Fire',  weaponType:'MG',  burstStep:'Step3', grade:3,core:3,bondLevel:40, cubeId:10004, cubeLevel:14, favItemId:100202, favLevel:15 },
    { name:'Scarlet: Black Shadow', key:'sbs',   classType:'Attacker',  corporation:'PILGRIM',  element:'Wind',  weaponType:'RL',  burstStep:'Step3', grade:3,core:0,bondLevel:40, cubeId:10003, cubeLevel:14, favItemId:100302, favLevel:15, foreswingTicks:11, backswingTicks:14 },
    { name:'Helm',                  key:'helm',  classType:'Attacker',  corporation:'ELYSION',  element:'Water', weaponType:'SR',  burstStep:'Step3', grade:3,core:6,bondLevel:30, cubeId:10005, cubeLevel:14, favItemId:200701, favLevel:15, ssrFavSkillLevel:10, canBurst:false },
  ];
  const result = simulate(buildConfig(teamDef, squadStats, nd, fd, cubeData));
  printPhase0Trace('Team 1: LM / Crown / Rapi / SBS / Helm', result);
}

// ── Team 2: Liter / Mast / Anchor / SBS / Lib ────────────────────────────────
{
  const nd = {
    liter:  load('./scripts/cache/nikke_82.json'),
    mast:   load('./scripts/cache/nikke_354.json'),
    anchor: load('./scripts/cache/nikke_355.json'),
    sbs:    load('./scripts/cache/nikke_225.json'),
    lib:    load('./scripts/cache/nikke_262.json'),
  };
  const fd = {
    liter:  load('./scripts/cache/fav_100502.json'),
    mast:   load('./scripts/cache/fav_100202.json'),
    anchor: load('./scripts/cache/fav_100302.json'),
    sbs:    load('./scripts/cache/fav_100302.json'),
    lib:    load('./scripts/cache/fav_100602.json'),
  };
  const cubeData = {
    10003: load('./scripts/cache/cube_10003.json'),
    10004: load('./scripts/cache/cube_10004.json'),
  };
  const squadStats = [
    { atk:278763, hp:8631352, def:50618, critRate:0.3213, critDmg:0.5,   equipAtkPct:0.1181, elementDmgPct:0.4265, bonusAmmo:83, chargeDmgPct:0.1181, chargeSpeedPct:0.0492, reloadSpeedPct:0.2969 },
    { atk:260643, hp:8112638, def:46012, critRate:0.2071, critDmg:0.5,   equipAtkPct:0.1181, elementDmgPct:0.4265, bonusAmmo:0,  chargeDmgPct:0.2362, chargeSpeedPct:0,      reloadSpeedPct:0 },
    { atk:251178, hp:7826675, def:50426, critRate:0.2642, critDmg:0.8288, equipAtkPct:0,      elementDmgPct:0.1909, bonusAmmo:8,  chargeDmgPct:0,      chargeSpeedPct:0,      reloadSpeedPct:0.2969 },
    { atk:304256, hp:7127674, def:46796, critRate:0.1935, critDmg:0.5,   equipAtkPct:0.5501, elementDmgPct:1.119,  bonusAmmo:11, chargeDmgPct:0.097,  chargeSpeedPct:0,      reloadSpeedPct:0.2969 },
    { atk:299231, hp:7127674, def:40336, critRate:0.2199, critDmg:0.5,   equipAtkPct:0.1870, elementDmgPct:0.7267, bonusAmmo:6,  chargeDmgPct:0,      chargeSpeedPct:0.0484, reloadSpeedPct:0.2969 },
  ];
  const teamDef = [
    { name:'Liter',                  key:'liter',  classType:'Supporter', corporation:'MISSILIS', element:'Iron',  weaponType:'SMG', burstStep:'Step1', grade:3, core:7, bondLevel:40, cubeId:10003, cubeLevel:15, favItemId:100502, favLevel:5  },
    { name:'Mast: Romantic Maid',    key:'mast',   classType:'Supporter', corporation:'ELYSION',  element:'Water', weaponType:'MG',  burstStep:'Step2', grade:3, core:2, bondLevel:40, cubeId:10004, cubeLevel:15, favItemId:100202, favLevel:15 },
    { name:'Anchor: Innocent Maid',  key:'anchor', classType:'Supporter', corporation:'ELYSION',  element:'Water', weaponType:'RL',  burstStep:'Step2', grade:3, core:1, bondLevel:40, cubeId:10003, cubeLevel:15, favItemId:100302, favLevel:5  },
    { name:'Scarlet: Black Shadow',  key:'sbs',    classType:'Attacker',  corporation:'PILGRIM',  element:'Wind',  weaponType:'RL',  burstStep:'Step3', grade:3, core:0, bondLevel:40, cubeId:10003, cubeLevel:14, favItemId:100302, favLevel:15, foreswingTicks:11, backswingTicks:14 },
    { name:'Liberalio',              key:'lib',    classType:'Attacker',  corporation:'PILGRIM',  element:'Wind',  weaponType:'SR',  burstStep:'Step3', grade:3, core:0, bondLevel:40, cubeId:10003, cubeLevel:15, favItemId:100602, favLevel:15, immuneSkillChargeSpeed:true },
  ];
  const result = simulate(buildConfig(teamDef, squadStats, nd, fd, cubeData));
  printPhase0Trace('Team 2: Liter / Mast / Anchor / SBS / Lib', result);
}
