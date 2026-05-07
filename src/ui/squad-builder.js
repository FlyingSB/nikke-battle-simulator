/**
 * 队伍构建器 UI — 全局研究面板 + 5 槽位队伍构建器。
 *
 * 数据流：
 *   花名册一次性加载 → getAllCharacters()
 *   单角色 CDN JSON  → 槽位选择 NIKKE 时 loadNikke(resourceId)
 *   魔方 CDN JSON    → 魔方下拉选择时 loadCube(resourceId)
 *
 * 状态保存在模块级 `_state` 对象中，所有输入直接改写它。
 * 引擎通过 `getState()` 读取当前配置。
 */

import { getAllCharacters, getCharacterByResourceId } from '../data/models.js';
import { loadNikke, loadCube } from '../data/loader.js';
import { CUBE_URLS, CUBE_NAMES, FAVORITE_ITEM_URLS } from '../data/manifest.js';
import { getRosterEntry } from '../data/account-loader.js';

// ─── 常量 ───────────────────────────────────────────────────────────────

const CORPS    = ['ELYSION', 'MISSILIS', 'TETRA', 'PILGRIM', 'ABNORMAL'];
const CLASSES  = ['Attacker', 'Defender', 'Supporter'];
const TIERS    = ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10'];
const POS_LABEL = ['Front', 'Back', 'Front', 'Back', 'Front'];

// 展示用的中文映射（key 仍为英文标识符，不影响状态数据结构）
const CLASS_LABEL = { Attacker: '攻击手', Defender: '防御手', Supporter: '支援手' };
const ELEMENT_LABEL = { Fire: '火', Water: '水', Wind: '风', Electric: '电', Iron: '铁' };
const POS_LABEL_CN = { Front: '前排', Back: '后排' };
const CORP_LABEL = { ELYSION: '极乐净土', MISSILIS: '米西利斯', TETRA: '泰特拉', PILGRIM: '朝圣者', ABNORMAL: '反常' };

const EQUIP_SLOTS = [
  { key: 'head',  label: '头部', mod: 'Module_A' },
  { key: 'torso', label: '躯干', mod: 'Module_B' },
  { key: 'arms',  label: '手臂', mod: 'Module_C' },
  { key: 'legs',  label: '腿部', mod: 'Module_D' },
];

// 魔方条目按 resource_id 排序用于下拉展示
const CUBE_OPTIONS = Object.keys(CUBE_URLS)
  .map(id => ({ id: Number(id), name: CUBE_NAMES[id] ?? `魔方 ${id}` }))
  .sort((a, b) => a.id - b.id);

// 收藏品下拉元数据
const FAV_ITEMS = [
  { id: 100101, name: '烹饪娃娃 (R)',       weapon: 'AR',  rare: 'R'  },
  { id: 100102, name: '烹饪娃娃 限定 (SR)', weapon: 'AR',  rare: 'SR' },
  { id: 100201, name: '购物娃娃 (R)',       weapon: 'MG',  rare: 'R'  },
  { id: 100202, name: '购物娃娃 限定 (SR)', weapon: 'MG',  rare: 'SR' },
  { id: 100301, name: '健身娃娃 (R)',       weapon: 'RL',  rare: 'R'  },
  { id: 100302, name: '健身娃娃 限定 (SR)', weapon: 'RL',  rare: 'SR' },
  { id: 100401, name: '战斗娃娃 (R)',       weapon: 'SG',  rare: 'R'  },
  { id: 100402, name: '战斗娃娃 限定 (SR)', weapon: 'SG',  rare: 'SR' },
  { id: 100501, name: '咖啡娃娃 (R)',       weapon: 'SMG', rare: 'R'  },
  { id: 100502, name: '咖啡娃娃 限定 (SR)', weapon: 'SMG', rare: 'SR' },
  { id: 100601, name: '午睡娃娃 (R)',       weapon: 'SR',  rare: 'R'  },
  { id: 100602, name: '午睡娃娃 限定 (SR)', weapon: 'SR',  rare: 'SR' },
];

