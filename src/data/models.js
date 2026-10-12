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
 * @property {'AR'|'SMG'|'SR'|'MG'|'SG'|'RL'|'Charged'} weaponType
 * @property {'Metal'|'Energy'|'Bio'} damageType
 * @property {'ELYSION'|'MISSILIS'|'TETRA'|'PILGRIM'|'ABNORMAL'} corporation
 * @property {'SSR'|'SR'|'R'} rarity
 * @property {string} burstStep      // 'Step1' | 'Step2' | 'Step3'
 */

/**
 * CDN 数据中电击属性拼写为 "Electronic"，引擎克制表（damage.js ELEMENT_CHART)
 * 及技能过滤统一使用 "Electric"。所有解析入口必须经此归一化。
 * @param {string|null} elem
 * @returns {string|null}
 */
export function normalizeElement(elem) {
  return elem === 'Electronic' ? 'Electric' : elem;
}

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
      element:     normalizeElement(c.element_id?.element?.element ?? null),
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
 * 查找匹配职业和槽位的 T10 装备（getEquipmentByTier 的 T10 简写）。
 * 若无职业专属 T10，回退到 'All' 职业的装备。
 * @param {'Attacker'|'Defender'|'Supporter'} classReq
 * @param {'Module_A'|'Module_B'|'Module_C'|'Module_D'} slot
 * @returns {Equipment|null}
 */
export function getT10Equipment(classReq, slot) {
  return getEquipmentByTier('T10', classReq, slot);
}

/**
 * 查找指定档位、职业、槽位的装备；无职业专属时回退到 'All'。
 * 'All' 职业的 T9 只有测试装备（属性 999999），故 T9 不回退。
 * @param {'T9'|'T10'} tier
 * @param {'Attacker'|'Defender'|'Supporter'} classReq
 * @param {'Module_A'|'Module_B'|'Module_C'|'Module_D'} slot
 * @returns {Equipment|null}
 */
export function getEquipmentByTier(tier, classReq, slot) {
  const all = getAllEquipment();
  return (
    all.find(e => e.tier === tier && e.slot === slot && e.classReq === classReq) ??
    (tier === 'T10' ? all.find(e => e.tier === tier && e.slot === slot && e.classReq === 'All') : null) ??
    null
  );
}

// ─── 装备档位 ────────────────────────────────────────────────────────────
// 'T9Corp' = T9 企业装备（穿戴者同企业时基础属性 +30%，与强化 +10%/级加法叠加），数据上复用 T9 物品

/** 可选装备档位（UI 下拉顺序） */
export const EQUIP_TIERS = ['T10', 'T9Corp', 'T9'];

/** 企业装备对同企业 NIKKE 的属性加成（加法项；lv0 Attacker 头 26442 HP → 34375，lv5 → 47596） */
export const CORP_EQUIP_STAT_BONUS = 0.3;

