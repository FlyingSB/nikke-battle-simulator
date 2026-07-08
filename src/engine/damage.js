/**
 * NIKKE 伤害公式（已由用户验证）。
 *
 * FinalDamage =
 *   BaseDamage
 *   × CommonMultiplier
 *   × ElementMultiplier        （仅在优越代码克制时）
 *   × ChargeDamageMultiplier   （仅 SR / RL / 特殊武器）
 *   × ExtraMultiplier
 *   × DamageTakenLikeMultiplier
 *
 * BaseDamage =
 *   (ATK × ATK_Multiplier + OtherATKIncrement − EnemyDEF × DEF_Multiplier)
 *   × (WeaponMultiplier | SkillMultiplier | ProjectileAttachmentDmg | ProjectileExplosionDmg)
 *
 * CommonMultiplier = 1
 *   + (0.50 + critDmgIncrement)   暴击命中
 *   + (1.00 + coreDmgIncrement)   核心命中
 *   + 0.30                        距离优势（NEAR：SG/SMG；MID：AR/MG；FAR：SR）
 *   + 0.50                        Full Burst 生效中
 *
 * ElementMultiplier = 0.10 + elementAdvantageDmgIncrement   （仅当攻击方拥有优越代码克制时）
 *   燃烧 > 风压 > 铁甲 > 电击 > 水冷 > 燃烧（5 代码循环）
 *
 * ChargeDamageMultiplier = (full_charge_damage / 10000) × (1 + favChargeDmgPct) + Σ chargeDmgBonuses
 *   full_charge_damage 来自 shot_detail（10000 = 基线 ×1.0；SR/RL 数值更高）
 *   favChargeDmgPct：珍藏品 "Charge Damage Multiplier ▲" — 只对 shot_detail.damage 相乘
 *   chargeDmgBonuses：技能 / 魔方 / 装备的蓄力加成 — 彼此相加
 *   仅在 SR / RL / 特殊蓄力武器的 isCharged=true 时应用
 *
 * ExtraMultiplier = 1 + Σ 生效的加成（见 ExtraFlags）
 *
 * DamageTakenLikeMultiplier = 1 + damageTakenMult + distributedDamageMult
 *
 * True Damage：将 Enemy DEF 视为 0。
 *
 * ── 爆裂能量（通过测试校准） ─────────────────────────────────────────────
 * 爆裂槽总量                    = 1,000,000
 * target_burst_energy_pershot  = 每次命中敌人获得的能量（SG 为每发弹丸，见 battle-logic §6.1）
 * burst_energy_pershot         = 每次命中掩体 / 非主目标获得的能量
 * 对空射击                      = 0 能量
 * SR/RL 全蓄力                  = 充能 × (full_charge_damage / 10000)，乘法（非加法）；
 *                                CDN 的 full_charge_burst_energy 字段引擎不使用
 *
 * ── 射速（通过测试校准） ───────────────────────────────────────────────
 * rate_of_fire 单位 = 每分钟发射数（RPM）
 * MG 起速：起始为 rate_of_fire RPM，每发增加 rate_of_fire_change_pershot，
 *         上限为 end_rate_of_fire RPM
 * 例如 Rapi Red Hood：60→4200 RPM 需 42 发 ≈ 3.17 秒
 */

import {
  ELEMENT_ADVANTAGE_BASE,
  DISTANCE_ADVANTAGE_BONUS,
  FULL_BURST_BONUS,
  BASE_CRIT_DAMAGE,
  BASE_CORE_DAMAGE,
  CHARGE_DAMAGE_BASE,
} from './constants.js';
import { rng } from './rng.js';

// ─── 代码克制表 ────────────────────────────────────────────────────────────

/** key 克制 value。循环：Fire > Wind > Iron > Electric > Water > Fire */
const ELEMENT_CHART = {
  Fire:     'Wind',
  Wind:     'Iron',
  Iron:     'Electric',
  Electric: 'Water',
  Water:    'Fire',
};


// ─── 类型定义 ────────────────────────────────────────────────────────────────