// 按武器类型对应的默认 SR 收藏品 id
const DEFAULT_FAV_SR = { AR: 100102, MG: 100202, RL: 100302, SG: 100402, SMG: 100502, SR: 100602 };

// 羁绊等级上限：grade 0→10，1→20，2→30，3→30（仅 PILGRIM 为 40）
function maxBond(grade, corporation) {
  if (grade === 0) return 10;
  if (grade === 1) return 20;
  if (grade === 2) return 30;
  return corporation === 'PILGRIM' ? 40 : 30;
}

// 通用研究上限 = 同步器等级（保守按 1:1 估算）
function generalCap(synchro) { return synchro; }

// ─── 状态 ────────────────────────────────────────────────────────────────────

function defaultEquip(classReq = 'Attacker') {
  return { classReq, tier: 'T10', options: [false, false, false] };
}

function defaultSlot() {
  return {
    active:      false,
    resourceId:  null,
    name:        '',
    classType:   'Attacker',
    corporation: 'ELYSION',
    element:     'Fire',
    weaponType:  'AR',
    burstStep:   'Step3',
    grade:       0,
    core:        0,
    bondLevel:   10,
    skills:      [10, 10, 10],
    cube:        { resourceId: null, level: 15 },
    favoriteItem:{ resourceId: null, level: 15, rare: 'SR' },
    equipment: {
      head:  defaultEquip(),
      torso: defaultEquip(),
      arms:  defaultEquip(),
      legs:  defaultEquip(),
    },
    // 选择 NIKKE 后异步填充：
    _nikkeData: null,
    _cubeData:  null,
  };
}

const _state = {
  synchroLevel:  200,
  generalResearch: 200,
  classResearch: { attacker: 0, defender: 0, supporter: 0 },
  corpResearch:  { ELYSION: 0, MISSILIS: 0, TETRA: 0, PILGRIM: 0, ABNORMAL: 0 },
  distancePhases: { near: 0, mid: 180, far: 0 },
  // 槽位 1 默认启用，让用户落地即可直接填写表单，而非看到 5 张折叠卡片。
  team: Array.from({ length: 5 }, (_, i) => ({ ...defaultSlot(), active: i === 0 })),
};

/** 返回当前的配置状态（引擎使用的浅拷贝）。 */
export function getState() { return _state; }

// ─── 入口 ──────────────────────────────────────────────────────────────

let _container = null;
let _onSimulate = null;

/**
 * 将队伍构建器渲染到 container。
 * @param {HTMLElement} container
 * @param {(state: object) => void} onSimulate
 */
export function renderSquadBuilder(container, onSimulate) {
  _container  = container;
  _onSimulate = onSimulate;
  _render();
}

// ─── 渲染 ───────────────────────────────────────────────────────────────────

function _render() {
  _container.innerHTML = `
    ${_globalPanelHTML()}
    ${_teamPanelHTML()}
    ${_enemyPanelHTML()}
    ${_simPanelHTML()}
    <button class="btn-simulate" id="btnSimulate">▶ 开始模拟</button>
  `;
  _bindGlobal();
  _state.team.forEach((_, i) => _bindSlot(i));
  _container.querySelector('#btnSimulate').addEventListener('click', () => {
    if (_onSimulate) _onSimulate(_state);
  });
}

// ─── 全局面板 ─────────────────────────────────────────────────────────────

function _globalPanelHTML() {
  const s = _state;
  return `
<section class="global-panel">
  <h2>全局设置</h2>
  <div class="global-grid">

    <div class="global-col">
      <h3>同步器</h3>
      <div class="row-inputs">
        <label>同步器等级
          <input type="number" id="synchroLevel" value="${s.synchroLevel}" min="1" max="200">
        </label>
        <label>通用研究 <small>（上限 = 同步器）</small>
          <input type="number" id="generalResearch" value="${s.generalResearch}" min="0" max="9999">
        </label>
      </div>
    </div>

    <div class="global-col">
      <h3>职业研究</h3>
      <div class="row-inputs">
        ${CLASSES.map(c => `
        <label>${CLASS_LABEL[c] ?? c}
          <input type="number" class="class-research" data-class="${c.toLowerCase()}"
                 value="${s.classResearch[c.toLowerCase()]}" min="0" max="9999">
        </label>`).join('')}
      </div>
    </div>

    <div class="global-col">
      <h3>厂商研究</h3>
      <div class="row-inputs">
        ${CORPS.map(corp => `
        <label>${_corpLabel(corp)}
          <input type="number" class="corp-research" data-corp="${corp}"
                 value="${s.corpResearch[corp]}" min="0" max="9999">
        </label>`).join('')}
      </div>
    </div>

  </div>
</section>`;
}