/** 该档位是否带词条（仅 T10 / Overload 装备有词条） */
export function equipTierHasOptions(tier) {
  return tier === 'T10';
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

// 账号 JSON harmony_cube_tid（7位）→ CUBE_URLS / loadCube 所用的 resource_id（5位）
// 数据来源：src/data/static/cubes/*.json 中的 id 和 resource_id 字段
const _CUBE_TID_TO_RID = new Map([
  [1000301, 10001], [1000302, 10002], [1000303, 10003], [1000304, 10004],
  [1000305, 10005], [1000306, 10006], [1000307, 11001], [1000308, 13001],
  [1000309, 12001], [1000310, 13002], [1000311, 12002], [1000312, 10009],
  [1000313, 10007], [1000314, 10008], [1000315, 10010], [1000316, 10012],
  [1000317, 10013],
]);

/** 按账号 JSON 中的 harmony_cube_tid 查找 resource_id。 */
export function getCubeResourceIdByTid(tid) {
  return _CUBE_TID_TO_RID.get(Number(tid)) ?? null;
}

// ─── Attractive（好感度等级） ──────────────────────────────────────────────────

/**
 * 获取指定职业和好感度等级的固定属性加成。
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
  if (!nikkeData) {
    console.error('[getBaseStats] nikkeData 为 null/undefined');
    throw new Error('[getBaseStats] nikkeData 为 null/undefined');
  }

  const idx = Math.max(0, level - 1);

  // 现代 CDN 布局：每项属性独立数组（character_level_attack_list 等）
  if (nikkeData.character_level_attack_list?.length) {
    const atkList = nikkeData.character_level_attack_list;
    const hpList  = nikkeData.character_level_hp_list;
    const defList = nikkeData.character_level_defence_list;
    if (!hpList?.length) {
      const err = `[getBaseStats] resource_id=${nikkeData.resource_id}: character_level_hp_list 缺失或为空`;
      console.error(err, nikkeData);
      throw new Error(err);
    }
    if (!defList?.length) {
      const err = `[getBaseStats] resource_id=${nikkeData.resource_id}: character_level_defence_list 缺失或为空`;
      console.error(err, nikkeData);
      throw new Error(err);
    }
    return {
      atk: atkList[idx] ?? atkList[atkList.length - 1],
      hp:  hpList[idx]  ?? hpList[hpList.length   - 1],
      def: defList[idx] ?? defList[defList.length  - 1],
    };
  }

  // 旧版兼容：扁平的 stat_list 数组，每项为 {atk, hp, def} 对象
  const list = nikkeData.stat_list ?? nikkeData.stats ?? nikkeData.level_stat ?? nikkeData.stat;
  if (!list?.length) {
    const err = `[getBaseStats] resource_id=${nikkeData.resource_id}: stat list 缺失或为空（尝试字段 stat_list/stats/level_stat/stat）`;
    console.error(err, nikkeData);
    throw new Error(err);
  }
  const entry = list[idx] ?? list[list.length - 1];
  const atk = entry.atk ?? entry.attack ?? entry.Atk;
  const hp  = entry.hp  ?? entry.Hp     ?? entry.HP;
  const def = entry.def ?? entry.defence ?? entry.Def;
  if (atk == null) {
    const err = `[getBaseStats] resource_id=${nikkeData.resource_id} level=${level}: atk 字段缺失（尝试 atk/attack/Atk）`;
    console.error(err, entry);
    throw new Error(err);
  }
  if (hp == null) {
    const err = `[getBaseStats] resource_id=${nikkeData.resource_id} level=${level}: hp 字段缺失（尝试 hp/Hp/HP）`;
    console.error(err, entry);
    throw new Error(err);
  }
  if (def == null) {
    const err = `[getBaseStats] resource_id=${nikkeData.resource_id} level=${level}: def 字段缺失（尝试 def/defence/Def）`;
    console.error(err, entry);
    throw new Error(err);
  }
  return { atk, hp, def };
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
 * @property {boolean} isOverspec           true → 好感度上限 Lv.40（corporation_sub_type=OVERSPEC）
 * @property {number}  baseCritRate         基础暴击率（critical_ratio / 10000）。多数 = 0.15。
 * @property {number}  baseCritDamagePct    暴击时相对 1× 的加成（critical_damage/10000 - 1）。多数 = 0.50。
 * @property {string}  element              NIKKE 属性
 * @property {number}  weaponMultiplier     damage / 10000。例如 557 → 0.0557（5.57%）
 * @property {number}  coreDamagePct        命中核心时相对 1× 的加成（core_damage_rate/10000 - 1）。多数 = 1.0。
 *   TODO: 精度字段（accuracy_change_pershot、accuracy_change_speed、
 *         start/end_accuracy_circle_scale）影响命中核心的概率 — 稍后建模。
 * @property {number}  maxAmmo              基础弹匣容量（未计入加成前）
 * @property {number}  reloadFraction       每次装填恢复的弹匣比例（reload_bullet/10000）。
 *   多数 = 1.0（一次装填满）。例外：Drake = 0.33（需多次装填才能填满）。
 * @property {number}  reloadTime           每次装填的秒数（reload_time / 100）
 * @property {number}  shotCount            每次射击的弹丸数。SG = 10。伤害为合计值不变；仅对逐发技能有意义。
 * @property {number}  chargeBaseMult       full_charge_damage / 10000。仅 SR/RL；AR/SMG/MG/SG = 1.0。
 * @property {number}  chargeTime           全蓄力所需秒数（charge_time / 100）
 * @property {number}  rateOfFire           初始 RPM
 * @property {number}  endRateOfFire        MG 起速后的最高 RPM（非 MG 时 = rateOfFire）
 * @property {number}  rateOfFireChange     每发 RPM 增量（MG 起速；非 MG 为 0）
 * @property {number}  rateOfFireResetTime  停火后 RPM 回落所需秒数（rate_of_fire_reset_time / 100）
 * @property {number}  burstEnergyPerShot         非目标命中时每发的能量（掩体 / miss）
 * @property {number}  targetBurstEnergyPerShot   命中敌方主目标时每发的能量
 *   队伍合计需 1,000,000 才能触发 burst。MG/AR：~500 掩体 / ~1000 敌人。
 * @property {number}  fullChargeBurstEnergy      CDN 原始字段 full_charge_burst_energy；引擎不使用（全蓄力充能取 × full_charge_damage/10000，见 constants.js）
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
  if (!raw) {
    console.error('[parseNikkeDetail] raw 为 null/undefined');
    throw new Error('[parseNikkeDetail] raw 为 null/undefined');
  }
  if (!raw.shot_detail) {
    const err = `[parseNikkeDetail] resource_id=${raw.resource_id}: shot_detail 缺失`;
    console.error(err, raw);
    throw new Error(err);
  }
  const sd = raw.shot_detail;

  function req(obj, field, ctx) {
    if (obj[field] == null) {
      const err = `[parseNikkeDetail] resource_id=${raw.resource_id}: ${ctx}.${field} 缺失`;
      console.error(err, obj);
      throw new Error(err);
    }
    return obj[field];
  }

  const elem = raw.element_details?.[0]?.element;
  if (elem == null) {
    const err = `[parseNikkeDetail] resource_id=${raw.resource_id}: element_details[0].element 缺失`;
    console.error(err, raw.element_details);
    throw new Error(err);
  }

  if (sd.rate_of_fire === undefined) {
    const err = `[parseNikkeDetail] resource_id=${raw.resource_id}: shot_detail.rate_of_fire 缺失`;
    console.error(err, sd);
    throw new Error(err);
  }

  return {
    resourceId:   raw.resource_id,

    burstDuration: req(raw, 'burst_duration', 'raw') / 100,     // 厘秒 → 秒
    useBurstSkill:   req(raw, 'use_burst_skill', 'raw'),
    changeBurstStep: raw.change_burst_step ?? null,              // null = 不切换阶段，为合法值

    classType:   req(raw, 'class', 'raw'),
    corporation: req(raw, 'corporation', 'raw'),
    isOverspec:  raw.corporation_sub_type === 'OVERSPEC',

    baseCritRate:     req(raw, 'critical_ratio', 'raw') / 10000,
    baseCritDamagePct: req(raw, 'critical_damage', 'raw') / 10000 - 1.0,

    element: normalizeElement(elem),

    // 武器
    weaponMultiplier: req(sd, 'damage', 'shot_detail') / 10000,
    coreDamagePct:    req(sd, 'core_damage_rate', 'shot_detail') / 10000 - 1.0,
    maxAmmo:          req(sd, 'max_ammo', 'shot_detail'),
    reloadFraction:   req(sd, 'reload_bullet', 'shot_detail') / 10000,
    reloadTime:       (sd.reload_time ?? 0) / 100,              // 部分 CDN 记录可能不含此字段
    shotCount:        req(sd, 'shot_count', 'shot_detail'),

    // 蓄力武器（SR / RL）
    chargeBaseMult: req(sd, 'full_charge_damage', 'shot_detail') / 10000,
    chargeTime:     (sd.charge_time ?? 0) / 100,                // 非蓄力武器可缺失

    // MG 起速（非 MG 可缺失，默认 0）
    rateOfFire:           sd.rate_of_fire,
    endRateOfFire:        sd.end_rate_of_fire            ?? 0,
    rateOfFireChange:     sd.rate_of_fire_change_pershot ?? 0,
    rateOfFireResetTime:  (sd.rate_of_fire_reset_time    ?? 0) / 100,

    // 散布圆（accuracy circle）— 命中率机制用。自动战斗优先 auto_* 字段，缺失回退手动字段。
    // 数值为 CDN scale 原值（如标准 SG=250、SMG=110、AR=75、MG=250→10）。SR/RL 无收束意义（恒核心命中）。
    startAccuracyScale:    sd.auto_start_accuracy_circle_scale ?? sd.start_accuracy_circle_scale ?? null,
    endAccuracyScale:      sd.auto_end_accuracy_circle_scale   ?? sd.end_accuracy_circle_scale   ?? null,
    accuracyChangePerShot: sd.auto_accuracy_change_pershot     ?? sd.accuracy_change_pershot     ?? 0,
    accuracyChangeSpeed:   sd.auto_accuracy_change_speed       ?? sd.accuracy_change_speed       ?? 0,
    spotExplosionRange:    sd.spot_explosion_range ?? 0,

    // 距离优势区间（顶层字段，非 shot_detail）：优势 ⟺ 敌人距离 ∈ [min, max]。RL 为 (0,0) 永不触发。
    bonusRangeMin: raw.bonusrange_min ?? 0,
    bonusRangeMax: raw.bonusrange_max ?? 0,

    // 爆裂能量
    burstEnergyPerShot:       req(sd, 'burst_energy_pershot', 'shot_detail'),
    targetBurstEnergyPerShot: req(sd, 'target_burst_energy_pershot', 'shot_detail'),
    fullChargeBurstEnergy:    sd.full_charge_burst_energy ?? 0, // SR/RL 专属，可缺失

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
    console.error('[getSkillValue] 技能值缺失', { paramIndex, skillLevel, group_id: skillDetail?.group_id });
    throw new Error(`[getSkillValue] paramIndex=${paramIndex} skillLevel=${skillLevel} group_id=${skillDetail?.group_id}: 技能值缺失`);
  }
  return parseFloat(raw);
}

/**
 * 从 SSR 珍藏品在指定物品等级下的 collection_skill_group_data
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
 * @param {object} favData   — 原始 CDN 珍藏品 JSON（.data 字段）
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
 * 为装备了 SSR 珍藏品的 NIKKE 返回升级后的技能详情对象。
 *
 * SSR 珍藏品自带 `favoriteitem_skill_group_data`：三项数组（Skill1、Skill2、Burst），
 * 每项包含对应角色技能的完整 10 级数值表。`level1`/`level2` 数组归属于
 * `collection_skill_group_data`（全队基础被动），与此处无关。
 *
 * CDN 不编码玩家当前技能等级；调用方应传入角色的技能等级，省略时按满级（10）计算。
 *
 * 当珍藏品没有 `favoriteitem_skill_group_data`（R/SR 物品）时返回 `null`。
 *
 * @param {object} favData              原始 CDN 珍藏品 JSON（.data 字段）
 * @param {number} itemLevel            物品强化等级（保留参数，当前未使用）
 * @param {number|number[]} [skillLevelOverride] 技能等级（1–10）：单个数值作用于全部技能，
 *                                      数组则按 [skill1, skill2, burst] 分别指定；省略时默认为 10
 * @returns {{ skill1: object, skill2: object, burst: object } | null}
 */
export function getSsrFavSkills(favData, itemLevel, skillLevelOverride) {
  const fskills = favData?.favoriteitem_skill_group_data;
  if (!fskills?.length) return null;
  const result  = {};
  const slotLabels = { 1: 'skill1', 2: 'skill2', 3: 'burst' };
  // CDN 数组顺序可能不固定（部分角色为逆序），按 skill_change_slot 显式映射
  for (const entry of fskills) {
    const info  = entry?.info;
    const label = slotLabels[entry?.skill_change_slot];
    if (!info || !label) continue;
    // CDN JSON 中的 skill_level 始终为 1（非玩家实际等级），不可用；默认满级 10
    const override = Array.isArray(skillLevelOverride)
      ? skillLevelOverride[entry.skill_change_slot - 1]
      : skillLevelOverride;
    const skillLv = override ?? 10;
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