/**
 * @typedef {'NEAR'|'MID'|'FAR'|null} DistanceZone
 *
 * @typedef {Object} ExtraFlags
 * @property {number} [attackDamageMult]
 * @property {number} [projectileAttachmentDamageMult]
 * @property {number} [projectileExplosionDamageMult]
 * @property {number} [pierceDamageMult]           仅穿透命中适用
 * @property {number} [damageToPartsMult]          仅命中敌人部件适用
 * @property {number} [sequentialAttackDamageMult] 仅连续攻击适用
 * @property {number} [affectsAllEnemiesDamageMult]
 * @property {number} [affects1EnemyDamageMult]
 * @property {number} [sustainedDamagePct]         仅持续（DoT）伤害适用
 * @property {number} [trueDamageMult]             仅真实伤害适用
 * @property {number} [damageDealtToShieldMult]    仅对护盾适用
 * @property {number} [damageToProjectilesMult]    仅对子弹适用
 *
 * @typedef {Object} DamageInput
 * @property {number}        atk                   施放者的最终基础 ATK
 * @property {number}        [atkMultiplier=1]      来自 buff 的 ATK% 倍率
 * @property {number}        [otherAtkIncrement=0]  在 atkMultiplier 之后叠加的固定 ATK。
 *                                                  调用前需先行计算，例如：
 *                                                  技能 "ATK +35% of caster's ATK"
 *                                                  → otherAtkIncrement = buffCaster.atk × 0.35
 *                                                  （使用施放者的 ATK，不是伤害制造者的）
 * @property {number}        enemyDef              敌人的基础 DEF
 * @property {number}        [defMultiplier=1]      DEF% 倍率（debuff 会减少此值）
 * @property {number}        hitMultiplier         武器命中% 或 技能% 或 子弹伤害值
 * @property {string}        weaponType            AR | SMG | SR | MG | SG | RL
 * @property {boolean}       [isCrit=false]
 * @property {number}        [critDmgIncrement=0]  在基础 50% 暴击伤害之上的附加值
 * @property {'body'|'core'|'parts'|'intercept_parts'} [hitPart='body']
 * @property {number}        [coreDmgIncrement=0]  在基础 100% 核心伤害之上的附加值
 * @property {boolean}       [distanceAdvantage=false] 是否处于优势射程（敌人距离 ∈ [bonusrange_min,max]）
 * @property {boolean}       [isFullBurst=false]
 * @property {string}        [attackerElement]
 * @property {string}        [defenderElement]
 * @property {number}        [elementAdvantageDmgIncrement=0]
 * @property {boolean}       [isCharged=false]       SR / RL / 特殊蓄力射击
 * @property {number}        [fullChargeDamage=10000] shot_detail.full_charge_damage（10000=×1.0）
 * @property {number}        [favChargeDmgPct=0]     珍藏品 "Charge Damage Multiplier ▲" — 仅对
 *   shot_detail.damage 相乘：chargeMult = (fullCharge/10000)×(1+fav) + otherBonuses
 * @property {number}        [chargeDmgStat=1]       装备 / 技能 / 魔方带来的蓄力伤害加成（不含珍藏品）。
 *   以 (1 + stats.chargeDmgPct + sums.chargeDamagePct) 形式传入。
 * @property {number}        [favNormalAttackDamageMult=1]  珍藏品 "Normal Attack Damage Multiplier ▲"
 *   适用于 SMG/SG — 独立倍率，直接乘在 baseDamage 上（与 ExtraMultiplier 不是加法关系）。
 * @property {ExtraFlags}    [extra]
 * @property {number}        [damageTakenMult=0]   来自敌方 debuff
 * @property {number}        [distributedDamageMult=0]
 * @property {boolean}       [isTrueDamage=false]  完全忽略 DEF
 */

// ─── 主计算函数 ──────────────────────────────────────────────────────────

/**
 * 计算一次命中的伤害。
 * @param {DamageInput} input
 * @returns {{ damage: number, breakdown: Object }}
 */