function _corpLabel(corp) {
  return CORP_LABEL[corp] ?? corp;
}

function _bindGlobal() {
  const c = _container;

  c.querySelector('#synchroLevel').addEventListener('input', e => {
    const v = parseInt(e.target.value) || 1;
    _state.synchroLevel = v;
    const cap = generalCap(v);
    if (_state.generalResearch > cap) {
      _state.generalResearch = cap;
      c.querySelector('#generalResearch').value = cap;
    }
  });

  c.querySelector('#generalResearch').addEventListener('input', e => {
    const v = parseInt(e.target.value) ?? 0;
    const cap = generalCap(_state.synchroLevel);
    _state.generalResearch = Math.min(v, cap);
    if (v > cap) e.target.value = cap;
  });

  c.querySelectorAll('.class-research').forEach(inp => {
    inp.addEventListener('input', e => {
      _state.classResearch[e.target.dataset.class] = parseInt(e.target.value) || 0;
    });
  });

  c.querySelectorAll('.corp-research').forEach(inp => {
    inp.addEventListener('input', e => {
      _state.corpResearch[e.target.dataset.corp] = parseInt(e.target.value) || 0;
    });
  });

  c.querySelector('#distNear').addEventListener('input', e => {
    _state.distancePhases.near = parseInt(e.target.value) || 0;
  });
  c.querySelector('#distMid').addEventListener('input', e => {
    _state.distancePhases.mid = parseInt(e.target.value) || 0;
  });
  c.querySelector('#distFar').addEventListener('input', e => {
    _state.distancePhases.far = parseInt(e.target.value) || 0;
  });
}

// ─── 队伍面板 ───────────────────────────────────────────────────────────────

function _teamPanelHTML() {
  return `
<section class="team-panel">
  <h2>队伍</h2>
  <div class="team-slots">
    ${_state.team.map((_, i) => _slotHTML(i)).join('')}
  </div>
</section>`;
}

function _slotHTML(i) {
  const slot = _state.team[i];
  const pos  = POS_LABEL[i];
  return `
<div class="slot-card" id="slot-${i}">
  <div class="slot-header">
    <span class="slot-label">槽位 ${i+1} <span class="slot-pos ${pos === 'Back' ? 'back' : 'front'}">${POS_LABEL_CN[pos] ?? pos}</span></span>
    <button class="btn-toggle-slot" data-slot="${i}">${slot.active ? '禁用' : '启用'}</button>
  </div>
  <div class="slot-body ${slot.active ? '' : 'hidden'}" id="slot-body-${i}">
    ${_slotBodyHTML(i)}
  </div>
</div>`;
}

