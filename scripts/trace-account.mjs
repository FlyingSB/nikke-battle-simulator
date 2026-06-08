/**
 * trace-account.mjs — FullDamageTrace using dev account data.
 *
 * Usage: node scripts/trace-account.mjs [CharName|all]
 *
 *   CharName — character name (substring match); default: 'all'
 *
 * Reads dev/config.json → account JSON.
 * Uses account synchro/research levels and actual equipment option data.
 * Output: scripts/<char-name>-trace.txt
 */

import { readFile }                        from 'fs/promises';
import { existsSync, mkdirSync }           from 'fs';
import { createWriteStream }               from 'fs';
import { join, dirname }                   from 'path';
import { fileURLToPath }                   from 'url';

import { simulate }                        from '../src/engine/battle.js';
import { setData }                         from '../src/data/loader.js';
import { computeFinalStats }               from '../src/engine/stats.js';
import {
  getCharacterByName,
  getCharacterByNameCode,
  getCubeResourceIdByTid,
  getFavItemSkillEffects,
}                                          from '../src/data/models.js';
import {
  loadNikkeData, loadStaticData,
  loadFavItemData, loadCubeData,
}                                          from './lib/nikke-cache.mjs';
import { printFullDamageTrace, fmtN, fmtP } from './lib/full-damage-trace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_DIR   = join(__dirname, '..', 'dev');

// ─── 装备词条解码（镜像 account-loader.js） ───────────────────────────────────

