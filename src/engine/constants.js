/**
 * 游戏常量 — 通过游戏内测试校准得出。
 */

// ── 爆裂槽 ──────────────────────────────────────────────────────────────

/** 填满爆裂槽所需的总能量（校准依据：Rapi RH 1000 次命中 × 每发 1000 能量）。 */
export const BURST_GAUGE_MAX = 1_000_000;

/**
 * 每发射击提供的爆裂能量来源（游戏内测试 + 社区 BBS 已确认）：
 *   target_burst_energy_pershot  — 命中主要敌方目标的充能。
 *                                  ⚠ SG 武器：该值为【每发弹丸】命中的充能，一次射击 N 发
 *                                  弹丸全部命中 → 本次射击充能 = N × target_burst_energy_pershot
 *                                  （如 Brid: Silent Track 4000 × 10 弹丸 = 40000）。详见 battle-logic §6.1。
 *   burst_energy_pershot         — 命中掩体 / 护盾 / 非主目标部位
 *   对空射击                      — 0 能量
 *   full_charge_damage           — SR/RL 全蓄力倍率：满蓄射击充能 = target_burst_energy_pershot ×
 *                                  (full_charge_damage / 10000)，与蓄力伤害一致（乘法，非加法）。
 *                                  注：CDN 另有 full_charge_burst_energy 字段，引擎不使用它。
 * 所有值均来自 CDN 数据中每个角色的 shot_detail。
 */

// ── 射速 ─────────────────────────────────────────────────────────────────

/**
 * rate_of_fire 单位：每分钟发射次数（RPM）。
 * 两发之间的间隔（ms）= 60_000 / rate_of_fire
 *
 * MG 起速：
 *   每发之后 current_rate += rate_of_fire_change_pershot
 *   上限为 end_rate_of_fire
 *   停火时以 rate_of_fire_reset_time 的速率回落到 rate_of_fire
 *
 * 例如 Rapi Red Hood：60 → 4200 RPM，每发 +100 → 42 发 ≈ 3.17 秒达到上限
 */

// ── 优越代码 ─────────────────────────────────────────────────────────────

/** 优越代码克制的基础加成（在 1.0 之上相加）。 */
export const ELEMENT_ADVANTAGE_BASE = 0.10;

// ── 距离优势 ────────────────────────────────────────────────────────────

/** 武器在其最佳射程区间射击时的加成。 */
export const DISTANCE_ADVANTAGE_BONUS = 0.30;

/** @type {Record<string, string[]>} */
export const DISTANCE_ZONES = {
  NEAR: ['SG', 'SMG'],
  MID:  ['AR', 'MG'],
  FAR:  ['SR'],
};

// ── Full Burst ────────────────────────────────────────────────────────────

export const FULL_BURST_BONUS = 0.50;

// ── 基础暴击 / 核心加成 ──────────────────────────────────────────────────

export const BASE_CRIT_DAMAGE  = 0.50;  // 暴击时 +50%（在 critDmgIncrement 之前）
export const BASE_CORE_DAMAGE  = 1.00;  // 命中核心时 +100%（在 coreDmgIncrement 之前）

// ── 蓄力伤害基准 ────────────────────────────────────────────────────────

/**
 * full_charge_damage = 10000 对应 ×1.0（非蓄力武器无加成）。
 * SR/RL 数值更高，如 Alice = 35000 → ×3.5
 * ChargeDamageMultiplier = (full_charge_damage / CHARGE_DAMAGE_BASE) × chargeDmgStat
 */
export const CHARGE_DAMAGE_BASE = 10_000;

/**
 * 时间类字段单位 = 厘秒（1/100 秒）。适用于：
 *   charge_time  — Alice 150 → 1.50 秒（游戏内已确认）
 *   reload_time  — Alice 200 → 2.00 秒，Rapi RH 250 → 2.50 秒（游戏内已确认）
 * 除以 TIMING_DIVISOR 即得到以秒为单位的实际值。
 */
export const TIMING_DIVISOR = 100;

// ── 武器默认值 ───────────────────────────────────────────────────────────

/**
 * 各武器类型的默认弹匣容量。
 * 当角色 CDN shot_detail 未加载时使用。
 */
export const WEAPON_AMMO = {
  AR:  30,
  SMG: 45,
  SR:   5,
  MG:  300,  // 已确认：Crown / Rapi Red Hood shot_detail.max_ammo = 300
  SG:   5,
  RL:   3,
};

/**
 * 各武器类型的基础命中倍率（每发 / 每次霰弹系列射击对 ATK 的比例）。
 * 应用方式：baseDamage = effectiveAtk × hitMultiplier
 * 这些近似值经过校准，使 200 同步器等级的队伍在 3 分钟内可打出约 5-15M 伤害。
 * 加载角色 CDN 数据时用 shot_detail 的实际值覆盖。
 */
export const WEAPON_HIT_MULT = {
  AR:      0.029,  // 每发约 2.9%
  SMG:     0.011,  // 每发约 1.1%
  SR:      0.075,  // 每次蓄力射击约 7.5%（蓄力倍率单独计算）
  MG:      0.009,  // 每发约 0.9%
  SG:      0.036,  // 每次射击约 3.6%（所有弹丸合计伤害）
  RL:      0.120,  // 每发约 12%
  Charged: 0.075,  // 蓄力特殊武器（切换型，既非 SR 也非 RL，但可蓄力；默认同 SR）
};

/**
 * SR/RL 进行全蓄力射击并命中主要目标时，充能按蓄力伤害倍率放大（乘法，非加法）：
 *   full_charge 充能 = target_burst_energy_pershot × (full_charge_damage / 10000)
 * 例如 Alice：56000 × (35000 / 10000) = 每次蓄力命中 196000。
 * （游戏实测确认为乘法；CDN 的 full_charge_burst_energy 字段引擎不使用。）
 */
