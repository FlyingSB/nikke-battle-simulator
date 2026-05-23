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
import { getAllCharacters, getCharacterByResourceId, normalizeCube } from '../data/models.js';
import { simulate, simulateMonteCarlo } from '../engine/battle.js';
import { computeFinalStats } from '../engine/stats.js';
import { CUBE_NAMES, CUBE_URLS, FAVORITE_ITEM_URLS } from '../data/manifest.js';
import { renderSkillDesc } from './skill-render.js';
import { MODELED_IDS } from '../data/skill-traits.js';

// ─── 常量 ──────────────────────────────────────────────────────────────────

const CLASS_LABEL   = { Attacker: '攻击手', Defender: '防御手', Supporter: '支援手' };
const CORP_LABEL    = { ELYSION: '极乐净土', MISSILIS: '米西利斯', TETRA: '泰特拉', PILGRIM: '朝圣者', ABNORMAL: '反常' };
const ELEMENT_LABEL = { Fire: '火', Water: '水', Wind: '风', Electric: '电', Iron: '铁' };

const STORAGE_KEY = 'nikke-sim-v1';

const EQUIP_SLOTS = ['head', 'torso', 'arms', 'legs'];
const EQUIP_SLOT_LABELS = { head: '头部', torso: '躯干', arms: '手臂', legs: '腿部' };

