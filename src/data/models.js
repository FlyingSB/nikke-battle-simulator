/**
 * 将原始 CDN 数据规范化为引擎使用的干净对象。
 */
import { getData } from './loader.js';

// ─── 角色花名册 ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} Character
 * @property {number} resourceId     // 跨补丁稳定；由 getRoleDataUrl() 动态生成 URL 时使用
 * @property {number} id             // 内部花名册 id（例如 209001）
 * @property {string} name           // 显示名（来自 CDN 的繁体中文）
 * @property {'Attacker'|'Defender'|'Supporter'} classType
 * @property {'Fire'|'Water'|'Wind'|'Electric'|'Iron'} element
 * @property {'AR'|'SMG'|'SR'|'MG'|'SG'|'RL'} weaponType
 * @property {'Metal'|'Energy'|'Bio'} damageType
 * @property {'ELYSION'|'MISSILIS'|'TETRA'|'PILGRIM'|'ABNORMAL'} corporation
 * @property {'SSR'|'SR'|'R'} rarity
 * @property {string} burstStep      // 'Step1' | 'Step2' | 'Step3'
 */

let _rosterCache = null;

/** @returns {Character[]} 按名称排序 */
export function getAllCharacters() {
  if (_rosterCache) return _rosterCache;
  const raw = getData('characters') ?? [];
  _rosterCache = raw
    .filter(c => c.is_visible !== false)
    .map(c => ({
      resourceId:  c.resource_id,
      id:          c.id,
      nameCode:    c.name_code ?? 0,
      name:        c.name_localkey?.name ?? String(c.resource_id),
      classType:   c.class ?? 'Attacker',
      element:     c.element_details?.[0]?.element ?? null,
      weaponType:  (typeof c.shot_id    === 'object' ? c.shot_id?.element?.weapon_type : null) ?? null,
      damageType:  (typeof c.shot_id    === 'object' ? c.shot_id?.element?.attack_type : null) ?? null,
      corporation: c.corporation ?? 'ELYSION',
      rarity:      c.original_rare ?? 'SSR',
      burstStep:   c.use_burst_skill ?? 'Step1',
    }))
    .sort((a, b) => a.resourceId - b.resourceId);
  return _rosterCache;
}

/** @param {number} resourceId @returns {Character|undefined} */
export function getCharacterByResourceId(resourceId) {
  return getAllCharacters().find(c => c.resourceId === Number(resourceId));
}

/** @param {number} nameCode @returns {Character|undefined} */
export function getCharacterByNameCode(nameCode) {
  return getAllCharacters().find(c => c.nameCode === Number(nameCode));
}

/** @param {string} name 显示名（大小写敏感，来自 CDN name_localkey）@returns {Character|undefined} */
export function getCharacterByName(name) {
  return getAllCharacters().find(c => c.name === name);
}

// ─── 装备 ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Equipment
 * @property {number} id
 * @property {string} name
 * @property {'Module_A'|'Module_B'|'Module_C'|'Module_D'} slot
 * @property {'Attacker'|'Defender'|'Supporter'|'All'} classReq
 * @property {'T1'|'T2'|'T3'|'T4'|'T5'|'T6'|'T7'|'T8'|'T9'|'T10'} tier
 * @property {number} atk
 * @property {number} hp
 * @property {number} def
 * @property {boolean} hasOptions  // T10 时为 true
 */

let _equipCache = null;

/** @returns {Equipment[]} */
export function getAllEquipment() {
  if (_equipCache) return _equipCache;
  const raw = getData('equipment') ?? [];
  _equipCache = raw
    .filter(e => e.item_type === 'Equip' && e.name_localkey !== '-')
    .map(e => {
      const stats = parseStatArray(e.stat ?? []);
      return {
        id:       e.id,
        name:     e.name_localkey ?? String(e.id),
        slot:     e.item_sub_type,
        classReq: e.class ?? 'All',
        tier:     e.item_rare ?? 'T1',
        atk:      stats.atk,
        hp:       stats.hp,
        def:      stats.def,
        hasOptions: (e.option_slot ?? []).some(s => s.option_slot !== 0),
      };
    });
  return _equipCache;
}

