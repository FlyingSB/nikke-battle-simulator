/**
 * 账号数据加载器。
 *
 * 开发模式：读取 /dev/config.json 获取文件名，再 fetch 对应的账号 JSON。
 * 账号 JSON 格式为 GetUserCharacters API 的响应体（data.character_details[]）。
 *
 * TODO (prod): 支持用户通过 <input type="file"> 上传同格式 JSON，
 *   实现 loadAccountFromFile(file) 替代 loadAccountFromDev()。
 */

import { getCharacterByNameCode, getCharacterByName, maxGeneralResearchLevel } from './models.js';

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
 * @property {string}   tier       'T1'–'T10'
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

// tid 第三位（0-based index 2）编码职业要求
const _CLASS_DIGIT = { 1: 'Attacker', 2: 'Defender', 3: 'Supporter' };

function _parseEntry(raw) {
  return {
    grade:    raw.grade        ?? 0,
    core:     raw.core         ?? 0,
    bondLevel: raw.attractive_lv ?? 1,
    skills:   [raw.skill1_lv ?? 1, raw.skill2_lv ?? 1, raw.ulti_skill_lv ?? 1],
    cube: {
      resourceId: raw.harmony_cube_tid  || null,
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
  const o1   = raw[`${k}_equip_option1_id`] ?? 0;
  const o2   = raw[`${k}_equip_option2_id`] ?? 0;
  const o3   = raw[`${k}_equip_option3_id`] ?? 0;

  // tid 格式：3[槽位][职类][tier2位][01]，第 3 位（index 2）为职类
  const tidStr   = String(tid);
  const classReq = (tidStr.length === 7 ? _CLASS_DIGIT[parseInt(tidStr[2])] : null) ?? 'Attacker';

  return {
    classReq,
    tier:    `T${tier}`,
    options: [o1 !== 0, o2 !== 0, o3 !== 0],
  };
}