export function calcDamage(input) {
  const {
    atk,
    atkMultiplier       = 1,
    otherAtkIncrement   = 0,
    enemyDef,
    defMultiplier       = 1,
    hitMultiplier,
    weaponType          = 'AR',
    isCrit              = false,
    critDmgIncrement    = 0,
    hitPart             = 'body',
    coreDmgIncrement    = 0,
    distanceAdvantage   = false,
    isFullBurst         = false,
    attackerElement,
    defenderElement,
    elementAdvantageDmgIncrement = 0,
    isCharged           = false,
    fullChargeDamage    = 10000,
    favChargeDmgPct     = 0,
    chargeDmgStat       = 1,
    favNormalAttackDamageMult = 1,
    extra               = {},
    damageTakenMult     = 0,
    distributedDamageMult = 0,
    isTrueDamage        = false,
  } = input;

  // ── BaseDamage ──
  const effectiveDef = isTrueDamage ? 0 : enemyDef * defMultiplier;
  const effectiveAtk = atk * atkMultiplier + otherAtkIncrement - effectiveDef;
  const baseDamage   = Math.max(0, effectiveAtk) * hitMultiplier * favNormalAttackDamageMult;

  // ── CommonMultiplier ──
  let commonMult = 1;
  if (isCrit)              commonMult += BASE_CRIT_DAMAGE + critDmgIncrement;
  if (hitPart === 'core') commonMult += BASE_CORE_DAMAGE + coreDmgIncrement;
  if (distanceAdvantage) commonMult += DISTANCE_ADVANTAGE_BONUS;
  if (isFullBurst)    commonMult += FULL_BURST_BONUS;

  // ── ElementMultiplier ──
  const hasElemAdv = attackerElement && ELEMENT_CHART[attackerElement] === defenderElement;
  const elemMult   = hasElemAdv ? (1 + ELEMENT_ADVANTAGE_BASE + elementAdvantageDmgIncrement) : 1.0;

  // ── ChargeDamageMultiplier ──
  const canCharge    = ['SR', 'RL', 'Charged'].includes(weaponType);
  // favChargeDmgPct 只与 shot_detail.damage 相乘；其他蓄力加成均为加法。
  // chargeDmgStat 传入形式为 (1 + 装备/技能/魔方加成)，因此 (chargeDmgStat - 1) 即为纯加成部分。
  const chargeMult   = (canCharge && isCharged)
    ? (fullChargeDamage / CHARGE_DAMAGE_BASE) * (1 + favChargeDmgPct) + (chargeDmgStat - 1)
    : 1.0;

  // ── ExtraMultiplier ──
  const extraMult = 1 + sumExtra(extra, input);

  // ── DamageTakenLikeMultiplier ──
  const damageTakenMult_ = 1 + damageTakenMult + distributedDamageMult;

  // ── Final ──
  const raw = baseDamage * commonMult * elemMult * chargeMult * extraMult * damageTakenMult_;
  const damage = isNaN(raw) ? 0 : Math.floor(raw);

  return {
    damage,
    breakdown: { baseDamage, commonMult, elemMult, chargeMult, extraMult, damageTakenMult_ },
  };
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

/**
 * 是否处于优势射程：敌人连续距离落在角色的 [bonusRangeMin, bonusRangeMax] 区间内。
 * bonusrange 为 (0,0) 的武器（RL）永不触发；distance=null（不可瞄准）时无优势。
 * @param {number|null} distance      敌人连续距离（0..100）
 * @param {number} bonusRangeMin
 * @param {number} bonusRangeMax
 * @returns {boolean}
 */
export function hasDistanceAdvantage(distance, bonusRangeMin, bonusRangeMax) {
  if (distance == null || !(bonusRangeMax > 0)) return false;
  return distance >= bonusRangeMin && distance <= bonusRangeMax;
}

/** @param {string} attackerElem @param {string} defenderElem */
export function getElementAdvantage(attackerElem, defenderElem) {
  return ELEMENT_CHART[attackerElem] === defenderElem ? 'advantage' : 'neutral';
}

/** 汇总所有适用的 ExtraMultiplier 加成。 */
function sumExtra(extra, input) {
  let sum = extra.attackDamageMult ?? 0;

  // 子弹类型（每次命中通常只适用其中一种）
  sum += extra.projectileAttachmentDamageMult ?? 0;
  sum += extra.projectileExplosionDamageMult  ?? 0;

  sum += extra.pierceDamageMult              ?? 0;
  if (input.hitPart === 'parts') sum += extra.damageToPartsMult ?? 0;
  sum += extra.sequentialAttackDamageMult    ?? 0;
  sum += extra.affectsAllEnemiesDamageMult   ?? 0;
  sum += extra.affects1EnemyDamageMult       ?? 0;
  sum += extra.sustainedDamagePct            ?? 0;
  sum += extra.trueDamageMult                ?? 0;
  sum += extra.damageDealtToShieldMult       ?? 0;
  sum += extra.damageToProjectilesMult       ?? 0;

  return sum;
}

/**
 * 掷一次暴击结果。
 * @param {number} critRate 0.0 – 1.0
 * @returns {boolean}
 */
export function rollCrit(critRate) {
  return rng() < critRate;
}

/**
 * 将暴击视为概率事件，计算期望（平均）伤害。
 * @param {DamageInput} input  — isCrit 被忽略；改用 critRate
 * @param {number} critRate    0.0 – 1.0
 * @returns {number} 每次命中的期望伤害
 */
export function calcExpectedDamage(input, critRate) {
  const { damage: noCrit  } = calcDamage({ ...input, isCrit: false });
  const { damage: yesCrit } = calcDamage({ ...input, isCrit: true  });
  return Math.floor(noCrit * (1 - critRate) + yesCrit * critRate);
}