/**
 * 查找匹配职业和槽位的 T10 装备。
 * 若无职业专属 T10，回退到 'All' 职业的装备。
 * @param {'Attacker'|'Defender'|'Supporter'} classReq
 * @param {'Module_A'|'Module_B'|'Module_C'|'Module_D'} slot
 * @returns {Equipment|null}
 */
export function getT10Equipment(classReq, slot) {
  const all = getAllEquipment();
  return (
    all.find(e => e.tier === 'T10' && e.slot === slot && e.classReq === classReq) ??
    all.find(e => e.tier === 'T10' && e.slot === slot && e.classReq === 'All') ??
    null
  );
}

// ─── 和谐魔方 ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} HarmonyCube
 * @property {number} id
 * @property {string} name
 * @property {number[]} atk   // 按 level-1 索引（最大 lv15 时长度为 15）
 * @property {number[]} hp
 * @property {number[]} def
 */

/** 规范化原始魔方 JSON（CDN 的单对象格式）。 */
export function normalizeCube(raw) {
  if (!raw) return null;
  return {
    id:     raw.id,
    name:   raw.name_localkey ?? String(raw.id),
    atk:    raw.atk ?? [],
    hp:     raw.hp  ?? [],
    def:    raw.def ?? [],
    // levels[si][cubeLevel-1] → 第 si 个技能的 1-based 技能等级。
    // (skillLv - 1) 作为 description_value 的 0-based 索引。
    // CDN 以 level1、level2、level3 存储 — 每个技能槽一个数组。
    levels: [raw.level1 ?? [], raw.level2 ?? [], raw.level3 ?? []],
    skills: (raw.harmonycube_skill_group ?? []).filter(Boolean),
  };
}

// ─── Attractive（羁绊等级） ──────────────────────────────────────────────────

/**
 * 获取指定职业和羁绊等级的固定属性加成。
 * 值为固定值（非百分比）— 直接加到最终属性上。
 * @param {'Attacker'|'Defender'|'Supporter'} classType
 * @param {number} level   1–40
 * @returns {{ atk: number, hp: number, def: number }}
 */
export function getBondBonus(classType, level) {
  const table = getData('attractive') ?? [];
  const prefix = classType.toLowerCase(); // 'attacker' | 'defender' | 'supporter'
  const row = table.find(r => r.attractive_level === level);
  if (!row) return { atk: 0, hp: 0, def: 0 };
  return {
    atk: row[`${prefix}_attack_rate`]  ?? 0,
    hp:  row[`${prefix}_hp_rate`]      ?? 0,
    def: row[`${prefix}_defence_rate`] ?? 0,
  };
}

// ─── 研究（回收室） ──────────────────────────────────────────────────

/**
 * recycleRoom 表中的一条研究记录。
 * @typedef {Object} ResearchRow
 * @property {number} id
 * @property {string} type       // 'Personal' | 'Class' | 'Corporation'
 * @property {string} subtype    // 'Personal' | 'Attacker' | 'ELYSION' | …
 * @property {number} atkPerLv   // 每级研究的固定 ATK 加成
 * @property {number} hpPerLv
 * @property {number} defPerLv
 */

let _researchCache = null;

/** @returns {ResearchRow[]} */
export function getAllResearchRows() {
  if (_researchCache) return _researchCache;
  const raw = getData('recycleRoom') ?? [];
  _researchCache = raw.map(r => ({
    id:       r.id,
    type:     r.recycle_type    ?? '',
    subtype:  r.recycle_sub_type ?? '',
    atkPerLv: r.attack   ?? 0,
    hpPerLv:  r.hp       ?? 0,
    defPerLv: r.defence  ?? 0,
  }));
  return _researchCache;
}

/**
 * 计算单个 NIKKE 的研究总属性加成。
 * @param {string} classType       // NIKKE 职业
 * @param {string} corporation     // NIKKE 厂商
 * @param {object} levels          // { general, attacker, defender, supporter, ELYSION, … }
 * @returns {{ atk: number, hp: number, def: number }}
 */
