/**
 * 命中率（HitRate）机制 —— 核心命中率的几何概率模型。
 *
 * 详见 docs/battle-logic 与 dev/game-data.md（2026-07-07 训练场实测拟合）。
 *
 * 模型（每发 / SG 每弹丸）：
 *   r_core(d) = CORE0 · max(0, 1 − d/D0)        核心屏幕半径随距离线性缩小
 *   R_eff     = currentScale / (1 + c · HitRate) HitRate 收缩散布圆（实测 c≈4.5）
 *   P_core    = clamp( (r_core / R_eff)², 0, 1 ) 散布圆内均匀落点命中核心圆的面积比
 *
 * 躯体恒命中（实战 BOSS 体型庞大），命中率仅影响核心命中率。
 * SR/RL/Charged 为精准武器，恒核心命中（alwaysCore）；散布数据缺失的角色亦保守视为恒核心。
 * currentScale 由 MG 暖机 ramp 推进（AR/SMG/SG 的 changePerShot=0，恒定）。
 */

/** 精准武器（无散布，恒核心命中）。 */
const PRECISE_WEAPONS = new Set(['SR', 'RL', 'Charged']);

/**
 * @typedef {Object} AccuracyProfile
 * @property {boolean} alwaysCore   精准武器或散布数据缺失 → 恒核心命中
 * @property {number}  startScale   起始散布 scale（停火静止值）
 * @property {number}  endScale     收束极限 scale（持续射击，仅 MG 与 start 不同）
 * @property {number}  changePerShot 每发收束量（scale/发；AR/SMG/SG=0）
 * @property {number}  changeSpeed  停火恢复速率（scale/秒）
 */

/**
 * 从已解析的角色 detail 构造散布档。
 * @param {object|null} detail  parseNikkeDetail 结果（含 startAccuracyScale 等）
 * @param {string} weaponType
 * @returns {AccuracyProfile}
 */
export function parseAccuracyProfile(detail, weaponType) {
  const startScale = detail?.startAccuracyScale ?? null;
  const endScale   = detail?.endAccuracyScale   ?? startScale;
  return {
    // 精准武器，或散布 scale 缺失 → 恒核心（保守：不把无数据角色误算成 0 核心）
    alwaysCore:    PRECISE_WEAPONS.has(weaponType) || startScale == null,
    startScale:    startScale ?? 0,
    endScale:      endScale   ?? 0,
    changePerShot: detail?.accuracyChangePerShot ?? 0,
    changeSpeed:   detail?.accuracyChangeSpeed   ?? 0,
  };
}

/**
 * 在 unit 上初始化散布 ramp 运行态。
 * @param {object} unit
 * @param {AccuracyProfile} profile
 * @param {number} tickRate  每秒 tick 数（用于把 changeSpeed 换算成每 tick）
 */
export function initAccuracyState(unit, profile, tickRate) {
  unit.accAlwaysCore     = profile.alwaysCore;
  unit.accStartScale     = profile.startScale;
  unit.accEndScale       = profile.endScale;
  unit.accChangePerShot  = profile.changePerShot;
  unit.accRecoverPerTick = profile.changeSpeed / tickRate;
  unit.accCurrentScale   = profile.startScale;
}

/** 把 v 夹到 [min(a,b), max(a,b)]。 */
function clampBetween(v, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 射击一发后推进散布收束（MG 暖机：currentScale 朝 endScale 移动 changePerShot）。
 * AR/SMG/SG 的 changePerShot=0，无变化。
 * @param {object} unit
 */
export function rampAccuracyOnShot(unit) {
  if (!unit.accChangePerShot) return;
  const dir = Math.sign(unit.accEndScale - unit.accStartScale); // MG: 250→10 为 -1
  unit.accCurrentScale = clampBetween(
    unit.accCurrentScale + dir * unit.accChangePerShot,
    unit.accStartScale, unit.accEndScale,
  );
}

/**
 * 停火恢复：currentScale 朝 startScale 回移 changeSpeed。
 * @param {object} unit
 * @param {number} ticks
 */
export function recoverAccuracy(unit, ticks) {
  if (!unit.accChangePerShot || !unit.accRecoverPerTick) return;
  const dir = Math.sign(unit.accStartScale - unit.accEndScale); // MG: 回到 250 为 +1
  unit.accCurrentScale = clampBetween(
    unit.accCurrentScale + dir * unit.accRecoverPerTick * ticks,
    unit.accStartScale, unit.accEndScale,
  );
}

/**
 * 计算单发 / 单弹丸的核心命中概率。
 * @param {Object} p
 * @param {boolean} p.alwaysCore   精准武器 → 恒 1
 * @param {number} p.currentScale  当前散布 scale（含 MG ramp）
 * @param {number} p.hitRatePct    命中率属性（0..1）
 * @param {number} p.distance      敌人连续距离（0..100，与 bonusrange 同刻度）
 * @param {number} p.CORE0         d=0 时核心屏幕半径（校准，默认 55）
 * @param {number} p.D0            核心缩为 0 的距离（校准，默认 77）
 * @param {number} p.coef          HitRate 收圆系数（校准，默认 4.5）
 * @returns {number} P_core ∈ [0,1]
 */
export function coreHitChance({ alwaysCore, currentScale, hitRatePct, distance, CORE0, D0, coef }) {
  if (alwaysCore) return 1;
  if (!(currentScale > 0)) return 1;           // 无散布数据 → 视为必中核心
  const rCore = CORE0 * Math.max(0, 1 - distance / D0);
  if (rCore <= 0) return 0;                     // 距离 ≥ D0：核心不可命中
  const rEff  = currentScale / (1 + coef * (hitRatePct ?? 0));
  const ratio = rCore / rEff;
  return Math.min(1, ratio * ratio);
}
