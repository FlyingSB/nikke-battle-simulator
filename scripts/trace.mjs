/**
 * trace.mjs — unified simulation trace tool
 *
 * Usage: node scripts/trace.mjs [CharName|all] [--team <file>]
 *
 *   CharName  — character name (or substring) to trace; default: 'all'
 *   --team    — JSON file with team definition array; default: embedded classic team
 *
 * Team definition format (JSON array):
 *   [ { resourceId, name, classType, element, weaponType, burstStep, corporation,
 *       grade, core, bondLevel, cubeId, favItemId, favLevel,
 *       equipPct: { atkPct?, defPct?, ammoPct?, elementDmgPct?, critRatePct?,
 *                   critDamagePct?, chargeDmgPct?, chargeSpeedPct?, ... },
 *       ssrFavSkillLevel?, canBurst? }, ... ]
 *
 * Output: scripts/<char-name>-trace.txt  (gitignored via scripts/*.txt)
 */
import { createWriteStream }               from 'fs';
import { readFile }                        from 'fs/promises';
import { simulate }                        from '../src/engine/battle.js';
import { setData }                         from '../src/data/loader.js';
import { computeFinalStats }               from '../src/engine/stats.js';
import { getFavItemSkillEffects,
         maxGeneralResearchLevel }         from '../src/data/models.js';
import { loadNikkeData, loadStaticData,
         loadFavItemData, loadCubeData }   from './lib/nikke-cache.mjs';
import { printFullDamageTrace,
         fmtN, fmtP }                     from './lib/full-damage-trace.mjs';

// ─── Research settings ────────────────────────────────────────────────────────

const SYNCHRO_LEVEL = 592;
const RESEARCH = {
  general:   maxGeneralResearchLevel(SYNCHRO_LEVEL),
  attacker:  218, defender:  218, supporter: 218,
  ELYSION:   206, MISSILIS:  206, TETRA:     206,
  PILGRIM:   201, ABNORMAL:  206,
};

// ─── Default team (classic LM/Crown/Rapi/SBS/Helm) ───────────────────────────

const CLASSIC_TEAM = [
  {
    resourceId: 513, name: 'Little Mermaid', classType: 'Supporter',
    element: 'Wind', weaponType: 'SMG', burstStep: 'Step1', corporation: 'PILGRIM',
    grade: 3, core: 0, bondLevel: 40, cubeId: 10003, favItemId: 100502, favLevel: 15,
    equipPct: { elementDmgPct: 0.3871, atkPct: 0.0900, ammoPct: 1.8214,
                hitRatePct: 0.0688, critRatePct: 0.0528, defPct: 0.0900 },
  },
  {
    resourceId: 330, name: 'Crown', classType: 'Defender',
    element: 'Iron', weaponType: 'MG', burstStep: 'Step2', corporation: 'PILGRIM',
    grade: 3, core: 1, bondLevel: 40, cubeId: 10004, favItemId: 100202, favLevel: 15,
    equipPct: { elementDmgPct: 0.1655, atkPct: 0.2151, ammoPct: 1.1321,
                chargeSpeedPct: 0.0925, critRatePct: 0.0571, critDamagePct: 0.2700 },
  },
  {
    resourceId: 16, name: 'Rapi: Red Hood', classType: 'Attacker',
    element: 'Fire', weaponType: 'MG', burstStep: 'Step3', corporation: 'ELYSION',
    grade: 3, core: 3, bondLevel: 40, cubeId: 10004, favItemId: 100202, favLevel: 15,
    equipPct: { elementDmgPct: 0.9842, atkPct: 0.5289, ammoPct: 1.8625, critDamagePct: 0.0664 },
  },
  {
    resourceId: 225, name: 'Scarlet: Black Shadow', classType: 'Attacker',
    element: 'Wind', weaponType: 'RL', burstStep: 'Step3', corporation: 'PILGRIM',
    grade: 3, core: 0, bondLevel: 40, cubeId: 10003, favItemId: 100302, favLevel: 15,
    equipPct: { elementDmgPct: 0.9281, atkPct: 0.5501, ammoPct: 1.2143,
                chargeDmgPct: 0.0970, critRatePct: 0.0435 },
  },
  {
    resourceId: 352, name: 'Helm', classType: 'Attacker',
    element: 'Water', weaponType: 'SR', burstStep: 'Step3', corporation: 'ELYSION',
    grade: 3, core: 6, bondLevel: 30, cubeId: 10005, favItemId: 200701, favLevel: 2,
    ssrFavSkillLevel: 10, canBurst: false,
    equipPct: { elementDmgPct: 0.9562, atkPct: 0.1659, ammoPct: 1.8533, chargeDmgPct: 0.1940 },
  },
];

// ─── Stat computation ─────────────────────────────────────────────────────────