function _slotBodyHTML(i) {
  const slot = _state.team[i];
  const roster = getAllCharacters();
  const rosterOptions = [
    '<option value="">— 选择 NIKKE —</option>',
    ...roster.map(c => `<option value="${c.resourceId}" ${c.resourceId === slot.resourceId ? 'selected' : ''}>${c.name}（${CORP_LABEL[c.corporation] ?? c.corporation} · ${CLASS_LABEL[c.classType] ?? c.classType}）</option>`)
  ].join('');

  const gradeButtons = [0,1,2,3].map(g => `
    <button class="grade-btn ${slot.grade === g ? 'active' : ''}" aria-pressed="${slot.grade === g}" data-slot="${i}" data-grade="${g}">
      突破 ${g}
    </button>`).join('');

  const maxCore = 7;
  const coreDisabled = slot.grade < 3 ? 'disabled' : '';

  const bondMax = maxBond(slot.grade, slot.corporation);

  return `
  <div class="slot-inner">

    <!-- NIKKE 选择 -->
    <label class="full-width">NIKKE
      <select class="nikke-select" data-slot="${i}">${rosterOptions}</select>
    </label>
    <div class="nikke-meta" id="meta-${i}">
      ${slot.resourceId ? `<span class="tag">${CLASS_LABEL[slot.classType] ?? slot.classType}</span> <span class="tag">${ELEMENT_LABEL[slot.element] ?? slot.element}</span> <span class="tag">${slot.weaponType}</span> <span class="tag">${CORP_LABEL[slot.corporation] ?? slot.corporation}</span>` : ''}
    </div>

    <!-- 突破 -->
    <div class="sub-section">
      <h4>突破</h4>
      <div class="grade-row">${gradeButtons}</div>
      <label>核心强化（仅突破 3）
        <input type="number" class="core-input" data-slot="${i}"
               value="${slot.core}" min="0" max="${maxCore}" ${coreDisabled}>
      </label>
    </div>

    <!-- 羁绊等级 -->
    <div class="sub-section">
      <h4>羁绊等级</h4>
      <label>羁绊 <small>（突破 ${slot.grade}${slot.corporation === 'PILGRIM' ? ' 朝圣者' : ''}上限 ${bondMax}）</small>
        <input type="number" class="bond-input" data-slot="${i}"
               value="${Math.min(slot.bondLevel, bondMax)}" min="1" max="${bondMax}">
      </label>
    </div>

    <!-- 技能 -->
    <div class="sub-section">
      <h4>技能</h4>
      <div class="row-inputs">
        ${['技能 1','技能 2','Burst'].map((label, j) => `
        <label>${label}
          <input type="number" class="skill-input" data-slot="${i}" data-skill="${j}"
                 value="${slot.skills[j]}" min="1" max="10">
        </label>`).join('')}
      </div>
    </div>

    <!-- 装备 -->
    <div class="sub-section">
      <h4>装备 <small>（T10 基础属性按职业自动加载）</small></h4>
      ${EQUIP_SLOTS.map(es => _equipSlotHTML(i, es.key, es.label)).join('')}
    </div>

    <!-- 和谐魔方 -->
    <div class="sub-section">
      <h4>和谐魔方</h4>
      <div class="row-inputs">
        <label>魔方
          <select class="cube-select" data-slot="${i}">
            <option value="">无</option>
            ${CUBE_OPTIONS.map(c => `<option value="${c.id}" ${c.id === slot.cube.resourceId ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </label>
        <label>等级（1–15）
          <input type="number" class="cube-level" data-slot="${i}"
                 value="${slot.cube.level}" min="1" max="15">
        </label>
      </div>
      <div class="cube-status" id="cube-status-${i}">
        ${slot._cubeData ? `<span class="tag success">${CUBE_NAMES[slot.cube.resourceId] ?? '魔方已加载'}</span>` : ''}
      </div>
    </div>

    <!-- 收藏品 -->
    <div class="sub-section">
      <h4>收藏品</h4>
      <div class="row-inputs">
        <label>道具
          <select class="fav-select" data-slot="${i}">
            <option value="">无</option>
            ${FAV_ITEMS.map(f => `<option value="${f.id}" ${f.id === slot.favoriteItem.resourceId ? 'selected' : ''}>${f.name}</option>`).join('')}
          </select>
        </label>
        <label>等级（1–15）
          <input type="number" class="fav-level" data-slot="${i}"
                 value="${slot.favoriteItem.level}" min="1" max="15">
        </label>
      </div>
    </div>

  </div>`;
}

function _equipSlotHTML(slotIdx, key, label) {
  const cfg = _state.team[slotIdx].equipment[key];
  return `
<div class="equip-row">
  <span class="equip-label">${label}</span>
  <select class="equip-class" data-slot="${slotIdx}" data-equip="${key}">
    ${CLASSES.map(c => `<option value="${c}" ${cfg.classReq === c ? 'selected' : ''}>${CLASS_LABEL[c] ?? c}</option>`).join('')}
  </select>
  <select class="equip-tier" data-slot="${slotIdx}" data-equip="${key}">
    ${TIERS.map(t => `<option value="${t}" ${cfg.tier === t ? 'selected' : ''}>${t}</option>`).join('')}
  </select>
  <div class="option-toggles">
    ${cfg.options.map((on, j) => `
    <label class="opt-toggle" title="词条 ${j+1}">
      <input type="checkbox" class="equip-option" data-slot="${slotIdx}" data-equip="${key}" data-opt="${j}"
             ${on ? 'checked' : ''}> E${j+1}
    </label>`).join('')}
  </div>
</div>`;
}

// ─── 敌人面板 ──────────────────────────────────────────────────────────────

const ELEMENTS = ['Fire', 'Water', 'Wind', 'Electric', 'Iron'];

function _enemyPanelHTML() {
  return `
<section class="enemy-panel">
  <h2>敌人</h2>
  <div class="row-inputs">
    <label>HP
      <input type="number" id="enemyHp" value="10000000" min="1" step="100000">
    </label>
    <label>DEF
      <input type="number" id="enemyDef" value="500" min="0" step="10">
    </label>
    <label>属性
      <select id="enemyElement">
        ${ELEMENTS.map(e => `<option value="${e}">${ELEMENT_LABEL[e] ?? e}</option>`).join('')}
      </select>
    </label>
    <label>类型
      <select id="enemyType">
        <option value="Normal">普通 Rapture</option>
        <option value="Elite">精英 Rapture</option>
        <option value="Boss">Boss</option>
      </select>
    </label>
    <label>近距离时长（秒） <small>SG / SMG 优势</small>
      <input type="number" id="distNear" value="0" min="0" max="9999" step="5">
    </label>
    <label>中距离时长（秒） <small>AR / MG 优势</small>
      <input type="number" id="distMid" value="180" min="0" max="9999" step="5">
    </label>
    <label>远距离时长（秒） <small>SR 优势</small>
      <input type="number" id="distFar" value="0" min="0" max="9999" step="5">
    </label>
    <label class="enemy-core-label">
      <input type="checkbox" id="enemyHasCore"> 具有核心
      <small>命中核心：+100% 伤害</small>
    </label>
  </div>
</section>`;
}

// ─── 模拟选项面板 ────────────────────────────────────────────────────────────

function _simPanelHTML() {
  return `
<section class="sim-panel">
  <h2>模拟</h2>
  <div class="row-inputs">
    <label><input type="checkbox" id="useMonteCarlo" checked> 蒙特卡洛（暴击 RNG 取平均）</label>
    <label>迭代次数
      <input type="number" id="iterations" value="200" min="1" max="2000" step="50">
    </label>
  </div>
</section>`;
}

// ─── 事件绑定 ────────────────────────────────────────────────────────────

function _bindSlot(i) {
  const c = _container;

  // 切换槽位启用 / 禁用
  c.querySelector(`.btn-toggle-slot[data-slot="${i}"]`).addEventListener('click', e => {
    _state.team[i].active = !_state.team[i].active;
    const body = c.querySelector(`#slot-body-${i}`);
    body.classList.toggle('hidden', !_state.team[i].active);
    e.target.textContent = _state.team[i].active ? '禁用' : '启用';
  });

  // NIKKE 选择
  const nikkeSelect = c.querySelector(`.nikke-select[data-slot="${i}"]`);
  if (nikkeSelect) {
    nikkeSelect.addEventListener('change', e => _onNikkeSelect(i, e.target.value));
  }

  // 突破按钮
  c.querySelectorAll(`.grade-btn[data-slot="${i}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const grade = parseInt(btn.dataset.grade);
      _state.team[i].grade = grade;

      // 更新按钮样式与 ARIA 状态
      c.querySelectorAll(`.grade-btn[data-slot="${i}"]`).forEach(b => {
        const isActive = parseInt(b.dataset.grade) === grade;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive);
      });

      // 启用 / 禁用核心输入框
      const coreInput = c.querySelector(`.core-input[data-slot="${i}"]`);
      if (coreInput) {
        coreInput.disabled = grade < 3;
        if (grade < 3) { coreInput.value = 0; _state.team[i].core = 0; }
      }

      // 更新羁绊等级上限并 clamp
      _updateBondMax(i);
    });
  });

  // 核心输入
  const coreInput = c.querySelector(`.core-input[data-slot="${i}"]`);
  if (coreInput) {
    coreInput.addEventListener('input', e => {
      _state.team[i].core = Math.max(0, Math.min(7, parseInt(e.target.value) || 0));
    });
  }

  // 羁绊输入
  const bondInput = c.querySelector(`.bond-input[data-slot="${i}"]`);
  if (bondInput) {
    bondInput.addEventListener('input', e => {
      const slot = _state.team[i];
      const bMax = maxBond(slot.grade, slot.corporation);
      slot.bondLevel = Math.max(1, Math.min(bMax, parseInt(e.target.value) || 1));
      if (parseInt(e.target.value) > bMax) e.target.value = bMax;
    });
  }

  // 技能输入
  c.querySelectorAll(`.skill-input[data-slot="${i}"]`).forEach(inp => {
    inp.addEventListener('input', e => {
      const j = parseInt(e.target.dataset.skill);
      _state.team[i].skills[j] = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
    });
  });

  // 装备职业 / Tier / 词条
  c.querySelectorAll(`.equip-class[data-slot="${i}"]`).forEach(sel => {
    sel.addEventListener('change', e => {
      _state.team[i].equipment[e.target.dataset.equip].classReq = e.target.value;
    });
  });
  c.querySelectorAll(`.equip-tier[data-slot="${i}"]`).forEach(sel => {
    sel.addEventListener('change', e => {
      _state.team[i].equipment[e.target.dataset.equip].tier = e.target.value;
    });
  });
  c.querySelectorAll(`.equip-option[data-slot="${i}"]`).forEach(chk => {
    chk.addEventListener('change', e => {
      const j = parseInt(e.target.dataset.opt);
      _state.team[i].equipment[e.target.dataset.equip].options[j] = e.target.checked;
    });
  });

  // 魔方下拉
  const cubeSelect = c.querySelector(`.cube-select[data-slot="${i}"]`);
  if (cubeSelect) {
    cubeSelect.addEventListener('change', e => {
      const id = parseInt(e.target.value) || null;
      _state.team[i].cube.resourceId = id;
      if (id) _loadCube(i, id);
      else {
        _state.team[i]._cubeData = null;
        const statusEl = c.querySelector(`#cube-status-${i}`);
        if (statusEl) statusEl.innerHTML = '';
      }
    });
  }

  // 魔方等级
  const cubeLevel = c.querySelector(`.cube-level[data-slot="${i}"]`);
  if (cubeLevel) {
    cubeLevel.addEventListener('input', e => {
      _state.team[i].cube.level = Math.max(1, Math.min(15, parseInt(e.target.value) || 15));
    });
  }

  // 收藏品下拉
  const favSelect = c.querySelector(`.fav-select[data-slot="${i}"]`);
  if (favSelect) {
    favSelect.addEventListener('change', e => {
      const id = parseInt(e.target.value) || null;
      _state.team[i].favoriteItem.resourceId = id;
      const meta = FAV_ITEMS.find(f => f.id === id);
      if (meta) _state.team[i].favoriteItem.rare = meta.rare;
    });
  }

  // 收藏品等级
  const favLevel = c.querySelector(`.fav-level[data-slot="${i}"]`);
  if (favLevel) {
    favLevel.addEventListener('input', e => {
      _state.team[i].favoriteItem.level = Math.max(1, Math.min(15, parseInt(e.target.value) || 15));
    });
  }
}

