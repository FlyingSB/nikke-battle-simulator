/**
 * 账号数据加载器。
 *
 * 开发模式：读取 /dev/config.json 获取文件名，再 fetch 对应的账号 JSON。
 * 文件上传模式：通过 loadAccountFromJson(file) 接收用户上传的同格式 JSON。
 * 账号 JSON 格式为 GetUserCharacters API 的响应体（data.character_details[]）。
 */

import { getCharacterByNameCode, getCharacterByName, maxGeneralResearchLevel, getCubeResourceIdByTid } from './models.js';

/** 已解析的角色账号数据，按 resourceId 索引。 */
const _rosterByResourceId = new Map();

/** 已加载的全局账号设置（同步器、研究等级）。 */
let _settings = null;

const _DEFAULT_SYNCHRO = 400;

/**
 * 开发模式：从 /dev/config.json 读取文件名，再加载对应账号数据。
 * 同时解析 data.outpost_info 填充全局设置（同步器、研究等级）。
 * 文件不存在或解析失败时静默返回 false，不影响手动填写流程。
 * 必须在 loadAllData()（填充 CDN 角色花名册）之后调用。
 * @returns {Promise<boolean>} 是否成功加载
 */
export async function loadAccountFromDev() {
  try {
    const json = await _fetchAccountJson();
    if (!json) return false;

    _buildRosterIndex(json.data?.character_details ?? []);
    _parseOutpostSettings(json.data?.outpost_info);
    return _rosterByResourceId.size > 0;
  } catch {
    return false;
  }
}

/**
 * 开发模式：加载全局设置（同步器、研究等级）。
 * 若 loadAccountFromDev() 已成功运行，设置已就绪，直接返回 true。
 * 否则独立读取账号文件并解析 outpost_info。
 * @returns {Promise<boolean>} 是否成功加载
 */
export async function loadSettingsFromDev() {
  if (_settings) return true;
  try {
    const json = await _fetchAccountJson();
    if (!json) return false;
    _parseOutpostSettings(json.data?.outpost_info);
    return !!_settings;
  } catch {
    return false;
  }
}

// ─── 账号文件加载 & 设置解析 ──────────────────────────────────────────────────

/**
 * 读取 /dev/config.json 并 fetch 对应账号 JSON，失败返回 null。
 * @returns {Promise<object|null>}
 */
async function _fetchAccountJson() {
  const cfgRes = await fetch('/dev/config.json');
  if (!cfgRes.ok) return null;
  const cfg = await cfgRes.json();
  if (!cfg.account_file) return null;

  const dataRes = await fetch(`/dev/${cfg.account_file}`);
  if (!dataRes.ok) return null;
  return dataRes.json();
}

// outpost_info.recycle_room_researches 的 tid → 内部路径映射
const _RESEARCH_TID_MAP = {
  1001: ['generalResearch'],
  1101: ['classResearch', 'attacker'],
  1102: ['classResearch', 'defender'],
  1103: ['classResearch', 'supporter'],
  1201: ['corpResearch', 'ELYSION'],
  1202: ['corpResearch', 'MISSILIS'],
  1203: ['corpResearch', 'TETRA'],
  1204: ['corpResearch', 'PILGRIM'],
  1205: ['corpResearch', 'ABNORMAL'],
};

/**
 * 将 outpost_info 解析为内部 _settings 格式。
 * outpost_info 缺失时不做任何操作（保留 _settings = null，getAccountSettings 返回缺省值）。
 * @param {object|undefined} outpostInfo
 */
function _parseOutpostSettings(outpostInfo) {
  if (!outpostInfo) return;

  const s = {
    synchroLevel:    outpostInfo.synchro_level ?? _DEFAULT_SYNCHRO,
    generalResearch: 0,
    classResearch:   { attacker: 0, defender: 0, supporter: 0 },
    corpResearch:    { ELYSION: 0, MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0 },
  };

  for (const r of outpostInfo.recycle_room_researches ?? []) {
    const path = _RESEARCH_TID_MAP[r.tid];
    if (!path) continue;
    if (path.length === 1) {
      s[path[0]] = r.lv;
    } else {
      s[path[0]][path[1]] = r.lv;
    }
  }

  _settings = s;
}