export function computeResearchBonus(classType, corporation, levels) {
  const rows = getAllResearchRows();
  let atk = 0, hp = 0, def = 0;

  for (const r of rows) {
    let lv = 0;
    if (r.type === 'Personal') {
      lv = levels.general ?? 0;
    } else if (r.type === 'Class' && r.subtype === classType) {
      lv = levels[r.subtype.toLowerCase()] ?? 0;
    } else if (r.type === 'Corporation' && r.subtype === corporation) {
      lv = levels[r.subtype] ?? 0;
    }
    atk += r.atkPerLv * lv;
    hp  += r.hpPerLv  * lv;
    def += r.defPerLv * lv;
  }

  return { atk, hp, def };
}

/**
 * 计算给定同步器等级下可解锁的通用研究上限。
 * 公式：floor(syncLevel / 20 - 2) * 10，最小为 0。
 * @param {number} syncLevel  当前同步器等级
 * @returns {number}
 */
export function maxGeneralResearchLevel(syncLevel) {
  return Math.max(0, (Math.floor(syncLevel / 20) - 2) * 10);
}

// ─── 单 NIKKE 基础属性 ─────────────────────────────────────────────────────

/**
 * 从单角色 CDN JSON 中按等级提取基础属性。
 * JSON 中有按 level-1（或类似方式）索引的 `stat_list` 数组。
 * @param {object} nikkeData  loadNikke() 返回的原始 JSON
 * @param {number} level      1–200
 * @returns {{ atk: number, hp: number, def: number }}
 */
export function getBaseStats(nikkeData, level) {
  if (!nikkeData) return { atk: 0, hp: 0, def: 0 };

  const idx = Math.max(0, level - 1);

  // 现代 CDN 布局：每项属性独立数组（character_level_attack_list 等）
  if (nikkeData.character_level_attack_list?.length) {
    const atkList = nikkeData.character_level_attack_list;
    const hpList  = nikkeData.character_level_hp_list       ?? [];
    const defList = nikkeData.character_level_defence_list  ?? [];
    return {
      atk: atkList[idx] ?? atkList[atkList.length - 1] ?? 0,
      hp:  hpList[idx]  ?? hpList[hpList.length   - 1] ?? 0,
      def: defList[idx] ?? defList[defList.length  - 1] ?? 0,
    };
  }

  // 旧版兼容：扁平的 stat_list 数组，每项为 {atk, hp, def} 对象
  const list = nikkeData.stat_list ?? nikkeData.stats ?? nikkeData.level_stat ?? nikkeData.stat ?? [];
  const entry = list[idx] ?? list[list.length - 1] ?? {};
  return {
    atk: entry.atk ?? entry.attack  ?? entry.Atk ?? 0,
    hp:  entry.hp  ?? entry.Hp      ?? entry.HP  ?? 0,
    def: entry.def ?? entry.defence ?? entry.Def ?? 0,
  };
}

// ─── 单 NIKKE 详情 ─────────────────────────────────────────────────────