/**
 * Two-pass stat computation for equipment option percentages.
 * Mirrors test-team-classic.mjs.
 */
function computeStatsFromPct(slotBase, equipPct, baseAmmo) {
  const { atkPct = 0, defPct = 0, ammoPct = 0, ...directOpts } = equipPct;
  const pass1     = computeFinalStats({ ...slotBase, equipOptions: directOpts }, SYNCHRO_LEVEL, RESEARCH);
  const defFlat   = Math.round(pass1.def * defPct);
  const equipMaxAmmoFlat = Math.round(baseAmmo * ammoPct);
  return computeFinalStats({
    ...slotBase,
    equipOptions: { ...directOpts, atkPct, defFlat, equipMaxAmmoPct: equipMaxAmmoFlat },
  }, SYNCHRO_LEVEL, RESEARCH);
}

// ─── Team loading ─────────────────────────────────────────────────────────────

async function loadTeam(teamDef) {
  const STATICS = ['levels', 'attractive', 'recycleRoom', 'charLevels',
                   'equipment', 'harmonyCubes', 'equipmentEffects'];
  for (const key of STATICS) setData(key, await loadStaticData(key));

  const nikkeData   = {};
  const cubeData    = {};
  const favItemData = {};

  for (const char of teamDef)
    nikkeData[char.resourceId] = await loadNikkeData(char.resourceId, char.name);
  for (const id of [...new Set(teamDef.map(c => c.cubeId).filter(Boolean))])
    cubeData[id] = await loadCubeData(id);
  for (const id of [...new Set(teamDef.map(c => c.favItemId))])
    favItemData[id] = await loadFavItemData(id);

  const squadStats = teamDef.map(char => {
    const nd       = nikkeData[char.resourceId];
    const baseAmmo = nd.shot_detail?.max_ammo ?? 30;
    const slotBase = {
      resourceId:   char.resourceId,
      classType:    char.classType,
      corporation:  char.corporation,
      element:      char.element,
      weaponType:   char.weaponType,
      burstStep:    char.burstStep,
      grade:        char.grade,
      core:         char.core,
      bondLevel:    char.bondLevel,
      skills:       [10, 10, 10],
      cube:         { resourceId: char.cubeId ?? null, level: char.cubeId ? (char.cubeLevel ?? 15) : 0 },
      favoriteItem: { resourceId: char.favItemId, level: char.favLevel, rare: 'SR' },
      equipment: {
        head:  { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
        torso: { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
        arms:  { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
        legs:  { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
      },
      _nikkeData:   nd,
      _cubeData:    char.cubeId ? cubeData[char.cubeId] : null,
      _favItemData: favItemData[char.favItemId],
    };
    return computeStatsFromPct(slotBase, char.equipPct ?? {}, baseAmmo);
  });

  return { nikkeData, cubeData, favItemData, squadStats };
}

// ─── Engine config builder ────────────────────────────────────────────────────

function buildConfig(teamDef, nikkeData, favItemData, squadStats, enemyOverride) {
  return {
    squad: teamDef.map((char, idx) => {
      const nd = nikkeData[char.resourceId];
      return {
        characterId:            char.resourceId,
        name:                   char.name,
        classType:              char.classType,
        element:                char.element,
        weaponType:             char.weaponType,
        burstStep:              char.burstStep,
        canBurst:               char.canBurst ?? true,
        level:                  SYNCHRO_LEVEL,
        _computedStats:         squadStats[idx],
        _nikkeData:             nd,
        _favItemData:           favItemData[char.favItemId],
        favoriteItem:           { resourceId: char.favItemId, level: char.favLevel },
        ssrFavSkillLevel:       char.ssrFavSkillLevel,
        cubeLevel:              char.cubeLevel ?? 15,
        baseAmmo:               nd.shot_detail?.max_ammo,
        fullChargeDamage:       nd.shot_detail?.full_charge_damage ?? 10000,
        reloadTicks:            Math.round((nd.shot_detail?.reload_time ?? 200) / 100 * 60),
        burstEnergyPerShot:     nd.shot_detail?.burst_energy_pershot ?? 500,
        fullChargeBurstEnergy:  nd.shot_detail?.full_charge_burst_energy ?? 0,
        chargeTimeTicks:        ['SR','RL'].includes(char.weaponType)
          ? Math.round((nd.shot_detail?.charge_time ?? 0) / 100 * 60) : 0,
        burstSkillCooltime:     Math.round((nd.ulti_skill_detail?.skill_cooltime ?? 4000) / 100 * 60),
        foreswingTicks:         char.foreswingTicks,
        backswingTicks:         char.backswingTicks,
        immuneSkillChargeSpeed: char.immuneSkillChargeSpeed,
        coreHitRateMult:        char.coreHitRateMult,
      };
    }),
    enemy:  enemyOverride
      ? { maxHp: 1e15, ...enemyOverride }
      : { maxHp: 1e15, def: 102.4, element: 'Iron', hasCore: true, distance: 'NEAR' },
    hitLog: true,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Override console.log to tee output to a file; returns a restore function. */
function makeTeeLogger(filePath) {
  const stream = createWriteStream(filePath);
  const orig   = console.log;
  console.log  = (...args) => {
    const line = args.map(String).join(' ');
    orig(line);
    stream.write(line + '\n');
  };
  return () => { console.log = orig; stream.end(); };
}

function computeMaxAmmo(nd, fdRaw, favLevel, equipMaxAmmoFlat) {
  const base    = nd.shot_detail?.max_ammo ?? 0;
  const ammoPct = getFavItemSkillEffects(fdRaw, favLevel)?.ammoPct ?? 0;
  return Math.round(base * (1 + ammoPct)) + (equipMaxAmmoFlat ?? 0);
}

function printStatHeader(char, stats, nd) {
  const eff = Math.round(stats.atk * (1 + stats.equipAtkPct));
  const sd  = nd?.shot_detail;
  console.log(`${char.name}  [${char.classType} | ${char.element} | ${char.weaponType} | B${char.burstStep.replace('Step','')}]  G${char.grade}C${char.core} Bond${char.bondLevel}`);
  console.log(`  ATK ${fmtN(stats.atk)}  (eff ${fmtN(eff)})  HP ${fmtN(stats.hp)}  DEF ${fmtN(stats.def)}`);
  console.log(`  EquipATK +${fmtP(stats.equipAtkPct)}   ElemDmg +${fmtP(stats.elementDmgPct)}   CritRate ${fmtP(stats.critRate)}   CritDmg +${fmtP(stats.critDmg)}`);
  console.log(`  ReloadSpd +${fmtP(stats.reloadSpeedPct)}   ChargeSpd +${fmtP(stats.chargeSpeedPct)}   ChargeDmg +${fmtP(stats.chargeDmgPct)}`);
  if (sd) {
    const shotMult = (sd.damage / 10000).toFixed(4);
    const coreInc  = fmtP((sd.core_damage_rate / 10000) - 2);
    console.log(`  ShotMult ×${shotMult}   CoreInc +${coreInc}   BurstEnergy ${sd.burst_energy_pershot}/shot`);
  }
  console.log('');
}

// ─── Character-specific hit detail functions ──────────────────────────────────

const HIT_DETAIL_FN = {
  'Rapi: Red Hood': (h) => {
    const extra = h.extraAttackDamagePct ?? 0;
    if (extra > 0) return [`  projBonus: +${fmtP(extra)}  (projectile type ExtraMultiplier — not from buffs)`];
    return [];
  },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args     = process.argv.slice(2);
  let target     = 'all';
  let teamFile   = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--team' && args[i + 1]) { teamFile = args[++i]; }
    else { target = args[i]; }
  }

  let teamDef = CLASSIC_TEAM;
  let enemyOverride = null;
  if (teamFile) {
    const raw = JSON.parse(await readFile(teamFile, 'utf8'));
    if (Array.isArray(raw)) {
      teamDef = raw;
    } else {
      teamDef      = raw.members;
      enemyOverride = raw.enemy ?? null;
    }
  }

  process.stdout.write('Loading data…');
  const { nikkeData, favItemData, squadStats } = await loadTeam(teamDef);
  process.stdout.write(' done\n');

  const config = buildConfig(teamDef, nikkeData, favItemData, squadStats, enemyOverride);
  const result = simulate(config);

  const chars = target === 'all'
    ? teamDef
    : teamDef.filter(c => c.name === target || c.name.toLowerCase().includes(target.toLowerCase()));

  if (chars.length === 0) {
    console.error(`No character matching '${target}' in team: ${teamDef.map(c => c.name).join(', ')}`);
    process.exit(1);
  }

  for (const char of chars) {
    const idx     = teamDef.indexOf(char);
    const stats   = squadStats[idx];
    const nd      = nikkeData[char.resourceId];
    const fdRaw   = favItemData[char.favItemId];
    const maxAmmo = computeMaxAmmo(nd, fdRaw, char.favLevel, stats.equipMaxAmmoPct);
    const slug    = char.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const outFile = `./scripts/${slug}-trace.txt`;

    const restore = makeTeeLogger(outFile);
    console.log(`=== ${char.name} — Full Damage Trace ===`);
    console.log('');
    printStatHeader(char, stats, nd);
    printFullDamageTrace({ result, unitName: char.name, maxAmmo,
                           hitDetailFn: HIT_DETAIL_FN[char.name],
                           outFilePath: outFile });
    restore();
    console.log('');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
