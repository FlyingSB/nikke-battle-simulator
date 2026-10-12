/**
 * 最终属性计算。
 * 计算流程：基础（每位 NIKKE 的等级表）
 *         → 突破 / 核心（Limit Break）
 *         + 好感度加成（固定值）
 *         + 装备 ATK/HP/DEF（固定值；物品基础属性 × 强化倍率）
 *         + 魔方固定值（按魔方等级）
 *         + 珍藏品固定值（按物品等级）
 *         + 研究固定值（每级加成 × 级数）
 *         + 装备词条 atkFlat / defFlat（固定值）
 *
 * 装备 "Increase ATK" 词条（atkPct）不会计入返回值中的 atk，
 * 而是单独以 equipAtkPct 返回，让战斗引擎在伤害计算时与技能 ATK% buff 按加法组合。
 */
import {
  getBaseStats,
  getBondBonus,
  getEquipmentByTier,
  CORP_EQUIP_STAT_BONUS,
  normalizeCube,
  computeResearchBonus,
} from '../data/models.js';

/**
 * @typedef {Object} SlotConfig
 * @property {number|null} resourceId    // null = 槽位为空
 * @property {string} classType          // Attacker | Defender | Supporter
 * @property {string} corporation        // ELYSION | MISSILIS | TETRA | PILGRIM | ABNORMAL
 * @property {string} element
 * @property {string} weaponType
 * @property {number} grade              // 极限突破等级 0-3
 * @property {number} core               // 核心 0-7（仅在突破 3 时有效）
 * @property {number} bondLevel          // 1-40
 * @property {number[]} skills           // [skill1, skill2, burst]
 * @property {{ resourceId: number|null, level: number }} cube
 * @property {{ resourceId: number|null, level: number, rare: string }} favoriteItem
 * @property {{ head: EquipSlotCfg, torso: EquipSlotCfg, arms: EquipSlotCfg, legs: EquipSlotCfg }} equipment
 * @property {object|null} _nikkeData    // loadNikke() 返回的 CDN 原始 JSON（已加载时）
 * @property {object|null} _cubeData     // 魔方原始 CDN JSON（已加载时）
 * @property {object|null} _favItemData  // 珍藏品原始 CDN JSON（已加载时）
 * @property {EquipOptions} [equipOptions] // 四个装备槽位词条加成的合计
 */

/**
 * @typedef {Object} EquipSlotCfg
 * @property {string} classReq           // Attacker | Defender | Supporter | All
 * @property {string} tier               // 'T10' | 'T9Corp'（T9 企业）| 'T9'；其余档位不计属性
 * @property {number} [level]            // 强化等级 0–5（默认 0）
 * @property {boolean[]} options         // [effect1, effect2, effect3] 是否已获取
 */

/**
 * @typedef {Object} GlobalResearch
 * @property {number} general
 * @property {number} attacker
 * @property {number} defender
 * @property {number} supporter
 * @property {number} ELYSION
 * @property {number} MISSILIS
 * @property {number} TETRA
 * @property {number} PILGRIM
 * @property {number} ABNORMAL
 */

/**
 * @typedef {Object} FinalStats
 * @property {number} atk
 * @property {number} hp
 * @property {number} def
 * @property {number} critRate           基础 0.15 + 装备 critRatePct
 * @property {number} critDmg            基础 0.50 + 装备 critDamagePct（= calcDamage 用的 critDmgIncrement）
 * @property {number} elementDmgPct      来自装备词条（传给 calcDamage 的 elementAdvantageDmgIncrement）
 * @property {number} equipMaxAmmoPct     来自装备词条（加到 maxAmmo 上）
 * @property {number} chargeDmgPct       来自装备词条。以 chargeDmgStat: (1 + chargeDmgPct) 的形式传给 calcDamage()。
 * @property {number} chargeSpeedPct     来自装备词条（仅记录；会减少蓄力时间 — 当前模型未计算）
 * @property {number} hitRatePct         来自装备词条（仅记录；未建模 — 默认必定命中）
 * @property {Object<string, number>} cubeBuffPcts  魔方开战永久 buff（键为 BUFF_NUMERIC_FIELDS 字段名），
 *                                                  由 battle.js initBattle 作为「魔方」永久 buff 推入
 */