/**
 * @typedef {Object} NikkeDetail
 * @property {number}  resourceId
 * @property {number}  burstDuration        秒（原值 /100）。多数 NIKKE = 10 秒。
 * @property {string}  useBurstSkill        'Step1'|'Step2'|'Step3'
 *   TODO: "Red Hood"（resource_id 未知）的爆裂阶段行为特殊 — 需单独处理。
 * @property {string}  changeBurstStep      使用 burst 之后进入的阶段：'Step2'|'Step3'|'StepFull'
 *   多数 Step3 NIKKE 会进入 StepFull。少数例外保持当前阶段。
 * @property {string}  classType            'Attacker'|'Defender'|'Supporter'
 * @property {string}  corporation          'ELYSION'|'MISSILIS'|'TETRA'|'PILGRIM'|'ABNORMAL'
 * @property {boolean} isOverspec           true → 羁绊上限 Lv.40（corporation_sub_type=OVERSPEC）
 * @property {number}  baseCritRate         基础暴击率（critical_ratio / 10000）。多数 = 0.15。
 * @property {number}  baseCritDmgBonus     暴击时相对 1× 的加成（critical_damage/10000 - 1）。多数 = 0.50。
 * @property {string}  element              NIKKE 属性
 * @property {number}  weaponMultiplier     damage / 10000。例如 557 → 0.0557（5.57%）
 * @property {number}  coreDmgBonus         命中核心时相对 1× 的加成（core_damage_rate/10000 - 1）。多数 = 1.0。
 *   TODO: 精度字段（accuracy_change_pershot、accuracy_change_speed、
 *         start/end_accuracy_circle_scale）影响命中核心的概率 — 稍后建模。
 * @property {number}  maxAmmo              基础弹匣容量（未计入加成前）
 * @property {number}  reloadFraction       每次装填恢复的弹匣比例（reload_bullet/10000）。
 *   多数 = 1.0（一次装填满）。例外：Drake = 0.33（需多次装填才能填满）。
 * @property {number}  reloadTime           每次装填的秒数（reload_time / 100）
 * @property {number}  shotCount            每次射击的弹丸数。SG = 10。伤害为合计值不变；仅对逐发技能有意义。
 * @property {number}  chargeBaseMult       full_charge_damage / 10000。仅 SR/RL；AR/SMG/MG/SG = 1.0。
 * @property {number}  chargeTime           满蓄力所需秒数（charge_time / 100）
 * @property {number}  rateOfFire           初始 RPM
 * @property {number}  endRateOfFire        MG 起速后的最高 RPM（非 MG 时 = rateOfFire）
 * @property {number}  rateOfFireChange     每发 RPM 增量（MG 起速；非 MG 为 0）
 * @property {number}  rateOfFireResetTime  停火后 RPM 回落所需秒数（rate_of_fire_reset_time / 100）
 * @property {number}  burstEnergyPerShot         非目标命中时每发的能量（掩体 / miss）
 * @property {number}  targetBurstEnergyPerShot   命中敌方主目标时每发的能量
 *   队伍合计需 1,000,000 才能触发 burst。MG/AR：~500 掩体 / ~1000 敌人。
 * @property {number}  fullChargeBurstEnergy      SR/RL 满蓄力射击的额外爆裂能量
 * @property {object|null} skill1   原始 skill1_detail CDN 对象
 * @property {object|null} skill2   原始 skill2_detail CDN 对象
 * @property {object|null} burst    原始 ulti_skill_detail CDN 对象
 *
 * 技能值结构（skill1、skill2、burst）：
 *   group_id                     — 技能组 ID，跨等级稳定；用作 src/data/skill-traits.js 注册表的键
 *   description_localkey         — 带 {description_value_01}、{description_value_02} … 占位符的展示文本
 *   description_value_list[N]    — 第 N 个占位符的数据（0-based；空项表示后续无更多占位符）
 *     .description_value[L]      — 10 元素数组，L = skillLevel - 1（0-based，技能等级 1–10）
 *
 * 使用 getSkillValue(skill, paramIndex, skillLevel) 安全读取值。
 *   例：getSkillValue(nikke.burst, 4, 10) → '2808'，Rapi:RH burst 在技能 lv10 时（2808% ATK）
 *
 * 使用 getSkillTraits(skill?.group_id)（src/data/skill-traits.js）查询手写机制属性
 *   （如 canHitCore、tags），这些属性无法从 CDN 数据推导。
 *
 *   TODO: stat_enhance_detail — grade/core 公式常量（所有 NIKKE 相同；已在 applyGradeCore 中处理）。
 */

/**
 * 将单角色的原始 CDN 详情 JSON 规范化为战斗可用的干净对象。
 * 输入为 CDN 文件内的 `.data` 对象（loader/cache 已解包）。
 * @param {object} raw   原始 NIKKE 详情数据（含 resource_id、shot_detail、skills 等）
 * @returns {NikkeDetail}
 */