/**
 * 返回已加载的全局设置；未加载时返回缺省值（同步器 400，研究均为计算值或 0）。
 * @returns {{ synchroLevel: number, generalResearch: number, classResearch: object, corpResearch: object }}
 */
export function getAccountSettings() {
  if (_settings) return _settings;
  const synchro = _DEFAULT_SYNCHRO;
  return {
    synchroLevel:    synchro,
    generalResearch: maxGeneralResearchLevel(synchro),
    classResearch:   { attacker: 0, defender: 0, supporter: 0 },
    corpResearch:    { ELYSION: 0, MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0 },
  };
}

/**
 * 从用户上传的文件加载账号数据（与 loadAccountFromDev 相同格式）。
 * @param {File} file
 * @returns {Promise<boolean>}
 */
export async function loadAccountFromJson(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    _buildRosterIndex(json.data?.character_details ?? []);
    _parseOutpostSettings(json.data?.outpost_info);
    return _rosterByResourceId.size > 0;
  } catch {
    return false;
  }
}

/**
 * 按 resourceId 查找角色账号数据。
 * @param {number} resourceId
 * @returns {RosterEntry|null}
 */
export function getRosterEntry(resourceId) {
  return _rosterByResourceId.get(Number(resourceId)) ?? null;
}

/** 返回已加载的角色数量。 */
export function getAccountSize() {
  return _rosterByResourceId.size;
}

/**
 * 按显示名查找角色的 CDN 静态数据 + 账号数据。
 * 需先调用 loadAllData() 和 loadAccountFromDev()。
 * @param {string} name 显示名（与 CDN name_localkey 一致）
 * @returns {{ char: import('./models.js').Character, entry: RosterEntry|null }|null}
 */
export function lookupByName(name) {
  const char = getCharacterByName(name);
  if (!char) return null;
  return { char, entry: getRosterEntry(char.resourceId) };
}

// ─── 内部解析 ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RosterEntry
 * @property {number}   grade
 * @property {number}   core
 * @property {number}   bondLevel       attractive_lv
 * @property {number[]} skills          [skill1_lv, skill2_lv, ulti_skill_lv]
 * @property {{ resourceId: number|null, level: number }} cube
 * @property {{ resourceId: number|null, level: number }} favoriteItem
 * @property {{ head: EquipEntry, torso: EquipEntry, arms: EquipEntry, legs: EquipEntry }} equipment
 */

/**
 * @typedef {Object} EquipEntry
 * @property {string}   classReq   'Attacker'|'Defender'|'Supporter'|'All'
 * @property {string}   tier       'T1'–'T10'，或 'T9Corp'（T9 企业装备）
 * @property {boolean[]} options   长度为 3，对应三个词条槽位
 */

function _buildRosterIndex(characterDetails) {
  _rosterByResourceId.clear();
  for (const raw of characterDetails) {
    const char = getCharacterByNameCode(raw.name_code);
    if (!char) continue;
    _rosterByResourceId.set(char.resourceId, _parseEntry(raw));
  }
}

// API 字段前缀：squad-builder 的 key（arms/legs）与 API 字段（arm/leg）不同
const _API_SLOT = { head: 'head', torso: 'torso', arms: 'arm', legs: 'leg' };