// vals 以整数厘百分比存储（954 表示 9.54%），与 account-loader._OPTION_GROUPS 保持一致
export const EQUIP_OPTION_TYPES = [
  { key: '',               label: '（无）',             unit: '',  vals: [] },
  { key: 'atkPct',         label: '攻击力增加',          unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { key: 'atkFlat',        label: '攻击力增加（固定值）', unit: '',  vals: [] },
  { key: 'critRatePct',    label: '暴击率增加',          unit: '%', vals: [230,264,298,332,366,400,435,469,503,537,570,605,639,673,707] },
  { key: 'critDmgPct',     label: '暴击伤害增加',        unit: '%', vals: [664,762,860,958,1056,1154,1252,1350,1448,1546,1644,1742,1840,1938,2036] },
  { key: 'hitRatePct',     label: '命中率增加',          unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { key: 'elementDmgPct',  label: '优越代码伤害增加',    unit: '%', vals: [954,1094,1234,1375,1515,1655,1795,1935,2075,2215,2356,2496,2636,2776,2916] },
  { key: 'bonusAmmo',      label: '最大装弹数增加',      unit: '%', vals: [2784,3195,3606,4017,4428,4839,5250,5660,6071,6482,6893,7304,7715,8126,8537] },
  { key: 'chargeDmgPct',   label: '蓄力伤害增加',        unit: '%', vals: [477,547,618,688,759,829,900,970,1040,1111,1181,1252,1322,1393,1463] },
  { key: 'chargeSpeedPct', label: '蓄力速度增加',        unit: '%', vals: [198,228,257,286,316,345,375,404,433,463,492,521,551,580,609] },
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

// SSR 收藏品：角色 resourceId → SSR 珍藏品 resourceId
// 通过读取本地 favorites/*.json 的 name_code 与 characters.json 对照得出
const SSR_FAV_BY_CHAR = {
   32: 200601, // Miranda   → Sheet of Paper
  101: 200801, // Drake     → Villain Figurine
  170: 201401, // Privaty   → Central Government Special Medal
  192: 201101, // Tove      → Fire Starter
  281: 201701, // Moran     → Peony Hairpin
  352: 200701, // Helm      → Antique Compass
};

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
  'elementDmgPct', 'hitRatePct', 'bonusAmmo', 'atkPct',
  'chargeDmgPct', 'chargeSpeedPct', 'critRatePct', 'critDmgPct', 'defFlat',
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

function fmtTime(sec) {
  if (!sec && sec !== 0) return '—';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return m > 0 ? `${m}:${s.padStart(4, '0')}` : `${sec.toFixed(1)}s`;
}

// ─── 战斗日志聚合 ─────────────────────────────────────────────────────────────

const TICK_RATE = 60;

function formatTick(tick) {
  const t  = tick / TICK_RATE;
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String((t % 60).toFixed(1)).padStart(4, '0');
  return `${mm}:${ss}`;
}

// { name, label, desc } 分别对应 角色列、技能列、事件描述列
const BATTLE_EVENT_COLS = {
  burst_i:      e => ({ name: e.unitName ?? '', label: 'Burst',  desc: 'Burst I' }),
  burst_ii:     e => ({ name: e.unitName ?? '', label: 'Burst',  desc: 'Burst II' }),
  full_burst:   e => ({ name: e.unitName ?? '', label: 'Burst',  desc: 'Full Burst' }),
  burst_end:    () => ({ name: '',               label: '',       desc: 'Full Burst 结束' }),
  burst_timeout:() => ({ name: '',               label: '',       desc: 'Full Burst 超时' }),
  reload:       e => ({ name: e.unitName ?? '', label: '',       desc: '装填' }),
  phase_change: e => ({ name: '',               label: '',       desc: `距离 → ${e.zone ?? ''}` }),
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
  return label;
}

function buildEventRows(eventLog) {
  if (!eventLog?.length) return [];
  return eventLog.map(e => {
    let name = '', label = '', target = '';
    if (e.type === 'skill_trigger') {
      const part = e.partIdx != null ? ` P${e.partIdx + 1}` : '';
      name   = e.unitName;
      label  = `${e.skillLabel}${part}`;
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
      kind:       'event',
      eventType:  e.type,
      name,
      label,
      target,
      buffDesc:   '',
      damage:     null,
      count:      1,
      isCrit:     false,
    };
  });
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
        target:    '敌人',
        bufKey,
        buffDesc:  (h.buffBreakdown ?? []).map(b => b.name).join(' / ') || '—',
        damage:    h.damage,
        count:     1,
        isCrit:    h.isCrit,
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
    target:     '敌人',
    bufKey:     '',
    buffDesc:   (h.buffBreakdown ?? []).map(b => b.name).join(' / ') || '—',
    damage:     h.damage,
    count:      1,
    isCrit:     h.isCrit,
    ammoLeft:   h.ammoLeft,
    maxAmmo:    h.maxAmmo,
    isFullBurst:h.isFullBurst,
    charge:     h.isFullBurst ? '' : (h.ammoLeft != null ? `${h.ammoLeft}/${h.maxAmmo}` : '—'),
  }));
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
      def:      500,
      element:  'Iron',
      type:     'Normal',
      hasCore:  false,
      distNear: 0,
      distMid:  180,
      distFar:  0,
    },

    // 模拟选项
    iterations: 30,

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
    logMode:       'aggregate',

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
    fmtNum,
    fmtStat,
    fmtPct,
    fmtTime,
    formatTick,

    // ── 计算辅助 ──
    get activeSlotData() { return this.team[this.activeSlot]; },

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
        enemy:           { ...this.enemy },
        iterations:      this.iterations,
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
      if (state.enemy)          Object.assign(this.enemy, state.enemy);
      if (state.iterations      != null) this.iterations = state.iterations;
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
        slot.burstStep    = saved.burstStep   ?? slot.burstStep;
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
          this._loadNikkeData(i, slot.resourceId);
          if (slot.cube.resourceId)         this._loadCubeData(i, slot.cube.resourceId);
          if (slot.favoriteItem.resourceId) this._loadFavData(i, slot.favoriteItem.resourceId);
        }
      });
    },

    // ── 角色选择 ──────────────────────────────────────────────────────────────

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
      slot.burstStep   = char.burstStep ?? 'Step3';
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

    // ── 突破与羁绊 ────────────────────────────────────────────────────────────

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
      } catch {
        this.team[i]._cubeData = null;
      }
    },

    // ── 收藏品 ────────────────────────────────────────────────────────────────

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
      } catch {
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
        console.warn(`[slot ${i}] NIKKE ${resourceId} 加载失败:`, err.message);
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
      } catch { return ''; }
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

      this.simRunning   = true;
      this.result       = null;
      this.hitLogRows   = [];
      this.hitLogRaw    = null;
      this.battleLogRaw = null;

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
            skillLevels:           slot.skills.slice(0, 3),
            baseAmmo:              nd?.shot_detail?.max_ammo,
            fullChargeDamage:      nd?.shot_detail?.full_charge_damage ?? 10000,
            reloadTicks:           nd ? Math.round((nd.shot_detail?.reload_time ?? 200) / 100 * 60) : undefined,
            burstEnergyPerShot:    nd?.shot_detail?.burst_energy_pershot,
            fullChargeBurstEnergy: nd?.shot_detail?.full_charge_burst_energy ?? 0,
            chargeTimeTicks:       isChargeWeapon ? Math.round((nd?.shot_detail?.charge_time ?? 0) / 100 * 60) : 0,
            burstSkillCooltime:    nd ? Math.round(
              ((nd.ulti_skill_detail?.skill_cooltime_list?.[(slot.skills[2] >= 1 ? slot.skills[2] : 1) - 1]
                ?? nd.ulti_skill_detail?.skill_cooltime
                ?? 4000) / 100 * 60)
            ) : undefined,
          };
        });

        const distancePhases = [];
        if (this.enemy.distNear > 0) distancePhases.push({ zone: 'NEAR', durationS: Number(this.enemy.distNear) });
        if (this.enemy.distMid  > 0) distancePhases.push({ zone: 'MID',  durationS: Number(this.enemy.distMid)  });
        if (this.enemy.distFar  > 0) distancePhases.push({ zone: 'FAR',  durationS: Number(this.enemy.distFar)  });

        const baseConfig = {
          squad:    squadConfig,
          enemy: {
            def:     Number(this.enemy.def)  || 500,
            element: this.enemy.element,
            type:    this.enemy.type,
            hasCore: this.enemy.hasCore,
            distance: distancePhases[0]?.zone ?? null,
            ...(distancePhases.length ? { distancePhases } : {}),
          },
          duration: 180,
        };

        const iters     = Math.max(1, Math.min(100, Number(this.iterations) || 30));
        const mcResult  = simulateMonteCarlo(baseConfig, iters);
        const single    = simulate({ ...baseConfig, hitLog: true });

        this.result        = { ...mcResult, iterations: iters };
        this.hitLogRaw     = single.hitLog;
        this.battleLogRaw  = single.log ?? [];
        this._rebuildLog();
      } catch (err) {
        console.error('模拟出错:', err);
        alert(`模拟出错：${err.message}`);
      } finally {
        this.simRunning = false;
      }
    },

    _rebuildLog() {
      if (!this.hitLogRaw || !this.result) { this.hitLogRows = []; return; }
      const unitNames = Object.fromEntries(
        (this.result.units ?? []).map(u => [u.id, u.name])
      );
      const hitRows   = this.logMode === 'detail'
        ? buildDetailLog(this.hitLogRaw, unitNames)
        : buildAggregateLog(this.hitLogRaw, unitNames);
      const eventRows = buildEventRows(this.battleLogRaw);
      this.hitLogRows = [...hitRows, ...eventRows].sort((a, b) => a.tickStart - b.tickStart);
    },

    setLogMode(mode) {
      this.logMode = mode;
      this._rebuildLog();
    },

    // ── 结果辅助 ─────────────────────────────────────────────────────────────

    skillDamageRows(unit) {
      if (!unit?.skillDamage) return [];
      return Object.entries(unit.skillDamage)
        .filter(([, dmg]) => dmg > 0)
        .map(([label, dmg]) => ({
          label,
          damage: dmg,
          share:  unit.totalDamage > 0 ? dmg / unit.totalDamage : 0,
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