const _OPTION_GROUPS = [
  { start: 7000501, key: 'elementDmgPct',  vals: [954,1094,1234,1375,1515,1655,1795,1935,2075,2215,2356,2496,2636,2776,2916] },
  { start: 7000601, key: 'hitRatePct',     vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { start: 7000701, key: 'bonusAmmo',      vals: [2784,3195,3606,4017,4428,4839,5250,5660,6071,6482,6893,7304,7715,8126,8537] },
  { start: 7000801, key: 'atkPct',         vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { start: 7000901, key: 'chargeDmgPct',   vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { start: 7001001, key: 'chargeSpeedPct', vals: [198,228,257,286,316,345,375,404,433,463,492,521,551,580,609] },
  { start: 7001101, key: 'critRatePct',    vals: [230,264,298,332,366,400,435,469,503,537,570,605,639,673,707] },
  { start: 7001201, key: 'critDamagePct',     vals: [664,762,860,958,1056,1154,1252,1350,1448,1546,1644,1742,1840,1938,2036] },
  { start: 7001301, key: 'defFlat',        vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
];
const _OPTION_MAP = new Map();
for (const g of _OPTION_GROUPS)
  for (let i = 0; i < 15; i++) _OPTION_MAP.set(g.start + i, { type: g.key, value: g.vals[i] });

const _API_SLOT    = { head: 'head', torso: 'torso', arms: 'arm', legs: 'leg' };
const _CLASS_DIGIT = { 1: 'Attacker', 2: 'Defender', 3: 'Supporter' };
const EQUIP_SLOTS  = ['head', 'torso', 'arms', 'legs'];

const _PCT_OPT_KEYS = new Set([
  'elementDmgPct', 'hitRatePct', 'bonusAmmo', 'atkPct',
  'chargeDmgPct', 'chargeSpeedPct', 'critRatePct', 'critDamagePct', 'defFlat',
]);

function _parseEquip(slotKey, raw) {
  const k    = _API_SLOT[slotKey];
  const tid  = raw[`${k}_equip_tid`]        ?? 0;
  const tier = raw[`${k}_equip_tier`]       ?? 1;
  const lv   = raw[`${k}_equip_lv`]         ?? 0;
  const o1   = raw[`${k}_equip_option1_id`] ?? 0;
  const o2   = raw[`${k}_equip_option2_id`] ?? 0;
  const o3   = raw[`${k}_equip_option3_id`] ?? 0;
  const tidStr   = String(tid);
  const classReq = (tidStr.length === 7 ? _CLASS_DIGIT[parseInt(tidStr[2])] : null) ?? 'Attacker';
  return {
    classReq,
    tier:  `T${tier}`,
    level: lv,
    opts:  [
      { ...(_OPTION_MAP.get(o1) ?? { type: '', value: 0 }) },
      { ...(_OPTION_MAP.get(o2) ?? { type: '', value: 0 }) },
      { ...(_OPTION_MAP.get(o3) ?? { type: '', value: 0 }) },
    ],
  };
}

function aggregateEquipOptions(equipment) {
  const result = {};
  for (const key of EQUIP_SLOTS) {
    const equip = equipment?.[key];
    if (!equip) continue;
    for (const opt of equip.opts) {
      if (!opt.type) continue;
      const v = Number(opt.value) || 0;
      if (!v) continue;
      const normalized = _PCT_OPT_KEYS.has(opt.type) ? v / 10000 : v;
      result[opt.type] = (result[opt.type] ?? 0) + normalized;
    }
  }
  return result;
}

// ─── Research 解析 ───────────────────────────────────────────────────────────

const _RESEARCH_TID = {
  1001: 'general',
  1101: 'attacker', 1102: 'defender', 1103: 'supporter',
  1201: 'ELYSION',  1202: 'MISSILIS', 1203: 'TETRA',
  1204: 'PILGRIM',  1205: 'ABNORMAL',
};

function parseResearch(outpostInfo) {
  const r = {
    general: 0, attacker: 0, defender: 0, supporter: 0,
    ELYSION: 0, MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0,
  };
  for (const entry of outpostInfo?.recycle_room_researches ?? []) {
    const key = _RESEARCH_TID[entry.tid];
    if (key) r[key] = entry.lv;
  }
  return r;
}

// ─── 账号文件读取 ─────────────────────────────────────────────────────────────

async function loadAccountData() {
  const cfgPath = join(DEV_DIR, 'config.json');
  if (!existsSync(cfgPath)) throw new Error('dev/config.json not found');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
  if (!cfg.account_file) throw new Error('account_file missing from dev/config.json');
  const accPath = join(DEV_DIR, cfg.account_file);
  if (!existsSync(accPath)) throw new Error(`Account file not found: ${accPath}`);
  const json = JSON.parse(await readFile(accPath, 'utf8'));
  return json.data;
}

// ─── 队伍加载 ─────────────────────────────────────────────────────────────────

async function buildTeam(teamNames, charDetails, synchroLevel, research) {
  const STATICS = ['characters', 'levels', 'attractive', 'recycleRoom', 'charLevels',
                   'equipment', 'harmonyCubes', 'equipmentEffects'];
  for (const key of STATICS) setData(key, await loadStaticData(key));

  const roster = new Map();
  for (const raw of charDetails) {
    const char = getCharacterByNameCode(raw.name_code);
    if (char) roster.set(char.name, raw);
  }

  const squadStats   = [];
  const squadConfigs = [];

  for (const name of teamNames) {
    const charInfo = getCharacterByName(name);
    if (!charInfo) throw new Error(`CDN 中未找到角色：「${name}」`);

    const raw = roster.get(name);
    if (!raw) throw new Error(`账号数据中未找到角色：「${name}」`);

    const grade     = raw.grade         ?? 0;
    const core      = Math.min(raw.core ?? 0, 7);
    const bondLevel = raw.attractive_lv ?? 1;
    const skills    = [raw.skill1_lv ?? 1, raw.skill2_lv ?? 1, raw.ulti_skill_lv ?? 1];

    const cubeResourceId    = raw.harmony_cube_tid ? getCubeResourceIdByTid(raw.harmony_cube_tid) : null;
    const cubeLevel         = raw.harmony_cube_lv  || 0;
    const favResourceId     = raw.favorite_item_tid || null;
    const favLevel          = raw.favorite_item_lv  || 0;
    const isSSRFav          = favResourceId != null && favResourceId >= 200000;
    const effectiveFavLevel = isSSRFav ? Math.max(favLevel, 1) : favLevel;

    const equipment = {
      head:  _parseEquip('head',  raw),
      torso: _parseEquip('torso', raw),
      arms:  _parseEquip('arms',  raw),
      legs:  _parseEquip('legs',  raw),
    };

    const nd       = await loadNikkeData(charInfo.resourceId, name);
    const cubeData = cubeResourceId ? await loadCubeData(cubeResourceId) : null;
    const favData  = favResourceId  ? await loadFavItemData(favResourceId) : null;

    const slotForStats = {
      resourceId:   charInfo.resourceId,
      classType:    charInfo.classType,
      corporation:  charInfo.corporation,
      element:      charInfo.element,
      weaponType:   charInfo.weaponType,
      grade, core, bondLevel, skills,
      cube:         { resourceId: cubeResourceId, level: cubeLevel },
      favoriteItem: { resourceId: favResourceId,  level: effectiveFavLevel },
      equipment,
      _nikkeData:   nd,
      _cubeData:    cubeData,
      _favItemData: favData,
      equipOptions: aggregateEquipOptions(equipment),
    };

    const stats          = computeFinalStats(slotForStats, synchroLevel, research);
    const isChargeWeapon = ['SR', 'RL'].includes(charInfo.weaponType);

    squadStats.push(stats);
    squadConfigs.push({
      characterId:           charInfo.resourceId,
      name,
      classType:             charInfo.classType,
      element:               charInfo.element,
      weaponType:            charInfo.weaponType,
      burstStep:             charInfo.burstStep ?? 'Step3',
      level:                 synchroLevel,
      _computedStats:        stats,
      _nikkeData:            nd,
      _favItemData:          favData,
      favoriteItem:          { resourceId: favResourceId, level: effectiveFavLevel },
      cubeLevel,
      skillLevels:           skills,
      baseAmmo:              nd?.shot_detail?.max_ammo,
      fullChargeDamage:      nd?.shot_detail?.full_charge_damage ?? 10000,
      reloadTicks:           Math.round((nd?.shot_detail?.reload_time ?? 200) / 100 * 60),
      burstEnergyPerShot:    nd?.shot_detail?.burst_energy_pershot,
      fullChargeBurstEnergy: nd?.shot_detail?.full_charge_burst_energy ?? 0,
      chargeTimeTicks:       isChargeWeapon
        ? Math.round((nd?.shot_detail?.charge_time ?? 0) / 100 * 60) : 0,
      burstSkillCooltime:    Math.round((nd?.ulti_skill_detail?.skill_cooltime ?? 4000) / 100 * 60),
    });
  }

  return { squadStats, squadConfigs };
}

// ─── 辅助 ─────────────────────────────────────────────────────────────────────

function makeTeeLogger(filePath, extraStream = null) {
  const stream = createWriteStream(filePath);
  const orig   = console.log;
  console.log  = (...args) => {
    const line = args.map(String).join(' ');
    orig(line);
    stream.write(line + '\n');
    extraStream?.write(line + '\n');
  };
  return () => { console.log = orig; stream.end(); };
}

function printStatHeader(cfg, stats) {
  const nd = cfg._nikkeData;
  const sd = nd?.shot_detail;
  const bs = cfg.burstStep?.replace('Step', '') ?? '?';
  console.log(`${cfg.name}  [${cfg.classType} | ${cfg.element} | ${cfg.weaponType} | B${bs}]`);
  console.log(`  ATK ${fmtN(stats.atk)}  HP ${fmtN(stats.hp)}  DEF ${fmtN(stats.def)}`);
  console.log(`  EquipATK +${fmtP(stats.equipAtkPct)}   ElemDmg +${fmtP(stats.elementDmgPct)}   CritRate ${fmtP(stats.critRate)}   CritDmg +${fmtP(stats.critDmg)}`);
  console.log(`  ReloadSpd +${fmtP(stats.reloadSpeedPct)}   ChargeSpd +${fmtP(stats.chargeSpeedPct)}   ChargeDmg +${fmtP(stats.chargeDmgPct)}`);
  if (sd) {
    const shotMult = (sd.damage / 10000).toFixed(4);
    const coreInc  = fmtP((sd.core_damage_rate / 10000) - 2);
    console.log(`  ShotMult ×${shotMult}   CoreInc +${coreInc}   BurstEnergy ${sd.burst_energy_pershot}/shot`);
  }
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const TEAM_NAMES = [
  'Little Mermaid', 'Crown', 'Rapi: Red Hood', 'Scarlet: Black Shadow', 'Helm',
];

async function main() {
  const target = process.argv[2] ?? 'all';

  process.stdout.write('Loading account data… ');
  const accountData  = await loadAccountData();
  const outpostInfo  = accountData.outpost_info;
  const charDetails  = accountData.character_details ?? [];
  const synchroLevel = outpostInfo?.synchro_level ?? 400;
  const research     = parseResearch(outpostInfo);
  process.stdout.write(`done  (synchro ${synchroLevel})\n`);

  process.stdout.write('Loading CDN & computing stats… ');
  const { squadStats, squadConfigs } = await buildTeam(
    TEAM_NAMES, charDetails, synchroLevel, research,
  );
  process.stdout.write('done\n');

  const config = {
    squad:  squadConfigs,
    enemy:  { maxHp: 1e15, def: 102.4, element: 'Iron', hasCore: true, distance: 'NEAR' },
    hitLog: true,
  };

  process.stdout.write('Running simulation… ');
  const result = simulate(config);
  process.stdout.write('done\n\n');

  const targets = target === 'all'
    ? TEAM_NAMES
    : TEAM_NAMES.filter(n =>
        n === target || n.toLowerCase().includes(target.toLowerCase()));

  if (targets.length === 0) {
    console.error(`未找到匹配「${target}」的角色，队伍：${TEAM_NAMES.join(', ')}`);
    process.exit(1);
  }

  // 生成时间戳目录
  const now       = new Date();
  const pad       = n => String(n).padStart(2, '0');
  const ts        = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_`
                  + `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const traceDir  = join(__dirname, 'traces', ts);
  mkdirSync(traceDir, { recursive: true });

  const summaryPath = join(traceDir, `${ts}_summary.txt`);
  const summaryStream = createWriteStream(summaryPath);

  for (const name of targets) {
    const idx   = TEAM_NAMES.indexOf(name);
    const cfg   = squadConfigs[idx];
    const stats = squadStats[idx];
    const nd    = cfg._nikkeData;

    const baseAmmo     = cfg.baseAmmo ?? nd?.shot_detail?.max_ammo ?? 30;
    const collFx       = (cfg._favItemData && (cfg.favoriteItem?.level ?? 0) > 0)
      ? getFavItemSkillEffects(cfg._favItemData, cfg.favoriteItem.level) : null;
    const favMaxAmmoFlat = collFx?.ammoPct ? Math.round(baseAmmo * collFx.ammoPct) : 0;
    const maxAmmo        = baseAmmo + Math.round(baseAmmo * (stats.equipMaxAmmoPct ?? 0)) + favMaxAmmoFlat;

    // 短名称用于文件名（去除特殊字符）
    const shortName = name.replace(/[^a-zA-Z0-9]+/g, '').replace(/^-|-$/g, '');
    const outFile   = join(traceDir, `${ts}_${shortName}.txt`);

    const restore = makeTeeLogger(outFile, summaryStream);
    console.log(`=== ${name} — Full Damage Trace (account data) ===`);
    console.log('');
    printStatHeader(cfg, stats);
    printFullDamageTrace({ result, unitName: name, maxAmmo, outFilePath: outFile });
    restore();
    console.log('');
  }

  summaryStream.end();
  process.stdout.write(`\nTrace files written to: scripts/traces/${ts}/\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
