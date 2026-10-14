/**
 * Alpine.js 全局 store — 战斗模拟器状态与逻辑。
 * 由 src/main.js 导入并通过 Alpine.store('sim', createStore()) 注册。
 */

import { loadAllData, loadNikke, loadCube, loadFavoriteItem } from '../data/loader.js';
import {
  loadAccountFromDev,
  loadAccountFromJson,
  getAccountSettings,
  getAccountSize,
  getRosterEntry,
} from '../data/account-loader.js';
import { getAllCharacters, getCharacterByResourceId, normalizeCube, getSsrFavSkills, EQUIP_TIERS, equipTierHasOptions } from '../data/models.js';
import { computeFinalStats } from '../engine/stats.js';
import { runSimulation, cancelSimulation, SimCancelledError } from './sim-runner.js';
import { CUBE_NAMES, CUBE_URLS } from '../data/manifest.js';
import { renderSkillDesc } from './skill-render.js';
import { MODELED_IDS } from '../data/skill-traits.js';
import { loadZhNames, loadZhPatch, localizeData } from '../data/locale-loader.js';
import { LANGS, loadSavedLang, setCurrentLang, t, translate } from './i18n.js';
import { createNameMap, displayGameText } from './game-text.js';
import { buildDmgTooltipHTML, pelletGroupTitleKey } from './dmg-tooltip.js';
import { buildDmgFormulaExport, pickPelletGroup } from './dmg-formula-export.js';
import { buildEnemyConfigExport, parseEnemyConfig, pickActionFields, buildEnemyPhases } from './enemy-config-io.js';
import { BUILTIN_ENEMY_PRESETS, DEFAULT_ENEMY_PRESET } from '../data/enemy-presets.js';
import { getActiveSkillCooldownSec } from '../data/active-skill-cooldowns.js';
import { SIM_HISTORY_MAX, buildHistoryRecord, addHistoryRecord, mergeHistory, loadHistory, saveHistory } from './sim-history.js';
import ZH_GAME_TERMS from './locales/zh-game-terms.js';
import { ELEMENT_ORDER, CLASS_ORDER, CORP_ORDER, elementIcon, weaponIcon, classIcon, corpIcon, burstIcon } from './icons.js';

// ─── 开发模式 trace 上报 ────────────────────────────────────────────────────
// 仅在 localhost 且 trace-server.mjs 运行时生效；服务器未启动时静默忽略。

const _DEV = typeof location !== 'undefined' && location.hostname === 'localhost';
const _TRACE_URL = 'http://127.0.0.1:7474/trace';

function _postTrace(config, hitLog, battleLog, result) {
  if (!_DEV) return;
  const payload = JSON.stringify({ config, hitLog, battleLog, result });
  fetch(_TRACE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  }).catch(() => {}); // 服务器未启动时静默失败
}

// ─── 常量 ──────────────────────────────────────────────────────────────────

// 战斗日志每页行数。每行约 30–60 个 DOM 节点及同量 Alpine 绑定，全量渲染数千行会占用数百 MB。
const LOG_PAGE_SIZE = 200;

const STORAGE_KEY        = 'nikke-sim-v1';
const ENEMY_PRESETS_KEY  = 'nikke-enemy-presets-v1';

const EQUIP_SLOTS = ['head', 'torso', 'arms', 'legs'];

// 百暴：可与 Miranda（32）S2 P3 配合、在自己轮次全爆裂期间停止普攻依靠技能输出的角色
// Mihara: Bonding Chain（162）/ Ein（391）。
// Nayuta（223）爆裂换枪为无限弹，射击本就不消耗回合制 buff，无需停火，不列入。
const MIRANDA_ID         = 32;
const FULL_CRIT_CHAR_IDS = [162, 391];