// ─── NIKKE 选择 ──────────────────────────────────────────────────────────

async function _onNikkeSelect(i, value) {
  const slot = _state.team[i];
  if (!value) {
    slot.resourceId = null;
    slot.name = '';
    _updateMeta(i);
    return;
  }

  const resourceId = parseInt(value);
  const char = getCharacterByResourceId(resourceId);
  if (!char) return;

  slot.resourceId  = resourceId;
  slot.name        = char.name;
  slot.classType   = char.classType;
  slot.corporation = char.corporation;
  slot.element     = char.element;
  slot.weaponType  = char.weaponType;
  slot.burstStep   = char.burstStep ?? 'Step3';

  // 装备职业默认与 NIKKE 职业一致
  for (const key of ['head', 'torso', 'arms', 'legs']) {
    slot.equipment[key].classReq = char.classType;
  }

  // 羁绊等级默认设为当前突破对应的上限
  const bMax = maxBond(slot.grade, slot.corporation);
  slot.bondLevel = bMax;

  // 自动选择与武器类型匹配的 SR 收藏品
  const favId = DEFAULT_FAV_SR[char.weaponType] ?? null;
  slot.favoriteItem.resourceId = favId;
  slot.favoriteItem.rare = 'SR';

  // 从账号数据自动填充（覆盖上方默认值）
  const entry = getRosterEntry(resourceId);
  if (entry) _applyRosterEntry(i, entry);

  _updateMeta(i);
  _updateEquipmentClass(i);
  _updateBondMax(i);
  _updateFavSelect(i);

  // 拉取 NIKKE 的 CDN 数据 — 请求期间展示加载状态
  const meta = _container.querySelector(`#meta-${i}`);
  if (meta) meta.insertAdjacentHTML('beforeend', ' <span class="tag dim" id="nikke-loading-${i}">加载中…</span>');
  try {
    slot._nikkeData = null;
    slot._nikkeData = await loadNikke(resourceId);
  } catch (err) {
    console.warn(`[slot ${i}] 加载 NIKKE ${resourceId} 失败：`, err.message);
    if (meta) meta.insertAdjacentHTML('beforeend', '<span class="tag error">CDN 加载失败</span>');
  } finally {
    _container.querySelector(`#nikke-loading-${i}`)?.remove();
  }
}

