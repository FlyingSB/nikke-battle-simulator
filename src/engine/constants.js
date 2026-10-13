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
 *
 * 帧率封顶：客户端每帧最多一次射击，60fps 下每秒最多 60 发（= 3600 RPM）。
 *   MG 顶速 4200 RPM 实际只打出 60 发/s（Rapi: Red Hood 实测，见 battle.js MAX_SHOTS_PER_TICK）。
 */

// ── 优越代码 ─────────────────────────────────────────────────────────────

/** 优越代码克制的基础加成（在 1.0 之上相加）。 */
export const ELEMENT_ADVANTAGE_BASE = 0.10;

// ── 距离优势 ────────────────────────────────────────────────────────────

/** 武器在其最佳射程区间射击时的加成。 */
export const DISTANCE_ADVANTAGE_BONUS = 0.30;

/**
 * 优势射程改由各角色 CDN 的 bonusrange_min/max 判定（敌人连续距离 ∈ [min,max]），
 * 见 damage.js:hasDistanceAdvantage。旧的按武器类型分档 DISTANCE_ZONES 已废弃。
 * 离散相位标签 → 连续距离的默认映射（可被敌人配置 UI 覆盖）：
 */
export const ZONE_TO_DISTANCE = { NEAR: 20, MID: 35, FAR: 55 };

// ── Full Burst ────────────────────────────────────────────────────────────

export const FULL_BURST_BONUS = 0.50;

// ── 基础暴击 / 核心加成 ──────────────────────────────────────────────────

export const BASE_CRIT_DAMAGE  = 0.50;  // 暴击时 +50%（在 critDmgIncrement 之前）
export const BASE_CORE_DAMAGE  = 1.00;  // 命中核心时 +100%（在 coreDmgIncrement 之前）

// ── 双枪 ──────────────────────────────────────────────────────────────────
// shot_detail.muzzle_count === 2 的角色：普通攻击（含切换武器）武器伤害系数 ×2
export const DUAL_GUN_MULT = 2;

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

// ── 命中率（HitRate）核心命中模型 ────────────────────────────────────────
/**
 * 数据实证默认值（dev/game-data.md，2026-07-07 训练场实测拟合）。均可被敌人配置 UI 覆盖。
 *   核心屏幕半径 r_core(d) = CORE0 · max(0, 1 − d/D0)
 *   有效散布     R_eff     = currentScale / (1 + HITRATE_CORE_COEF · HitRate)
 *   核心命中率   P_core    = clamp((r_core / R_eff)², 0, 1)
 * 武器散布 currentScale 取各角色 auto 散布 scale（SG 250 / SMG 110 / AR 75 / MG 250→10），不设常量。
 */
export const CORE0_DEFAULT             = 55;   // d=0 时核心屏幕半径（SMG/SG 交叉验证）
export const D0_DEFAULT                = 77;   // 核心缩为 0 的距离（线性透视外推）
export const HITRATE_CORE_COEF_DEFAULT = 4.5;  // HitRate 收圆系数（Drake 三档拟合）

/**
 * 实战命中校正系数（模拟选项可调）。引擎层默认 1 = 理想命中（与旧行为一致，回归测试依赖）；
 * 界面默认 0.7（src/ui/store.js HIT_CAL_DEFAULTS），每次模拟显式传入。
 *   SG_PELLET_HIT_RATE_DEFAULT：SG 每颗弹丸命中躯体的概率（散布大，远距离时部分弹丸打空）。
 * RL 核心命中不用校正系数，按敌人横向移动 + 弹道飞行时间建模（见下方 RL_FLIGHT_* / LATERAL_*）。
 */
export const SG_PELLET_HIT_RATE_DEFAULT = 1;
/**
 * 上述系数为敌人距离 HIT_RATE_REF_DISTANCE 时的命中率；敌人越近命中率越高，按距离线性缩放：
 *   P(d) = clamp(1 − (1 − 系数) · d / HIT_RATE_REF_DISTANCE, 0, 1)   （d = 0 时恒为 1）
 */
export const HIT_RATE_REF_DISTANCE = 50;
/**
 * SG 弹丸命中率的标定散布：sgHitRate 视为散布 scale = 250、HitRate = 0 时的命中率。
 * 实际打空率按有效散布 R_eff = currentScale / (1 + HITRATE_CORE_COEF · HitRate) 与标定散布之比缩放
 * （散布收束 / 命中率 ▲ → 弹丸更集中 → 打空更少），与核心命中模型共用同一收圆式。
 */
export const SG_PELLET_REF_SCALE = 250;

/**
 * 敌人进入 HIDDEN 后仍可被命中的时长（秒）。BIGARMS 隐藏动画约 2s，前 0.9s 仍可被命中（dev/game-data.md）。
 * 自动战斗的角色在 HIDDEN 起点即停火装弹；不受操作控制的自动攻击技能（如 Anis: Star 的 Shooting Stars）
 * 在此窗口内继续命中，之后才因无目标而跳过。
 */
export const HIDDEN_HITTABLE_SECS = 0.9;

/**
 * RL 核心命中模型（实测：2026-10-13，Anis: Star 单人 vs 射击场 BIGARMS，逐发记录核心命中与敌人横向移动）。
 * 命中本身不建模飞行时间（即时结算），飞行时间只用于核心判定：
 *   · 敌人静止 → 必中核心（约 90 发静止命中仅 1 发偏离）；
 *   · 敌人横向移动（以「出手 + 飞行时间」时刻判定）→ 打偏率 = clamp(斜率 × (飞行帧 − 阈值), 0, 1)：
 *       距离 20（飞行约 8 帧）0/30，距离 30/40（约 15/21 帧）6/25，距离 50（约 27 帧）14/31。
 * 飞行帧 = max(0, RL_FLIGHT_TICKS_PER_DISTANCE × 距离 + RL_FLIGHT_TICKS_OFFSET) × RL_REF_PROJECTILE_SPEED / 弹速
 *   （实测出手 → 命中帧：距离 20 → 7 / 9，30 → 18，40 → 19，50 → 27，线性拟合）。
 * 弹速取 CDN shot_detail.spot_projectile_speed（绝大多数 RL 为 100；Laplace / A2 300，
 * Scarlet: Black Shadow / Raven 400，Cinderella 1500 → 飞行极短，几乎不会打偏）。
 */
export const RL_REF_PROJECTILE_SPEED      = 100;
export const RL_FLIGHT_TICKS_PER_DISTANCE = 0.603;
export const RL_FLIGHT_TICKS_OFFSET       = -3.3;
/** 横向移动速度档 → 每飞行帧的打偏率斜率（目前仅「慢」，实测拟合）。 */
export const LATERAL_MISS_SLOPE = { SLOW: 0.028 };
/** 飞行帧低于该值时横向移动不致打偏。 */
export const LATERAL_MISS_FLIGHT_THRESHOLD = 10.8;
/**
 * Anis: Star 的 Shooting Stars 在敌人横向移动时的核心命中率基准（另一场整局实测：移动中约 30% 未中核心，
 * 与距离无稳定关系，疑与攻击角度有关）。界面「流星核心命中率修正系数」与之相乘；敌人静止时必中核心。
 */
export const STAR_MOVING_CORE_RATE = 0.7;