// 装备词条 ID → 词条类型+数值映射
// option_id = state_effect_id_prefix * 100 + level（level 1–15）
// 数值来源：src/data/static/equipmentEffects.csv，按等级顺序
// 以百分比整数存储（9.54 表示 9.54%），aggregateEquipOptions 传引擎前除以 100
// vals 以整数厘百分比存储（954 表示 9.54%），UI 显示除以 100，引擎使用除以 10000
const _OPTION_GROUPS = [
  { start: 7000501, key: 'elementDmgPct',  vals: [954,1094,1234,1375,1515,1655,1795,1935,2075,2215,2356,2496,2636,2776,2916] },
  { start: 7000601, key: 'hitRatePct',     vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { start: 7000701, key: 'equipMaxAmmoPct', vals: [2784,3195,3606,4017,4428,4839,5250,5660,6071,6482,6893,7304,7715,8126,8537] },
  { start: 7000801, key: 'atkPct',         vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { start: 7000901, key: 'chargeDmgPct',   vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { start: 7001001, key: 'chargeSpeedPct', vals: [198,228,257,286,316,345,375,404,433,463,492,521,551,580,609] },
  { start: 7001101, key: 'critRatePct',    vals: [230,264,298,332,366,400,435,469,503,537,570,605,639,673,707] },
  { start: 7001201, key: 'critDamagePct',     vals: [664,762,860,958,1056,1154,1252,1350,1448,1546,1644,1742,1840,1938,2036] },
  { start: 7001301, key: 'defFlat',        vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
];
const _OPTION_MAP = new Map();
for (const g of _OPTION_GROUPS) {
  for (let i = 0; i < 15; i++) _OPTION_MAP.set(g.start + i, { type: g.key, value: g.vals[i] });
}

// tid 第三位（0-based index 2）编码职业要求
const _CLASS_DIGIT = { 1: 'Attacker', 2: 'Defender', 3: 'Supporter' };

function _parseEntry(raw) {
  return {
    grade:    raw.grade        ?? 0,
    core:     raw.core         ?? 0,
    bondLevel: raw.attractive_lv ?? 1,
    skills:   [raw.skill1_lv ?? 1, raw.skill2_lv ?? 1, raw.ulti_skill_lv ?? 1],
    cube: {
      resourceId: raw.harmony_cube_tid ? getCubeResourceIdByTid(raw.harmony_cube_tid) : null,
      level:      raw.harmony_cube_lv   || 0,
    },
    favoriteItem: {
      resourceId: raw.favorite_item_tid || null,
      level:      raw.favorite_item_lv  || 0,
    },
    equipment: {
      head:  _parseEquip('head',  raw),
      torso: _parseEquip('torso', raw),
      arms:  _parseEquip('arms',  raw),
      legs:  _parseEquip('legs',  raw),
    },
  };
}

function _parseEquip(slotKey, raw) {
  const k    = _API_SLOT[slotKey];
  const tid  = raw[`${k}_equip_tid`]  ?? 0;
  const tier = raw[`${k}_equip_tier`] ?? 1;
  const lv   = raw[`${k}_equip_lv`]   ?? 0;
  // corporation_type：0 = 无企业；1 Elysion / 2 Missilis / 3 Tetra / 4 Pilgrim / 7 Abnormal（恒与穿戴者企业一致）
  const corp = raw[`${k}_equip_corporation_type`] ?? 0;
  const o1   = raw[`${k}_equip_option1_id`] ?? 0;
  const o2   = raw[`${k}_equip_option2_id`] ?? 0;
  const o3   = raw[`${k}_equip_option3_id`] ?? 0;

  // tid 格式：3[槽位][职类][tier2位][01]，第 3 位（index 2）为职类
  const tidStr   = String(tid);
  const classReq = (tidStr.length === 7 ? _CLASS_DIGIT[parseInt(tidStr[2])] : null) ?? 'Attacker';

  return {
    classReq,
    tier:  (tier === 9 && corp) ? 'T9Corp' : `T${tier}`,
    level: lv,
    opts:  [
      { ...(_OPTION_MAP.get(o1) ?? { type: '', value: 0 }) },
      { ...(_OPTION_MAP.get(o2) ?? { type: '', value: 0 }) },
      { ...(_OPTION_MAP.get(o3) ?? { type: '', value: 0 }) },
    ],
  };
}