// vals 以整数厘百分比存储（954 表示 9.54%），与 account-loader._OPTION_GROUPS 保持一致
// 显示名由 i18n 词典 equipOpt.<key> 提供
export const EQUIP_OPTION_TYPES = [
  { key: '',               unit: '',  vals: [] },
  { key: 'elementDmgPct',  unit: '%', vals: [954,1094,1234,1375,1515,1655,1795,1935,2075,2215,2356,2496,2636,2776,2916] },
  { key: 'hitRatePct',     unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { key: 'equipMaxAmmoPct', unit: '%', vals: [2784,3195,3606,4017,4428,4839,5250,5660,6071,6482,6893,7304,7715,8126,8537] },
  { key: 'atkPct',         unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { key: 'chargeDmgPct',   unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { key: 'chargeSpeedPct', unit: '%', vals: [198,228,257,286,316,345,375,404,433,463,492,521,551,580,609] },
  { key: 'critRatePct',    unit: '%', vals: [230,264,298,332,366,400,435,469,503,537,570,605,639,673,707] },
  { key: 'critDamagePct',  unit: '%', vals: [664,762,860,958,1056,1154,1252,1350,1448,1546,1644,1742,1840,1938,2036] },
  { key: 'defFlat',        unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
];

// R / SR 指挥官娃娃；显示名由 favItemLabel() 按界面语言生成
const FAV_ITEMS_RS = [
  { id: 100101, weapon: 'AR',  rare: 'R'  },
  { id: 100102, weapon: 'AR',  rare: 'SR' },
  { id: 100201, weapon: 'MG',  rare: 'R'  },
  { id: 100202, weapon: 'MG',  rare: 'SR' },
  { id: 100301, weapon: 'RL',  rare: 'R'  },
  { id: 100302, weapon: 'RL',  rare: 'SR' },
  { id: 100401, weapon: 'SG',  rare: 'R'  },
  { id: 100402, weapon: 'SG',  rare: 'SR' },
  { id: 100501, weapon: 'SMG', rare: 'R'  },
  { id: 100502, weapon: 'SMG', rare: 'SR' },
  { id: 100601, weapon: 'SR',  rare: 'R'  },
  { id: 100602, weapon: 'SR',  rare: 'SR' },
];

// 日志「普通攻击」行的内部标签（筛选与 tooltip 依赖此值，显示时经 dispText 翻译）
const NORMAL_ATTACK_LABEL = '普通攻击';

// SSR 珍藏品：角色 resourceId → SSR 珍藏品 resourceId
// 通过读取本地 favorites/*.json 的 name_code 与 characters.json 对照得出
// 规则：此表中的角色技能仅建模 SSR 版本，模拟时必须持有对应满级（Lv15）SSR 珍藏品。
// 详见 docs/ssr-collectible-rules.md
const SSR_FAV_BY_CHAR = {
   32: 200601, // Miranda   → Sheet of Paper
   80: 201601, // Centi     → Metal Pendant
  101: 200801, // Drake     → Villain Figurine
  140: 202101, // Sugar     → Commemorative Keychain
  142: 200301, // Frima     → Beloved Pillow
  170: 201401, // Privaty   → Central Government Special Medal
  192: 201101, // Tove      → Fire Starter
  210: 200201, // Exia      → Gamekid Evolution
  280: 202001, // Rosanna   → Signet Ring
  281: 201701, // Moran     → Peony Hairpin
  352: 200701, // Helm      → Antique Compass
  390: 201501, // Zwei      → Four-Leaf Clover Bookmark
  411: 201901, // Flora     → Planter We Made Together
  580: 201801, // Phantom   → Precious Masks
};

// SSR 珍藏品满级对应的 favLevel 档位（0=Lv5 / 1=Lv10 / 2=Lv15）
const SSR_FAV_MAX_ITEM_LEVEL = 2;

const DEFAULT_FAV_SR = { AR: 100102, MG: 100202, RL: 100302, SG: 100402, SMG: 100502, SR: 100602 };

// ─── 状态工厂 ──────────────────────────────────────────────────────────────

function maxBond(grade, corporation) {
  if (grade === 0) return 10;
  if (grade === 1) return 20;
  if (grade === 2) return 30;
  return corporation === 'PILGRIM' ? 40 : 30;
}

function defaultEquip(classReq = 'Attacker') {
  return {
    classReq,
    tier: 'T10',
    level: 0,
    opts: [
      { type: '', value: 0 },
      { type: '', value: 0 },
      { type: '', value: 0 },
    ],
  };
}

function defaultSlot(active = false) {
  return {
    active,
    resourceId:   null,
    name:         '',
    classType:    'Attacker',
    corporation:  'ELYSION',
    element:      'Fire',
    weaponType:   'AR',
    burstStep:    'Step3',
    grade:        0,
    core:         0,
    bondLevel:    10,
    skills:       [10, 10, 10],
    cube:         { resourceId: null, level: 15 },
    favoriteItem: { resourceId: null, level: 15 },
    equipment: {
      head:  defaultEquip(),
      torso: defaultEquip(),
      arms:  defaultEquip(),
      legs:  defaultEquip(),
    },
    _nikkeData: null,
    _cubeData:  null,
    _favData:   null,
    // 简体中文显示用副本（英文数据叠加 zh-CN 文本补丁；仅供界面显示，引擎不使用）
    _nikkeDataZh: null,
    _cubeDataZh:  null,
    _favDataZh:   null,
    _loading:   false,
  };
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

// opt.value 以整数厘百分比存储（954 表示 9.54%），传引擎前除以 10000 得小数
const _PCT_OPT_KEYS = new Set([
  'elementDmgPct', 'hitRatePct', 'equipMaxAmmoPct', 'atkPct',
  'chargeDmgPct', 'chargeSpeedPct', 'critRatePct', 'critDamagePct', 'defFlat',
]);

function aggregateEquipOptions(equipment) {
  const result = {};
  for (const key of EQUIP_SLOTS) {
    const equip = equipment?.[key];
    if (!equip) continue;
    // T9 / T9企业装备没有词条：保留已填词条数据，但不计入（切回 T10 时恢复）
    if (!equipTierHasOptions(equip.tier)) continue;
    for (const opt of equip.opts) {
      if (!opt.type) continue;
      const v = Number(opt.value) || 0;
      if (!v) continue;
      // 整数厘百分比求和后除以 10000 → 引擎所需小数（0.0954）
      const normalized = _PCT_OPT_KEYS.has(opt.type) ? v / 10000 : v;
      result[opt.type] = (result[opt.type] ?? 0) + normalized;
    }
  }
  return result;
}

export function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

export function fmtStat(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString();
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(2) + '%';
}

// 30 种预置轨道颜色，超出后循环使用
const BUFF_TRACK_COLORS = [
  '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
  '#1abc9c','#e67e22','#16a085','#8e44ad','#2980b9',
  '#27ae60','#d35400','#c0392b','#f1c40f','#7f8c8d',
  '#e91e63','#00bcd4','#8bc34a','#ff5722','#607d8b',
  '#673ab7','#009688','#ff9800','#795548','#03a9f4',
  '#4caf50','#ff4444','#2196f3','#ffeb3b','#9c27b0',
];

function fmtTime(sec) {
  if (!sec && sec !== 0) return '—';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return m > 0 ? `${m}:${s.padStart(4, '0')}` : `${sec.toFixed(1)}s`;
}

// ─── 技能 tooltip 辅助 ───────────────────────────────────────────────────────

const CHARGE_WEAPONS = new Set(['SR', 'RL', 'Charged']);

function _normalAttackTipHTML(unitData) {
  const sd = unitData.nd?.shot_detail;
  if (!sd) return null;
  const wt = unitData.weaponType ?? '?';
  const dmgPct  = sd.damage != null ? (sd.damage / 100).toFixed(2) + '%' : '?';
  const corePct = sd.core_damage_rate != null ? '+' + ((sd.core_damage_rate / 10000 - 1) * 100).toFixed(0) + '%' : '?';
  const rows = [
    `<tr><td>${t('tip.weaponType')}</td><td>${wt}</td></tr>`,
    `<tr><td>${t('tip.weaponDamage')}</td><td>${dmgPct}</td></tr>`,
  ];
  if (CHARGE_WEAPONS.has(wt) && sd.full_charge_damage != null) {
    const chargePct = (sd.full_charge_damage / 100).toFixed(2) + '%';
    rows.push(`<tr><td>${t('tip.fullCharge')}</td><td>${chargePct}</td></tr>`);
  }
  rows.push(`<tr><td>${t('tip.coreHit')}</td><td>${corePct}</td></tr>`);
  return `<div class="skill-tip-title">${t('tip.normalAttack')}</div><table class="skill-tip-table">${rows.join('')}</table>`;
}

// 根据行数据找到对应技能（skill 对象 + level + 槽位键 key，key 供切换到中文显示副本）
// 对 burst_i/burst_ii/full_burst 事件直接取 rawBurst；
// 对 skill_trigger 和技能伤害行则按 label 匹配三个技能槽（label 为英文技能名）。
function _findSkillByRow(row, unitData) {
  if (!unitData) return null;
  // Burst 事件 → burst 技能；isCA 决定高亮哪一段：true=Part0(Stage1)，false=Part1(Stage3)
  if (row.eventType === 'burst_i' || row.eventType === 'burst_ii' || row.eventType === 'burst_iii' || row.eventType === 'full_burst') {
    const partIdx = row.isCA === true ? 0 : row.isCA === false ? 1 : null;
    return { skill: unitData.rawBurst, key: 'rawBurst', level: unitData.skillLevels[2] ?? 10, partIdx };
  }
  // 剥离 " P1" " P2" 等后缀，以及 " Stage N" 中间标记（如 "Impermanence Stage 1 P2"）再匹配
  const base = row.label.replace(/ P\d+$/, '').replace(/ Stage \d+$/, '');
  // 从 label 推断所属技能槽：S1_xxx / S2_xxx / Burst_xxx 前缀，或 xxx_s2_yyy 形式（如 velvet_s2_bonusHit）
  const tier = (base === 'S1' || base.startsWith('S1_')) ? 'S1'
             : (base === 'S2' || base.startsWith('S2_') || /_s2_/i.test(base)) ? 'S2'
             : (base === 'Burst' || base.startsWith('Burst_')) ? 'Burst'
             : null;
  const { rawSkill1, rawSkill2, rawBurst, skillLevels } = unitData;
  if (rawSkill1 && (tier === 'S1' || rawSkill1.name_localkey === base))
    return { skill: rawSkill1, key: 'rawSkill1', level: skillLevels[0] ?? 10 };
  if (rawSkill2 && (tier === 'S2' || rawSkill2.name_localkey === base))
    return { skill: rawSkill2, key: 'rawSkill2', level: skillLevels[1] ?? 10 };
  if (rawBurst  && (tier === 'Burst' || rawBurst.name_localkey  === base))
    return { skill: rawBurst,  key: 'rawBurst',  level: skillLevels[2] ?? 10 };
  return null;
}

/**
 * 把英文技能（tooltip 查找结果）换成当前界面语言的显示版本。
 * 中文描述的 ■ 段与英文一致（下载脚本已校验），但段内换行可能不同：
 * 行数不一致时放弃行高亮，只保留段高亮。
 * @returns {{ skill: object, lineIdx: number|null }}
 */
function _localizeFoundSkill(found, unitData, lang, partIdx, lineIdx) {
  const zhSkill = lang === 'zh' ? unitData?.zh?.[found.key] : null;
  if (!zhSkill) return { skill: found.skill, lineIdx };
  const sameLines = lineIdx == null
    || _countLinesInPart(zhSkill, partIdx) === _countLinesInPart(found.skill, partIdx);
  return { skill: zhSkill, lineIdx: sameLines ? lineIdx : null };
}

// 推断日志行所属技能位置：1=S1, 2=S2, 3=Burst, 99=未知
// 优先用事件行的结构化 slot，其次解析 "S1 …"/"Burst …" 前缀，
// 最后把纯技能名（去掉 P/L/Stage 后缀）与角色的技能名比对。
const SKILL_POS = { s1: 1, s2: 2, burst: 3 };
function _skillPosOfRow(row, unitData) {
  const key = row.skillKey ?? row.label ?? '';
  const slotName = row.slot ?? key.match(/^(S1|S2|Burst)\b/i)?.[1];
  if (slotName) return SKILL_POS[slotName.toLowerCase()] ?? 99;
  if (!unitData) return 99;
  const base = key.replace(/(?: (?:P|L)\d+| Stage \d+)+$/, '');
  if (unitData.rawSkill1?.name_localkey === base) return 1;
  if (unitData.rawSkill2?.name_localkey === base) return 2;
  if (unitData.rawBurst?.name_localkey  === base) return 3;
  return 99;
}

// 按排序键数组逐项比较 [名称, 键数组] 条目，键全相等时按名称字典序
function _compareSortEntries([na, ka], [nb, kb]) {
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return na.localeCompare(nb);
}

function _skillDescTipHTML(skill, level, renderFn, partIdx = null, lineIdx = null) {
  if (!skill) return null;
  const name = skill.name_localkey ?? '';
  const rawDesc = skill.description_localkey ?? '';
  const valueList = skill.description_value_list ?? [];
  const lv = level ?? 10;

  const nameHtml = name ? `<div class="skill-tip-name">${name}</div>` : '';

  // 按 ■ 分割各段，逐段渲染并高亮 partIdx 对应段
  const startsWithBlock = rawDesc.trimStart().startsWith('■');
  const rawParts = rawDesc.split('■').filter(s => s.trim() !== '');
  if (partIdx !== null && rawParts.length > 1) {
    // 描述不以 ■ 开头时，index 0 是无 ■ 的标题段，■ 段从 index 1 起；partIdx 基于 ■ 段计数，需 +1 对齐
    const highlightIdx = startsWithBlock ? partIdx : partIdx + 1;
    const parts = rawParts.map((raw, i) => {
      // 第 0 段只有在原文以 ■ 开头时才补 ■，否则该段本身无 ■ 前缀
      const prefix = (startsWithBlock || i > 0) ? '■' : '';
      const isActivePart = i === highlightIdx;
      let content;
      if (isActivePart && lineIdx !== null) {
        // 先整体渲染（保证 <color> 跨行标签正确处理），再按 <br> 切行包裹高亮
        const fullRendered = renderFn(prefix + raw, valueList, lv);
        const renderedLines = fullRendered.split('<br>');
        content = renderedLines.map((rl, li) =>
          li === lineIdx ? `<span class="skill-tip-line--active">${rl}</span>` : rl
        ).join('<br>');
      } else {
        content = renderFn(prefix + raw, valueList, lv);
      }
      const cls = isActivePart ? 'skill-tip-part skill-tip-part--active' : 'skill-tip-part';
      return `<div class="${cls}">${content}</div>`;
    });
    const descHtml = `<div class="skill-tip-desc">${parts.join('')}</div>`;
    return nameHtml + descHtml;
  }

  // 单段描述（无 ■ 分隔符）但指定了 lineIdx：仅做行高亮，不做段高亮
  if (lineIdx !== null && rawParts.length > 0) {
    const raw = rawParts[0];
    const prefix = startsWithBlock ? '■' : '';
    const fullRendered = renderFn(prefix + raw, valueList, lv);
    const renderedLines = fullRendered.split('<br>');
    const content = renderedLines.map((rl, li) =>
      li === lineIdx ? `<span class="skill-tip-line--active">${rl}</span>` : rl
    ).join('<br>');
    const descHtml = `<div class="skill-tip-desc">${content}</div>`;
    return nameHtml + descHtml;
  }

  // 无 P 后缀或描述无分隔符：整块渲染
  const desc = renderFn(rawDesc, valueList, lv);
  if (!desc && !name) return null;
  const descHtml = desc ? `<div class="skill-tip-desc">${desc}</div>` : '';
  return nameHtml + descHtml;
}

function _buffFallbackTipHTML(buff, displayName) {
  const rows = [];
  if (buff.atkPct)          rows.push(`<tr><td>ATK ▲</td><td>+${(buff.atkPct * 100).toFixed(1)}%</td></tr>`);
  if (buff.atkFlat)         rows.push(`<tr><td>ATK ▲</td><td>+${buff.atkFlat}</td></tr>`);
  if (buff.attackDamagePct) rows.push(`<tr><td>${t('tip.damageUp')}</td><td>+${(buff.attackDamagePct * 100).toFixed(1)}%</td></tr>`);
  if (buff.damageTakenPct)  rows.push(`<tr><td>${t('tip.damageTakenUp')}</td><td>+${(buff.damageTakenPct * 100).toFixed(1)}%</td></tr>`);
  if (buff.stacks > 1)      rows.push(`<tr><td>${t('tip.stacks')}</td><td>${buff.stacks}</td></tr>`);
  if (!rows.length) return null;
  return `<div class="skill-tip-name">${displayName}</div><table class="skill-tip-table">${rows.join('')}</table>`;
}

// ─── 战斗日志聚合 ─────────────────────────────────────────────────────────────

const TICK_RATE = 60;

function formatTick(tick) {
  const t  = tick / TICK_RATE;
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String((t % 60).toFixed(2)).padStart(5, '0');
  return `${mm}:${ss}`;
}

// 旧核心状态值迁移：「穿透双判核心」已并入「零件核心」；「命中零件」已移除（原本即无核心）
const LEGACY_CORE_VALUES = { PIERCE_DUAL: 'PARTS_CORE', PARTS: 'NONE' };

/** 迁移已保存的核心行动值（返回新对象，非核心行动原样复制）。 */
function migrateCoreAction(a) {
  return a.type === 'core' && a.value in LEGACY_CORE_VALUES
    ? { ...a, value: LEGACY_CORE_VALUES[a.value] }
    : { ...a };
}

// 旧距离标签 NEAR/MID/FAR → 连续距离数字
const LEGACY_ZONE_DISTANCE = { NEAR: 20, MID: 35, FAR: 55 };
const DEFAULT_ENEMY_DISTANCE = 35;
// 固定初始行数量（DEF / 核心 / 距离，时间恒为 0）
const FIXED_ENEMY_ACTION_COUNT = 3;

/** 迁移单条距离行动：旧标签转数字；旧「距离=HIDDEN」转为独立的 hidden 类型。 */
function migratePositionAction(a) {
  if (a.value === 'HIDDEN') return { ...a, type: 'hidden', value: 'HIDDEN' };
  return a.value in LEGACY_ZONE_DISTANCE ? { ...a, value: LEGACY_ZONE_DISTANCE[a.value] } : { ...a };
}

/**
 * 迁移已保存的敌人行动列表（返回新数组）。
 * 固定初始行的类型不可更改，若旧数据里初始距离行为 HIDDEN，
 * 则初始行恢复为默认距离，并在 0 秒追加一条「隐藏」行动以保持原有行为。
 * @param {{ id?: number, startTimeS: number, type: string, value: * }[]} actions
 */
function migrateEnemyActions(actions) {
  const migrated = actions.map(a => (a.type === 'position' ? migratePositionAction(a) : migrateCoreAction(a)));
  const maxId = migrated.reduce((m, a) => Math.max(m, a.id ?? 0), 0);
  const fixed = migrated.slice(0, FIXED_ENEMY_ACTION_COUNT);
  const displaced = fixed
    .filter(a => a.type === 'hidden')
    .map((a, i) => ({ ...a, id: maxId + 1 + i }));
  const restoredFixed = fixed.map(a =>
    (a.type === 'hidden' ? { ...a, type: 'position', value: DEFAULT_ENEMY_DISTANCE } : a));
  return [...restoredFixed, ...displaced, ...migrated.slice(FIXED_ENEMY_ACTION_COUNT)];
}

/**
 * 敌人配置签名（预设去重用）：元素 + 类型 + 行动列表。命中参数属于模拟选项，不参与。
 * @param {{ element: string, type: string, actions: { startTimeS: number, type: string, value: * }[] }} cfg
 */
function enemyConfigSignature(cfg) {
  const actions = (cfg?.actions ?? [])
    .map(({ startTimeS, type, value, endTimeS }) =>
      `${startTimeS}|${type}|${value}` + (endTimeS != null ? `|${endTimeS}` : ''))
    .join(',');
  return `${cfg?.element}:${cfg?.type}:${actions}`;
}

/** 由内置预设生成新的敌人状态（行动带连续 id）。 */
function enemyFromPreset(preset) {
  const actions = preset.config.actions.map((a, i) => ({ ...a, id: i + 1 }));
  return {
    element:  preset.config.element,
    type:     preset.config.type,
    actions,
    _nextId:  actions.length + 1,
  };
}

/**
 * 命中参数默认值（模拟选项 hitCal）。
 * sgHitRate = 0.7：敌人距离 50 处的实战弹丸命中率（SG 与 Brid 弹丸实测 NEAR 92% / MID 77% / FAR 67%，
 * 见 dev/game-data.md）。引擎层默认仍为 1（理想命中，回归测试不传此参数），界面每次模拟都显式传入。
 * RL 核心命中按敌人「横向移动」行动与弹道飞行时间建模，不再有校正系数。
 */
const HIT_CAL_DEFAULTS = { core0: 55, d0: 77, hitCoef: 4.5, sgHitRate: 0.7 };
/** Anis: Star 的 Shooting Stars 核心命中率修正系数默认值（乘以敌人移动时的基准核心命中率 0.7）。 */
const STAR_CORE_COEF_DEFAULT = 1;

/**
 * 从存档恢复命中参数：新存档读顶层 hitCal；旧存档（命中参数曾存于 enemy 内）自动迁移。
 * @param {object} state  存档快照
 * @returns {object} 完整的 hitCal
 */
function restoreHitCal(state) {
  const src = state.hitCal ?? state.enemy ?? {};
  return Object.fromEntries(Object.entries(HIT_CAL_DEFAULTS)
    .map(([k, v]) => [k, Number.isFinite(src[k]) ? src[k] : v]));
}

/** 流星核心命中率修正系数：非负数；非数值（空输入等）回退为 1。核心命中率最终在引擎中夹到 ≤ 1。 */
function clampCoef(v) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null ? Math.max(0, n) : STAR_CORE_COEF_DEFAULT;
}

/** 命中校正系数夹到 [0, 1]；非数值（空输入等）回退为默认值。 */
function clampRate(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null ? Math.min(1, Math.max(0, n)) : fallback;
}

// 敌人位置事件的显示值：隐藏 / 连续距离 / 旧版 NEAR·MID·FAR 标签
function _zoneDesc(zone) {
  if (zone === 'HIDDEN') return t('ev.hidden');
  if (zone === 'JUMP')   return t('ev.jump');
  if (typeof zone === 'number') return t('ev.distance', { n: zone });
  return ['NEAR', 'MID', 'FAR'].includes(zone) ? t(`ev.zone.${zone}`) : zone;
}

// 敌人核心状态的显示值（零件核心用短名）
function _coreDesc(value) {
  if (value === 'PARTS_CORE') return t('enemy.core.PARTS_CORE.short');
  return ['EXPOSED', 'PROTECTED', 'NONE'].includes(value) ? t(`enemy.core.${value}`) : value;
}

// { name, label, desc } 分别对应 角色列、技能列、事件描述列
// 描述在构建日志行时按当前界面语言生成；切换语言时 store.setLang 会重建日志行
const BATTLE_EVENT_COLS = {
  burst_i:      e => ({ name: e.unitName ?? '', label: 'Burst',  desc: 'Burst I' }),
  burst_ii:     e => ({ name: e.unitName ?? '', label: 'Burst',  desc: 'Burst II' }),
  burst_iii:    e => ({ name: e.unitName ?? '', label: 'Burst',  desc: 'Burst III' }),
  full_burst:   e => ({ name: '',              label: 'Burst',  desc: e.burstNum != null ? `Full Burst #${e.burstNum}` : 'Full Burst' }),
  burst_end:    () => ({ name: '',               label: '',       desc: t('ev.fbEnd') }),
  burst_timeout:() => ({ name: '',               label: '',       desc: t('ev.fbTimeout') }),
  reload:       e => ({ name: e.unitName ?? '', label: '',       desc: t('ev.reload') }),
  phase_change:       e => ({ name: '',              label: t('ev.enemyAction'), desc: t('ev.position', { v: _zoneDesc(e.zone) }) }),
  enemy_action:       e => {
    const desc = e.actionType === 'def'
      ? t('ev.def', { v: e.value })
      : t('ev.core', { v: _coreDesc(e.value) });
    return { name: '', label: t('ev.enemyAction'), desc };
  },
  reload_interrupted: e => ({ name: e.unitName ?? '', label: t('ev.reloadInterrupted'), desc: t('ev.enemyAppeared') }),
};

const TRIGGER_DESC = {
  BATTLE_START:     '战斗开始',
  ENTER_FULL_BURST: '全爆裂',
  FULL_BURST_END:   '爆裂结束',
  INTERVAL:         '定时',
  INTERVAL_IN_BURST:'爆裂定时',
  RELOAD_END:       '装填结束',
  LAST_BULLET:      '末弹',
  FULL_CHARGE:      '全蓄力',
  HEAL_RECEIVED:    '治疗',
  BURST_SKILL_USE:  '爆裂技能',
};

function formatHitLabel(label) {
  if (label === 'normal_shot') return NORMAL_ATTACK_LABEL;
  // "S2 P2 Projectile Attachment" → "Projectile Attachment"（原始 label 保留在 skillKey 供 tooltip 使用）
  const subMatch = label.match(/^(?:S\d+|Burst)(?: P\d+)? (.+)$/);
  // 捕获组为纯 L 行号（如 "S2 P4 L3"→"L3"）时保留完整标签，避免丢失段号信息
  if (subMatch && !/^L\d+$/.test(subMatch[1])) return subMatch[1];
  return label;
}

// 同 tick 内的行排序优先级：burst_i/ii/iii(0) → BURST_SKILL_USE 技能触发(1) → full_burst(2)
// → ENTER_FULL_BURST 技能触发(3) → 其他事件(4) → 聚合命中行(5) → 射击触发效果(6)
function _logRowOrder(row) {
  if (row.kind !== 'event') return 5;
  switch (row.eventType) {
    case 'burst_i':
    case 'burst_ii':
    case 'burst_iii':  return 0;
    case 'full_burst': return 2;
    default:
      if (row.trigger === 'BURST_SKILL_USE')   return 1;
      if (row.trigger === 'ENTER_FULL_BURST')  return 3;
      // 射击触发的效果（伤害命中后引发），应排在伤害行之后
      if (row.trigger === 'SHOT_COUNT'       ||
          row.trigger === 'FULL_CHARGE'      ||
          row.trigger === 'LAST_BULLET'      ||
          row.trigger === 'SQUAD_SHOT_COUNT' ||
          row.trigger === 'AMMO_MILESTONE')   return 6;
      return 4;
  }
}

// 根据事件的 slot 字段从 squadLookup 取出对应技能对象
function _getSkillForEvent(e, squadLookup) {
  if (!squadLookup || !e.unitName || !e.slot) return null;
  const ud = squadLookup[e.unitName];
  if (!ud) return null;
  if (e.slot === 'S1') return ud.rawSkill1;
  if (e.slot === 'S2') return ud.rawSkill2;
  if (e.slot === 'Burst') return ud.rawBurst;
  return null;
}

// 统计技能描述中的 ■ 分段数（决定技能有几个"P"段）
function _countSkillParts(skill) {
  const desc = skill?.description_localkey ?? '';
  const parts = desc.split('■').filter(s => s.trim() !== '');
  return parts.length || 1;
}

// 统计指定 P 段内的行数（按 \n 计，决定是否省略 L 后缀）
function _countLinesInPart(skill, partIdx) {
  const desc = skill?.description_localkey ?? '';
  const parts = desc.split('■').filter(s => s.trim() !== '');
  if (!parts.length) return 1;
  const startsWithBlock = desc.trimStart().startsWith('■');
  let raw;
  if (partIdx == null) {
    raw = parts[0];
  } else {
    const rawIdx = startsWithBlock ? partIdx : partIdx + 1;
    raw = parts[rawIdx] ?? parts[0];
  }
  return Math.max(1, (raw ?? '').split('\n').filter(s => s.trim() !== '').length);
}

function buildEventRows(eventLog, squadLookup = null, logMode = 'detail') {
  if (!eventLog?.length) return [];
  const raw = eventLog.map(e => {
    // burst_i with no caster = 队伍无 B1 单位时的跳过占位事件，不显示
    if (e.type === 'burst_i' && !e.unitName) return null;
    let name = '', label = '', target = '';
    if (e.type === 'skill_trigger') {
      const skill = _getSkillForEvent(e, squadLookup);
      // 技能仅有唯一 P 段时省略 P 后缀
      let part = '';
      if (e.partIdx != null && _countSkillParts(skill) > 1) {
        part = ` P${e.partIdx + 1}`;
      }
      // 该 P 段内行数 ≤ 2 时省略 L 后缀
      let ln = '';
      if (e.lineIdx != null && _countLinesInPart(skill, e.partIdx) > 2) {
        ln = ` L${e.lineIdx + 1}`;
      }
      name   = e.unitName;
      // 格式：技能名 P4 L2（不含槽位，与 buff 名一致）
      label = `${e.skillLabel}${part}${ln}`;
      target = e.target ?? '';
    } else {
      const fn = BATTLE_EVENT_COLS[e.type];
      const r  = fn ? fn(e) : { name: '', label: e.type, desc: '' };
      name  = r.name;
      label = r.desc || r.label;   // 事件描述放进技能列
    }
    return {
      tickStart:  e.tick,
      tickEnd:    e.tick,
      _endTick:   e.endTick ?? null,  // buff 到期 tick，仅 skill_trigger+buffName 有效
      kind:       'event',
      eventType:  e.type,
      trigger:    e.trigger ?? null,
      isDamage:   e.isDamage ?? false,
      name,
      label,
      // skillKey 存原始 skillLabel（不含 P/L），供 tooltip 查找技能用
      skillKey:   e.skillLabel ?? null,
      // 结构化数据，供 tooltip 直接使用，无需从 label 字符串重新解析
      partIdx:    e.partIdx ?? null,
      lineIdx:    e.lineIdx ?? null,
      slot:       e.slot ?? null,   // 'S1' / 'S2' / 'Burst'，供技能筛选菜单排序
      target,
      buffName:   e.buffName ?? null,
      buffDesc:   e.buffName ?? '',
      buffArr:    e.buffName && e.unitName
        ? [{ name: e.buffName, sourceCaster: e.unitName, sourceSkillLabel: e.skillLabel ?? null, sourcePartIdx: e.partIdx ?? null, sourceLineIdx: e.lineIdx ?? null }]
        : [],
      damage:     null,
      count:      1,
      isCrit:     false,
      isCA:       e.isCA,  // 透传 Combat Assist 标志（用于 tooltip partIdx 定位）
      gauge:      e.gaugeAfter ?? null,
      _seq:       e._seq ?? null,
    };
  }).filter(Boolean);

  if (logMode !== 'aggregate') return raw;

  // 聚合模式：同名+同目标的 buff 在持续时间内刷新时合并为一条
  const out = [];
  // key: `${buffName}|${target}` → 当前开放的合并组
  const open = new Map();

  for (const row of raw) {
    if (row.eventType !== 'skill_trigger' || !row.buffName) {
      out.push(row);
      continue;
    }
    const key = `${row.buffName}|${row.target}`;
    const grp = open.get(key);
    if (grp && row.tickStart <= grp._endTick) {
      // 在持续时间内刷新：合并到现有组
      grp.tickEnd  = row.tickStart;
      grp._endTick = row._endTick ?? grp._endTick;
      grp.count++;
    } else {
      // buff 已过期或首次出现：关闭旧组，开新组
      if (grp) out.push(grp);
      open.set(key, { ...row });
    }
  }
  for (const grp of open.values()) out.push(grp);
  return out.sort((a, b) => a.tickStart - b.tickStart || (a._seq ?? Infinity) - (b._seq ?? Infinity));
}

function buildAggregateLog(hitLog, unitNames) {
  if (!hitLog?.length) return [];
  const rows = [];
  // 每个 unitId+label 独立维护开放段，互不干扰
  const open = new Map();

  for (const h of hitLog) {
    const name = unitNames[h.unitId] ?? String(h.unitId);
    const bufKey = [
      h.atkPct  ?? 0,
      h.atkFlat ?? 0,
      h.extraAtkFlat ?? 0,
      h.attackDamagePct ?? 0,
      h.hitMult ?? 1,
      h.distanceAdv ? 1 : 0,
      h.elemMult  ?? 1,
      h.chargeMult ?? 1,
      h.favNormalAttackDamageMult ?? 1,
      h.critDmgInc ?? 0,
      h.missed ? 1 : 0,   // 落空（未命中）与正常命中分行
    ].map(v => (typeof v === 'number' ? v.toFixed(6) : v)).join('|');

    const key = `${h.unitId}|${h.label}`;
    const cur  = open.get(key);

    if (cur && cur.bufKey === bufKey) {
      cur.damage += h.damage;
      cur.count++;
      cur.tickEnd = h.tick;
    } else {
      if (cur) rows.push(cur);
      open.set(key, {
        tickStart: h.tick,
        tickEnd:   h.tick,
        unitId:    h.unitId,
        name,
        label:     formatHitLabel(h.label),
        skillKey:  h.label,
        target:    '敌人',
        bufKey,
        buffDesc:  (h.buffBreakdown ?? []).map(b => b.name).join(' / ') || '—',
        buffArr:   h.buffBreakdown ?? [],
        damage:    h.damage,
        count:     1,
        isCrit:    h.isCrit,
        missed:    !!h.missed,
        _seq:      h._seq ?? null,
      });
    }
  }
  for (const cur of open.values()) rows.push(cur);
  return rows.sort((a, b) => a.tickStart - b.tickStart);
}

function buildDetailLog(hitLog, unitNames) {
  if (!hitLog?.length) return [];
  return hitLog.map(h => ({
    tickStart:  h.tick,
    tickEnd:    h.tick,
    unitId:     h.unitId,
    name:       unitNames[h.unitId] ?? String(h.unitId),
    label:      formatHitLabel(h.label),
    skillKey:   h.label,
    target:     '敌人',
    bufKey:     '',
    buffDesc:   (h.buffBreakdown ?? []).map(b => b.name).join(' / ') || '—',
    buffArr:    h.buffBreakdown ?? [],
    damage:     h.damage,
    count:      1,
    isCrit:     h.isCrit,
    missed:     !!h.missed,
    isCore:     h.isCore,
    distanceAdv: h.distanceAdv,
    ammoLeft:   h.ammoLeft,
    maxAmmo:    h.maxAmmo,
    isFullBurst:h.isFullBurst,
    charge:     h.isUnlimitedAmmo ? '-' : (h.ammoLeft != null ? `${h.ammoLeft}/${h.maxAmmo}` : '—'),
    gauge:      h.gaugeAfter ?? null,
    _hit:       h,
    _seq:       h._seq ?? null,
  }));
}

// ─── 游戏文本显示翻译 ─────────────────────────────────────────────────────────

// 战斗日志「英文 → 简体」名称表（角色名、技能名、具名效果），每次模拟后重建。
// 放在模块级而非 store 上：其内部的 memo Map 会在渲染时写入，放进响应式对象会引发无谓的重渲染。
let _logNameMap = null;

/** 收集一个技能详情的「英文名 → 简体名」 */
function _skillNamePair(en, zh) {
  return [en?.name_localkey, zh?.name_localkey];
}

/**
 * 从模拟时的队伍槽位构建日志名称表。
 * @param {object[]} slots  参与模拟的槽位（含英文数据与 *Zh 显示副本）
 * @param {Record<string, string>} zhCharNames  resource_id → 简体角色名
 */
function _buildLogNameMap(slots, zhCharNames) {
  // 人工译名（src/ui/locales/zh-game-terms.js）优先；未填写的空译名由 createNameMap 忽略
  const pairs = [...Object.entries(ZH_GAME_TERMS)];
  for (const slot of slots) {
    pairs.push([slot.name, zhCharNames[slot.resourceId]]);
    const nd = slot._nikkeData, nz = slot._nikkeDataZh;
    for (const k of ['skill1_detail', 'skill2_detail', 'ulti_skill_detail']) pairs.push(_skillNamePair(nd?.[k], nz?.[k]));
    pairs.push(...Object.entries(nz?._terms ?? {}));
    const fd = slot._favData, fz = slot._favDataZh;
    (fd?.collection_skill_group_data ?? []).forEach((s, i) => pairs.push(_skillNamePair(s, fz?.collection_skill_group_data?.[i])));
    (fd?.favoriteitem_skill_group_data ?? []).forEach((e, i) => pairs.push(_skillNamePair(e?.info, fz?.favoriteitem_skill_group_data?.[i]?.info)));
    pairs.push(...Object.entries(fz?._terms ?? {}));
    const cd = slot._cubeData, cz = slot._cubeDataZh;
    (cd?.harmonycube_skill_group ?? []).forEach((s, i) => pairs.push(_skillNamePair(s, cz?.harmonycube_skill_group?.[i])));
  }
  return createNameMap(pairs);
}

// ─── store 工厂 ────────────────────────────────────────────────────────────────

export function createStore() {
  const initialLang = loadSavedLang();
  setCurrentLang(initialLang);

  return {
    // 界面语言（'zh' | 'en'）；模板经 $t() / t() 读取，切换后自动重渲染
    lang:          initialLang,
    LANGS,
    // 简体名称表（角色 / 魔方 / 珍藏品），init 时加载
    zhNames:       { characters: {}, cubes: {}, favorites: {} },
    // 日志名称表版本号：_logNameMap 重建后递增，让依赖它的显示绑定重新求值
    _nameMapVersion: 0,

    // 加载状态
    loading:       true,
    loadProgress:  t('app.initializing'),
    // 顶栏账号状态：{ key, params }，显示时按当前语言翻译
    accountStatus: null,
    devMode:       false,

    // 全局设置
    synchroLevel:    200,
    generalResearch: 200,
    classResearch:   { attacker: 0, defender: 0, supporter: 0 },
    corpResearch:    { ELYSION: 0, MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0 },

    // 敌人
    // 行动阶段：前3条固定（时间=0，类型固定），后续可增删。默认为内置预设「射击场BIGARMS」。
    // position 值为连续距离（0-100，与 bonusrange 同刻度）；隐藏阶段用独立的 hidden 类型行动表示；
    // 横向移动（lateral）为 [startTimeS, endTimeS) 区间，value 为速度档（目前仅 SLOW）。
    enemy: enemyFromPreset(DEFAULT_ENEMY_PRESET),

    // 敌人配置预设
    enemyPresets:     [],
    selectedPresetId: null,

    // 敌人配置导入 / 导出弹窗：mode = null（关闭）/ 'export' / 'import'
    // message = { kind: 'warn' | 'error', text } 弹窗顶部提示；dragging = 正在拖入文件
    enemyIo: { mode: null, text: '', message: null, dragging: false },
    // 轻提示：{ id, text }，数秒后自动消失
    toast: null,

    // 模拟选项
    iterations:         5,
    // 命中参数（模拟选项）：
    //   core0 / d0 / hitCoef：核心命中率几何模型校准常量（实证默认；见 dev/game-data.md）
    //   sgHitRate：实战弹丸命中校正（0..1，1 = 理想命中，默认 0.7），为敌人距离 50 处的命中率，越近越高
    hitCal: { ...HIT_CAL_DEFAULTS },
    // Anis: Star 在队时显示：Shooting Stars 在敌人横向移动时的核心命中率修正系数（× 基准 0.7）
    starCoreCoef:       STAR_CORE_COEF_DEFAULT,
    burstStepSecs:      0.4,
    // 在敌人隐藏（跳起 / HIDDEN）时继续开爆裂：默认 false = 自动战斗实测行为，停火区段内不施放爆裂
    burstDuringHidden:  false,
    // 锁定等级：0 = 无限制（按同步器等级）；40 / 200 / 400 = 基础属性按该等级重算。
    // 仅替换等级表基础属性（突破 / 核心照常叠加），好感度、装备、魔方、珍藏品、研究等加成不变。
    levelLock:          0,
    LEVEL_LOCK_OPTIONS: [0, 40, 200, 400],
    ebsLastBurstOnly: true,
    mirLastBurstOnly: true,
    // Mast: Romantic Maid 爆裂轮次策略：auto / drunken3 / b3a / b3b（见 mastBurstOptions）
    mastBurstMode:    'auto',
    // Cinderella: Crystal Wave 手动打法：进入战斗时切换到 Snipe Mode（射击 1 发 → 主动装填 → 射击 1 发 → 主动装填）
    ccwSnipeModeAtStart: false,
    // 速充（Focus 的 UP 型 SR/RL 手动打法）：off / always（始终速充）/ untilFull（充能满后恢复全蓄力）
    quickChargeMode: 'off',
    // 百暴（Miranda 与 FULL_CRIT_CHAR_IDS 角色同队时显示）：使用百暴的角色 resource_id，0 = 关闭
    fullCritChar: 0,

    // 队伍
    activeSlot:   0,
    // Focus（受控）角色的队伍槽位下标（0–4），null = 无人受控（全员非Focus）。
    // 实机同时仅 1 个受控角色、可随时切换；模拟器简化为用户指定 1 个固定 Focus。
    // 仅影响蓄力武器（SR/RL）的充能：Focus 蓄力角色每发充能 × (full_charge_burst_energy/10000)。
    focusSlot:    null,
    team:         Array.from({ length: 5 }, (_, i) => defaultSlot(i === 0)),
    // 槽位拖拽换位：拖动中的源槽位下标 / 当前悬停的目标槽位下标（-1 = 无）
    dragFrom:     -1,
    dropTarget:   -1,

    // 角色选择器
    allChars:        [],
    charQuery:       '',
    charPickerSlot:  -1,
    // 角色选择器图标筛选：每组为已选值数组，空数组 = 该组不筛选；关闭弹窗后保留
    charFilters:     { burstStep: [], classType: [], corporation: [], weaponType: [], element: [] },

    // 结果
    result:        null,
    hitLogRows:    [],
    hitLogRaw:     null,
    battleLogRaw:  null,
    simRunning:    false,
    simProgress:   { done: 0, total: 0 },
    // 日志分页：一次只渲染一页，避免数千行 × 每行数十个 Alpine 绑定撑爆内存（详细模式单次可达 600MB）。
    logPage:       0,
    logMode:             'aggregate',
    logHiddenUnits:      [],
    logHiddenSkillLabels: [],
    logActiveBuffTracks: [],
    showLogNormal:       false,
    showLogReload:       false,
    _squadLookup:  null,

    // 模拟结果记录（最新在前，最多 SIM_HISTORY_MAX 条；只含队伍组成与各角色总伤害）
    simHistory:     [],
    simHistoryOpen: false,
    SIM_HISTORY_MAX,

    // 常量（模板使用）
    EQUIP_SLOTS,
    EQUIP_OPTION_TYPES,
    EQUIP_TIERS,
    equipHasOptions: equipTierHasOptions,
    cubeOptions: [],

    // ── 多语言 ──
    /** 按当前界面语言取文案（读取 this.lang，模板中调用时随语言切换重渲染） */
    t(key, params) { return translate(this.lang, key, params); },

    setLang(lang) {
      setCurrentLang(lang);
      this.lang = lang;
      // 事件描述在构建日志行时生成，切换语言后重建（保留筛选）
      if (this.result) this._rebuildLog(true);
    },

    get accountStatusText() {
      return this.accountStatus ? this.t(this.accountStatus.key, this.accountStatus.params) : '';
    },

    /** 角色显示名：中文界面优先简体名，缺失时回退英文 */
    charName(resourceId, fallback = '') {
      return (this.lang === 'zh' && this.zhNames.characters[resourceId]) || fallback;
    },

    slotName(slot) {
      return this.charName(slot?.resourceId, slot?.name ?? '');
    },

    cubeName(id) {
      return (this.lang === 'zh' && this.zhNames.cubes[id]) || CUBE_NAMES[id] || this.t('cube.fallback', { id });
    },

    favItemLabel(item) {
      if (item.rare === 'SSR') return this.t('fav.ssr');
      return `${this.t(item.rare === 'SR' ? 'fav.dollLtd' : 'fav.doll')} (${item.weapon}·${item.rare})`;
    },

    /**
     * 角色技能描述中的具名效果显示名（如 Mast 的 Drunken、Cinderella 的 Snipe Mode）。
     * 中文名优先取人工译名表 zh-game-terms.js，其次是下载脚本自动配对的 _terms，均缺失时回退英文。
     */
    effectName(resourceId, enName) {
      if (this.lang !== 'zh') return enName;
      const slot = this.team.find(s => s.resourceId === resourceId);
      return ZH_GAME_TERMS[enName] || slot?._nikkeDataZh?._terms?.[enName] || enName;
    },

    /** 战斗日志游戏文本（技能标签、Buff 名、角色名）的显示翻译 */
    dispText(text) {
      void this._nameMapVersion; // 建立响应式依赖：名称表重建后重新求值
      return displayGameText(text, this.lang, _logNameMap);
    },

    // ── 标签辅助 ──
    classLabel(c)   { return this.t(`class.${c}`); },
    corpLabel(c)    { return this.t(`corp.${c}`); },
    elementLabel(e) { return this.t(`element.${e}`); },
    burstLabel(b)   { return ({ Step1: 'B-I', Step2: 'B-II', Step3: 'B-III', AllStep: 'B-ALL' })[b] ?? b; },

    // ── 图标（src/ui/icons.js） ──
    ELEMENT_ORDER, CLASS_ORDER, CORP_ORDER,
    elementIcon, weaponIcon, classIcon, corpIcon,
    /** 槽位的花名册原始爆裂阶段：AllStep 在槽位里被映射为 Step3，图标需按原值显示 */
    slotBurstStep(slot) {
      return getCharacterByResourceId(slot.resourceId)?.burstStep === 'AllStep' ? 'AllStep' : slot.burstStep;
    },
    slotBurstIcon(slot) { return burstIcon(this.slotBurstStep(slot)); },
    /**
     * 武器图标悬停提示行（CDN shot_detail 基础值，不含装备 / 技能加成）。
     * 时间字段单位厘秒；damage / full_charge_damage / core_damage_rate 以 1/100 % 计。
     * 蓄力时间 / 全蓄力伤害仅蓄力武器（charge_time > 0）显示；双枪仅 muzzle_count === 2 显示。
     */
    weaponTipRows(slot) {
      const sd = slot?._nikkeData?.shot_detail;
      if (!sd) return [];
      const pct = v => (v / 100).toFixed(2).replace(/\.?0+$/, '') + '%';
      const sec = v => (v / 100).toFixed(2) + 's';
      const rows = [
        { label: this.t('tip.maxAmmo'),    value: String(sd.max_ammo ?? '—') },
        { label: this.t('tip.reloadTime'), value: sd.reload_time != null ? sec(sd.reload_time) : '—' },
        { label: this.t('tip.damageCoef'), value: sd.damage != null ? pct(sd.damage) : '—' },
      ];
      if (sd.charge_time > 0) {
        rows.push({ label: this.t('tip.chargeTime'), value: sec(sd.charge_time) });
        if (sd.full_charge_damage != null) rows.push({ label: this.t('tip.fullCharge'), value: pct(sd.full_charge_damage) });
      }
      rows.push({ label: this.t('tip.coreDamage'), value: sd.core_damage_rate != null ? pct(sd.core_damage_rate) : '—' });
      if (sd.muzzle_count === 2) rows.push({ label: this.t('tip.dualGun'), value: this.t('tip.dualGunVal') });
      // 命中目标充能：CDN 原值（与日志「充能」列同单位）；SG 为每发弹丸
      rows.push({
        label: this.t('tip.hitCharge'),
        value: sd.target_burst_energy_pershot != null ? fmtNum(sd.target_burst_energy_pershot) : '—',
      });
      // 蓄力充能系数：CDN full_charge_burst_energy（1/100 %），仅 > 0 时显示（引擎不使用该字段）
      if (sd.full_charge_burst_energy > 0) {
        rows.push({ label: this.t('tip.chargeBurstCoef'), value: pct(sd.full_charge_burst_energy) });
      }
      return rows;
    },
    /** 点击第 n 颗星（1..3）：未点亮 → 突破到 n；已点亮 → 退到 n-1（从 3 星点第 1 颗熄灭全部） */
    clickGradeStar(i, n) {
      const cur = this.team[i].grade ?? 0;
      this.setGrade(i, cur >= n ? n - 1 : n);
    },
    equipTypeOptions() {
      return EQUIP_OPTION_TYPES.map(ot =>
        `<option value="${ot.key}">${ot.key ? this.t(`equipOpt.${ot.key}`) : this.t('common.none')}</option>`
      ).join('');
    },
    equipValOptions(currentType) {
      const vals = EQUIP_OPTION_TYPES.find(t => t.key === currentType)?.vals ?? [];
      return vals.map(v =>
        `<option value="${v}">${(v / 100).toFixed(2)}%</option>`
      ).join('');
    },
    fmtNum,
    fmtStat,
    fmtPct,
    fmtTime,
    formatTick,
    // 充能列：展示该行事件产生的充能增量（带千分位分隔符）；无有效充能则留空
    fmtGaugeAdded(row) {
      return row.gaugeAdded != null ? fmtNum(row.gaugeAdded) : '';
    },

    formatLogTime(row) {
      const s = formatTick(row.tickStart);
      // buff 事件行：用 _endTick 作为范围终点（显示 buff 实际过期时刻）
      if (row.buffName && row._endTick != null) {
        if (row._endTick === Infinity) return s + '~∞';
        if (row._endTick > row.tickStart) return s + '~' + formatTick(row._endTick);
      }
      if (row.tickEnd > row.tickStart) return s + '~' + formatTick(row.tickEnd);
      return s;
    },

    // ── 计算辅助 ──
    get activeSlotData() { return this.team[this.activeSlot]; },

    // 队伍中 Burst 3 角色数量（StepFull 全阶段角色可充当 B3，一并计入）
    get burst3Count() {
      return this.team.filter(s =>
        s.active && (s.burstStep === 'Step3' || s.burstStep === 'StepFull')
      ).length;
    },

    // "最后一轮爆裂"策略选项显示条件：目标角色在队 且 队伍中有 3 名 Burst 3 角色
    // （少于 3 名 B3 时跳过该角色会导致爆裂循环缺口，策略无意义）
    _lastBurstOnlyAvailable(resourceId) {
      return this.team.some(s => s.active && s.resourceId === resourceId) &&
        this.burst3Count >= 3;
    },

    // Elegg: Boom and Shock / EBS（resource_id: 502）
    get hasEbsBoomAndShock() {
      return this._lastBurstOnlyAvailable(502);
    },

    // Maiden: Ice Rose（resource_id: 183）
    get hasMaidenIceRose() {
      return this._lastBurstOnlyAvailable(183);
    },

    // Mast: Romantic Maid（resource_id: 354）在队时显示爆裂轮次策略下拉菜单
    get hasMastRomanticMaid() {
      return this.team.some(s => s.active && s.resourceId === 354);
    },

    // Cinderella: Crystal Wave（resource_id: 515）在队时显示 Snipe Mode 开关
    get hasCinderellaCrystalWave() {
      return this.team.some(s => s.active && s.resourceId === 515);
    },

    // 速充选项显示条件：Focus 角色为 SR/RL 且非 DOWN_Charge 型（DOWN_Charge 按住自动全蓄力击发，无法速充）
    get quickChargeSlot() {
      const slot = this.focusSlot != null ? this.team[this.focusSlot] : null;
      if (!slot?.active || !slot.resourceId || !['SR', 'RL'].includes(slot.weaponType)) return null;
      if (slot._nikkeData?.shot_detail?.input_type === 'DOWN_Charge') return null;
      return slot;
    },

    // 百暴候选：Miranda 在队时，队伍中出现的 FULL_CRIT_CHAR_IDS 角色槽位（无 Miranda 或无候选 → 空，选项隐藏）
    get fullCritCandidates() {
      const active = this.team.filter(s => s.active && s.resourceId);
      if (!active.some(s => s.resourceId === MIRANDA_ID)) return [];
      return active.filter(s => FULL_CRIT_CHAR_IDS.includes(s.resourceId));
    },

    // 实际生效的百暴角色：所选角色已不在候选中（离队 / Miranda 离队）时视为关闭
    get effectiveFullCritChar() {
      return this.fullCritCandidates.some(s => s.resourceId === this.fullCritChar) ? this.fullCritChar : 0;
    },

    // Anis: Star（resource_id: 17）在队时显示流星核心命中率修正系数
    get hasAnisStar() {
      return this.team.some(s => s.active && s.resourceId === 17);
    },

    // 预设下拉列表：内置预设（名称按当前语言）在前，用户预设在后
    get allEnemyPresets() {
      const builtins = BUILTIN_ENEMY_PRESETS.map(p => ({ ...p, name: this.t(p.nameKey) }));
      return [...builtins, ...this.enemyPresets];
    },

    get selectedPresetIsBuiltin() {
      return BUILTIN_ENEMY_PRESETS.some(p => p.id === this.selectedPresetId);
    },

    // 下拉选项：B3 A / B 按队伍槽位顺序取第 1 / 第 2 名 B3（含 StepFull），与引擎一致；
    // 对应 B3 不存在时不提供该选项
    get mastBurstOptions() {
      const b3Names = this.team
        .filter(s => s.active && s.resourceId && (s.burstStep === 'Step3' || s.burstStep === 'StepFull'))
        .map(s => this.slotName(s));
      const opts = [
        { value: 'auto',     label: this.t('sim.mast.auto') },
        { value: 'drunken3', label: this.t('sim.mast.drunken3', { effect: this.effectName(354, 'Drunken') }) },
      ];
      if (b3Names[0]) opts.push({ value: 'b3a', label: this.t('sim.mast.b3', { name: b3Names[0] }) });
      if (b3Names[1]) opts.push({ value: 'b3b', label: this.t('sim.mast.b3', { name: b3Names[1] }) });
      return opts;
    },

    // 实际生效的策略：不在队或所选 B3 已不存在时回退为 auto
    get effectiveMastBurstMode() {
      if (!this.hasMastRomanticMaid) return 'auto';
      return this.mastBurstOptions.some(o => o.value === this.mastBurstMode) ? this.mastBurstMode : 'auto';
    },

    maxBond(grade, corp) { return maxBond(grade, corp); },

    // 角色选择器筛选组（显示顺序即按钮顺序）；值为花名册字段原值
    CHAR_FILTER_GROUPS: [
      { key: 'burstStep',   values: ['Step1', 'Step2', 'Step3'] },
      { key: 'classType',   values: CLASS_ORDER },
      { key: 'corporation', values: CORP_ORDER },
      { key: 'weaponType',  values: ['AR', 'SMG', 'SG', 'SR', 'RL', 'MG'] },
      { key: 'element',     values: ELEMENT_ORDER },
    ],
    charFilterIcon(key, v) {
      return ({ burstStep: burstIcon, classType: classIcon, corporation: corpIcon,
        weaponType: weaponIcon, element: elementIcon })[key](v);
    },
    charFilterLabel(key, v) {
      if (key === 'burstStep')   return this.burstLabel(v);
      if (key === 'classType')   return this.classLabel(v);
      if (key === 'corporation') return this.corpLabel(v);
      if (key === 'element')     return this.elementLabel(v);
      return v;
    },
    toggleCharFilter(key, v) {
      const cur = this.charFilters[key];
      this.charFilters = {
        ...this.charFilters,
        [key]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v],
      };
    },
    /** 是否存在任何生效的筛选（含名字搜索），用于禁用重置按钮 */
    get hasCharFilters() {
      return (this.charQuery ?? '').trim() !== ''
        || Object.values(this.charFilters).some(arr => arr.length > 0);
    },
    /** 清空名字搜索与全部图标筛选 */
    resetCharFilters() {
      this.charQuery = '';
      this.charFilters = Object.fromEntries(Object.keys(this.charFilters).map(k => [k, []]));
    },

    // 搜索同时匹配英文名与简体名（与当前界面语言无关）；
    // 图标筛选：组内为「或」、组间为「且」；AllStep（如 Red Hood）匹配任意爆裂阶段
    get filteredChars() {
      const q = (this.charQuery ?? '').toLowerCase().trim();
      const f = this.charFilters;
      const pass = (sel, v) => !sel.length || sel.includes(v);
      return this.allChars.filter(c =>
        (!q || c.name.toLowerCase().includes(q) || (this.zhNames.characters[c.resourceId] ?? '').includes(q)) &&
        (c.burstStep === 'AllStep' || pass(f.burstStep, c.burstStep)) &&
        pass(f.classType, c.classType) &&
        pass(f.corporation, c.corporation) &&
        pass(f.weaponType, c.weaponType) &&
        pass(f.element, c.element));
    },

    favItemsForSlot(slotIdx) {
      const slot = this.team[slotIdx];
      if (!slot?.weaponType) return FAV_ITEMS_RS;
      const byWeapon = FAV_ITEMS_RS.filter(f => f.weapon === slot.weaponType);
      if (!slot.resourceId) return byWeapon;
      const ssrId = SSR_FAV_BY_CHAR[slot.resourceId];
      if (!ssrId) return byWeapon;
      return [...byWeapon, { id: ssrId, weapon: slot.weaponType, rare: 'SSR' }];
    },

    // ── 初始化 ────────────────────────────────────────────────────────────────

    async init() {
      try {
        // 简体名称表与战斗数据并行加载；缺失（未运行下载脚本）时为空表，界面回退英文名
        const [, zhNames] = await Promise.all([
          loadAllData((key, done, total) => {
            this.loadProgress = this.t('load.progress', { key, done, total });
          }),
          loadZhNames(),
        ]);
        this.zhNames = zhNames;
      } catch (err) {
        this.loadProgress = this.t('load.failed', { msg: err.message });
      }

      this.allChars    = getAllCharacters().map(c => ({ ...c, modeled: MODELED_IDS.has(c.resourceId) }));
      this.cubeOptions = Object.keys(CUBE_URLS).map(Number).sort((a, b) => a - b).map(id => ({ id }));

      const accountLoaded = await loadAccountFromDev();
      if (accountLoaded) {
        this.devMode       = true;
        this.accountStatus = { key: 'status.accountLoaded', params: { n: getAccountSize() } };
        const settings = getAccountSettings();
        this._applySettings(settings);
      } else {
        this.devMode       = false;
        this.accountStatus = { key: 'status.noAccount' };
      }

      // 恢复上次保存的状态（在账号默认值之后，用户自定义优先）
      const _saved = localStorage.getItem(STORAGE_KEY);
      if (_saved) {
        try {
          this._restoreSnapshot(JSON.parse(_saved));
        } catch (err) {
          console.error('恢复上次保存的界面状态失败（已使用默认配置）:', err);
        }
      }

      this._loadEnemyPresetsFromStorage();
      // 模拟记录异步读取（IndexedDB），不阻塞启动；与读取期间新产生的记录合并
      loadHistory(localStorage).then(list => { this.simHistory = mergeHistory(this.simHistory, list); });
      this.loading = false;
    },

    // ── 账号导入 ──────────────────────────────────────────────────────────────

    async reloadAccountFromDev() {
      this.accountStatus = { key: 'status.reloading' };
      const ok = await loadAccountFromDev();
      if (!ok) {
        this.accountStatus = { key: 'status.reloadFailed' };
        return;
      }
      const settings = getAccountSettings();
      this._applySettings(settings);
      this.accountStatus = { key: 'status.updated', params: { n: getAccountSize() } };
      for (let i = 0; i < 5; i++) {
        const slot = this.team[i];
        if (!slot.resourceId) continue;
        const entry = getRosterEntry(slot.resourceId);
        if (entry) this._applyRosterEntry(i, entry);
      }
    },

    async importAccount(file) {
      if (!file) return;
      this.accountStatus = { key: 'status.importing' };
      const ok = await loadAccountFromJson(file);
      if (!ok) {
        this.accountStatus = { key: 'status.importFailed' };
        return;
      }
      const settings = getAccountSettings();
      this._applySettings(settings);
      this.accountStatus = { key: 'status.updated', params: { n: getAccountSize() } };

      for (let i = 0; i < 5; i++) {
        const slot = this.team[i];
        if (!slot.resourceId) continue;
        const entry = getRosterEntry(slot.resourceId);
        if (entry) this._applyRosterEntry(i, entry);
      }
    },

    _applySettings(settings) {
      this.synchroLevel    = settings.synchroLevel;
      this.generalResearch = settings.generalResearch;
      Object.assign(this.classResearch, settings.classResearch);
      Object.assign(this.corpResearch,  settings.corpResearch);
    },

    // ── 状态持久化 ────────────────────────────────────────────────────────────

    _getSnapshot() {
      return {
        synchroLevel:    this.synchroLevel,
        generalResearch: this.generalResearch,
        classResearch:   { ...this.classResearch },
        corpResearch:    { ...this.corpResearch },
        enemy: {
          element:  this.enemy.element,
          type:     this.enemy.type,
          actions:  this.enemy.actions.map(a => ({ ...a })),
          _nextId:  this.enemy._nextId,
        },
        iterations:         this.iterations,
        hitCal:             { ...this.hitCal },
        starCoreCoef:       this.starCoreCoef,
        burstStepSecs:      this.burstStepSecs,
        burstDuringHidden:  this.burstDuringHidden,
        levelLock:          this.levelLock,
        ebsLastBurstOnly: this.ebsLastBurstOnly,
        mirLastBurstOnly: this.mirLastBurstOnly,
        mastBurstMode:    this.mastBurstMode,
        ccwSnipeModeAtStart: this.ccwSnipeModeAtStart,
        quickChargeMode:    this.quickChargeMode,
        fullCritChar:       this.fullCritChar,
        focusSlot:          this.focusSlot,
        team: this.team.map(slot => this._slotSnapshot(slot)),
      };
    },

    /** 单个槽位的可序列化配置（不含加载的 CDN 数据）；状态持久化与模拟记录共用 */
    _slotSnapshot(slot) {
      return {
        active:       slot.active,
        resourceId:   slot.resourceId,
        name:         slot.name,
        classType:    slot.classType,
        corporation:  slot.corporation,
        element:      slot.element,
        weaponType:   slot.weaponType,
        burstStep:    slot.burstStep,
        grade:        slot.grade,
        core:         slot.core,
        bondLevel:    slot.bondLevel,
        skills:       slot.skills.slice(),
        cube:         { resourceId: slot.cube.resourceId, level: slot.cube.level },
        favoriteItem: { resourceId: slot.favoriteItem.resourceId, level: slot.favoriteItem.level },
        equipment:    Object.fromEntries(EQUIP_SLOTS.map(k => [k, {
          classReq: slot.equipment[k].classReq,
          tier:     slot.equipment[k].tier,
          level:    slot.equipment[k].level,
          opts:     slot.equipment[k].opts.map(o => ({ type: o.type, value: o.value })),
        }])),
      };
    },

    _restoreSnapshot(state) {
      if (!state) return;
      if (state.synchroLevel    != null) this.synchroLevel    = state.synchroLevel;
      if (state.generalResearch != null) this.generalResearch = state.generalResearch;
      if (this.LEVEL_LOCK_OPTIONS.includes(state.levelLock)) this.levelLock = state.levelLock;
      if (state.classResearch)  Object.assign(this.classResearch, state.classResearch);
      if (state.corpResearch)   Object.assign(this.corpResearch,  state.corpResearch);
      if (state.enemy) {
        const e = state.enemy;
        if (Array.isArray(e.actions)) {
          // 新格式（旧距离标签 / 旧「距离=HIDDEN」在 migrateEnemyActions 内迁移）
          this.enemy.element  = e.element  ?? this.enemy.element;
          this.enemy.type     = e.type     ?? this.enemy.type;
          this.enemy.actions  = migrateEnemyActions(e.actions);
          const maxId = this.enemy.actions.reduce((m, a) => Math.max(m, a.id), 0);
          this.enemy._nextId  = Math.max(e._nextId ?? 0, maxId + 1);
        } else {
          // 旧格式迁移：def/hasCore/distNear/distMid/distFar → actions
          this.enemy.element = e.element ?? this.enemy.element;
          this.enemy.type    = e.type    ?? this.enemy.type;
          const coreVal = e.hasCore ? 'EXPOSED' : 'NONE';
          let posVal = 35;
          if ((e.distNear ?? 0) > 0) posVal = 20;
          else if ((e.distFar ?? 0) > 0) posVal = 55;
          this.enemy.actions = [
            { id: 1, startTimeS: 0, type: 'def',      value: e.def ?? 500 },
            { id: 2, startTimeS: 0, type: 'core',     value: coreVal },
            { id: 3, startTimeS: 0, type: 'position', value: posVal },
          ];
          this.enemy._nextId = 4;
        }
      }
      if (state.iterations          != null) this.iterations          = state.iterations;
      this.hitCal = restoreHitCal(state);
      if (Number.isFinite(state.starCoreCoef)) this.starCoreCoef = state.starCoreCoef;
      // 旧版本保存的 0.6s 等超出上限的值统一压到 0.4s（自动战斗实测上限）
      if (state.burstStepSecs       != null) this.burstStepSecs       = Math.min(0.4, state.burstStepSecs);
      if (typeof state.burstDuringHidden === 'boolean') this.burstDuringHidden = state.burstDuringHidden;
      if (state.ebsLastBurstOnly  != null) this.ebsLastBurstOnly  = state.ebsLastBurstOnly;
      if (state.mirLastBurstOnly  != null) this.mirLastBurstOnly  = state.mirLastBurstOnly;
      if (state.mastBurstMode     != null) this.mastBurstMode     = state.mastBurstMode;
      if (state.ccwSnipeModeAtStart != null) this.ccwSnipeModeAtStart = state.ccwSnipeModeAtStart;
      if (['off', 'always', 'untilFull'].includes(state.quickChargeMode)) this.quickChargeMode = state.quickChargeMode;
      if (FULL_CRIT_CHAR_IDS.includes(state.fullCritChar)) this.fullCritChar = state.fullCritChar;
      if (state.focusSlot !== undefined)   this.focusSlot         = state.focusSlot;
      if (!Array.isArray(state.team)) return;
      state.team.forEach((saved, i) => {
        if (i >= this.team.length || !saved) return;
        this._restoreSlot(i, saved);
      });
    },

    /** 将保存的槽位配置（_slotSnapshot 格式）写入 this.team[i]，并加载对应 CDN 数据 */
    _restoreSlot(i, saved) {
      const slot = this.team[i];
      slot.active       = saved.active      ?? slot.active;
      slot.resourceId   = saved.resourceId  ?? null;
      slot.name         = saved.name        ?? '';
      slot.classType    = saved.classType   ?? slot.classType;
      slot.corporation  = saved.corporation ?? slot.corporation;
      slot.element      = saved.element     ?? slot.element;
      slot.weaponType   = saved.weaponType  ?? slot.weaponType;
      const savedStep   = saved.burstStep ?? slot.burstStep;
      slot.burstStep    = savedStep === 'AllStep' ? 'Step3' : savedStep;
      slot.grade        = saved.grade       ?? 0;
      slot.core         = saved.core        ?? 0;
      slot.bondLevel    = saved.bondLevel   ?? 1;
      if (saved.skills)       slot.skills = saved.skills.slice();
      if (saved.cube)         Object.assign(slot.cube, saved.cube);
      if (saved.favoriteItem) Object.assign(slot.favoriteItem, saved.favoriteItem);
      if (saved.equipment) {
        for (const k of EQUIP_SLOTS) {
          if (saved.equipment[k]) Object.assign(slot.equipment[k], saved.equipment[k]);
        }
      }
      if (slot.resourceId) {
        // 从花名册补全可能在旧存档中缺失或错误的字段
        const charMeta = getCharacterByResourceId(slot.resourceId);
        if (charMeta?.element) slot.element = charMeta.element;
        if (charMeta?.weaponType) slot.weaponType = charMeta.weaponType;
        this._loadNikkeData(i, slot.resourceId);
        if (slot.cube.resourceId)         this._loadCubeData(i, slot.cube.resourceId);
        if (slot.favoriteItem.resourceId) this._loadFavData(i, slot.favoriteItem.resourceId);
      }
    },

    // ── 角色选择 ──────────────────────────────────────────────────────────────

    handleSlotClick(i) {
      const slot = this.team[i];
      if (!slot.resourceId) {
        this.activeSlot = i;
        this.openCharPicker(i);
      } else if (this.activeSlot === i) {
        this.openCharPicker(i);
      } else {
        this.activeSlot = i;
      }
    },

    openCharPicker(slotIdx) {
      this.charPickerSlot = slotIdx;
      this.charQuery = '';
    },

    closeCharPicker() {
      this.charPickerSlot = -1;
    },

    async selectChar(resourceId) {
      const i = this.charPickerSlot;
      if (i < 0) return;
      this.closeCharPicker();
      this._assignChar(i, resourceId);
    },

    /** 把角色放入槽位 i：按花名册 / 账号数据填默认配置并加载 CDN 数据。返回是否成功 */
    _assignChar(i, resourceId) {
      const char = getCharacterByResourceId(resourceId);
      if (!char) return false;

      const slot = this.team[i];
      slot.resourceId  = resourceId;
      slot.name        = char.name;
      slot.classType   = char.classType;
      slot.corporation = char.corporation;
      slot.element     = char.element;
      slot.weaponType  = char.weaponType;
      // AllStep（如 Red Hood）目前仅支持用法1（纯 B3），默认映射为 Step3。
      // TODO: 将来在 UI 提供选项支持用法2（B1奇/偶轮）、用法3（B1+首轮-40s）、用法4（首轮补位+第二轮独推全爆裂）。
      slot.burstStep   = char.burstStep === 'AllStep' ? 'Step3' : (char.burstStep ?? 'Step3');
      slot.active      = true;
      slot._nikkeData  = null;
      slot._cubeData   = null;
      slot._favData    = null;
      slot._nikkeDataZh = null;
      slot._cubeDataZh  = null;
      slot._favDataZh   = null;

      for (const key of EQUIP_SLOTS) {
        slot.equipment[key].classReq = char.classType;
      }

      slot.bondLevel = maxBond(slot.grade, slot.corporation);
      slot.favoriteItem.resourceId = DEFAULT_FAV_SR[char.weaponType] ?? null;
      slot.favoriteItem.level      = 15;

      const entry = getRosterEntry(resourceId);
      if (entry) this._applyRosterEntry(i, entry);

      this._loadNikkeData(i, resourceId);
      if (slot.cube.resourceId) this._loadCubeData(i, slot.cube.resourceId);
      if (slot.favoriteItem.resourceId) this._loadFavData(i, slot.favoriteItem.resourceId);
      return true;
    },

    // ── 槽位拖拽换位 ──────────────────────────────────────────────────────────

    /**
     * 交换两个槽位（等同游戏内调整站位）。槽位对象整体互换，
     * 角色配置与已加载数据随角色移动；activeSlot / focusSlot 跟随原角色。
     * @param {number} from
     * @param {number} to
     */
    swapSlots(from, to) {
      if (from === to || from < 0 || to < 0) return;
      const remap = idx => (idx === from ? to : idx === to ? from : idx);
      this.team = this.team.map((slot, idx) => this.team[remap(idx)]);
      this.activeSlot = remap(this.activeSlot);
      if (this.focusSlot != null) this.focusSlot = remap(this.focusSlot);
    },

    onSlotDragStart(i, event) {
      this.dragFrom = i;
      event.dataTransfer.effectAllowed = 'move';
      // Firefox 需要设置数据才会开始拖拽
      event.dataTransfer.setData('text/plain', String(i));
    },

    onSlotDragOver(i, event) {
      if (this.dragFrom < 0) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      this.dropTarget = i;
    },

    onSlotDrop(i) {
      if (this.dragFrom >= 0) this.swapSlots(this.dragFrom, i);
      this.onSlotDragEnd();
    },

    onSlotDragEnd() {
      this.dragFrom   = -1;
      this.dropTarget = -1;
    },

    clearSlot(i) {
      this.team[i] = defaultSlot(false);
      // 清空的若是 Focus 槽位，取消 Focus（避免指向空槽）
      if (this.focusSlot === i) this.focusSlot = null;
    },

    // ── 极限突破与好感度 ──────────────────────────────────────────────────────

    setGrade(i, grade) {
      const slot = this.team[i];
      slot.grade = grade;
      if (grade < 3) slot.core = 0;
      const bMax = maxBond(grade, slot.corporation);
      if (slot.bondLevel > bMax) slot.bondLevel = bMax;
    },

    clampBond(i) {
      const slot = this.team[i];
      const bMax = maxBond(slot.grade, slot.corporation);
      slot.bondLevel = Math.max(1, Math.min(bMax, Number(slot.bondLevel) || 1));
    },

    clampCore(i) {
      const slot = this.team[i];
      slot.core = Math.max(0, Math.min(7, Number(slot.core) || 0));
    },

    // ── 敌人行动 ──────────────────────────────────────────────────────────────

    addEnemyAction() {
      this.selectedPresetId = null;
      this.enemy.actions.push({ id: this.enemy._nextId++, startTimeS: 0, type: 'def', value: 500 });
    },

    sortEnemyActions() {
      const fixed   = this.enemy.actions.slice(0, 3);
      const dynamic = this.enemy.actions.slice(3).sort((a, b) => a.startTimeS - b.startTimeS);
      this.enemy.actions = [...fixed, ...dynamic];
    },

    removeEnemyAction(id) {
      this.selectedPresetId = null;
      this.enemy.actions = this.enemy.actions.filter(a => a.id !== id);
    },

    updateEnemyAction(id, field, val) {
      const action = this.enemy.actions.find(a => a.id === id);
      if (!action) return;
      this.selectedPresetId = null;
      if (field === 'type') {
        // 类型切换时重置值为合理默认；横向移动为区间，默认持续 1 秒
        const defaults = { def: 500, core: 'NONE', position: DEFAULT_ENEMY_DISTANCE, hidden: 'HIDDEN', lateral: 'SLOW',
          jump: DEFAULT_ENEMY_DISTANCE };
        action.value = defaults[val] ?? 500;
        if (val === 'lateral') action.endTimeS = Math.min(180, (Number(action.startTimeS) || 0) + 1);
        else delete action.endTimeS;
      }
      action[field] = val;
    },

    // ── 敌人配置预设 ──────────────────────────────────────────────────────────

    _loadEnemyPresetsFromStorage() {
      try {
        const raw = localStorage.getItem(ENEMY_PRESETS_KEY);
        // 签名按当前规则重算（旧预设签名含已移至模拟选项的命中参数，不重算会导致重复自动保存）
        this.enemyPresets = (raw ? JSON.parse(raw) : [])
          .map(p => ({ ...p, _sig: enemyConfigSignature(p.config) }));
      } catch {
        this.enemyPresets = [];
      }
    },

    _saveEnemyPresetsToStorage() {
      localStorage.setItem(ENEMY_PRESETS_KEY, JSON.stringify(this.enemyPresets));
    },

    _getEnemyConfigSignature() {
      return enemyConfigSignature(this.enemy);
    },

    saveEnemyPresetIfNew() {
      const sig = this._getEnemyConfigSignature();
      if (this.enemyPresets.some(p => p._sig === sig)) return;
      if (BUILTIN_ENEMY_PRESETS.some(p => enemyConfigSignature(p.config) === sig)) return;
      const now = Date.now();
      const d   = new Date(now);
      const pad = n => String(n).padStart(2, '0');
      const name = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      this.enemyPresets.push({
        id:        `preset_${now}`,
        name,
        createdAt: now,
        _sig:      sig,
        config: {
          element: this.enemy.element,
          type:    this.enemy.type,
          actions: this.enemy.actions.map(pickActionFields),
        },
      });
      this._saveEnemyPresetsToStorage();
    },

    loadEnemyPreset(id) {
      if (!id) return;
      const preset = this.allEnemyPresets.find(p => p.id === id);
      if (!preset) return;
      this.enemy.element = preset.config.element;
      this.enemy.type    = preset.config.type;
      this.enemy.actions = migrateEnemyActions(preset.config.actions).map((a, i) => ({ ...a, id: i + 1 }));
      this.enemy._nextId = this.enemy.actions.length + 1;
      this.selectedPresetId = id;
    },

    deleteEnemyPreset(id) {
      // 内置预设不在 enemyPresets 中，过滤后无变化（界面按钮已禁用）
      this.enemyPresets = this.enemyPresets.filter(p => p.id !== id);
      if (this.selectedPresetId === id) this.selectedPresetId = null;
      this._saveEnemyPresetsToStorage();
    },

    renameEnemyPreset(id) {
      const preset = this.enemyPresets.find(p => p.id === id);
      if (!preset) return;
      const name = prompt(this.t('enemy.renamePrompt'), preset.name);
      if (name === null || name.trim() === '') return;
      preset.name = name.trim();
      this._saveEnemyPresetsToStorage();
    },

    // ── 敌人配置导入 / 导出（剪贴板优先，失败时弹窗）────────────────────────────

    showToast(text) {
      const id = Date.now();
      this.toast = { id, text };
      setTimeout(() => { if (this.toast?.id === id) this.toast = null; }, 2600);
    },

    _openEnemyIo(mode, text, message) {
      this.enemyIo = { mode, text, message, dragging: false };
    },

    closeEnemyIo() {
      this.enemyIo = { mode: null, text: '', message: null, dragging: false };
    },

    /** 导出：写入剪贴板；失败（无权限 / 非安全上下文）则弹窗显示 JSON 供手动复制或保存。 */
    async exportEnemyConfig() {
      const json = JSON.stringify(buildEnemyConfigExport(this.enemy), null, 2);
      try {
        await navigator.clipboard.writeText(json);
        this.showToast(this.t('enemyIo.toast.copied'));
      } catch {
        this._openEnemyIo('export', json, { kind: 'warn', text: this.t('enemyIo.notice.copyFailed') });
      }
    },

    /** 弹窗内「复制」：再次尝试写剪贴板，成功即关闭弹窗。 */
    async copyEnemyIoText() {
      try {
        await navigator.clipboard.writeText(this.enemyIo.text);
        this.closeEnemyIo();
        this.showToast(this.t('enemyIo.toast.copied'));
      } catch {
        this.enemyIo.message = { kind: 'error', text: this.t('enemyIo.notice.copyFailed') };
      }
    },

    saveEnemyIoFile() {
      const url = URL.createObjectURL(new Blob([this.enemyIo.text], { type: 'application/json' }));
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `nikke-enemy-${this.enemy.element}-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },

    /** 导入：读剪贴板并校验；读取失败或内容无法导入则弹窗等待粘贴 / 拖入 / 选择文件。 */
    async importEnemyConfig() {
      let text;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        this._openEnemyIo('import', '', { kind: 'warn', text: this.t('enemyIo.notice.clipboardUnreadable') });
        return;
      }
      const result = parseEnemyConfig(text);
      if (result.ok) {
        this._applyEnemyConfig(result.config);
        this.showToast(this.t('enemyIo.toast.importedClipboard'));
        return;
      }
      // 剪贴板内容是本格式但数值有误时保留原文便于修改；完全无关的内容不回显
      const isOurFormat = !['enemyIo.err.json', 'enemyIo.err.format'].includes(result.error.key);
      this._openEnemyIo('import', isOurFormat ? text : '', {
        kind: 'warn',
        text: this.t('enemyIo.notice.clipboardInvalid', { msg: this.t(result.error.key, result.error.params) }),
      });
    },

    /** 弹窗内「导入」：校验文本框内容，失败则提示原因且不改动当前配置。 */
    submitEnemyIoImport() {
      const result = parseEnemyConfig(this.enemyIo.text);
      if (!result.ok) {
        this.enemyIo.message = {
          kind: 'error',
          text: this.t('enemyIo.error.invalid', { msg: this.t(result.error.key, result.error.params) }),
        };
        return;
      }
      this._applyEnemyConfig(result.config);
      this.closeEnemyIo();
      this.showToast(this.t('enemyIo.toast.imported'));
    },

    /** 拖入或选择的文件：读入文本框后立即尝试导入。 */
    async loadEnemyIoFile(file) {
      this.enemyIo.dragging = false;
      if (!file) return;
      try {
        this.enemyIo.text = await file.text();
      } catch (err) {
        this.enemyIo.message = { kind: 'error', text: this.t('enemyIo.error.fileRead', { msg: err.message }) };
        return;
      }
      this.submitEnemyIoImport();
    },

    _applyEnemyConfig(c) {
      this.enemy.element = c.element;
      this.enemy.type    = c.type;
      this.enemy.actions = c.actions.map((a, i) => ({ ...a, id: i + 1 }));
      this.enemy._nextId = this.enemy.actions.length + 1;
      this.sortEnemyActions();
      this.selectedPresetId = null;
    },

    // ── 魔方 ──────────────────────────────────────────────────────────────────

    async onCubeChange(i) {
      const slot = this.team[i];
      slot._cubeData   = null;
      slot._cubeDataZh = null;
      if (slot.cube.resourceId) {
        await this._loadCubeData(i, slot.cube.resourceId);
      }
    },

    async _loadCubeData(i, resourceId) {
      // await 前取槽位对象：加载期间若拖拽换位，数据仍写回原角色
      const slot = this.team[i];
      try {
        const [data, zhPatch] = await Promise.all([loadCube(resourceId), loadZhPatch('cubes', resourceId)]);
        slot._cubeData   = data;
        slot._cubeDataZh = localizeData(data, zhPatch);
      } catch (err) {
        console.error(`[slot ${i}] Cube ${resourceId} 加载失败:`, err?.message ?? err);
        slot._cubeData   = null;
        slot._cubeDataZh = null;
      }
    },

    // ── 珍藏品 ────────────────────────────────────────────────────────────────

    async onFavChange(i) {
      const slot = this.team[i];
      slot._favData   = null;
      slot._favDataZh = null;
      if (slot.favoriteItem.resourceId) {
        await this._loadFavData(i, slot.favoriteItem.resourceId);
      }
    },

    async _loadFavData(i, resourceId) {
      // await 前取槽位对象：加载期间若拖拽换位，数据仍写回原角色
      const slot = this.team[i];
      try {
        const [data, zhPatch] = await Promise.all([loadFavoriteItem(resourceId), loadZhPatch('favorites', resourceId)]);
        slot._favData   = data;
        slot._favDataZh = localizeData(data, zhPatch);
      } catch (err) {
        console.error(`[slot ${i}] FavItem ${resourceId} 加载失败:`, err?.message ?? err);
        slot._favData   = null;
        slot._favDataZh = null;
      }
    },

    // ── NIKKE CDN 数据 ────────────────────────────────────────────────────────

    async _loadNikkeData(i, resourceId) {
      const slot = this.team[i];
      slot._loading     = true;
      slot._nikkeData   = null;
      slot._nikkeDataZh = null;
      try {
        const [data, zhPatch] = await Promise.all([loadNikke(resourceId), loadZhPatch('nikke', resourceId)]);
        slot._nikkeData   = data;
        slot._nikkeDataZh = localizeData(data, zhPatch);
      } catch (err) {
        console.error(`[slot ${i}] NIKKE ${resourceId} 加载失败:`, err?.message ?? err);
      } finally {
        slot._loading = false;
      }
    },

    // ── 账号数据填充 ──────────────────────────────────────────────────────────

    _applyRosterEntry(i, entry) {
      const slot = this.team[i];
      slot.grade  = entry.grade;
      slot.core   = Math.min(entry.core, 7);

      const bMax = maxBond(slot.grade, slot.corporation);
      slot.bondLevel = Math.min(entry.bondLevel, bMax);

      slot.skills = entry.skills.slice(0, 3);

      slot.cube.resourceId = entry.cube.resourceId;
      slot.cube.level      = entry.cube.level || 1;

      slot.favoriteItem.resourceId = entry.favoriteItem.resourceId;
      slot.favoriteItem.level      = entry.favoriteItem.level || 1;

      for (const key of EQUIP_SLOTS) {
        const eq = entry.equipment?.[key];
        if (!eq) continue;
        slot.equipment[key].classReq = eq.classReq;
        slot.equipment[key].tier     = eq.tier;
        slot.equipment[key].level    = eq.level ?? 0;
        if (eq.opts) slot.equipment[key].opts = eq.opts;
      }

      if (slot.cube.resourceId) this._loadCubeData(i, slot.cube.resourceId);
      if (slot.favoriteItem.resourceId) this._loadFavData(i, slot.favoriteItem.resourceId);
    },

    // ── 技能描述渲染 ──────────────────────────────────────────────────────────

    // 槽位数据的显示版本：中文界面且已有简体副本时用副本，否则用英文原数据（仅供界面显示）
    _displayData(slot, kind) {
      const zh = this.lang === 'zh' ? slot?.[`_${kind}DataZh`] : null;
      return zh ?? slot?.[`_${kind}Data`] ?? null;
    },

    // 返回 slot 第 skillIndex（0/1/2）个技能的有效 skillDetail（界面显示用，随界面语言切换）：
    // SSR 珍藏品已加载时，从 favoriteitem_skill_group_data 读取；否则从角色 nikke 数据读取。
    effectiveSkillDetail(slotIdx, skillIndex) {
      const slot = this.team[slotIdx];
      const fsg  = this._displayData(slot, 'fav')?.favoriteitem_skill_group_data;
      if (fsg?.length) {
        const entry = fsg.find(e => e.skill_change_slot === skillIndex + 1);
        if (entry?.info) return entry.info;
      }
      const nd = this._displayData(slot, 'nikke');
      return [nd?.skill1_detail, nd?.skill2_detail, nd?.ulti_skill_detail][skillIndex] ?? null;
    },

    /**
     * 技能栏显示的冷却时间（秒）；被动技能返回 null。
     * 爆裂技能：CDN skill_cooltime_list 按当前技能等级取值（与引擎 burstSkillCooltime 同源）；
     * 主动 S1 / S2（CDN 表 CharacterSkill）：取人工冷却表，未登记时返回 NaN（界面显示「主动」不带秒数）。
     */
    skillCooldownSec(slotIdx, skillIndex) {
      const slot = this.team[slotIdx];
      const nd   = slot?._nikkeData;
      if (!nd) return null;
      if (skillIndex === 2) {
        const ult = nd.ulti_skill_detail;
        const lv  = Math.max(1, slot.skills[2] ?? 1);
        const raw = ult?.skill_cooltime_list?.[lv - 1] ?? ult?.skill_cooltime;
        return raw != null ? raw / 100 : null;
      }
      const key = skillIndex === 0 ? 'skill1' : 'skill2';
      if (nd[`${key}_table`] !== 'CharacterSkill') return null;
      return getActiveSkillCooldownSec(slot.resourceId, key) ?? NaN;
    },

    renderSkillHtml(skillDetail, skillLevel) {
      if (!skillDetail) return '';
      return renderSkillDesc(
        skillDetail.description_localkey ?? '',
        skillDetail.description_value_list ?? [],
        skillLevel
      );
    },

    cubeSkillHtml(slotIdx) {
      const slot = this.team[slotIdx];
      if (!slot._cubeData || !slot.cube.level) return '';
      try {
        const cube  = normalizeCube(this._displayData(slot, 'cube'));
        const level = slot.cube.level;
        return cube.skills.map((skill, si) => {
          const skillLv = cube.levels[si]?.[level - 1] ?? 0;
          if (!skillLv) return '';
          const desc = renderSkillDesc(
            skill.description_localkey ?? '',
            skill.description_value_list ?? [],
            skillLv
          );
          const name = skill.name_localkey ?? this.t('skills.fallback', { n: si + 1 });
          return `<div class="cube-skill"><b class="skill-name">${name}</b> <span class="skill-lv">Lv${skillLv}</span><p class="skill-desc">${desc}</p></div>`;
        }).join('');
      } catch (err) {
        console.error(`[cubeSkillHtml] slot ${slotIdx} cube ${slot.cube.resourceId} 渲染失败:`, err?.message ?? err);
        return '';
      }
    },

    favSkillHtml(slotIdx) {
      const slot = this.team[slotIdx];
      if (!slot._favData) return '';
      const fav   = this._displayData(slot, 'fav');
      const level = slot.favoriteItem.level ?? 1;
      const skills   = fav.collection_skill_group_data ?? [];
      const lvArrays = [fav.level1 ?? [], fav.level2 ?? [], fav.level3 ?? []];

      return skills.map((skill, si) => {
        const lvArr  = lvArrays[si] ?? [];
        const clamp  = Math.min(level, Math.max(0, lvArr.length - 1));
        const skillLv = lvArr[clamp] ?? 0;
        if (!skillLv) return '';
        const desc = renderSkillDesc(
          skill.description_localkey ?? '',
          skill.description_value_list ?? [],
          skillLv
        );
        const name = skill.name_localkey ?? this.t('fav.passiveFallback', { n: si + 1 });
        return `<div class="fav-skill"><b class="skill-name">${name}</b> <span class="skill-lv">Lv${skillLv}</span><p class="skill-desc">${desc}</p></div>`;
      }).join('');
    },

    // ── 最终属性计算（UI 显示） ───────────────────────────────────────────────

    computedStats(slotIdx) {
      const slot = this.team[slotIdx];
      if (!slot?.active || !slot.resourceId) return null;
      try {
        return computeFinalStats(
          { ...slot, _favItemData: slot._favData, equipOptions: aggregateEquipOptions(slot.equipment) },
          this.effectiveLevel(),
          this._research()
        );
      } catch { return null; }
    },

    // 计算基础属性用的角色等级：锁定等级优先，否则取同步器等级
    effectiveLevel() {
      return this.levelLock > 0 ? this.levelLock : this.synchroLevel;
    },

    _research() {
      return {
        general:   this.generalResearch,
        attacker:  this.classResearch.attacker,
        defender:  this.classResearch.defender,
        supporter: this.classResearch.supporter,
        ELYSION:   this.corpResearch.ELYSION,
        MISSILIS:  this.corpResearch.MISSILIS,
        TETRA:     this.corpResearch.TETRA,
        PILGRIM:   this.corpResearch.PILGRIM,
        ABNORMAL:  this.corpResearch.ABNORMAL,
      };
    },

    // ── 模拟 ──────────────────────────────────────────────────────────────────

    async runSimulate() {
      const activeSlots = this.team.filter(s => s.active && s.resourceId);
      if (!activeSlots.length) {
        alert(this.t('alert.noSlots'));
        return;
      }

      // SSR 珍藏品强制校验：技能已按 SSR 版本建模的角色必须持有对应满级（Lv15）SSR 珍藏品
      const ssrErrors = [];
      for (const slot of activeSlots) {
        const requiredSsrId = SSR_FAV_BY_CHAR[slot.resourceId];
        if (!requiredSsrId) continue;
        const charLabel = this.slotName(slot) || this.t('slot.charN', { id: slot.resourceId });
        if (slot.favoriteItem.resourceId !== requiredSsrId) {
          ssrErrors.push(this.t('alert.ssrRequired', { name: charLabel, id: requiredSsrId }));
        } else if ((slot.favoriteItem.level ?? 0) < SSR_FAV_MAX_ITEM_LEVEL) {
          const lv = ['5', '10', '15'][slot.favoriteItem.level ?? 0] ?? slot.favoriteItem.level;
          ssrErrors.push(this.t('alert.ssrLevel', { name: charLabel, lv }));
        }
      }
      if (ssrErrors.length) {
        alert(this.t('alert.configError') + '\n\n' + ssrErrors.join('\n'));
        return;
      }

      this.simRunning   = true;
      this.simProgress  = { done: 0, total: 0 };
      this.result       = null;
      this.hitLogRows   = [];
      this.hitLogRaw    = null;
      this.battleLogRaw = null;
      this._squadLookup = null;
      // 模拟记录用的队伍配置快照：在启动时取，避免模拟运行期间用户修改队伍导致记录与结果不符
      const teamSnapshot = this.team.map(s => this._slotSnapshot(s));
      const focusAtStart = this.focusSlot;

      try {
        const research    = this._research();
        const nikkeLevel  = this.effectiveLevel();
        const squadStats  = activeSlots.map(slot =>
          computeFinalStats(
            { ...slot, _favItemData: slot._favData, equipOptions: aggregateEquipOptions(slot.equipment) },
            nikkeLevel,
            research
          )
        );

        const squadConfig = activeSlots.map((slot, idx) => {
          const nd             = slot._nikkeData;
          const isChargeWeapon = ['SR', 'RL'].includes(slot.weaponType);
          return {
            characterId:           slot.resourceId,
            name:                  slot.name || `NIKKE ${idx + 1}`,
            classType:             slot.classType,
            element:               slot.element,
            weaponType:            slot.weaponType,
            burstStep:             slot.burstStep ?? 'Step3',
            level:                 nikkeLevel,
            _computedStats:        squadStats[idx],
            _nikkeData:            nd ?? null,
            _favItemData:          slot._favData ?? null,
            favoriteItem:          { resourceId: slot.favoriteItem.resourceId, level: slot.favoriteItem.level },
            cubeLevel:             slot.cube.level ?? 15,
            _cubeData:             slot._cubeData ?? null,
            skillLevels:           slot.skills.slice(0, 3),
            baseAmmo:              nd?.shot_detail?.max_ammo,
            fullChargeDamage:      nd?.shot_detail?.full_charge_damage ?? 10000,
            reloadTicks:           nd ? Math.round((nd.shot_detail?.reload_time ?? 200) / 100 * 60) : undefined,
            burstEnergyPerShot:    nd?.shot_detail?.burst_energy_pershot,
            fullChargeBurstEnergy: nd?.shot_detail?.full_charge_burst_energy ?? 0,
            // 受控（Focus）角色：按队伍槽位引用匹配（activeSlots 元素是 this.team 的引用）。
            isFocus:               this.focusSlot != null && slot === this.team[this.focusSlot],
            // 队伍站位（含空位的槽位序号）：相邻 / 前后排判定用，空位不会被压缩掉
            position:              this.team.indexOf(slot),
            chargeTimeTicks:       isChargeWeapon ? Math.round((nd?.shot_detail?.charge_time ?? 0) / 100 * 60) : 0,
            // DOWN_Charge 型（持续按住自动连发）：发间无前后摇，只计蓄力时长。
            // 当前库中仅 Liberalio（SR）及少数 RL（Cinderella 等）为此类型。
            // UP 型（松手触发）每次发射需重新瞄准（前摇）和恢复（后摇），前后摇照常计入。
            isDownCharge:          isChargeWeapon && nd?.shot_detail?.input_type === 'DOWN_Charge',
            // 前后摇从 CDN 读取（单位：百分之一秒，/100*60 换算为 tick）。
            // maintain_fire_stance > 0 时覆盖后摇（如 Scarlet:BS=23→14t），否则用 spot_last_delay（通常 20→12t）。
            // 无 CDN 数据时默认 16.67→10t，保持原行为。
            foreswingTicks:        isChargeWeapon ? Math.round((nd?.shot_detail?.spot_first_delay  ?? 16.67) / 100 * 60) : 0,
            backswingTicks:        isChargeWeapon
              ? Math.round(((nd?.shot_detail?.maintain_fire_stance > 0
                  ? nd.shot_detail.maintain_fire_stance
                  : (nd?.shot_detail?.spot_last_delay ?? 16.67))) / 100 * 60)
              : 0,
            // 出停火区段（HIDDEN / 跳起）后重新举枪的后摇：始终取 spot_last_delay（不被 maintain_fire_stance 覆盖）
            spotLastTicks:         isChargeWeapon
              ? Math.round((nd?.shot_detail?.spot_last_delay ?? 16.67) / 100 * 60)
              : 0,
            // 非蓄力武器（AR/SMG/MG/SG）：末发后摇（spot_last_delay）计入换弹相位。
            // maintain_fire_stance > 0 时覆盖。无 CDN 数据则为 0（不加后摇）。
            reloadRecoveryTicks:   isChargeWeapon
              ? 0
              : Math.round(((nd?.shot_detail?.maintain_fire_stance > 0
                  ? nd.shot_detail.maintain_fire_stance
                  : (nd?.shot_detail?.spot_last_delay ?? 0))) / 100 * 60),
            // 非蓄力武器换弹完成后的对准期（spot_first_delay）：换弹不覆盖前摇（Rapi: Red Hood 实测 23t = 12 + 12）。
            reloadAimTicks:        isChargeWeapon
              ? 0
              : Math.round((nd?.shot_detail?.spot_first_delay ?? 0) / 100 * 60),
            burstSkillCooltime:    nd ? Math.round(
              ((nd.ulti_skill_detail?.skill_cooltime_list?.[(slot.skills[2] >= 1 ? slot.skills[2] : 1) - 1]
                ?? nd.ulti_skill_detail?.skill_cooltime
                ?? 4000) / 100 * 60)
            ) : undefined,
          };
        });

        // 构建技能 tooltip 查找表（按单位名索引）
        this._squadLookup = {};
        activeSlots.forEach((slot, idx) => {
          const unitName     = slot.name || `NIKKE ${idx + 1}`;
          const ssrFavSkills = getSsrFavSkills(slot._favData, slot.favoriteItem?.level ?? 1);
          // 简体显示副本（tooltip 中文描述用）；缺失时为 null，tooltip 回退英文
          const ndZh         = slot._nikkeDataZh;
          const ssrFavZh     = slot._favDataZh ? getSsrFavSkills(slot._favDataZh, slot.favoriteItem?.level ?? 1) : null;
          this._squadLookup[unitName] = {
            weaponType: slot.weaponType,
            cubeData:   slot._cubeData ?? null,
            nd:         slot._nikkeData,
            skillLevels: slot.skills.slice(0, 3),
            rawSkill1: ssrFavSkills?.skill1 ?? slot._nikkeData?.skill1_detail    ?? null,
            rawSkill2: ssrFavSkills?.skill2 ?? slot._nikkeData?.skill2_detail    ?? null,
            rawBurst:  ssrFavSkills?.burst  ?? slot._nikkeData?.ulti_skill_detail ?? null,
            zh: ndZh ? {
              rawSkill1: ssrFavZh?.skill1 ?? ndZh.skill1_detail    ?? null,
              rawSkill2: ssrFavZh?.skill2 ?? ndZh.skill2_detail    ?? null,
              rawBurst:  ssrFavZh?.burst  ?? ndZh.ulti_skill_detail ?? null,
            } : null,
          };
        });
        _logNameMap = _buildLogNameMap(activeSlots, this.zhNames.characters);
        this._nameMapVersion++;

        const ENEMY_TICK_RATE = 60;
        const enemyActions = this.enemy.actions;

        const initDefAction  = enemyActions.find(a => a.startTimeS === 0 && a.type === 'def');
        const initCoreAction = enemyActions.find(a => a.startTimeS === 0 && a.type === 'core');
        const initPosAction  = enemyActions.find(a => a.startTimeS === 0 && a.type === 'position');

        const initCore = initCoreAction?.value ?? 'NONE';
        // 距离 / 隐藏 / 跳起（展开为 JUMP → HIDDEN → 落地距离）→ 引擎相位表
        const positionPhases = buildEnemyPhases(enemyActions, ENEMY_TICK_RATE);
        const defActions = enemyActions
          .filter(a => a.type === 'def' && a.startTimeS > 0)
          .map(a => ({ startTick: Math.round(Number(a.startTimeS) * ENEMY_TICK_RATE), value: Number(a.value) || 0 }))
          .sort((x, y) => x.startTick - y.startTick);
        const coreActions = enemyActions
          .filter(a => a.type === 'core' && a.startTimeS > 0)
          .map(a => ({ startTick: Math.round(Number(a.startTimeS) * ENEMY_TICK_RATE), value: a.value }))
          .sort((x, y) => x.startTick - y.startTick);
        // 横向移动区间 [startTick, endTick)：RL / 弹道技能核心判定用
        const lateralMoves = enemyActions
          .filter(a => a.type === 'lateral' && Number(a.endTimeS) > Number(a.startTimeS))
          .map(a => ({
            startTick: Math.round(Number(a.startTimeS) * ENEMY_TICK_RATE),
            endTick:   Math.round(Number(a.endTimeS)   * ENEMY_TICK_RATE),
            speed:     a.value,
          }))
          .sort((x, y) => x.startTick - y.startTick);

        const baseConfig = {
          squad:    squadConfig,
          enemy: {
            def:            Number(initDefAction?.value) || 100,
            hasCore:        initCore !== 'NONE',
            coreProtected:  initCore === 'PROTECTED',
            coreIsParts:    initCore === 'PARTS_CORE',
            element:        this.enemy.element,
            type:           this.enemy.type,
            phases:         positionPhases,
            // 命中参数（模拟选项 hitCal）：核心命中率模型校准常量
            core0:          Number(this.hitCal.core0)  || 55,
            d0:             Number(this.hitCal.d0)     || 77,
            hitCoef:        Number(this.hitCal.hitCoef) || 4.5,
            // 实战命中校正（0 合法：表示弹丸全部打空）
            sgHitRate:      clampRate(this.hitCal.sgHitRate,  HIT_CAL_DEFAULTS.sgHitRate),
            ...(defActions.length   ? { defActions   } : {}),
            ...(coreActions.length  ? { coreActions  } : {}),
            ...(lateralMoves.length ? { lateralMoves } : {}),
          },
          // 选项不可见（Anis: Star 不在队）时按默认 1 传递，不影响结果
          starCoreCoef: this.hasAnisStar ? clampCoef(this.starCoreCoef) : STAR_CORE_COEF_DEFAULT,
          duration:           180,
          burstStepSecs:      this.burstStepSecs,
          burstDuringHidden:  this.burstDuringHidden === true,
          // 选项不可见（角色不在队 / 不足 3 名 B3）时不向引擎传递该策略
          ebsLastBurstOnly: this.hasEbsBoomAndShock && this.ebsLastBurstOnly,
          mirLastBurstOnly: this.hasMaidenIceRose   && this.mirLastBurstOnly,
          mastBurstMode:    this.effectiveMastBurstMode,
          ccwSnipeModeAtStart: this.hasCinderellaCrystalWave && this.ccwSnipeModeAtStart,
          quickChargeMode:  this.quickChargeSlot ? this.quickChargeMode : 'off',
          // 百暴：仅传队伍中实际出现的所选角色（Miranda 不在队时候选为空 → 关闭）
          fullCritCharIds:  this.effectiveFullCritChar ? [this.effectiveFullCritChar] : [],
        };

        const iters = Math.max(1, Math.min(100, Number(this.iterations) || 30));
        this.simProgress = { done: 0, total: iters };
        // 在 Worker 中运行：主线程保持可响应，模拟内存随线程结束整体释放。
        const { mcResult, hitLog, log } = await runSimulation(baseConfig, iters, {
          onProgress: (done, total) => { this.simProgress = { done, total }; },
        });

        // 冻结大块只读数据：Vue reactive 跳过不可扩展对象，避免为数万条命中记录逐个创建响应式代理。
        this.result        = { ...mcResult, iterations: iters };
        this.hitLogRaw     = Object.freeze(hitLog ?? []);
        this.battleLogRaw  = Object.freeze(log ?? []);
        this.logPage       = 0;
        this._rebuildLog();
        this.saveEnemyPresetIfNew();
        this._recordSimHistory(squadConfig, nikkeLevel, teamSnapshot, focusAtStart);
        _postTrace(baseConfig, hitLog, log ?? [], { ...mcResult, iterations: iters });
      } catch (err) {
        if (!(err instanceof SimCancelledError)) {
          // 错误弹窗（error-report.js）捕获此日志并显示堆栈，无需再 alert
          console.error(this.t('alert.simError', { msg: err.message }), err);
        }
      } finally {
        this.simRunning = false;
      }
    },

    cancelSimulate() {
      cancelSimulation();
    },

    // ── 模拟结果记录 ──────────────────────────────────────────────────────────

    _recordSimHistory(squadConfig, level, team, focusSlot) {
      const record = buildHistoryRecord({
        squadConfig,
        result: this.result,
        enemy:  { element: this.enemy.element, type: this.enemy.type },
        level,
        team,
        focusSlot,
      });
      this.simHistory = addHistoryRecord(this.simHistory, record);
      saveHistory(this.simHistory).then(ok => {
        if (!ok) this.showToast(this.t('history.toast.saveFailed'));
      });
    },

    /**
     * 把记录中的队伍配置应用到当前队伍（替换全部 5 个槽位）。
     * 有完整快照（team）时原样恢复（含装备 / 魔方 / 珍藏品 / 技能等级）；
     * 早期记录只有角色与站位，按选择角色的默认配置（账号数据优先）重建，并恢复爆裂阶段与受控角色。
     */
    applySimHistory(id) {
      const rec = this.simHistory.find(r => r.id === id);
      if (!rec || this.simRunning) return;
      // 深拷贝：避免槽位与记录共享 equipment.opts 等数组，后续编辑队伍时改动记录
      const team = Array.isArray(rec.team) ? JSON.parse(JSON.stringify(rec.team)) : null;

      // 先整体换成新槽位对象，再逐个填充（异步加载按调用时的槽位对象写回）
      this.team = Array.from({ length: 5 }, () => defaultSlot(false));
      if (team) {
        team.slice(0, 5).forEach((saved, i) => { if (saved) this._restoreSlot(i, saved); });
        this.focusSlot = rec.focusSlot ?? null;
      } else {
        this.focusSlot = null;
        for (const u of rec.units) {
          const i = u.position;
          if (!(i >= 0 && i < 5) || !this._assignChar(i, u.characterId)) continue;
          if (u.burstStep) this.team[i].burstStep = u.burstStep;
          if (u.isFocus)   this.focusSlot = i;
        }
      }
      const first = this.team.findIndex(s => s.resourceId);
      this.activeSlot = first >= 0 ? first : 0;
      this.simHistoryOpen = false;
      this.showToast(this.t(team ? 'history.toast.applied' : 'history.toast.appliedPartial'));
    },

    deleteSimHistory(id) {
      this.simHistory = this.simHistory.filter(r => r.id !== id);
      saveHistory(this.simHistory);  // 失败时 saveHistory 内部告警；内存中已删除
    },

    clearSimHistory() {
      if (!this.simHistory.length || !confirm(this.t('history.confirmClear'))) return;
      this.simHistory = [];
      saveHistory(this.simHistory);
    },

    /** 记录时间：YYYY-MM-DD HH:mm:ss（本地时区） */
    fmtHistoryTime(ts) {
      const d   = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    },

    // preserveFilters：切换聚合/详细模式时保留当前的角色、技能、Buff 轨道筛选；
    // 重新模拟时则不传，让筛选恢复默认（全部显示）。
    // mode：按哪种模式构建行，默认当前 logMode（setLogMode 需在切换 logMode 之前先构建）。
    _rebuildLog(preserveFilters = false, mode = this.logMode) {
      if (!this.hitLogRaw || !this.result) { this.hitLogRows = []; return; }
      if (!preserveFilters) {
        this.logHiddenSkillLabels = [];
        this.logActiveBuffTracks  = [];
      }
      const unitNames = Object.fromEntries(
        (this.result.units ?? []).map(u => [u.id, u.name])
      );
      const hitRows   = mode === 'detail'
        ? buildDetailLog(this.hitLogRaw, unitNames)
        : buildAggregateLog(this.hitLogRaw, unitNames);
      const eventRows = buildEventRows(this.battleLogRaw, this._squadLookup, mode);
      // 先在本地（非响应式）数组上完成排序与后处理，最后冻结整体赋值，
      // 避免逐行写入触发响应式追踪，也让模板拿到的行对象不被包装成 Proxy。
      const rows = [...hitRows, ...eventRows].sort((a, b) => {
        const dt = a.tickStart - b.tickStart;
        if (dt !== 0) return dt;
        // 同 tick 内：_seq 还原真实执行顺序（burst_iii/skill_trigger/full_burst/hit 均带 _seq）
        const sa = a._seq ?? Infinity;
        const sb = b._seq ?? Infinity;
        if (sa !== sb) return sa - sb;
        return _logRowOrder(a) - _logRowOrder(b);
      });
      // 标记 Full Burst 区间内的行（从 full_burst 事件到 burst_end/burst_timeout，含首尾）
      // 充能列：每行展示该行事件实际产生的充能增量（delta），并记录变动前后的累计能量供悬浮气泡使用。
      // row.gauge 为引擎记录的事件后累计能量（gaugeAfter，已 cap 到 BURST_GAUGE_MAX）；
      // delta = 本行 gaugeAfter − 上一已知 gaugeAfter。仅 delta>0 视为有效充能；
      // 满能量（增量被 cap 为 0）、能量重置（burst_end/timeout）、未触碰能量的事件均不展示。
      let inFB = false;
      let prevGauge = 0;  // 上一已知累计能量，战斗起始为 0
      for (const row of rows) {
        if (row.kind === 'event' && row.eventType === 'full_burst') inFB = true;
        row.inFullBurst = inFB;
        if (row.kind === 'event' && (row.eventType === 'burst_end' || row.eventType === 'burst_timeout')) inFB = false;
        if (row.gauge != null) {
          const delta = row.gauge - prevGauge;
          if (delta > 0) {
            row.gaugeAdded  = delta;
            row.gaugeBefore = prevGauge;
            row.gaugeAfter  = row.gauge;
          } else {
            row.gaugeAdded = null;
          }
          prevGauge = row.gauge;
        } else {
          row.gaugeAdded = null;
        }
        // 行与其 buff 明细此后只读；冻结后 x-for 作用域不会再为它们创建响应式代理。
        for (const buff of row.buffArr ?? []) Object.freeze(buff);
        Object.freeze(row);
      }
      this.hitLogRows = Object.freeze(rows);
    },

    // ── 日志分页 ──
    logPageCount() {
      return Math.max(1, Math.ceil(this.filteredLogRows().length / LOG_PAGE_SIZE));
    },

    // 筛选条件变化后总页数可能变少，读取时钳制到有效范围。
    _clampedLogPage() {
      return Math.min(this.logPage, this.logPageCount() - 1);
    },

    logPageOffset() {
      return this._clampedLogPage() * LOG_PAGE_SIZE;
    },

    pagedLogRows() {
      const start = this.logPageOffset();
      return this.filteredLogRows().slice(start, start + LOG_PAGE_SIZE);
    },

    setLogPage(page) {
      const last = this.logPageCount() - 1;
      this.logPage = Math.max(0, Math.min(last, Number(page) || 0));
    },

    setLogMode(mode) {
      // 切换聚合/详细只改变行的呈现方式，保留用户已有的角色/技能/Buff 轨道筛选。
      // 顺序很重要：先替换行、后改 logMode。Alpine 调度器在同一轮 flush 中不会重跑已执行过的 effect；
      // 若先改 logMode，行内依赖 logMode 的绑定（如伤害 tooltip 的 :class）会先于 x-for 刷新行作用域执行，
      // 读到旧行后就不再更新。
      this._rebuildLog(true, mode);
      this.logMode = mode;
    },

    logUnitNames() {
      if (!this.result?.units) return [];
      const inLog = new Set(this.hitLogRows.filter(r => r.name).map(r => r.name));
      return this.result.units.map(u => u.name).filter(n => inLog.has(n));
    },

    filteredLogRows() {
      const hiddenUnits  = new Set(this.logHiddenUnits);
      const hiddenSkills = new Set(this.logHiddenSkillLabels);
      const showNormal   = this.showLogNormal;
      const showReload   = this.showLogReload;
      return this.hitLogRows.filter(row => {
        if (row.kind === 'event') {
          // 装填事件由「技能」菜单中的「装填」开关控制，默认隐藏
          if (!showReload && row.eventType === 'reload') return false;
          // 有归属角色的事件行（skill_trigger/reload/burst_i 等）参与角色筛选
          if (row.name && hiddenUnits.has(row.name)) return false;
          // skill_trigger 额外参与技能筛选
          if (row.eventType === 'skill_trigger' && hiddenSkills.has(row.label)) return false;
          return true;
        }
        if (!showNormal && row.label === NORMAL_ATTACK_LABEL) return false;
        if (hiddenSkills.has(row.label)) return false;
        if (row.name && hiddenUnits.has(row.name)) return false;
        return true;
      });
    },

    toggleLogUnit(name) {
      const idx = this.logHiddenUnits.indexOf(name);
      if (idx >= 0) this.logHiddenUnits.splice(idx, 1);
      else this.logHiddenUnits.push(name);
    },

    toggleLogSkill(label) {
      const idx = this.logHiddenSkillLabels.indexOf(label);
      if (idx >= 0) this.logHiddenSkillLabels.splice(idx, 1);
      else this.logHiddenSkillLabels.push(label);
    },

    toggleBuffTrack(name) {
      const idx = this.logActiveBuffTracks.indexOf(name);
      if (idx >= 0) this.logActiveBuffTracks.splice(idx, 1);
      else this.logActiveBuffTracks.push(name);
    },

    buffTrackColorFor(name) {
      const idx = this.logActiveBuffTracks.indexOf(name);
      if (idx < 0) return '';
      return BUFF_TRACK_COLORS[idx % BUFF_TRACK_COLORS.length];
    },

    rowHasBuffTrack(row, buffName) {
      return row.buffArr?.some(b => b.name === buffName) ?? false;
    },

    logAllSkillLabels() {
      const unitSlots = new Map(
        (this.result?.units ?? []).map((u, i) => [u.name, i])
      );
      // 排序键：[角色位置, 技能位置(S1/S2/Burst), P 序号, L 序号]
      // 标签中无 P（或无 L）时序号取 0，排在有序号的同类项之前
      const seen = new Map(); // label → sortKey
      for (const row of this.hitLogRows) {
        if (row.kind === 'event' && row.eventType !== 'skill_trigger') continue;
        if (row.label === NORMAL_ATTACK_LABEL || !row.label) continue;
        if (seen.has(row.label)) continue;
        const unitPos = unitSlots.get(row.name) ?? 99;
        const skillPos = _skillPosOfRow(row, this._squadLookup?.[row.name]);
        const pm = row.label.match(/(?:^|\s)P(\d+)(?=\s|$)/);
        const lm = row.label.match(/(?:^|\s)L(\d+)(?=\s|$)/);
        seen.set(row.label, [unitPos, skillPos, pm ? +pm[1] : 0, lm ? +lm[1] : 0]);
      }
      return [...seen.entries()].sort(_compareSortEntries).map(([label]) => label);
    },

    logAllBuffNames() {
      // 与技能菜单同规则：[来源角色位置, 来源技能位置(S1/S2/Burst), P 序号, L 序号]
      // sourceCaster 为角色名；Buff 名中无 P（或无 L）时序号取 0，排在有序号的同类项之前
      const unitSlots = new Map(
        (this.result?.units ?? []).map((u, i) => [u.name, i])
      );
      const seen = new Map(); // name → sortKey
      for (const row of this.hitLogRows) {
        for (const b of (row.buffArr ?? [])) {
          if (!b.name || seen.has(b.name)) continue;
          const unitPos  = unitSlots.get(b.sourceCaster) ?? 99;
          const skillPos = b.sourceSkillLabel
            ? _skillPosOfRow({ skillKey: b.sourceSkillLabel }, this._squadLookup?.[b.sourceCaster])
            : 99;
          const pm = b.name.match(/(?:^|\s)P(\d+)(?=\s|$)/);
          const lm = b.name.match(/(?:^|\s)L(\d+)(?=\s|$)/);
          seen.set(b.name, [unitPos, skillPos, pm ? +pm[1] : 0, lm ? +lm[1] : 0]);
        }
      }
      return [...seen.entries()].sort(_compareSortEntries).map(([name]) => name);
    },

    showDmgTooltip(event, hitData) {
      const tip = document.getElementById('dmg-tooltip');
      if (!tip) return;
      tip.innerHTML = buildDmgTooltipHTML(hitData, name => this.dispText(name), {
        cubeElemName: this._cubeSkillName(hitData.unitId, 'Elemental Advantage'),
      });
      tip.style.left = '-9999px';
      tip.style.top  = '0px';
      tip.style.display = 'block';
      const rect = tip.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = event.clientX + 16, y = event.clientY + 8;
      if (x + rect.width  > vw) x = event.clientX - rect.width  - 8;
      if (y + rect.height > vh) y = event.clientY - rect.height - 8;
      tip.style.left = x + 'px';
      tip.style.top  = y + 'px';
    },

    /** 命中单位所装备魔方中、描述含关键字的技能原名（英文，显示时经 dispText 翻译）；无则 null */
    _cubeSkillName(unitId, keyword) {
      const unitName = this.result?.units?.find(u => u.id === unitId)?.name;
      const skills   = this._squadLookup?.[unitName]?.cubeData?.harmonycube_skill_group ?? [];
      const skill    = skills.find(s => (s?.description_localkey ?? '').replace(/<[^>]+>/g, '').includes(keyword));
      return skill?.name_localkey ?? null;
    },

    hideDmgTooltip() {
      const tip = document.getElementById('dmg-tooltip');
      if (tip) tip.style.display = 'none';
    },

    /** 点击详细日志伤害数字：把该次命中公式按伤害计算器导入格式（JSON）写入剪贴板 */
    async copyDmgFormula(hitData) {
      const data = buildDmgFormulaExport(hitData, { lang: this.lang, nameFn: name => this.dispText(name) });
      // SG 只导出优先级最高的一个弹丸分类的单颗弹丸公式，提示中注明是哪一类
      const g = pickPelletGroup(hitData);
      try {
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        this.showToast(g
          ? this.t('dmg.copiedPellets', { group: this.t(pelletGroupTitleKey(g)) })
          : this.t('dmg.copied'));
      } catch (err) {
        console.error('伤害公式复制失败:', err);
        this.showToast(this.t('dmg.copyFailed'));
      }
    },

    // ── 充能气泡：展示本行事件的充能变动（变动前 -> 变动后） ──────────────────
    showGaugeTooltip(event, row) {
      if (row.gaugeAdded == null) return;
      const tip = document.getElementById('gauge-tooltip');
      if (!tip) return;
      tip.textContent = `${fmtNum(row.gaugeBefore)}->${fmtNum(row.gaugeAfter)}`;
      tip.style.left = '-9999px';
      tip.style.top  = '0px';
      tip.style.display = 'block';
      const rect = tip.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = event.clientX + 16, y = event.clientY + 8;
      if (x + rect.width  > vw) x = event.clientX - rect.width  - 8;
      if (y + rect.height > vh) y = event.clientY - rect.height - 8;
      tip.style.left = x + 'px';
      tip.style.top  = y + 'px';
    },

    hideGaugeTooltip() {
      const tip = document.getElementById('gauge-tooltip');
      if (tip) tip.style.display = 'none';
    },

    // ── 技能 tooltip ─────────────────────────────────────────────────────────

    showSkillTooltip(event, row) {
      const tip = document.getElementById('skill-tooltip');
      if (!tip) return;
      const html = this._buildSkillTipHTML(row);
      if (!html) { tip.style.display = 'none'; return; }
      tip.innerHTML = html;
      tip.style.left = '-9999px';
      tip.style.top  = '0px';
      tip.style.display = 'block';
      const rect = tip.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = event.clientX + 16, y = event.clientY + 8;
      if (x + rect.width  > vw) x = event.clientX - rect.width  - 8;
      if (y + rect.height > vh) y = event.clientY - rect.height - 8;
      tip.style.left = x + 'px';
      tip.style.top  = y + 'px';
    },

    hideSkillTooltip() {
      const tip = document.getElementById('skill-tooltip');
      if (tip) tip.style.display = 'none';
    },

    // ── Buff tooltip ──────────────────────────────────────────────────────────

    showBuffTooltip(event, buff) {
      const tip = document.getElementById('buff-tooltip');
      if (!tip) return;
      const html = this._buildBuffTipHTML(buff);
      if (!html) { tip.style.display = 'none'; return; }
      tip.innerHTML = html;
      tip.style.left = '-9999px';
      tip.style.top  = '0px';
      tip.style.display = 'block';
      const rect = tip.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = event.clientX + 16, y = event.clientY + 8;
      if (x + rect.width  > vw) x = event.clientX - rect.width  - 8;
      if (y + rect.height > vh) y = event.clientY - rect.height - 8;
      tip.style.left = x + 'px';
      tip.style.top  = y + 'px';
    },

    hideBuffTooltip() {
      const tip = document.getElementById('buff-tooltip');
      if (tip) tip.style.display = 'none';
    },

    _buildBuffTipHTML(buff) {
      const buffName = this.dispText(buff.name);
      if (!buff.sourceCaster || !buff.sourceSkillLabel) {
        return _buffFallbackTipHTML(buff, buffName);
      }
      const unitData = this._squadLookup?.[buff.sourceCaster];
      const fakeRow = { name: buff.sourceCaster, label: buff.sourceSkillLabel, skillKey: buff.sourceSkillLabel };
      const found = _findSkillByRow(fakeRow, unitData);
      if (!found?.skill) return _buffFallbackTipHTML(buff, buffName);

      // buff.name 编码了 P/L（如 "Tighten Up P4 L2"）作为 lineIdx 的兜底来源
      const nameMatch = buff.name.match(/ P(\d+)(?: L(\d+))?$/);
      const partIdxFromName = nameMatch ? parseInt(nameMatch[1], 10) - 1 : null;
      const lineIdxFromName = nameMatch?.[2] != null ? parseInt(nameMatch[2], 10) - 1 : null;

      const partIdx = buff.sourcePartIdx ?? partIdxFromName ?? found.partIdx ?? null;
      const shown   = _localizeFoundSkill(found, unitData, this.lang, partIdx, buff.sourceLineIdx ?? lineIdxFromName ?? null);
      const casterHtml = `<div class="skill-tip-title">${this.dispText(buff.sourceCaster)}</div>`;
      return casterHtml + _skillDescTipHTML(shown.skill, found.level, renderSkillDesc, partIdx, shown.lineIdx);
    },

    _buildSkillTipHTML(row) {
      const unitData = this._squadLookup?.[row.name];

      // 普通攻击行：显示武器属性
      if (row.label === NORMAL_ATTACK_LABEL) {
        return unitData ? _normalAttackTipHTML(unitData) : null;
      }

      // 事件行 row.skillKey 存的是纯 skillLabel（无 P/L），命中日志 row.skillKey 是原始 label
      const rawKey = row.skillKey ?? row.label;

      // lineIdx：事件行直接从 row.lineIdx 取；命中日志行从 rawKey 解析
      const lineIdx = row.lineIdx !== undefined
        ? row.lineIdx
        : (() => { const m = rawKey.match(/ L(\d+)(?=\s|$)/); return m ? parseInt(m[1], 10) - 1 : null; })();

      // 剥离 L 后缀后做技能查找
      const keyWithoutL = rawKey.replace(/ L\d+(?=\s|$)/, '').trim();
      const canonLabel = keyWithoutL.replace(/^((?:S\d+|Burst)(?: P\d+)?) .+$/, '$1');
      const lookupLabel = canonLabel !== keyWithoutL ? canonLabel : keyWithoutL;
      const found = _findSkillByRow({ ...row, label: lookupLabel }, unitData);
      if (!found?.skill) return null;

      // partIdx：事件行直接从 row.partIdx 取；命中日志行从 canonLabel 解析
      const partIdx = row.partIdx !== undefined
        ? row.partIdx
        : (() => { const m = canonLabel.match(/ P(\d+)$/); return m ? parseInt(m[1], 10) - 1 : (found.partIdx ?? null); })();

      const shown = _localizeFoundSkill(found, unitData, this.lang, partIdx, lineIdx);
      return _skillDescTipHTML(shown.skill, found.level, renderSkillDesc, partIdx, shown.lineIdx);
    },

    // ── 结果辅助 ─────────────────────────────────────────────────────────────

    skillDamageRows(unit) {
      if (!unit?.skillDamage) return [];
      const allUnits = this.result?.units ?? [];
      const maxSubDmg = Math.max(
        0,
        ...allUnits.flatMap(u => Object.values(u.skillDamage ?? {}).filter(v => v > 0))
      );
      return Object.entries(unit.skillDamage)
        .filter(([, dmg]) => dmg > 0)
        .map(([rawLabel, dmg]) => ({
          label:    formatHitLabel(rawLabel),
          skillKey: rawLabel,
          name:     unit.name,
          damage:   dmg,
          count:    unit.skillDamageCount?.[rawLabel] ?? 0,
          share:    maxSubDmg > 0 ? dmg / maxSubDmg : 0,
        }))
        .sort((a, b) => b.damage - a.damage);
    },

    unitShare(unit) {
      if (!this.result?.totalDamage || !unit) return 0;
      return unit.totalDamage / this.result.totalDamage;
    },

    // ── echarts 图表（在 main.js 中处理） ────────────────────────────────────
    _chartInstance: null,
  };
}
