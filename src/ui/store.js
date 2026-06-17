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
import { getAllCharacters, getCharacterByResourceId, normalizeCube, getSsrFavSkills } from '../data/models.js';
import { simulate, simulateMonteCarlo } from '../engine/battle.js';
import { computeFinalStats } from '../engine/stats.js';
import { CUBE_NAMES, CUBE_URLS, FAVORITE_ITEM_URLS } from '../data/manifest.js';
import { renderSkillDesc } from './skill-render.js';
import { MODELED_IDS } from '../data/skill-traits.js';

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

const CLASS_LABEL   = { Attacker: '火力型', Defender: '防御型', Supporter: '辅助型' };
const CORP_LABEL    = { ELYSION: '极乐净土', MISSILIS: '米西利斯', TETRA: '泰特拉', PILGRIM: '朝圣者', ABNORMAL: '反常' };
const ELEMENT_LABEL = { Fire: '燃烧', Water: '水冷', Wind: '风压', Electric: '电击', Iron: '铁甲' };

const STORAGE_KEY        = 'nikke-sim-v1';
const ENEMY_PRESETS_KEY  = 'nikke-enemy-presets-v1';

const EQUIP_SLOTS = ['head', 'torso', 'arms', 'legs'];
const EQUIP_SLOT_LABELS = { head: '头部', torso: '躯干', arms: '手臂', legs: '腿部' };