export function parseNikkeDetail(raw) {
  if (!raw) return null;
  const sd = raw.shot_detail ?? {};
  return {
    resourceId:   raw.resource_id,

    burstDuration: (raw.burst_duration ?? 1000) / 100,     // 厘秒 → 秒
    useBurstSkill:   raw.use_burst_skill  ?? 'Step1',
    changeBurstStep: raw.change_burst_step ?? null,

    classType:   raw.class       ?? null,
    corporation: raw.corporation ?? null,
    isOverspec:  raw.corporation_sub_type === 'OVERSPEC',

    baseCritRate:     (raw.critical_ratio  ?? 1500) / 10000,  // 1500 → 0.15
    baseCritDmgBonus: (raw.critical_damage ?? 15000) / 10000 - 1.0,  // 15000 → 0.50

    element: raw.element_details?.[0]?.element ?? null,

    // 武器
    weaponMultiplier: (sd.damage          ?? 0)     / 10000,
    coreDmgBonus:     (sd.core_damage_rate ?? 20000) / 10000 - 1.0,  // 20000 → 1.0
    maxAmmo:          sd.max_ammo          ?? 0,
    reloadFraction:   (sd.reload_bullet    ?? 10000) / 10000,
    reloadTime:       (sd.reload_time      ?? 0)     / 100,
    shotCount:        sd.shot_count        ?? 1,

    // 蓄力武器（SR / RL）
    chargeBaseMult: (sd.full_charge_damage ?? 10000) / 10000,
    chargeTime:     (sd.charge_time        ?? 0)     / 100,

    // MG 起速
    rateOfFire:           sd.rate_of_fire               ?? 0,
    endRateOfFire:        sd.end_rate_of_fire            ?? 0,
    rateOfFireChange:     sd.rate_of_fire_change_pershot ?? 0,
    rateOfFireResetTime:  (sd.rate_of_fire_reset_time    ?? 0) / 100,

    // 爆裂能量
    burstEnergyPerShot:       sd.burst_energy_pershot        ?? 0,
    targetBurstEnergyPerShot: sd.target_burst_energy_pershot ?? 0,
    fullChargeBurstEnergy:    sd.full_charge_burst_energy     ?? 0,

    // 技能（原始数据 — 使用 getSkillValue() 读取值）
    skill1: raw.skill1_detail      ?? null,
    skill2: raw.skill2_detail      ?? null,
    burst:  raw.ulti_skill_detail  ?? null,
  };
}

/**
 * 从技能的 description_value_list 中读取一个数值。
 *
 * 结构：
 *   description_value_list[paramIndex].description_value[skillLevel - 1]
 *
 * @param {object} skillDetail   skill1_detail / skill2_detail / ulti_skill_detail（原始 CDN 对象）
 * @param {number} paramIndex    占位符的 0-based 索引（{description_value_01} → 0）
 * @param {number} skillLevel    1–10
 * @returns {number}             解析得到的浮点数，缺失时返回 0
 */
export function getSkillValue(skillDetail, paramIndex, skillLevel) {
  const raw = skillDetail?.description_value_list?.[paramIndex]?.description_value?.[skillLevel - 1];
  if (raw == null) {
    console.error(`[getSkillValue] 取值失败: id=${skillDetail?.id ?? 'null'}, paramIndex=${paramIndex}, skillLevel=${skillLevel}`);
    return 0;
  }
  return parseFloat(raw);
}

/**
 * 从 SSR 收藏品在指定物品等级下的 collection_skill_group_data
 * 中提取对模拟有影响的被动效果。
 *
 * 每个收藏技能是战斗开局的永久被动。第 si 个技能槽使用根级别的
 * level{si+1} 数组决定当前技能等级（1-based）。
 * 每个 description 占位符对应一个效果；我们读取全部。
 *
 * 已建模的效果（占位符文本 → 字段）：
 *   "Charge Damage Multiplier ▲"        → chargeDmgPct   （RL/SR 物品）
 *   "Normal Attack Damage Multiplier ▲"  → attackDmgPct   （SMG/SG 物品）
 *   "Max Ammunition Capacity ▲"          → ammoPct        （MG 物品）
 *   "Damage dealt when attacking core ▲" → coreDmgPct     （AR 物品，尚未进入伤害公式）
 *
 * 忽略（因未建模受伤 / 掩体）：
 *   "DEF ▲"、"Damage Taken ▼"、"Cover's Max HP ▲"
 *
 * @param {object} favData   — 原始 CDN 收藏品 JSON（.data 字段）
 * @param {number} itemLevel — 0–15
 * @returns {{ chargeDmgPct: number, attackDmgPct: number, ammoPct: number, coreDmgPct: number }}
 */