function _updateMeta(i) {
  const slot = _state.team[i];
  const meta = _container.querySelector(`#meta-${i}`);
  if (!meta) return;
  meta.innerHTML = slot.resourceId
    ? `<span class="tag">${CLASS_LABEL[slot.classType] ?? slot.classType}</span> <span class="tag">${ELEMENT_LABEL[slot.element] ?? slot.element}</span> <span class="tag">${slot.weaponType}</span> <span class="tag">${CORP_LABEL[slot.corporation] ?? slot.corporation}</span>`
    : '';
}

function _updateBondMax(i) {
  const slot = _state.team[i];
  const bMax = maxBond(slot.grade, slot.corporation);
  slot.bondLevel = Math.min(slot.bondLevel, bMax);

  const bondInput = _container.querySelector(`.bond-input[data-slot="${i}"]`);
  if (bondInput) {
    bondInput.max   = bMax;
    bondInput.value = slot.bondLevel;
    const label = bondInput.previousElementSibling ?? bondInput.parentElement;
    const small = bondInput.parentElement.querySelector('small');
    if (small) small.textContent = `（突破 ${slot.grade}${slot.corporation === 'PILGRIM' ? ' 朝圣者' : ''}上限 ${bMax}）`;
  }
}

function _updateFavSelect(i) {
  const slot = _state.team[i];
  const sel  = _container.querySelector(`.fav-select[data-slot="${i}"]`);
  if (sel) sel.value = slot.favoriteItem.resourceId ?? '';
}

