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

// ─── 常量 ──────────────────────────────────────────────────────────────────

const CLASS_LABEL   = { Attacker: '攻击手', Defender: '防御手', Supporter: '支援手' };
const CORP_LABEL    = { ELYSION: '极乐净土', MISSILIS: '米西利斯', TETRA: '泰特拉', PILGRIM: '朝圣者', ABNORMAL: '反常' };
const ELEMENT_LABEL = { Fire: '火', Water: '水', Wind: '风', Electric: '电', Iron: '铁' };

const EQUIP_SLOTS = ['head', 'torso', 'arms', 'legs'];
const EQUIP_SLOT_LABELS = { head: '头部', torso: '躯干', arms: '手臂', legs: '腿部' };

export const EQUIP_OPTION_TYPES = [
  { key: '',               label: '（无）',        unit: '' },
  { key: 'atkPct',         label: '攻击力 ▲%',     unit: '%' },
  { key: 'atkFlat',        label: '攻击力固定 ▲',  unit: '' },
  { key: 'critRatePct',    label: '暴击率 ▲',      unit: '%' },
  { key: 'critDmgPct',     label: '暴击伤害 ▲',    unit: '%' },
  { key: 'hitRatePct',     label: '命中率 ▲',      unit: '%' },
  { key: 'elementDmgPct',  label: '属性伤害 ▲',    unit: '%' },
  { key: 'bonusAmmo',      label: '弹匣容量 ▲',    unit: '' },
  { key: 'chargeDmgPct',   label: '蓄力伤害 ▲',    unit: '%' },
  { key: 'chargeSpeedPct', label: '蓄力速度 ▲',    unit: '%' },
  { key: 'defFlat',        label: '防御力固定 ▲',  unit: '' },
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

// SSR 收藏品：FAVORITE_ITEM_URLS 中 id >= 200000 的条目，映射到角色 resourceId
const SSR_FAV_BY_CHAR = Object.fromEntries(
  Object.keys(FAVORITE_ITEM_URLS)
    .filter(id => Number(id) >= 200000)
    .map(id => [Number(id) - 200000, Number(id)])
);

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

function aggregateEquipOptions(equipment) {
  const result = {};
  for (const key of EQUIP_SLOTS) {
    const equip = equipment?.[key];
    if (!equip) continue;
    for (const opt of equip.opts) {
      if (!opt.type) continue;
      const v = Number(opt.value) || 0;
      if (!v) continue;
      result[opt.type] = (result[opt.type] ?? 0) + v;
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

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(1) + '%';
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

function buildAggregateLog(hitLog, unitNames) {
  if (!hitLog?.length) return [];
  const rows = [];
  let cur = null;

  for (const h of hitLog) {
    const name   = unitNames[h.unitId] ?? String(h.unitId);
    const bufKey = (h.buffBreakdown ?? []).map(b => b.name).sort().join(',');

    if (
      cur &&
      cur.unitId === h.unitId &&
      cur.label  === h.label  &&
      cur.bufKey === bufKey
    ) {
      cur.damage += h.damage;
      cur.count++;
      cur.tickEnd = h.tick;
    } else {
      if (cur) rows.push(cur);
      cur = {
        tickStart:     h.tick,
        tickEnd:       h.tick,
        unitId:        h.unitId,
        name,
        label:         h.label,
        bufKey,
        buffDesc:      (h.buffBreakdown ?? []).map(b => b.name).join(' / ') || '—',
        damage:        h.damage,
        count:         1,
        isCrit:        h.isCrit,
      };
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

function buildDetailLog(hitLog, unitNames) {
  if (!hitLog?.length) return [];
  return hitLog.map(h => ({
    tickStart:  h.tick,
    tickEnd:    h.tick,
    unitId:     h.unitId,
    name:       unitNames[h.unitId] ?? String(h.unitId),
    label:      h.label,
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
    result:      null,
    hitLogRows:  [],
    hitLogRaw:   null,
    simRunning:  false,
    logMode:     'aggregate',

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
    fmtPct,
    fmtTime,
    formatTick,

    // ── 计算辅助 ──
    get activeSlotData() { return this.team[this.activeSlot]; },

    maxBond(grade, corp) { return maxBond(grade, corp); },

    get filteredChars() {
      const q = (this.charQuery ?? '').toLowerCase().trim();
      if (!q) return this.allChars.slice(0, 60);
      return this.allChars.filter(c => c.name.toLowerCase().includes(q)).slice(0, 60);
    },

    favItemsForSlot(slotIdx) {
      const slot = this.team[slotIdx];
      if (!slot?.weaponType) return FAV_ITEMS_RS;
      const byWeapon = FAV_ITEMS_RS.filter(f => f.weapon === slot.weaponType);
      if (!slot.resourceId) return byWeapon;
      const ssrId = SSR_FAV_BY_CHAR[slot.resourceId];
      if (!ssrId) return byWeapon;
      return [...byWeapon, { id: ssrId, name: `SSR 专属 (${slot.name})`, weapon: slot.weaponType, rare: 'SSR' }];
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

      this.allChars    = getAllCharacters();
      this.cubeOptions = Object.entries(CUBE_URLS)
        .map(([id]) => ({ id: Number(id), name: CUBE_NAMES[id] ?? `魔方 ${id}` }))
        .sort((a, b) => a.id - b.id);

      const accountLoaded = await loadAccountFromDev();
      if (accountLoaded) {
        this.accountStatus = `账号已加载，共 ${getAccountSize()} 个角色`;
        const settings = getAccountSettings();
        this._applySettings(settings);
      } else {
        this.accountStatus = '未找到账号文件（手动模式）';
      }

      this.loading = false;
    },

    // ── 账号导入 ──────────────────────────────────────────────────────────────

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

      // 账号数据只有 boolean options，无法恢复词条类型 — 保留 opts 默认值

      if (slot.cube.resourceId) this._loadCubeData(i, slot.cube.resourceId);
      if (slot.favoriteItem.resourceId) this._loadFavData(i, slot.favoriteItem.resourceId);
    },

    // ── 技能描述渲染 ──────────────────────────────────────────────────────────

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

      this.simRunning = true;
      this.result     = null;
      this.hitLogRows = [];
      this.hitLogRaw  = null;

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

        const squadConfig = activeSlots.map((slot, idx) => ({
          characterId:    slot.resourceId,
          name:           slot.name || `NIKKE ${idx + 1}`,
          classType:      slot.classType,
          element:        slot.element,
          weaponType:     slot.weaponType,
          burstStep:      slot.burstStep ?? 'Step3',
          level:          this.synchroLevel,
          _computedStats: squadStats[idx],
          _nikkeData:     slot._nikkeData ?? null,
        }));

        const distancePhases = [];
        if (this.enemy.distNear > 0) distancePhases.push({ zone: 'NEAR', durationS: Number(this.enemy.distNear) });
        if (this.enemy.distMid  > 0) distancePhases.push({ zone: 'MID',  durationS: Number(this.enemy.distMid)  });
        if (this.enemy.distFar  > 0) distancePhases.push({ zone: 'FAR',  durationS: Number(this.enemy.distFar)  });

        const baseConfig = {
          squad:    squadConfig,
          enemy: {
            maxHp:   10_000_000,
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

        this.result     = { ...mcResult, iterations: iters };
        this.hitLogRaw  = single.hitLog;
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
      this.hitLogRows = this.logMode === 'detail'
        ? buildDetailLog(this.hitLogRaw, unitNames)
        : buildAggregateLog(this.hitLogRaw, unitNames);
    },

    setLogMode(mode) {
      this.logMode = mode;
      this._rebuildLog();
    },

    // ── 结果辅助 ─────────────────────────────────────────────────────────────

    skillDamageRows(unit) {
      if (!unit?.skillDamage) return [];
      return Object.entries(unit.skillDamage)
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