// vals 以整数厘百分比存储（954 表示 9.54%），与 account-loader._OPTION_GROUPS 保持一致
export const EQUIP_OPTION_TYPES = [
  { key: '',               label: '（无）',             unit: '',  vals: [] },
  { key: 'elementDmgPct',  label: '优越代码伤害增加',    unit: '%', vals: [954,1094,1234,1375,1515,1655,1795,1935,2075,2215,2356,2496,2636,2776,2916] },
  { key: 'hitRatePct',     label: '命中率增加',          unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { key: 'equipMaxAmmoPct', label: '最大装弹数增加',      unit: '%', vals: [2784,3195,3606,4017,4428,4839,5250,5660,6071,6482,6893,7304,7715,8126,8537] },
  { key: 'atkPct',         label: '攻击力增加',          unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { key: 'chargeDmgPct',   label: '蓄力伤害增加',        unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { key: 'chargeSpeedPct', label: '蓄力速度增加',        unit: '%', vals: [198,228,257,286,316,345,375,404,433,463,492,521,551,580,609] },
  { key: 'critRatePct',    label: '暴击率增加',          unit: '%', vals: [230,264,298,332,366,400,435,469,503,537,570,605,639,673,707] },
  { key: 'critDamagePct',  label: '暴击伤害增加',        unit: '%', vals: [664,762,860,958,1056,1154,1252,1350,1448,1546,1644,1742,1840,1938,2036] },
  { key: 'defFlat',        label: '防御力增加',          unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
];

const FAV_ITEMS_RS = [
  { id: 100101, name: '指挥官娃娃 (AR·R)',      weapon: 'AR',  rare: 'R'  },
  { id: 100102, name: '指挥官娃娃·限 (AR·SR)',  weapon: 'AR',  rare: 'SR' },
  { id: 100201, name: '指挥官娃娃 (MG·R)',      weapon: 'MG',  rare: 'R'  },
  { id: 100202, name: '指挥官娃娃·限 (MG·SR)',  weapon: 'MG',  rare: 'SR' },
  { id: 100301, name: '指挥官娃娃 (RL·R)',      weapon: 'RL',  rare: 'R'  },
  { id: 100302, name: '指挥官娃娃·限 (RL·SR)',  weapon: 'RL',  rare: 'SR' },
  { id: 100401, name: '指挥官娃娃 (SG·R)',      weapon: 'SG',  rare: 'R'  },
  { id: 100402, name: '指挥官娃娃·限 (SG·SR)',  weapon: 'SG',  rare: 'SR' },
  { id: 100501, name: '指挥官娃娃 (SMG·R)',     weapon: 'SMG', rare: 'R'  },
  { id: 100502, name: '指挥官娃娃·限 (SMG·SR)', weapon: 'SMG', rare: 'SR' },
  { id: 100601, name: '指挥官娃娃 (SR·R)',      weapon: 'SR',  rare: 'R'  },
  { id: 100602, name: '指挥官娃娃·限 (SR·SR)',  weapon: 'SR',  rare: 'SR' },
];

// SSR 珍藏品：角色 resourceId → SSR 珍藏品 resourceId
// 通过读取本地 favorites/*.json 的 name_code 与 characters.json 对照得出
// 规则：此表中的角色技能仅建模 SSR 版本，模拟时必须持有对应满级（Lv15）SSR 珍藏品。
// 详见 docs/ssr-collectible-rules.md
const SSR_FAV_BY_CHAR = {
   32: 200601, // Miranda   → Sheet of Paper
  101: 200801, // Drake     → Villain Figurine
  170: 201401, // Privaty   → Central Government Special Medal
  192: 201101, // Tove      → Fire Starter
  281: 201701, // Moran     → Peony Hairpin
  352: 200701, // Helm      → Antique Compass
  390: 201501, // Zwei      → Four-Leaf Clover Bookmark
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
    `<tr><td>武器类型</td><td>${wt}</td></tr>`,
    `<tr><td>武器伤害</td><td>${dmgPct}</td></tr>`,
  ];
  if (CHARGE_WEAPONS.has(wt) && sd.full_charge_damage != null) {
    const chargePct = (sd.full_charge_damage / 100).toFixed(2) + '%';
    rows.push(`<tr><td>全蓄力伤害</td><td>${chargePct}</td></tr>`);
  }
  rows.push(`<tr><td>核心命中</td><td>${corePct}</td></tr>`);
  return `<div class="skill-tip-title">普通攻击</div><table class="skill-tip-table">${rows.join('')}</table>`;
}

// 根据行数据找到对应技能（skill 对象 + level）
// 对 burst_i/burst_ii/full_burst 事件直接取 rawBurst；
// 对 skill_trigger 和技能伤害行则按 label 匹配三个技能槽。
function _findSkillByRow(row, unitData) {
  if (!unitData) return null;
  // Burst 事件 → burst 技能；isCA 决定高亮哪一段：true=Part0(Stage1)，false=Part1(Stage3)
  if (row.eventType === 'burst_i' || row.eventType === 'burst_ii' || row.eventType === 'burst_iii' || row.eventType === 'full_burst') {
    const partIdx = row.isCA === true ? 0 : row.isCA === false ? 1 : null;
    return { skill: unitData.rawBurst, level: unitData.skillLevels[2] ?? 10, partIdx };
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
    return { skill: rawSkill1, level: skillLevels[0] ?? 10 };
  if (rawSkill2 && (tier === 'S2' || rawSkill2.name_localkey === base))
    return { skill: rawSkill2, level: skillLevels[1] ?? 10 };
  if (rawBurst  && (tier === 'Burst' || rawBurst.name_localkey  === base))
    return { skill: rawBurst,  level: skillLevels[2] ?? 10 };
  return null;
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

function _buffFallbackTipHTML(buff) {
  const rows = [];
  if (buff.atkPct)          rows.push(`<tr><td>ATK ▲</td><td>+${(buff.atkPct * 100).toFixed(1)}%</td></tr>`);
  if (buff.atkFlat)         rows.push(`<tr><td>ATK ▲</td><td>+${buff.atkFlat}</td></tr>`);
  if (buff.attackDamagePct) rows.push(`<tr><td>伤害 ▲</td><td>+${(buff.attackDamagePct * 100).toFixed(1)}%</td></tr>`);
  if (buff.damageTakenPct)  rows.push(`<tr><td>受到伤害 ▲</td><td>+${(buff.damageTakenPct * 100).toFixed(1)}%</td></tr>`);
  if (buff.stacks > 1)      rows.push(`<tr><td>当前叠层</td><td>${buff.stacks}</td></tr>`);
  if (!rows.length) return null;
  return `<div class="skill-tip-name">${buff.name}</div><table class="skill-tip-table">${rows.join('')}</table>`;
}

// ─── 战斗日志聚合 ─────────────────────────────────────────────────────────────

const TICK_RATE = 60;

function formatTick(tick) {
  const t  = tick / TICK_RATE;
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String((t % 60).toFixed(2)).padStart(5, '0');
  return `${mm}:${ss}`;
}

// { name, label, desc } 分别对应 角色列、技能列、事件描述列
const BATTLE_EVENT_COLS = {
  burst_i:      e => ({ name: e.unitName ?? '', label: 'Burst',  desc: 'Burst I' }),
  burst_ii:     e => ({ name: e.unitName ?? '', label: 'Burst',  desc: 'Burst II' }),
  burst_iii:    e => ({ name: e.unitName ?? '', label: 'Burst',  desc: 'Burst III' }),
  full_burst:   e => ({ name: '',              label: 'Burst',  desc: e.burstNum != null ? `Full Burst #${e.burstNum}` : 'Full Burst' }),
  burst_end:    () => ({ name: '',               label: '',       desc: 'Full Burst 结束' }),
  burst_timeout:() => ({ name: '',               label: '',       desc: 'Full Burst 超时' }),
  reload:       e => ({ name: e.unitName ?? '', label: '',       desc: '装填' }),
  phase_change:       e => ({ name: '',              label: '敌人行动', desc: `位置 → ${{ NEAR:'近', MID:'中', FAR:'远', HIDDEN:'隐藏' }[e.zone] ?? e.zone}` }),
  enemy_action:       e => {
    const desc = e.actionType === 'def'
      ? `DEF → ${e.value}`
      : `核心 → ${{ EXPOSED:'暴露核心', PROTECTED:'保护核心', PIERCE_DUAL:'穿透双判核心', NONE:'无核心' }[e.value] ?? e.value}`;
    return { name: '', label: '敌人行动', desc };
  },
  reload_interrupted: e => ({ name: e.unitName ?? '', label: '换弹中断',   desc: '敌人出现' }),
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
  if (label === 'normal_shot') return '普通攻击';
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
      const slot  = e.slot ?? '';
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
      // 有 L 时补充 slot（技能名 S2 L3 或 技能名 S2 P2 L3），否则保持原格式
      if (ln && slot && e.skillLabel !== slot) {
        label = `${e.skillLabel} ${slot}${part}${ln}`;
      } else {
        label = `${e.skillLabel}${part}${ln}`;
      }
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
      h.attackDamagePct ?? 0,
      h.hitMult ?? 1,
      h.distanceAdv ? 1 : 0,
      h.elemMult  ?? 1,
      h.chargeMult ?? 1,
      h.favNormalAttackDamageMult ?? 1,
      h.critDmgInc ?? 0,
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

// ─── 伤害分解 tooltip ────────────────────────────────────────────────────────

const _ELEM_ADV_BASE      = 0.10;
const _BASE_CRIT_DAMAGE   = 0.50;
const _BASE_CORE_DAMAGE   = 1.00;
const _DISTANCE_ADV_BONUS = 0.30;
const _FULL_BURST_BONUS   = 0.50;

function _pct(v, decimals = 2) {
  return (v * 100).toFixed(decimals) + '%';
}
function _numFmt(v) {
  return Math.round(v).toLocaleString();
}

function buildDmgTooltipHTML(h) {
  const bd           = h.buffBreakdown ?? [];
  const enemyDef     = h.enemyDef ?? 0;
  const hitMult      = h.hitMult  ?? 1;
  const favMult      = h.favNormalAttackDamageMult ?? 1;
  const isCrit       = h.isCrit   ?? false;
  const critInc      = h.critDmgInc ?? 0;
  const isCore       = h.isCore   ?? false;
  const coreInc      = h.coreDmgIncrement ?? 0;
  const distAdv      = h.distanceAdv ?? false;
  const isFB         = h.isFullBurst ?? false;
  const elemMult     = h.elemMult ?? 1;
  const chargeMult   = h.chargeMult ?? 1;
  const sustainedPct = h.sustainedDamagePct ?? 0;
  const truePct      = h.trueDamagePct ?? 0;
  const isTrueDmg    = h.isTrueDamage ?? false;

  const coreBufs     = isCore ? bd.filter(b => Math.abs(b.coreDamagePct ?? 0) > 0.0001) : [];
  const coreBufSum   = coreBufs.reduce((s, b) => s + (b.coreDamagePct ?? 0), 0);
  const coreResidual = (isCore && coreInc > 0.0001) ? Math.max(0, coreInc - coreBufSum) : 0;

  // ── 分段构建器 ──────────────────────────────────────────────
  const sects = [];
  const addSect = (title, sub = false) => {
    const s = { title, sub, items: [] };
    sects.push(s);
    return s;
  };
  const addItem = (s, lbl, val, type = 'pct') => s.items.push({ lbl, val, type });
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ── 基础攻击力 ──
  {
    const s = addSect('基础攻击力');
    addItem(s, '', _numFmt(h.atk ?? 0), 'num');
  }

  // ── 攻击力系数（ATK%）──
  const atkPctBufs   = bd.filter(b => Math.abs(b.atkPct ?? 0) > 0.0001);
  const atkPctBufSum = atkPctBufs.reduce((s, b) => s + (b.atkPct ?? 0), 0);
  const atkPctEquip  = (h.atkPct ?? 0) - atkPctBufSum;
  if (Math.abs(h.atkPct ?? 0) > 0.0001) {
    const s = addSect('攻击力系数');
    if (Math.abs(atkPctEquip) > 0.0001) addItem(s, '装备', `+${_pct(atkPctEquip)}`);
    atkPctBufs.forEach(b => addItem(s, b.name, `+${_pct(b.atkPct)}`));
  }

  // ── 固定加成（次一级 sub-section）──
  const atkFlatBufs   = bd.filter(b => Math.abs(b.atkFlat ?? 0) > 0.0001);
  const atkFlatBufSum = atkFlatBufs.reduce((s, b) => s + (b.atkFlat ?? 0), 0);
  const atkFlatEquip  = (h.atkFlat ?? 0) - atkFlatBufSum;
  if (Math.abs(h.atkFlat ?? 0) > 0.0001) {
    const s = addSect('固定加成', true);
    if (Math.abs(atkFlatEquip) > 0.0001) addItem(s, '装备', `+${_numFmt(atkFlatEquip)}`, 'flat');
    atkFlatBufs.forEach(b => addItem(s, b.name, `+${_numFmt(b.atkFlat)}`, 'flat'));
  }

  // ── 防御力 ──
  {
    const s = addSect('防御力');
    addItem(s, '', isTrueDmg ? '真实伤害·无视防御' : `−${_numFmt(enemyDef)}`, isTrueDmg ? 'note' : 'neg');
  }

  // ── 伤害系数 ──
  {
    const s = addSect('伤害系数');
    addItem(s, '', `×${_pct(hitMult)}`, 'pct');
    if (favMult !== 1) addItem(s, '珍藏品普攻倍率', `×${_pct(favMult)}`, 'pct');
  }

  // ── 通用系数（暴击 / 核心 / 距离 / Full Burst）──
  if (isCrit || isCore || distAdv || isFB) {
    const s = addSect('通用系数');
    if (isCrit) {
      addItem(s, '暴击伤害加成', `+${_pct(_BASE_CRIT_DAMAGE + critInc)}`);
    }
    if (isCore) {
      addItem(s, '核心（基础）', `+${_pct(_BASE_CORE_DAMAGE)}`);
      coreBufs.forEach(b => addItem(s, b.name, `+${_pct(b.coreDamagePct)}`));
      if (coreResidual > 0.0001) addItem(s, '核心伤害增加', `+${_pct(coreResidual)}`);
    }
    if (distAdv) addItem(s, '距离优势',  `+${_pct(_DISTANCE_ADV_BONUS)}`);
    if (isFB)    addItem(s, 'Full Burst', `+${_pct(_FULL_BURST_BONUS)}`);
  }

  // ── 优越代码加成 ──
  if (elemMult > 1.0001) {
    const equipElemPct = h.equipElementDmgPct ?? 0;
    const cubeElemPct  = (h.elementDmgPct ?? 0) - equipElemPct;
    const elemBufs     = bd.filter(b => Math.abs(b.elementAdvantagePct ?? 0) > 0.0001);
    const s = addSect('优越代码加成');
    addItem(s, '基础', `+${_pct(_ELEM_ADV_BASE)}`);
    if (Math.abs(equipElemPct) > 0.0001) addItem(s, '装备', `+${_pct(equipElemPct)}`);
    if (Math.abs(cubeElemPct)  > 0.0001) addItem(s, '魔方', `+${_pct(cubeElemPct)}`);
    elemBufs.forEach(b => addItem(s, b.name, `+${_pct(b.elementAdvantagePct)}`));
  }

  // ── 蓄力系数 ──
  if (Math.abs(chargeMult - 1) > 0.0001) {
    const chargeBufs   = bd.filter(b => Math.abs(b.chargeDamagePct ?? 0) > 0.0001);
    const chargeBufSum = chargeBufs.reduce((s, b) => s + (b.chargeDamagePct ?? 0), 0);
    const equipCharge  = h.equipChargeDmgPct ?? 0;
    const chargeBase   = chargeMult - equipCharge - chargeBufSum;
    const s = addSect('蓄力系数');
    if (Math.abs(equipCharge) > 0.0001 || chargeBufs.length > 0) {
      addItem(s, '武器基础', `${_pct(chargeBase)}`);
      if (Math.abs(equipCharge) > 0.0001) addItem(s, '装备', `+${_pct(equipCharge)}`);
      chargeBufs.forEach(b => addItem(s, b.name, `+${_pct(b.chargeDamagePct)}`));
    } else {
      addItem(s, '', `×${_pct(chargeMult)}`, 'pct');
    }
  }

  // ── 伤害加成（ExtraMultiplier）──
  const extraBufs = bd.filter(b =>
    Math.abs(b.attackDamagePct           ?? 0) > 0.0001 ||
    Math.abs(b.pierceDamagePct           ?? 0) > 0.0001 ||
    Math.abs(b.sequentialAttackDamagePct ?? 0) > 0.0001
  );
  const extraFallback = extraBufs.length === 0 && (
    Math.abs(h.attackDamagePct           ?? 0) > 0.0001 ||
    Math.abs(h.pierceDamagePct           ?? 0) > 0.0001 ||
    Math.abs(h.sequentialAttackDamagePct ?? 0) > 0.0001
  );
  const hasExtra = extraBufs.length > 0 || extraFallback
    || Math.abs(sustainedPct) > 0.0001 || Math.abs(truePct) > 0.0001;

  if (hasExtra) {
    const s = addSect('伤害加成');
    if (extraBufs.length > 0) {
      extraBufs.forEach(b => {
        if (Math.abs(b.attackDamagePct           ?? 0) > 0.0001) addItem(s, b.name, `+${_pct(b.attackDamagePct)}`);
        if (Math.abs(b.pierceDamagePct           ?? 0) > 0.0001) addItem(s, b.name, `+${_pct(b.pierceDamagePct)}`);
        if (Math.abs(b.sequentialAttackDamagePct ?? 0) > 0.0001) addItem(s, b.name, `+${_pct(b.sequentialAttackDamagePct)}`);
      });
    } else {
      if (Math.abs(h.attackDamagePct           ?? 0) > 0.0001) addItem(s, '攻击伤害增加',     `+${_pct(h.attackDamagePct)}`);
      if (Math.abs(h.pierceDamagePct           ?? 0) > 0.0001) addItem(s, '穿透伤害增加',     `+${_pct(h.pierceDamagePct)}`);
      if (Math.abs(h.sequentialAttackDamagePct ?? 0) > 0.0001) addItem(s, '依次攻击伤害增加', `+${_pct(h.sequentialAttackDamagePct)}`);
    }
    if (Math.abs(sustainedPct) > 0.0001) addItem(s, '持续伤害增加',       `+${_pct(sustainedPct)}`);
    if (Math.abs(truePct)      > 0.0001) addItem(s, '无视防御力伤害增加', `+${_pct(truePct)}`);
  }

  // ── 受创加深（DamageTakenLikeMultiplier）──
  const debuffBufs = bd.filter(b => b.isEnemyDebuff && Math.abs(b.damageTakenPct ?? 0) > 0.0001);
  if (debuffBufs.length > 0) {
    const s = addSect('受创加深');
    debuffBufs.forEach(b => addItem(s, b.name, `+${_pct(b.damageTakenPct)}`));
  } else if (Math.abs(h.damageTakenPct ?? 0) > 0.0001) {
    const s = addSect('受创加深');
    addItem(s, '受创伤害增加', `+${_pct(h.damageTakenPct)}`);
  }

  // ── 渲染 ────────────────────────────────────────────────────
  const typeClass = t =>
    t === 'flat' ? 'dmg-tip-flat' :
    t === 'neg'  ? 'dmg-tip-neg'  :
    t === 'num'  ? 'dmg-tip-num'  :
    t === 'note' ? 'dmg-tip-note' : 'dmg-tip-pct';

  const sectHtml = sects.map(s => {
    const hdHtml   = `<div class="dmg-tip-hd">${esc(s.title)}</div>`;
    const rowsHtml = s.items.map(({ lbl, val, type }) =>
      `<div class="dmg-tip-row"><span class="dmg-tip-lbl">${esc(lbl)}</span><span class="${typeClass(type)}">${val}</span></div>`
    ).join('');
    return `<div class="dmg-tip-sect${s.sub ? ' dmg-tip-sect--sub' : ''}">${hdHtml}${rowsHtml}</div>`;
  }).join('');

  const resultHtml = `<div class="dmg-tip-result"><span class="dmg-tip-result-lbl">最终伤害</span><span class="dmg-tip-result-val">${_numFmt(h.damage ?? 0)}</span></div>`;

  return `<div class="dmg-tip">${sectHtml}${resultHtml}</div>`;
}

// ─── store 工厂 ────────────────────────────────────────────────────────────────

export function createStore() {
  return {
    // 加载状态
    loading:       true,
    loadProgress:  '正在初始化…',
    accountStatus: '',
    devMode:       false,

    // 全局设置
    synchroLevel:    200,
    generalResearch: 200,
    classResearch:   { attacker: 0, defender: 0, supporter: 0 },
    corpResearch:    { ELYSION: 0, MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0 },

    // 敌人
    enemy: {
      element:  'Iron',
      type:     'Boss',
      // 行动阶段：前3条固定（时间=0，类型固定），后续可增删
      // 默认值参考联盟射击场 BIGARMS
      actions: [
        { id: 1, startTimeS: 0, type: 'def',      value: 100 },
        { id: 2, startTimeS: 0, type: 'core',     value: 'EXPOSED' },
        { id: 3, startTimeS: 0, type: 'position', value: 'MID' },
      ],
      _nextId: 4,
    },

    // 敌人配置预设
    enemyPresets:     [],
    selectedPresetId: null,

    // 模拟选项
    iterations:         30,
    burstStepSecs:      0.6,
    ebsLastBurstOnly: true,

    // 队伍
    activeSlot:   0,
    team:         Array.from({ length: 5 }, (_, i) => defaultSlot(i === 0)),

    // 角色选择器
    allChars:        [],
    charQuery:       '',
    charPickerSlot:  -1,

    // 结果
    result:        null,
    hitLogRows:    [],
    hitLogRaw:     null,
    battleLogRaw:  null,
    simRunning:    false,
    logMode:             'aggregate',
    logHiddenUnits:      [],
    logHiddenSkillLabels: [],
    logActiveBuffTracks: [],
    showLogNormal:       false,
    _squadLookup:  null,

    // 常量（模板使用）
    EQUIP_SLOTS,
    EQUIP_SLOT_LABELS,
    EQUIP_OPTION_TYPES,
    FAV_ITEMS_RS,
    cubeOptions: [],

    // ── 标签辅助 ──
    classLabel(c)   { return CLASS_LABEL[c]   ?? c; },
    corpLabel(c)    { return CORP_LABEL[c]    ?? c; },
    elementLabel(e) { return ELEMENT_LABEL[e] ?? e; },
    burstLabel(b)   { return ({ Step1: 'B-I', Step2: 'B-II', Step3: 'B-III' })[b] ?? b; },
    equipTypeOptions() {
      return EQUIP_OPTION_TYPES.map(ot =>
        `<option value="${ot.key}">${ot.label}</option>`
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
    fmtGauge(gauge) {
      if (gauge == null) return '—';
      return (gauge / 10000).toFixed(1) + '%';
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

    // 队伍中是否有 Elegg: Boom and Shock / EBS（resource_id: 502）
    get hasEbsBoomAndShock() {
      return this.team.some(s => s.active && s.resourceId === 502);
    },

    maxBond(grade, corp) { return maxBond(grade, corp); },

    get filteredChars() {
      const q = (this.charQuery ?? '').toLowerCase().trim();
      if (!q) return this.allChars;
      return this.allChars.filter(c => c.name.toLowerCase().includes(q));
    },

    favItemsForSlot(slotIdx) {
      const slot = this.team[slotIdx];
      if (!slot?.weaponType) return FAV_ITEMS_RS;
      const byWeapon = FAV_ITEMS_RS.filter(f => f.weapon === slot.weaponType);
      if (!slot.resourceId) return byWeapon;
      const ssrId = SSR_FAV_BY_CHAR[slot.resourceId];
      if (!ssrId) return byWeapon;
      return [...byWeapon, { id: ssrId, name: 'SSR珍藏品', weapon: slot.weaponType, rare: 'SSR' }];
    },

    // ── 初始化 ────────────────────────────────────────────────────────────────

    async init() {
      try {
        await loadAllData((key, done, total) => {
          this.loadProgress = `加载 ${key}… (${done}/${total})`;
        });
      } catch (err) {
        this.loadProgress = `部分数据加载失败：${err.message}`;
      }

      this.allChars    = getAllCharacters().map(c => ({ ...c, modeled: MODELED_IDS.has(c.resourceId) }));
      this.cubeOptions = Object.entries(CUBE_URLS)
        .map(([id]) => ({ id: Number(id), name: CUBE_NAMES[id] ?? `魔方 ${id}` }))
        .sort((a, b) => a.id - b.id);

      const accountLoaded = await loadAccountFromDev();
      if (accountLoaded) {
        this.devMode       = true;
        this.accountStatus = `账号已加载，共 ${getAccountSize()} 个角色`;
        const settings = getAccountSettings();
        this._applySettings(settings);
      } else {
        this.devMode       = false;
        this.accountStatus = '未找到账号文件（手动模式）';
      }

      // 恢复上次保存的状态（在账号默认值之后，用户自定义优先）
      const _saved = localStorage.getItem(STORAGE_KEY);
      if (_saved) {
        try { this._restoreSnapshot(JSON.parse(_saved)); } catch {}
      }

      this._loadEnemyPresetsFromStorage();
      this.loading = false;
    },

    // ── 账号导入 ──────────────────────────────────────────────────────────────

    async reloadAccountFromDev() {
      this.accountStatus = '正在重新加载…';
      const ok = await loadAccountFromDev();
      if (!ok) {
        this.accountStatus = '⚠ 读取 dev/config.json 失败';
        return;
      }
      const settings = getAccountSettings();
      this._applySettings(settings);
      this.accountStatus = `✓ 账号已更新，共 ${getAccountSize()} 个角色`;
      for (let i = 0; i < 5; i++) {
        const slot = this.team[i];
        if (!slot.resourceId) continue;
        const entry = getRosterEntry(slot.resourceId);
        if (entry) this._applyRosterEntry(i, entry);
      }
    },

    async importAccount(file) {
      if (!file) return;
      this.accountStatus = '正在导入…';
      const ok = await loadAccountFromJson(file);
      if (!ok) {
        this.accountStatus = '⚠ 导入失败，请检查文件格式';
        return;
      }
      const settings = getAccountSettings();
      this._applySettings(settings);
      this.accountStatus = `✓ 账号已更新，共 ${getAccountSize()} 个角色`;

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
        burstStepSecs:      this.burstStepSecs,
        ebsLastBurstOnly: this.ebsLastBurstOnly,
        team: this.team.map(slot => ({
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
        })),
      };
    },

    _restoreSnapshot(state) {
      if (!state) return;
      if (state.synchroLevel    != null) this.synchroLevel    = state.synchroLevel;
      if (state.generalResearch != null) this.generalResearch = state.generalResearch;
      if (state.classResearch)  Object.assign(this.classResearch, state.classResearch);
      if (state.corpResearch)   Object.assign(this.corpResearch,  state.corpResearch);
      if (state.enemy) {
        const e = state.enemy;
        if (Array.isArray(e.actions)) {
          // 新格式
          this.enemy.element  = e.element  ?? this.enemy.element;
          this.enemy.type     = e.type     ?? this.enemy.type;
          this.enemy.actions  = e.actions.map(a => ({ ...a }));
          this.enemy._nextId  = e._nextId  ?? (this.enemy.actions.reduce((m, a) => Math.max(m, a.id), 0) + 1);
        } else {
          // 旧格式迁移：def/hasCore/distNear/distMid/distFar → actions
          this.enemy.element = e.element ?? this.enemy.element;
          this.enemy.type    = e.type    ?? this.enemy.type;
          const coreVal = e.hasCore ? 'EXPOSED' : 'NONE';
          let posVal = 'MID';
          if ((e.distNear ?? 0) > 0) posVal = 'NEAR';
          else if ((e.distFar ?? 0) > 0) posVal = 'FAR';
          this.enemy.actions = [
            { id: 1, startTimeS: 0, type: 'def',      value: e.def ?? 500 },
            { id: 2, startTimeS: 0, type: 'core',     value: coreVal },
            { id: 3, startTimeS: 0, type: 'position', value: posVal },
          ];
          this.enemy._nextId = 4;
        }
      }
      if (state.iterations          != null) this.iterations          = state.iterations;
      if (state.burstStepSecs       != null) this.burstStepSecs       = state.burstStepSecs;
      if (state.ebsLastBurstOnly  != null) this.ebsLastBurstOnly  = state.ebsLastBurstOnly;
      if (!Array.isArray(state.team)) return;
      state.team.forEach((saved, i) => {
        if (i >= this.team.length || !saved) return;
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
      });
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

      const char = getCharacterByResourceId(resourceId);
      if (!char) return;

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
    },

    clearSlot(i) {
      this.team[i] = defaultSlot(false);
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
        // 类型切换时重置值为合理默认
        const defaults = { def: 500, core: 'NONE', position: 'MID' };
        action.value = defaults[val] ?? 500;
      }
      action[field] = val;
    },

    // ── 敌人配置预设 ──────────────────────────────────────────────────────────

    _loadEnemyPresetsFromStorage() {
      try {
        const raw = localStorage.getItem(ENEMY_PRESETS_KEY);
        this.enemyPresets = raw ? JSON.parse(raw) : [];
      } catch {
        this.enemyPresets = [];
      }
    },

    _saveEnemyPresetsToStorage() {
      localStorage.setItem(ENEMY_PRESETS_KEY, JSON.stringify(this.enemyPresets));
    },

    _getEnemyConfigSignature() {
      const actions = this.enemy.actions
        .map(({ startTimeS, type, value }) => `${startTimeS}|${type}|${value}`)
        .join(',');
      return `${this.enemy.element}:${this.enemy.type}:${actions}`;
    },

    saveEnemyPresetIfNew() {
      const sig = this._getEnemyConfigSignature();
      if (this.enemyPresets.some(p => p._sig === sig)) return;
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
          actions: this.enemy.actions.map(({ startTimeS, type, value }) => ({ startTimeS, type, value })),
        },
      });
      this._saveEnemyPresetsToStorage();
    },

    loadEnemyPreset(id) {
      if (!id) return;
      const preset = this.enemyPresets.find(p => p.id === id);
      if (!preset) return;
      this.enemy.element = preset.config.element;
      this.enemy.type    = preset.config.type;
      this.enemy.actions = preset.config.actions.map((a, i) => ({ ...a, id: i + 1 }));
      this.enemy._nextId = preset.config.actions.length + 1;
      this.selectedPresetId = id;
    },

    deleteEnemyPreset(id) {
      this.enemyPresets = this.enemyPresets.filter(p => p.id !== id);
      if (this.selectedPresetId === id) this.selectedPresetId = null;
      this._saveEnemyPresetsToStorage();
    },

    renameEnemyPreset(id) {
      const preset = this.enemyPresets.find(p => p.id === id);
      if (!preset) return;
      const name = prompt('请输入新名称：', preset.name);
      if (name === null || name.trim() === '') return;
      preset.name = name.trim();
      this._saveEnemyPresetsToStorage();
    },

    // ── 魔方 ──────────────────────────────────────────────────────────────────

    async onCubeChange(i) {
      const slot = this.team[i];
      slot._cubeData = null;
      if (slot.cube.resourceId) {
        await this._loadCubeData(i, slot.cube.resourceId);
      }
    },

    async _loadCubeData(i, resourceId) {
      try {
        const data = await loadCube(resourceId);
        this.team[i]._cubeData = data;
      } catch (err) {
        console.error(`[slot ${i}] Cube ${resourceId} 加载失败:`, err?.message ?? err);
        this.team[i]._cubeData = null;
      }
    },

    // ── 珍藏品 ────────────────────────────────────────────────────────────────

    async onFavChange(i) {
      const slot = this.team[i];
      slot._favData = null;
      if (slot.favoriteItem.resourceId) {
        await this._loadFavData(i, slot.favoriteItem.resourceId);
      }
    },

    async _loadFavData(i, resourceId) {
      try {
        const data = await loadFavoriteItem(resourceId);
        this.team[i]._favData = data;
      } catch (err) {
        console.error(`[slot ${i}] FavItem ${resourceId} 加载失败:`, err?.message ?? err);
        this.team[i]._favData = null;
      }
    },

    // ── NIKKE CDN 数据 ────────────────────────────────────────────────────────

    async _loadNikkeData(i, resourceId) {
      const slot = this.team[i];
      slot._loading   = true;
      slot._nikkeData = null;
      try {
        slot._nikkeData = await loadNikke(resourceId);
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

    // 返回 slot 第 skillIndex（0/1/2）个技能的有效 skillDetail：
    // SSR 珍藏品已加载时，从 favoriteitem_skill_group_data 读取；否则从角色 nikke 数据读取。
    effectiveSkillDetail(slotIdx, skillIndex) {
      const slot = this.team[slotIdx];
      const fsg  = slot?._favData?.favoriteitem_skill_group_data;
      if (fsg?.length) {
        const entry = fsg.find(e => e.skill_change_slot === skillIndex + 1);
        if (entry?.info) return entry.info;
      }
      const nd = slot?._nikkeData;
      return [nd?.skill1_detail, nd?.skill2_detail, nd?.ulti_skill_detail][skillIndex] ?? null;
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
        const cube  = normalizeCube(slot._cubeData);
        const level = slot.cube.level;
        return cube.skills.map((skill, si) => {
          const skillLv = cube.levels[si]?.[level - 1] ?? 0;
          if (!skillLv) return '';
          const desc = renderSkillDesc(
            skill.description_localkey ?? '',
            skill.description_value_list ?? [],
            skillLv
          );
          const name = skill.name_localkey ?? `技能 ${si + 1}`;
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
      const fav   = slot._favData;
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
        const name = skill.name_localkey ?? `被动 ${si + 1}`;
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
          this.synchroLevel,
          this._research()
        );
      } catch { return null; }
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
        alert('请至少启用一个 NIKKE 槽位并选择角色。');
        return;
      }

      // SSR 珍藏品强制校验：技能已按 SSR 版本建模的角色必须持有对应满级（Lv15）SSR 珍藏品
      const ssrErrors = [];
      for (const slot of activeSlots) {
        const requiredSsrId = SSR_FAV_BY_CHAR[slot.resourceId];
        if (!requiredSsrId) continue;
        const charLabel = slot.name || `角色 ${slot.resourceId}`;
        if (slot.favoriteItem.resourceId !== requiredSsrId) {
          ssrErrors.push(`${charLabel}：技能已按 SSR 珍藏品建模，必须持有其专属 SSR 珍藏品（id: ${requiredSsrId}）。`);
        } else if ((slot.favoriteItem.level ?? 0) < SSR_FAV_MAX_ITEM_LEVEL) {
          ssrErrors.push(`${charLabel}：SSR 珍藏品须升至满级（Lv15），当前为 Lv${['5','10','15'][slot.favoriteItem.level ?? 0] ?? slot.favoriteItem.level}。`);
        }
      }
      if (ssrErrors.length) {
        alert('配置错误——无法开始模拟：\n\n' + ssrErrors.join('\n'));
        return;
      }

      this.simRunning   = true;
      this.result       = null;
      this.hitLogRows   = [];
      this.hitLogRaw    = null;
      this.battleLogRaw = null;
      this._squadLookup = null;

      await new Promise(r => setTimeout(r, 10));

      try {
        const research    = this._research();
        const squadStats  = activeSlots.map(slot =>
          computeFinalStats(
            { ...slot, _favItemData: slot._favData, equipOptions: aggregateEquipOptions(slot.equipment) },
            this.synchroLevel,
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
            level:                 this.synchroLevel,
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
          this._squadLookup[unitName] = {
            weaponType: slot.weaponType,
            nd:         slot._nikkeData,
            skillLevels: slot.skills.slice(0, 3),
            rawSkill1: ssrFavSkills?.skill1 ?? slot._nikkeData?.skill1_detail    ?? null,
            rawSkill2: ssrFavSkills?.skill2 ?? slot._nikkeData?.skill2_detail    ?? null,
            rawBurst:  ssrFavSkills?.burst  ?? slot._nikkeData?.ulti_skill_detail ?? null,
          };
        });

        const ENEMY_TICK_RATE = 60;
        const enemyActions = this.enemy.actions;

        const initDefAction  = enemyActions.find(a => a.startTimeS === 0 && a.type === 'def');
        const initCoreAction = enemyActions.find(a => a.startTimeS === 0 && a.type === 'core');
        const initPosAction  = enemyActions.find(a => a.startTimeS === 0 && a.type === 'position');

        const initCore = initCoreAction?.value ?? 'NONE';
        const positionPhases = enemyActions
          .filter(a => a.type === 'position')
          .map(a => ({ startTick: Math.round(Number(a.startTimeS) * ENEMY_TICK_RATE), zone: a.value }))
          .sort((x, y) => x.startTick - y.startTick);
        const defActions = enemyActions
          .filter(a => a.type === 'def' && a.startTimeS > 0)
          .map(a => ({ startTick: Math.round(Number(a.startTimeS) * ENEMY_TICK_RATE), value: Number(a.value) || 0 }))
          .sort((x, y) => x.startTick - y.startTick);
        const coreActions = enemyActions
          .filter(a => a.type === 'core' && a.startTimeS > 0)
          .map(a => ({ startTick: Math.round(Number(a.startTimeS) * ENEMY_TICK_RATE), value: a.value }))
          .sort((x, y) => x.startTick - y.startTick);

        const baseConfig = {
          squad:    squadConfig,
          enemy: {
            def:            Number(initDefAction?.value) || 100,
            hasCore:        initCore !== 'NONE' && initCore !== 'PARTS',
            coreProtected:  initCore === 'PROTECTED',
            corePierceDual: initCore === 'PIERCE_DUAL',
            hasParts:       initCore === 'PARTS',
            element:        this.enemy.element,
            type:           this.enemy.type,
            phases:         positionPhases,
            ...(defActions.length  ? { defActions  } : {}),
            ...(coreActions.length ? { coreActions } : {}),
          },
          duration:           180,
          burstStepSecs:      this.burstStepSecs,
          ebsLastBurstOnly: this.ebsLastBurstOnly,
        };

        const iters     = Math.max(1, Math.min(100, Number(this.iterations) || 30));
        const mcResult  = simulateMonteCarlo(baseConfig, iters);
        const single    = simulate({ ...baseConfig, hitLog: true });

        this.result        = { ...mcResult, iterations: iters };
        this.hitLogRaw     = single.hitLog;
        this.battleLogRaw  = single.log ?? [];
        this._rebuildLog();
        this.saveEnemyPresetIfNew();
        _postTrace(baseConfig, single.hitLog, single.log ?? [], { ...mcResult, iterations: iters });
      } catch (err) {
        console.error('模拟出错:', err);
        alert(`模拟出错：${err.message}`);
      } finally {
        this.simRunning = false;
      }
    },

    _rebuildLog() {
      if (!this.hitLogRaw || !this.result) { this.hitLogRows = []; return; }
      this.logHiddenSkillLabels = [];
      this.logActiveBuffTracks  = [];
      const unitNames = Object.fromEntries(
        (this.result.units ?? []).map(u => [u.id, u.name])
      );
      const hitRows   = this.logMode === 'detail'
        ? buildDetailLog(this.hitLogRaw, unitNames)
        : buildAggregateLog(this.hitLogRaw, unitNames);
      const eventRows = buildEventRows(this.battleLogRaw, this._squadLookup, this.logMode);
      this.hitLogRows = [...hitRows, ...eventRows].sort((a, b) => {
        const dt = a.tickStart - b.tickStart;
        if (dt !== 0) return dt;
        // 同 tick 内：_seq 还原真实执行顺序（burst_iii/skill_trigger/full_burst/hit 均带 _seq）
        const sa = a._seq ?? Infinity;
        const sb = b._seq ?? Infinity;
        if (sa !== sb) return sa - sb;
        return _logRowOrder(a) - _logRowOrder(b);
      });
      // 标记 Full Burst 区间内的行（从 full_burst 事件到 burst_end/burst_timeout，含首尾）
      // 并做充能列 fill-forward：每行继承上一行的 gauge 值，直到出现新值
      let inFB = false;
      let lastGauge = null;
      for (const row of this.hitLogRows) {
        if (row.kind === 'event' && row.eventType === 'full_burst') inFB = true;
        row.inFullBurst = inFB;
        if (row.kind === 'event' && (row.eventType === 'burst_end' || row.eventType === 'burst_timeout')) inFB = false;
        if (row.gauge != null) lastGauge = row.gauge;
        else row.gauge = lastGauge;
      }
    },

    setLogMode(mode) {
      this.logMode = mode;
      this._rebuildLog();
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
      return this.hitLogRows.filter(row => {
        if (row.kind === 'event') {
          // 有归属角色的事件行（skill_trigger/reload/burst_i 等）参与角色筛选
          if (row.name && hiddenUnits.has(row.name)) return false;
          // skill_trigger 额外参与技能筛选
          if (row.eventType === 'skill_trigger' && hiddenSkills.has(row.label)) return false;
          return true;
        }
        if (!showNormal && row.label === '普通攻击') return false;
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
      const seen = new Map(); // label → sortKey
      for (const row of this.hitLogRows) {
        if (row.kind === 'event' && row.eventType !== 'skill_trigger') continue;
        if (row.label === '普通攻击' || !row.label) continue;
        if (seen.has(row.label)) continue;
        const slot = unitSlots.get(row.name) ?? 99;
        const sk   = row.skillKey ?? row.label;
        const skillType = /^S1\b/.test(sk) ? 0 : /^S2\b/.test(sk) ? 1 : /^Burst\b/i.test(sk) ? 2 : 99;
        const pm   = sk.match(/P(\d+)/) ?? row.label?.match(/P(\d+)/);
        const part = pm ? parseInt(pm[1]) - 1 : 0;
        seen.set(row.label, slot * 100000 + skillType * 1000 + part);
      }
      return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
    },

    logAllBuffNames() {
      const unitSlots = new Map(
        (this.result?.units ?? []).map((u, i) => [u.id, i])
      );
      const seen = new Map(); // name → sortKey
      for (const row of this.hitLogRows) {
        for (const b of (row.buffArr ?? [])) {
          if (!b.name || seen.has(b.name)) continue;
          const slot = unitSlots.get(b.sourceCaster) ?? 99;
          const sk   = b.sourceSkillLabel ?? '';
          const skillType = /^S1\b/.test(sk) ? 0 : /^S2\b/.test(sk) ? 1 : /^Burst\b/i.test(sk) ? 2 : 99;
          const part = b.sourcePartIdx ?? 0;
          seen.set(b.name, slot * 100000 + skillType * 1000 + part);
        }
      }
      return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
    },

    showDmgTooltip(event, hitData) {
      const tip = document.getElementById('dmg-tooltip');
      if (!tip) return;
      tip.innerHTML = buildDmgTooltipHTML(hitData);
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

    hideDmgTooltip() {
      const tip = document.getElementById('dmg-tooltip');
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
      if (!buff.sourceCaster || !buff.sourceSkillLabel) {
        return _buffFallbackTipHTML(buff);
      }
      const unitData = this._squadLookup?.[buff.sourceCaster];
      const fakeRow = { name: buff.sourceCaster, label: buff.sourceSkillLabel, skillKey: buff.sourceSkillLabel };
      const found = _findSkillByRow(fakeRow, unitData);
      if (!found?.skill) return _buffFallbackTipHTML(buff);

      // buff.name 编码了 P/L（如 "Tighten Up P4 L2"）作为 lineIdx 的兜底来源
      const nameMatch = buff.name.match(/ P(\d+)(?: L(\d+))?$/);
      const partIdxFromName = nameMatch ? parseInt(nameMatch[1], 10) - 1 : null;
      const lineIdxFromName = nameMatch?.[2] != null ? parseInt(nameMatch[2], 10) - 1 : null;

      const partIdx = buff.sourcePartIdx ?? partIdxFromName ?? found.partIdx ?? null;
      const lineIdx = buff.sourceLineIdx ?? lineIdxFromName ?? null;
      const casterHtml = `<div class="skill-tip-title">${buff.sourceCaster}</div>`;
      return casterHtml + _skillDescTipHTML(found.skill, found.level, renderSkillDesc, partIdx, lineIdx);
    },

    _buildSkillTipHTML(row) {
      const unitData = this._squadLookup?.[row.name];

      // 普通攻击行：显示武器属性
      if (row.label === '普通攻击') {
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

      return _skillDescTipHTML(found.skill, found.level, renderSkillDesc, partIdx, lineIdx);
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