function _updateEquipmentClass(i) {
  const slot = _state.team[i];
  EQUIP_SLOTS.forEach(({ key }) => {
    slot.equipment[key].classReq = slot.classType;
    const sel = _container.querySelector(`.equip-class[data-slot="${i}"][data-equip="${key}"]`);
    if (sel) sel.value = slot.classType;
  });
}

// ─── 账号数据自动填充 ───────────────────────────────────────────────────────────

/**
 * 将 RosterEntry 写入 slot 状态，并同步更新对应 DOM 控件。
 * 须在 _onNikkeSelect 设置好基础字段（classType/corporation 等）之后调用。
 * @param {number} i       槽位索引
 * @param {object} entry   getRosterEntry() 返回的 RosterEntry
 */
function _applyRosterEntry(i, entry) {
  const slot = _state.team[i];
  const c    = _container;

  // 突破 & 核心
  slot.grade = entry.grade;
  slot.core  = Math.min(entry.core, 7);
  c.querySelectorAll(`.grade-btn[data-slot="${i}"]`).forEach(btn => {
    const active = parseInt(btn.dataset.grade) === slot.grade;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
  });
  const coreInput = c.querySelector(`.core-input[data-slot="${i}"]`);
  if (coreInput) {
    coreInput.disabled = slot.grade < 3;
    coreInput.value    = slot.core;
  }

  // 羁绊（clamp 至当前突破上限）
  const bMax = maxBond(slot.grade, slot.corporation);
  slot.bondLevel = Math.min(entry.bondLevel, bMax);
  const bondInput = c.querySelector(`.bond-input[data-slot="${i}"]`);
  if (bondInput) bondInput.value = slot.bondLevel;

  // 技能
  slot.skills = entry.skills.slice(0, 3);
  c.querySelectorAll(`.skill-input[data-slot="${i}"]`).forEach(inp => {
    const j = parseInt(inp.dataset.skill);
    inp.value = slot.skills[j] ?? 1;
  });

  // 魔方
  slot.cube.resourceId = entry.cube.resourceId;
  slot.cube.level      = entry.cube.level || 1;
  const cubeSelect = c.querySelector(`.cube-select[data-slot="${i}"]`);
  if (cubeSelect) cubeSelect.value = slot.cube.resourceId ?? '';
  const cubeLevel = c.querySelector(`.cube-level[data-slot="${i}"]`);
  if (cubeLevel) cubeLevel.value = slot.cube.level;
  if (slot.cube.resourceId) _loadCube(i, slot.cube.resourceId);

  // 收藏品
  slot.favoriteItem.resourceId = entry.favoriteItem.resourceId;
  slot.favoriteItem.level      = entry.favoriteItem.level || 1;
  const favMeta = FAV_ITEMS.find(f => f.id === slot.favoriteItem.resourceId);
  if (favMeta) slot.favoriteItem.rare = favMeta.rare;
  const favLevel = c.querySelector(`.fav-level[data-slot="${i}"]`);
  if (favLevel) favLevel.value = slot.favoriteItem.level;

  // 装备
  EQUIP_SLOTS.forEach(({ key }) => {
    const eq = entry.equipment[key];
    if (!eq) return;
    slot.equipment[key].classReq = eq.classReq;
    slot.equipment[key].tier     = eq.tier;
    slot.equipment[key].options  = eq.options.slice();
    const classSel = c.querySelector(`.equip-class[data-slot="${i}"][data-equip="${key}"]`);
    const tierSel  = c.querySelector(`.equip-tier[data-slot="${i}"][data-equip="${key}"]`);
    if (classSel) classSel.value = eq.classReq;
    if (tierSel)  tierSel.value  = eq.tier;
    c.querySelectorAll(`.equip-option[data-slot="${i}"][data-equip="${key}"]`).forEach(chk => {
      chk.checked = eq.options[parseInt(chk.dataset.opt)] ?? false;
    });
  });
}

// ─── 魔方加载 ─────────────────────────────────────────────────────────────

async function _loadCube(i, resourceId) {
  const statusEl = _container.querySelector(`#cube-status-${i}`);
  if (statusEl) statusEl.innerHTML = '<span class="tag dim">加载中…</span>';

  try {
    const data = await loadCube(resourceId);
    _state.team[i]._cubeData = data;
    if (statusEl) statusEl.innerHTML = `<span class="tag success">${CUBE_NAMES[resourceId] ?? data.name_localkey ?? '魔方已加载'}</span>`;
  } catch {
    _state.team[i]._cubeData = null;
    if (statusEl) statusEl.innerHTML = '<span class="tag error">魔方加载失败</span>';
  }
}