// 魔方主技能中作为开战永久 buff 建模的效果：[描述匹配正则, buff 字段名]。
// 匹配前先去除 <color>/<word_group> 标签。Max HP 须锚定「开战即生效」句式，
// 以排除 Assist（HP 低于阈值时触发）和 Stealth（Max HP of cover）。
const CUBE_BUFF_PATTERNS = [
  [/^■ Activates (?:when entering|at the start of) battle\.\s*Max HP ▲/, 'maxHpPct'],       // Vigor
  [/Damage to Parts ▲/,    'damageToPartsPct'],      // Destruction
  [/Pierce Damage ▲/,      'pierceDamagePct'],       // Piercing
  [/True Damage ▲/,        'trueDamagePct'],         // Rupture
  [/Distributed Damage ▲/, 'distributedDamagePct'],  // Diffusion
];

export const SLOT_MAP = {
  head:  'Module_A',
  torso: 'Module_B',
  arms:  'Module_C',
  legs:  'Module_D',
};

/**
 * 装备词条效果 — 用户指定的四个装备槽位词条效果合计。
 * 未获取词条的槽位传 0 或省略即可。
 *
 * @typedef {Object} EquipOptions
 * @property {number} [atkPct=0]           装备 "ATK ▲X%" 词条 — 乘法，最后应用
 * @property {number} [atkFlat=0]          固定 ATK 加成（两遍计算中从 atkPct 推导；或直接给定）
 * @property {number} [elementDmgPct=0]    "Increase Element Damage Dealt" — 小数（0.05 = 5%）
 * @property {number} [hitRatePct=0]       "Increase Hit Rate" — 小数（仅记录，不参与模拟）
 * @property {number} [equipMaxAmmoPct=0]  "Increase Max Ammunition Capacity" — 固定子弹数。
 *                                          使用 grouped-ROUND 规则计算：将相同 pct 的词条分组，
 *                                          然后每组 Math.round(baseAmmo × pct × count)。
 *                                          OL 最多 4 个槽位。此处不要包含珍藏品 / 魔方 pct，
 *                                          那些会在 battle.js 的 maxAmmo 初始化处单独应用。
 * @property {number} [chargeDmgPct=0]     "Increase Charge Damage" — 加在蓄力倍率上的小数
 * @property {number} [chargeSpeedPct=0]   "Increase Charge Speed" — 小数（仅记录，减少蓄力时间）
 * @property {number} [critRatePct=0]      "Increase Critical Rate" — 加到暴击率的小数
 * @property {number} [critDamagePct=0]       "Increase Critical Damage" — 加到暴击伤害增量的小数
 * @property {number} [defFlat=0]          "Increase DEF" 词条带来的固定 DEF 加成
 */

const BASE_CRIT_RATE = 0.15;
const BASE_CRIT_DMG  = 0.50;

// 每个职业的 Grade/Core 固定值常量（c_class / 7 = 每核心提供的固定 ATK）
const GRADE_CORE_C = { Attacker: 959, Defender: 931, Supporter: 921 };

/**
 * 将 Grade/Core（Limit Break）的倍率与固定加成应用到单个基础属性值上。
 * 对 ATK、HP、DEF 都使用同一套公式。
 *
 * Grade 公式（grade <= 3，core == 0）：
 *   result = base × (1 + 0.02 × grade) + 20 × grade
 *
 * Core 公式（grade == 3，core 1-7）：
 *   result = base × (1.06 + core × 0.0212) + 60 + core × c_class / 7
 *
 * @param {number} base       原始等级属性（grade 0，core 0）
 * @param {number} grade      0–3
 * @param {number} core       0–7（仅在 grade 3 时有意义）
 * @param {string} classType  'Attacker' | 'Defender' | 'Supporter'
 * @returns {number}
 */
export function applyGradeCore(base, grade, core, classType) {
  const c = GRADE_CORE_C[classType] ?? GRADE_CORE_C.Attacker;
  if (grade <= 3 && core === 0) {
    return base * (1 + 0.02 * grade) + 20 * grade;
  }
  if (grade === 3 && core >= 1 && core <= 7) {
    return base * (1.06 + core * 0.0212) + 60 + (core * c) / 7;
  }
  throw new RangeError(`applyGradeCore: illegal grade=${grade} core=${core} (grade 0-3, core 0-7 at grade 3 only)`);
}

/** 银行家舍入：.5 取最近偶数（同 C# Math.Round 默认的 MidpointRounding.ToEven） */
function roundHalfEven(x) {
  const r = Math.round(x);
  return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r;
}

/**
 * 单项装备属性：基础 + 企业加成 + 强化加成，后两段分别银行家舍入。
 * 用整数十分比计算（base × k / 10），避免 0.1 浮点误差把 .5 变成 .50000001。
 * @param {number} base       物品基础属性（整数）
 * @param {number} corpBonus  企业加成（0 或 0.3）
 * @param {number} level      强化等级 0–5（每级 +10%）
 * @returns {number}
 */