export function getFavItemSkillEffects(favData, itemLevel) {
  const skills   = favData?.collection_skill_group_data ?? [];
  const lvArrays = [favData?.level1 ?? [], favData?.level2 ?? [], favData?.level3 ?? []];
  let chargeDmgPct = 0, attackDmgPct = 0, ammoPct = 0, coreDmgPct = 0;

  for (let si = 0; si < skills.length; si++) {
    const skill   = skills[si];
    const lvArr_  = lvArrays[si] ?? [];
    const clampedLevel = Math.min(itemLevel, Math.max(0, lvArr_.length - 1));
    const skillLv = lvArr_[clampedLevel] ?? 0;
    if (skillLv < 1) continue;
    const desc = skill.description_localkey ?? '';
    const dvl  = skill.description_value_list ?? [];

    // 遍历每个 {description_value_NN} 占位符，按其前面的文本分类。
    const placeholders = [...desc.matchAll(/\{description_value_(\d+)\}/g)];
    for (const match of placeholders) {
      const pi  = parseInt(match[1], 10) - 1; // 0-based 索引
      const raw = dvl[pi]?.description_value?.[skillLv - 1];
      if (raw == null) continue;
      const val = parseFloat(raw) / 100;
      // 上下文：从上一个占位符（或技能块开头）到当前占位符之间的文本
      const blockStart = desc.lastIndexOf('■', match.index);
      const prevEnd    = match.index > 0 ? (desc.lastIndexOf('}', match.index - 1) + 1) : (blockStart + 1);
      const ctx        = desc.slice(prevEnd, match.index).replace(/<[^>]+>/g, '');

      if      (ctx.includes('Charge Damage'))              chargeDmgPct += val;
      else if (ctx.includes('Normal Attack Damage'))        attackDmgPct += val;
      else if (ctx.includes('Max Ammunition Capacity'))     ammoPct      += val;
      else if (ctx.includes('attacking core'))              coreDmgPct   += val;
      // 'DEF ▲'、'Damage Taken ▼'、'Cover' — 未建模
    }
  }
  return { chargeDmgPct, attackDmgPct, ammoPct, coreDmgPct };
}

/**
 * 为装备了 SSR 收藏品的 NIKKE 返回升级后的技能详情对象。
 *
 * SSR 收藏品自带 `favoriteitem_skill_group_data`：三项数组（Skill1、Skill2、Burst），
 * 每项包含对应角色技能的完整 10 级数值表。`level1`/`level2` 数组归属于
 * `collection_skill_group_data`（全队基础被动），与此处无关。
 *
 * favoriteitem 技能由玩家独立升级（1–10），CDN 不编码当前等级；默认按满级（10）计算。
 *
 * 当收藏品没有 `favoriteitem_skill_group_data`（R/SR 物品）时返回 `null`。
 *
 * @param {object} favData              原始 CDN 收藏品 JSON（.data 字段）
 * @param {number} itemLevel            物品强化等级（保留参数，当前未使用）
 * @param {number} [skillLevelOverride] 指定技能等级（1–10）；省略时默认为 10
 * @returns {{ skill1: object, skill2: object, burst: object } | null}
 */
export function getSsrFavSkills(favData, itemLevel, skillLevelOverride) {
  const fskills = favData?.favoriteitem_skill_group_data;
  if (!fskills?.length) return null;
  const skillLv = skillLevelOverride ?? 10;
  const result  = {};
  const slotLabels = { 1: 'skill1', 2: 'skill2', 3: 'burst' };
  // CDN 数组顺序可能不固定（部分角色为逆序），按 skill_change_slot 显式映射
  for (const entry of fskills) {
    const info  = entry?.info;
    const label = slotLabels[entry?.skill_change_slot];
    if (!info || !label) continue;
    result[label] = { ...info, _activeSkillLevel: skillLv };
  }
  return Object.keys(result).length ? result : null;
}

function parseStatArray(statArr) {
  const out = { atk: 0, hp: 0, def: 0 };
  for (const s of statArr) {
    const type = (s.stat_type ?? '').toLowerCase();
    const val  = s.stat_value ?? 0;
    if (type === 'atk' || type === 'attack')       out.atk += val;
    else if (type === 'hp')                         out.hp  += val;
    else if (type === 'defence' || type === 'def') out.def += val;
  }
  return out;
}