export function equipStatValue(base, corpBonus, level) {
  const corpTenths = Math.round(corpBonus * 10);
  return base
    + roundHalfEven(base * corpTenths / 10)
    + roundHalfEven(base * level / 10);
}

/**
 * 为某个 NIKKE 槽位计算完全叠加后的属性。
 * @param {SlotConfig} slot
 * @param {number} nikkeLevel     角色等级（1–1200+）
 * @param {GlobalResearch} research
 * @returns {FinalStats}
 */
export function computeFinalStats(slot, nikkeLevel, research) {
  let atk = 0, hp = 0, def = 0;
  const grade = slot.grade ?? 0;
  const core  = slot.core  ?? 0;

  // 1. 从每位 NIKKE 的等级表取基础属性，再应用 grade/core
  if (slot._nikkeData) {
    const base = getBaseStats(slot._nikkeData, nikkeLevel);
    atk = applyGradeCore(base.atk, grade, core, slot.classType);
    hp  = applyGradeCore(base.hp,  grade, core, slot.classType);
    def = applyGradeCore(base.def, grade, core, slot.classType);
  }

  // 2. 好感度等级 — 固定属性加成（不是百分比）
  const bond = getBondBonus(slot.classType, slot.bondLevel ?? 0);
  atk += bond.atk;
  hp  += bond.hp;
  def += bond.def;

  // 3. 装备加成（T10 / T9企业 / T9，每级 × 强化倍率）：
  //    ATK、HP、DEF 全部为固定值叠加：基础 + 企业加成(+30%) + 强化加成(+10%/级)，三段分别取整后相加。
  //    取整为银行家舍入（.5 取偶，同 C# Math.Round 默认），游戏内实测（T9 Attacker）：
  //      企业 lv5 头 HP 26442 + 7933 + 13221 = 47596，ATK 3233 + 970 + 1616(1616.5) = 5819
  //      企业 lv5 胸 HP 85937 + 25781 + 42968(42968.5) = 154686，ATK 588 + 176 + 294 = 1058
  //      普通 lv5 鞋 HP 19832 + 9916 = 29748，DEF 527 + 264(263.5) = 791
  //    T9企业装备只能由同企业 NIKKE 穿戴（账号数据 corporation_type 恒与穿戴者一致），故恒计企业加成。
  let equipAtkPct = 0;
  for (const [slotKey, modId] of Object.entries(SLOT_MAP)) {
    const cfg = slot.equipment?.[slotKey];
    if (!cfg) continue;
    const isCorp = cfg.tier === 'T9Corp';
    const dataTier = isCorp ? 'T9' : cfg.tier;
    if (dataTier !== 'T10' && dataTier !== 'T9') continue;
    const equip = getEquipmentByTier(dataTier, cfg.classReq, modId);
    if (!equip) continue;
    const corpBonus = isCorp ? CORP_EQUIP_STAT_BONUS : 0;
    const level     = cfg.level ?? 0;
    atk += equipStatValue(equip.atk, corpBonus, level);
    hp  += equipStatValue(equip.hp,  corpBonus, level);
    def += equipStatValue(equip.def, corpBonus, level);
  }

  // 4. 和谐魔方的固定加成 + 被动技能加成
  let cubeElementDmgPct  = 0;
  let cubeChargeSpeedPct = 0;
  let cubeReloadSpeedPct = 0;
  const cubeBuffPcts     = {};
  // 魔方永久 buff 按技能拆分，名称取魔方数据原文（如 'Quick Reload HC'），供战斗日志显示与翻译
  const cubeBuffs        = [];
  if (slot._cubeData && (slot.cube?.level ?? 0) > 0) {
    const cube      = normalizeCube(slot._cubeData);
    const cubeLevel = slot.cube.level;
    const statIdx   = Math.min(cubeLevel - 1, (cube.atk?.length ?? 0) - 1);
    if (statIdx >= 0) {
      atk += cube.atk[statIdx] ?? 0;
      hp  += cube.hp[statIdx]  ?? 0;
      def += cube.def[statIdx] ?? 0;
    }
    // 技能加成 — skill i（0-based）以 levels[i][cubeLevel-1] 作为 1-based 的技能等级。
    // description_value 的索引 = skillLv - 1（0-based）。skillLv=0 表示未解锁，跳过。
    for (let si = 0; si < cube.skills.length; si++) {
      const skill = cube.skills[si];
      const skillLv = cube.levels[si]?.[cubeLevel - 1] ?? 0;
      if (skillLv === 0) continue;
      const vals = skill.description_value_list?.[0]?.description_value ?? [];
      const val  = parseFloat(vals[skillLv - 1] ?? '0') / 100;
      const desc = (skill.description_localkey ?? '').replace(/<[^>]+>/g, '');
      const skillName = skill.name_localkey ?? 'Cube';
      if (desc.includes('Elemental Advantage'))          cubeElementDmgPct  += val;
      else if (desc.includes('Charge Speed'))            cubeChargeSpeedPct += val;
      else if (desc.includes('Reload Speed')) {
        cubeReloadSpeedPct += val;
        cubeBuffs.push({ name: skillName, reloadSpeedPct: val });
      } else {
        const hit = CUBE_BUFF_PATTERNS.find(([re]) => re.test(desc));
        if (hit) {
          cubeBuffPcts[hit[1]] = (cubeBuffPcts[hit[1]] ?? 0) + val;
          cubeBuffs.push({ name: skillName, [hit[1]]: val });
        }
      }
      // "Activates when firing … Reload ▲ round(s)" → Bastion 战斗机制，在引擎中处理
      // 其余（命中率、蓄力伤害、弹匣、爆裂充能、防御、减伤、治疗、掩体 HP、濒危 Max HP）不建模
    }
  }

  // 5. 珍藏品的固定属性加成（ATK/HP/DEF 数组，按物品等级 0–15 索引）。
  //    珍藏技能被动（Charge Damage、Normal Attack Damage、Max Ammo 等）
  //    会在 battle.js 的 initBattle 中作为战斗开局的永久 buff 应用，不在此处处理。
  if (slot._favItemData && (slot.favoriteItem?.level ?? 0) > 0) {
    const fav   = slot._favItemData;
    const level = slot.favoriteItem.level;
    atk += fav.atk?.[level] ?? 0;
    hp  += fav.hp?.[level]  ?? 0;
    def += fav.def?.[level] ?? 0;
  }

  // 6. 研究加成
  const res = computeResearchBonus(slot.classType, slot.corporation, research);
  atk += res.atk;
  hp  += res.hp;
  def += res.def;

  // 7. 装备词条效果（用户传入的四个槽位合计）
  const opts = slot.equipOptions ?? {};
  // atkFlat 词条不并入 atk，单独以 equipAtkFlat 返回；
  // 战斗引擎在 getBuffSums 的初始值中累入，使其仍参与伤害公式，
  // 但不影响技能"X% of caster's ATK"中的基础 ATK 参考值。
  const equipAtkFlat = opts.atkFlat ?? 0;
  const equipDefPct = opts.defFlat ?? 0;
  def += Math.round(def * equipDefPct);
  equipAtkPct += opts.atkPct ?? 0;

  return {
    atk:          Math.round(atk),   // 基础 ATK — 不含装备词条 atkFlat 及 "Increase ATK" 倍率
    hp:           Math.round(hp),
    def:          Math.round(def),
    // "Increase ATK" 词条：战斗引擎与技能 ATK% buff 加法组合（乘法项）。
    equipAtkPct,
    // 装备词条固定 ATK 加成：在 getBuffSums 初始值中累入 atkFlat（加法项），
    // 不计入 stats.atk，以保证技能"X% of caster's ATK"引用正确的基础 ATK。
    equipAtkFlat,
    critRate:       BASE_CRIT_RATE + (opts.critRatePct ?? 0),
    critDmg:        BASE_CRIT_DMG  + (opts.critDamagePct  ?? 0),
    // 优越代码攻击伤害：装备词条 + 魔方 Anti Code HC
    elementDmgPct:      (opts.elementDmgPct ?? 0) + cubeElementDmgPct,
    // 仅装备词条部分（UI 最终属性展示用，不含魔方加成）
    equipElementDmgPct: opts.elementDmgPct ?? 0,
    equipMaxAmmoPct: opts.equipMaxAmmoPct ?? 0,
    chargeDmgPct:   opts.chargeDmgPct   ?? 0,
    // 蓄力速度：装备词条 + 魔方（Adjutant）
    chargeSpeedPct: (opts.chargeSpeedPct ?? 0) + cubeChargeSpeedPct,
    // 换弹速度：仅来自魔方（Resilience Quick Reload HC）
    reloadSpeedPct: cubeReloadSpeedPct,
    // 魔方开战永久 buff（Max HP / 零件 / 穿透 / 真实 / 分摊伤害）的字段合计（不含换弹速度）
    cubeBuffPcts,
    // 同上，按魔方技能拆分并含换弹速度：[{ name: 技能原名, [buff 字段]: 值 }]，由 initBattle 推入 state.buffs
    cubeBuffs,
    hitRatePct:     opts.hitRatePct     ?? 0,
    equipDefPct,
  };
}
