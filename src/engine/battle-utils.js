/**
 * 战斗引擎共享工具。
 * 被 battle.js 和 skill-executor.js 同时引用，避免循环依赖。
 */

import { calcDamage, rollCrit, hasDistanceAdvantage } from './damage.js';
import { rng } from './rng.js';
import { HIT_RATE_REF_DISTANCE, HIDDEN_HITTABLE_SECS, SG_PELLET_REF_SCALE,
         RL_REF_PROJECTILE_SPEED, RL_FLIGHT_TICKS_PER_DISTANCE, RL_FLIGHT_TICKS_OFFSET,
         LATERAL_MISS_SLOPE, LATERAL_MISS_FLIGHT_THRESHOLD } from './constants.js';

export const TICK_RATE       = 60;         // 每秒 tick 数

/**
 * 判定某单位当前是否处于优势射程。优势 ⟺ 敌人连续距离 ∈ [有效min, bonusRangeMax]。
 * 有效 min 取 bonusRangeMin 与技能扩展的 skillState.effRangeMin 中的较小者（如 Ade 的 Minimum Effective Range）。
 * @param {object} unit  含 bonusRangeMin/Max、可选 skillState.effRangeMin
 * @param {number|null} distance  敌人连续距离
 * @returns {boolean}
 */
export function unitDistanceAdvantage(unit, distance) {
  const advMin = Math.min(
    unit.bonusRangeMin ?? Infinity,
    unit.skillState?.effRangeMin ?? Infinity,
  );
  return hasDistanceAdvantage(distance, advMin, unit.bonusRangeMax ?? 0);
}

// unit.maxAmmo 的内部存储 key（模块私有）。
// 仅 recalcMaxAmmo 可写；外部通过 getter 只读，严格模式下赋值抛出 TypeError。
const _maxAmmo = Symbol('maxAmmo');
export const BURST_GAUGE_MAX = 1_000_000;  // 共享爆裂槽上限
export const ENEMY_UNIT_ID   = '__enemy__';    // 敌人 debuff 专用 unitId（区别于 unitId:null 全体队友 buff）
export const ALL_ALLIES      = '__all_allies__'; // 全体队友目标哨兵（applyHeal/applyShield/pushHoT 支持）

// ─── Buff 数值字段注册表（单一来源）────────────────────────────────────────────
// 新增 buff 字段：只需在此处添加一行，getBuffSums 和 buffLog 会自动包含它。
export const BUFF_NUMERIC_FIELDS = [
  'atkPct', 'atkFlat', 'defPct', 'defFlat',
  'attackDamagePct', 'normalAttackDamagePct',
  // 技能 "Normal Attack Damage Multiplier ▲"：与珍藏品普攻倍率同一乘区（相加后乘在 BaseDamage 上）
  'normalAttackDamageMultPct',
  'critRatePct', 'normalAttackCritRatePct', 'critDamagePct',
  'chargeDamagePct', 'chargeDamageMultPct', 'chargeSpeedPct', 'reloadSpeedPct',
  'lifeStealPct', 'distributedDamagePct',
  'chargeTimeReductionTicks', 'hitRatePct', 'elementAdvantagePct',
  'projectileAttachmentDamagePct', 'projectileExplosionDamagePct', 'coreDamagePct',
  'maxHpPct', 'maxHpFlat', 'burstGaugeFlat',
  'pierceDamagePct', 'sustainedDamagePct',
  'maxAmmoPct', 'maxAmmoFlat',
  'trueDamagePct', 'atkSpeedPct', 'sequentialAttackDamagePct',
  'damageToPartsPct',
  'mgHeatSpeedPct',
  'pelletFlat',
  // 治疗效能（Outgoing Healing ▲，挂在治疗者身上）/ 受治疗量（Incoming Healing ▲，挂在受治疗者身上，作用于一切受到的治疗）
  'healPotencyPct', 'incomingHealPct',
  // 「目标说明以『全体敌人』结尾的爆裂技能伤害 ▲」（Trina 爆裂 Spread Roots / Wilted Roots）：
  // 仅作用于施放者爆裂技能中「Affects all enemies」段的伤害命中（判定见 isAllEnemiesBurstHit）
  'allEnemiesBurstDamagePct',
];

// ─── 最大装弹数管理 ─────────────────────────────────────────────────────────

/**
 * 在单位对象上安装 maxAmmo 只读 getter，并设置初始值与 ammoLeft。
 * 必须在 battle.js initBattle 的 map 回调末尾调用一次，之后由 recalcMaxAmmo 维护。
 */
export function initUnitMaxAmmo(unit, initialValue) {
  unit[_maxAmmo] = initialValue;
  unit.ammoLeft  = initialValue;
  Object.defineProperty(unit, 'maxAmmo', {
    get() { return this[_maxAmmo]; },
    enumerable:   true,
    configurable: false,   // 禁止重新定义，防止意外覆盖
  });
}

/**
 * 根据当前所有效果重新计算 unit.maxAmmo，并在必要时截断 unit.ammoLeft。
 * 触发时机：pushBuff（含 maxAmmoPct/maxAmmoFlat）、buff 过期、tempMaxAmmoMult 写入/到期。
 *
 * 公式（§5.1.1）：
 *   rawMax = max(1,
 *     baseAmmo
 *     + round(baseAmmo × sums.maxAmmoPct)   ← 含 OL、珍藏品pct、技能 buff 百分比（均作为永久/临时 buff）
 *     + sums.maxAmmoFlat                     ← 含珍藏品 flat、技能 buff 固定值
 *   )
 */
export function recalcMaxAmmo(state, unit) {
  const sums   = getBuffSums(state, unit.id);
  const rawMax = Math.max(1,
    unit.baseAmmo
    + Math.round(unit.baseAmmo * (sums.maxAmmoPct ?? 0))
    + (sums.maxAmmoFlat ?? 0),
  );
  unit[_maxAmmo] = rawMax;
  // 固定弹匣的切换武器（如 Red Hood: Red Wolf）不受装弹数效果影响：只更新原武器上限，不截断当前弹药
  if (isWeaponSwitchAmmoFixed(state, unit)) return;
  if (unit.ammoLeft > rawMax) unit.ammoLeft = rawMax;
}

/**
 * 「Reload n% of the magazine」补弹：补充 round(当前弹匣上限 × pct) 发，封顶上限；补满时取消进行中的换弹。
 * 取整与时机（实测 2026-10-12）：
 *   · 四舍五入：Little Mermaid 爆裂 33.26% 为弹匣 913 的 Rapi: Red Hood 补 304 发（303.66，floor 为 303）。
 *   · 同一技能先扩容再补弹时，按扩容后的上限计算：Tove S1 5.31% 第 30 发 64→66 上限补 4 发
 *     （round(66 × 5.31%) = round(3.50)；按扩容前 64 为 3）。调用方须先推入扩容 buff 再调用本函数。
 * 固定弹匣的切换武器（isWeaponSwitchAmmoFixed）不接受补弹。
 * @param {object} state
 * @param {object} unit
 * @param {number} pct     补弹比例（0..1，100% 即补满）
 * @param {string} source  弹药日志来源标签
 * @returns {number} 实际补充发数
 */
export function reloadMagazinePct(state, unit, pct, source) {
  if (isWeaponSwitchAmmoFixed(state, unit)) return 0;
  const ammoBefore = unit.ammoLeft;
  unit.ammoLeft = Math.min(unit.maxAmmo, Math.max(0, unit.ammoLeft) + Math.round(unit.maxAmmo * pct));
  if (unit.ammoLeft >= unit.maxAmmo && unit.reloadTick > 0) unit.reloadTick = 0;
  const delta = unit.ammoLeft - ammoBefore;
  if (state.ammoLog && delta !== 0)
    state.ammoLog.push({ tick: state.tick, unitId: unit.id, unitName: unit.name,
      delta, ammoAfter: unit.ammoLeft, maxAmmo: unit.maxAmmo, source });
  return delta;
}

/**
 * 当前是否处于「固定弹匣」的武器切换期间（skillState.weaponSwitchFixedAmmo = true）。
 * 此期间 ammoLeft 属于切换武器（上限 = weaponSwitchMaxAmmo），
 * 任何装弹数增减 / 补弹效果（maxAmmo buff、RELOAD_AMMO、AMMO_EXPAND、Bastion 方块）均不作用于它。
 */
export function isWeaponSwitchAmmoFixed(state, unit) {
  const st = unit.skillState;
  return !!st?.weaponSwitchFixedAmmo
    && (st.weaponSwitchEndTick ?? 0) > 0
    && state.tick <= st.weaponSwitchEndTick;
}

// ─── Buff 汇总 ──────────────────────────────────────────────────────────────

/**
 * buff 当前是否作用于 unit：目标（unitId 或全队 null）、回合未耗尽、未到期、武器过滤（weaponFilter）。
 * getBuffSums 与所有逐字段汇总 / 明细快照共用此口径，避免各处内联过滤遗漏条件
 * （曾遗漏 weaponFilter：Tove S2「仅 SG 友军」攻速 ▲ 被 AR 的 Tove 自身吃到）。
 * @param {object} state
 * @param {object} b     buff
 * @param {object} unit
 * @returns {boolean}
 */
export function isBuffActiveFor(state, b, unit) {
  if (b.unitId !== null && b.unitId !== unit.id) return false;
  if (b.roundsLeft !== undefined && b.roundsLeft <= 0) return false;
  if (b.endTick !== undefined && b.endTick !== Infinity && b.endTick <= state.tick) return false;
  if (b.weaponFilter && unit.weaponType !== b.weaponFilter) return false;
  // 「最大装弹数 ▼（同类效果不叠加）」（buff.maxAmmoDownNoStack，如 K S2 Fulfillment of Righteousness 效果 1）：
  // 目标身上有其他生效中的最大装弹数 ▼ 效果时暂时屏蔽（持续时间照常流逝），其他效果结束后恢复生效
  if (b.maxAmmoDownNoStack && hasOtherMaxAmmoDown(state, b, unit)) return false;
  return true;
}

/** unit 身上是否有 b 以外、生效中的普通最大装弹数 ▼ 效果（不含同为「不叠加」的效果，避免互相递归屏蔽） */
function hasOtherMaxAmmoDown(state, b, unit) {
  return state.buffs.some(o => o !== b && !o.maxAmmoDownNoStack
    && ((o.maxAmmoPct ?? 0) < 0 || (o.maxAmmoFlat ?? 0) < 0)
    && isBuffActiveFor(state, o, unit));
}

/**
 * 单字段 buff 汇总（含叠层），口径同 getBuffSums；供每 tick 调用的热路径（射速、MG 预热）使用。
 * @param {object} state
 * @param {object} unit
 * @param {string} field  buff 数值字段名（如 'atkSpeedPct'）
 * @returns {number}
 */
export function sumBuffField(state, unit, field) {
  let sum = 0;
  for (const b of state.buffs) {
    if (b[field] == null || !isBuffActiveFor(state, b, unit)) continue;
    sum += b[field] * (b.stacks ?? 1);
  }
  return sum;
}

export function getBuffSums(state, unitId) {
  const unit = state.squad.find(u => u.id === unitId);
  if (!unit) {
    const err = `[getBuffSums] unitId=${unitId} 在 squad 中不存在`;
    console.error(err, { unitId, squadIds: state.squad.map(u => u.id) });
    throw new Error(err);
  }
  // 从 BUFF_NUMERIC_FIELDS 初始化，装备基础值单独叠加
  const sums = Object.fromEntries(BUFF_NUMERIC_FIELDS.map(f => [f, 0]));
  sums.atkPct  = unit.equipAtkPct  ?? 0;
  sums.atkFlat = unit.equipAtkFlat ?? 0;
  let pierce = false;
  // 「对 X 代码敌人的伤害视为优越代码伤害」：buff 字段 elementAdvantageVs = 'Electric' 等，汇总为元素列表
  const elementAdvantageVs = [];
  // 普通攻击造成真实伤害（无视防御，受 trueDamagePct 加成），如 Guilty/Sin Bunny Mode: Engage
  let normalAttackTrueDamage = false;
  // 「弹丸数固定为 N」（buff 字段 pelletFixed，如 Dorothy: Serendipity S1）：非累加，多个同时生效取最小值
  let pelletFixed = null;
  for (const b of state.buffs) {
    if (!isBuffActiveFor(state, b, unit)) continue;
    // 可叠加 buff（stacks > 1）：各字段按层数等比累加
    const k = b.stacks ?? 1;
    for (const f of BUFF_NUMERIC_FIELDS) sums[f] += (b[f] ?? 0) * k;
    if (b.pierce) pierce = true;
    if (b.elementAdvantageVs && !elementAdvantageVs.includes(b.elementAdvantageVs))
      elementAdvantageVs.push(b.elementAdvantageVs);
    if (b.normalAttackTrueDamage) normalAttackTrueDamage = true;
    if (b.pelletFixed != null) pelletFixed = Math.min(pelletFixed ?? Infinity, b.pelletFixed);
  }
  return { ...sums, pierce, elementAdvantageVs, normalAttackTrueDamage, pelletFixed };
}

/**
 * 本次射击命中目标的弹丸数。仅 SG 有多弹丸，其余武器恒为 1。
 * 「弹丸数固定为 N」优先于「弹丸数 ▲」；否则 = 基础 shot_count + Σ pelletFlat（下限 1）。
 * 须用射击时（回合扣减前）的 sums 快照计算，回合制 pelletFixed 才能覆盖到其最后一回合。
 * 返回的是发射弹丸数；实际命中数由 rollHitPellets 按 SG 弹丸命中率判定。
 * @param {object} unit
 * @param {string} weaponType  本次射击的实际武器类型（含武器切换）
 * @param {{ pelletFixed: number|null, pelletFlat: number }} sums
 * @returns {number}
 */
export function shotPelletCount(unit, weaponType, sums) {
  if (weaponType !== 'SG') return 1;
  if (sums.pelletFixed != null) return sums.pelletFixed;
  return Math.max(1, (unit.shotCount ?? 1) + (sums.pelletFlat ?? 0));
}

/**
 * 按敌人距离缩放实战命中校正系数：系数为参考距离（HIT_RATE_REF_DISTANCE）时的命中率，
 * 敌人越近命中率越高，d = 0 时恒为 1；距离未知（null，如不可瞄准）按参考距离处理。
 * @param {number} rate      参考距离处的命中率（0..1）
 * @param {number|null} distance  敌人连续距离（0..100）
 * @returns {number} 当前距离下的命中率（0..1）
 */
export function distanceScaledHitRate(rate, distance) {
  if (rate >= 1) return 1;
  const d = distance ?? HIT_RATE_REF_DISTANCE;
  return Math.min(1, Math.max(0, 1 - (1 - rate) * d / HIT_RATE_REF_DISTANCE));
}

/**
 * SG 每颗弹丸命中躯体的概率：在距离缩放的标定命中率基础上，按有效散布缩放打空率。
 *   打空率 = (1 − 距离缩放命中率) × min(1, R_eff / SG_PELLET_REF_SCALE)
 *   R_eff  = currentScale / (1 + coef · HitRate)
 * 标定条件（散布 250、HitRate 0）下即为 distanceScaledHitRate 本身；
 * 散布收束（如 Privaty: Unkind Maid 250→75）或命中率 ▲（如 Dorothy: Serendipity 的 Flash）时打空更少。
 * @param {number} rate          参考距离、标定散布处的弹丸命中率（0..1）
 * @param {number|null} distance 敌人连续距离
 * @param {number} currentScale  当前散布 scale（无数据 ≤0 时按标定散布）
 * @param {number} hitRatePct    命中率属性（0..1）
 * @param {number} coef          HitRate 收圆系数
 * @returns {number} 每颗弹丸命中概率（0..1）
 */
export function sgPelletHitRate(rate, distance, currentScale, hitRatePct, coef) {
  const base = distanceScaledHitRate(rate, distance);
  if (base >= 1) return 1;
  const scale  = currentScale > 0 ? currentScale : SG_PELLET_REF_SCALE;
  const spread = Math.min(1, scale / (1 + coef * Math.max(0, hitRatePct ?? 0)) / SG_PELLET_REF_SCALE);
  return 1 - (1 - base) * spread;
}

/**
 * 逐弹丸判定命中躯体（SG 实战弹丸命中率校正）。hitRate ≥ 1 时全部命中，不消耗随机数。
 * @param {number} fired    发射弹丸数
 * @param {number} hitRate  每颗弹丸命中概率（0..1）
 * @returns {number} 命中弹丸数（0..fired）
 */
export function rollHitPellets(fired, hitRate) {
  if (hitRate >= 1) return fired;
  let hit = 0;
  for (let i = 0; i < fired; i++) if (rng() < hitRate) hit++;
  return hit;
}

/**
 * SG 逐弹丸判定暴击与核心：命中的每颗弹丸先判暴击、再判核心（各自独立），
 * 按（暴击, 核心）归为至多 4 类，只返回弹丸数 > 0 的类。
 * 顺序固定为：非暴击+非核心、仅暴击、仅核心、暴击+核心（伤害明细按此顺序分栏）。
 * @param {number} hitPellets       命中弹丸数
 * @param {number} critRate         暴击率（0..1）
 * @param {() => boolean} rollCore  单颗弹丸核心判定（已含核心保护 / 穿透条件）
 * @returns {Array<{ isCrit: boolean, isCore: boolean, count: number }>}
 */
export function rollPelletGroups(hitPellets, critRate, rollCore) {
  const counts = [0, 0, 0, 0];   // 下标 = 暴击(1) + 核心(2)
  for (let i = 0; i < hitPellets; i++) {
    const crit = rollCrit(critRate) ? 1 : 0;
    counts[crit + (rollCore() ? 2 : 0)]++;
  }
  return counts
    .map((count, i) => ({ isCrit: (i & 1) !== 0, isCore: (i & 2) !== 0, count }))
    .filter(g => g.count > 0);
}

/**
 * 敌人当前是否可被命中（供不受操作控制的自动攻击技能判定是否有目标，如 Anis: Star 的 Shooting Stars）。
 * HIDDEN 并非瞬间不可命中：隐藏动画前 HIDDEN_HITTABLE_SECS 秒内仍可被命中，之后才无目标。
 * （自动战斗的普通射击在 HIDDEN 起点即停火，不经过此函数。）
 * @param {object} state
 * @returns {boolean}
 */
export function isEnemyHittable(state) {
  if (state.currentPhaseZone !== 'HIDDEN') return true;
  return state.tick - (state.hiddenStartTick ?? state.tick) < Math.round(HIDDEN_HITTABLE_SECS * TICK_RATE);
}

/**
 * 敌人在指定 tick 的横向移动速度档（敌人配置「横向移动」区间，[startTick, endTick)）。
 * @param {{ enemyLateralMoves?: { startTick: number, endTick: number, speed: string }[] }} state
 * @param {number} tick
 * @returns {string|null} 速度档（如 'SLOW'）；静止返回 null
 */
export function enemyLateralSpeedAt(state, tick) {
  for (const m of state.enemyLateralMoves ?? []) {
    if (tick >= m.startTick && tick < m.endTick) return m.speed;
  }
  return null;
}

/**
 * RL 弹道飞行 tick 数（按敌人距离线性拟合，再按弹速缩放）。
 * @param {number|null} distance 敌人连续距离（null 按参考距离）
 * @param {number|null} [speed]  弹速（spot_projectile_speed；无数据按标定弹速 100）
 * @returns {number}
 */
export function rlFlightTicks(distance, speed = null) {
  const d = distance ?? HIT_RATE_REF_DISTANCE;
  const v = speed > 0 ? speed : RL_REF_PROJECTILE_SPEED;
  const base = Math.max(0, RL_FLIGHT_TICKS_PER_DISTANCE * d + RL_FLIGHT_TICKS_OFFSET);
  return base * RL_REF_PROJECTILE_SPEED / v;
}

/**
 * RL 普通攻击核心命中率：命中时刻（出手 + 飞行时间）敌人静止 → 1；
 * 横向移动 → 1 − clamp(斜率[速度档] × (飞行帧 − 阈值), 0, 1)。
 * @param {object} state
 * @param {number|null} [speed]  弹速
 * @returns {number} 0..1
 */
export function rlCoreHitRate(state, speed = null) {
  const flight = rlFlightTicks(state.enemyDistance, speed);
  const moving = enemyLateralSpeedAt(state, state.tick + Math.round(flight));
  if (!moving) return 1;
  const miss = (LATERAL_MISS_SLOPE[moving] ?? 0) * (flight - LATERAL_MISS_FLIGHT_THRESHOLD);
  return 1 - Math.min(1, Math.max(0, miss));
}

/**
 * 弹道类技能命中（如 Anis: Star 的 Shooting Stars）是否命中核心：
 * 敌人有核心且未被保护时，按给定核心命中率判定。
 * @param {object} state
 * @param {number} [rate=1]  核心命中率（0..1）
 * @returns {boolean}
 */
export function rollProjectileCore(state, rate = 1) {
  if (!state.enemyHasCore || state.enemyCoreProtected) return false;
  return rate >= 1 || rng() < rate;
}

// 被克制关系反查：value 克制 key（Fire > Wind > Iron > Electric > Water > Fire）
const ELEMENT_COUNTERED_BY = { Wind: 'Fire', Iron: 'Wind', Electric: 'Iron', Water: 'Electric', Fire: 'Water' };

/**
 * 计算本次命中参与克制判定的攻击方元素。
 * 若 buff 声明「对 enemyElement 代码敌人的伤害视为优越代码伤害」（sums.elementAdvantageVs 含该元素），
 * 则返回克制该元素的代码，使 calcDamage 判定为优越代码；否则返回单位自身元素。
 * @param {object} unit
 * @param {{ elementAdvantageVs?: string[] }} sums
 * @param {string|null} enemyElement
 * @returns {string|null}
 */
export function resolveAttackerElement(unit, sums, enemyElement) {
  if (enemyElement && sums.elementAdvantageVs?.includes(enemyElement))
    return ELEMENT_COUNTERED_BY[enemyElement];
  return unit.element;
}

// ─── 敌人承伤汇总 ─────────────────────────────────────────────────────────────

// 汇总所有 unitId === ENEMY_UNIT_ID 的活跃 buff 中的 enemyDamageTakenPct（含叠层）
export function getEnemyDamageTakenPct(state) {
  let total = 0;
  for (const b of state.buffs) {
    if (b.unitId !== ENEMY_UNIT_ID) continue;
    if (b.roundsLeft !== undefined && b.roundsLeft <= 0) continue;
    total += (b.enemyDamageTakenPct ?? 0) * (b.stacks ?? 1);
  }
  return total;
}

// 敌人当前实际 DEF：基础 DEF（由 enemyDefActions 脚本驱动）× (1 − Σ enemyDefDownPct)，下限 0。
// enemyDefDownPct 来自 unitId === ENEMY_UNIT_ID 的活跃 debuff（含叠层），如 Phantom Calling Card。
export function getEffectiveEnemyDef(state) {
  let defDown = 0;
  for (const b of state.buffs) {
    if (b.unitId !== ENEMY_UNIT_ID) continue;
    if (b.roundsLeft !== undefined && b.roundsLeft <= 0) continue;
    defDown += (b.enemyDefDownPct ?? 0) * (b.stacks ?? 1);
  }
  return state.enemyDef * Math.max(0, 1 - defDown);
}

/**
 * 构建敌人承伤 debuff 的 buffBreakdown 条目，与 damageTakenMult 来源严格对应：
 *   state.buffs 中 unitId === '__enemy__' 的具名条目。
 * 返回的条目可直接 spread 进 hitLog 的 buffBreakdown 数组。
 */
export function getEnemyDebuffBreakdown(state) {
  const entries = state.buffs
    .filter(b => b.unitId === ENEMY_UNIT_ID
              && (b.roundsLeft === undefined || b.roundsLeft > 0)
              && (b.enemyDamageTakenPct ?? 0) !== 0)
    .map(b => ({
      name:             b.name,
      damageTakenPct:   (b.enemyDamageTakenPct ?? 0) * (b.stacks ?? 1),
      isEnemyDebuff:    true,
      sourceCaster:     b._sourceCaster     ?? null,
      sourceSkillLabel: b._sourceSkillLabel ?? null,
      sourcePartIdx:    b._sourcePartIdx    ?? null,
      sourceLineIdx:    b._sourceLineIdx    ?? null,
      stacks:           b.stacks ?? 1,
      multiplier:       b.multiplier ?? null,
    }));
  return entries;
}

// ─── Buff 添加 ─────────────────────────────────────────────────────────────

/**
 * logCtx — 日志上下文，控制 skill_trigger 事件在战斗日志中的归属与显示。
 *
 * 字段说明：
 *   unitName   {string}      施法单位名（日志"角色"列）。
 *   skillLabel {string}      技能显示名，通常为 name_localkey（如 "Calm Depths"）。
 *                            UI 以此名称查找 tooltip 对应技能对象，需与 slot 匹配。
 *   slot       {string|null} 'S1' | 'S2' | 'Burst'。
 *                            用于 tooltip 精确定位技能对象；null 时回退至名称匹配。
 *   partIdx    {number|null} P 段 0-based 索引（P1=0, P2=1 …）。
 *                            null = 不显示 P 后缀。
 *                            UI 在描述只有唯一段时自动省略 P（见 store._countSkillParts）。
 *   lineIdx    {number|null} L 行 0-based 索引（L1=0, L2=1 …）。
 *                            null = 不显示 L 后缀。
 *                            UI 在该 P 段行数 ≤ 2 时自动省略 L（见 store._countLinesInPart）。
 *   trigger    {string}      触发条件字符串（如 'ENTER_FULL_BURST'），用于日志分组排序。
 *
 * 常见用法：
 *   // 1. 沿用当前触发器上下文（handler 内最常见，自动取 state._logCtx）
 *   pushBuff(state, buffObj);
 *
 *   // 2. 省略 P 后缀
 *   pushBuff(state, buffObj, { ...state._logCtx, partIdx: null });
 *
 *   // 3. 覆盖为另一个技能槽
 *   pushBuff(state, buffObj, {
 *     ...state._logCtx,
 *     skillLabel: unit.rawSkill2?.name_localkey ?? 'S2',
 *     slot: 'S2', partIdx: 0, lineIdx: null,
 *   });
 *
 *   // 4. 归属另一个单位的技能
 *   pushBuff(state, buffObj, {
 *     unitName:   ally.name,
 *     skillLabel: ally.rawBurst?.name_localkey ?? 'Burst',
 *     slot: 'Burst', partIdx: null, lineIdx: null,
 *     trigger: state._logCtx?.trigger ?? '',
 *   });
 */
// 多目标 buff（unitIds）的日志目标名：覆盖全队时显示「全体队友」，否则按队伍顺序列出目标名
function _multiTargetName(state, unitIds) {
  const squad = state.squad ?? [];
  const idSet = new Set(unitIds);
  if (squad.length > 0 && squad.every(u => idSet.has(u.id))) return '全体队友';
  const names = squad.filter(u => idSet.has(u.id)).map(u => u.name);
  return names.join('、') || '?';
}

function _emitBuffEvent(state, buffObj, logCtx) {
  if (!state.pendingSkillEvents) return;
  const targetName = Array.isArray(buffObj.unitIds)
    ? _multiTargetName(state, buffObj.unitIds)
    : buffObj.unitId === null
    ? (buffObj.weaponFilter && state.squad
        ? (state.squad.filter(u => u.weaponType === buffObj.weaponFilter).map(u => u.name).join('、') || `${buffObj.weaponFilter} 友军`)
        : '全体队友')
    : buffObj.unitId === ENEMY_UNIT_ID
    ? '敌人'
    : (state.squad?.find(u => u.id === buffObj.unitId)?.name ?? '?');
  state.pendingSkillEvents.push({
    type: 'skill_trigger', tick: state.tick,
    _seq: state._logSeq++,
    unitName: logCtx.unitName, skillLabel: logCtx.skillLabel, slot: logCtx.slot ?? null,
    partIdx: logCtx.partIdx, trigger: logCtx.trigger ?? '',
    lineIdx: logCtx.lineIdx ?? null,
    target:   targetName,
    buffName: buffObj.name,
    endTick:  buffObj.endTick,
    gaugeAfter: state.burstGauge,
  });
}

/**
 * 由 logCtx 生成 buff 的来源字段（供 UI Buff 悬浮提示定位到技能描述段落）。
 * logCtx 为空时返回空对象。
 */
function _sourceFieldsFrom(logCtx) {
  if (!logCtx) return {};
  return {
    _sourceCaster:     logCtx.unitName,
    _sourceSkillLabel: logCtx.skillLabel,
    _sourcePartIdx:    logCtx.partIdx ?? null,
    _sourceLineIdx:    logCtx.lineIdx ?? null,
  };
}

/**
 * 推入单条 buff（单一 unitId）。
 * @returns {boolean} 本次推入是否值得记录日志（纯永久 buff 的无实质刷新返回 false）
 */
function _pushBuffCore(state, buffObj, logCtx = null) {
  const existing = state.buffs.find(b => b.name === buffObj.name && b.unitId === buffObj.unitId);
  if (existing) {
    // 无论是否达到上限，均刷新 endTick（整体持续时间重置）
    existing.endTick = Math.max(existing.endTick, buffObj.endTick);
    // 回合制 buff 刷新：roundsLeft 取较大值
    if (buffObj.endRounds !== undefined)
      existing.roundsLeft = Math.max(existing.roundsLeft ?? 0, buffObj.endRounds);
    // 可叠加效果（stackLimit > 1）：层数未达上限时新增一层
    const limit = buffObj.stackLimit ?? 1;
    if (limit > 1 && (existing.stacks ?? 1) < limit) {
      if (_hasMaxHpEffect(existing)) markMaxHpChange(state, _buffTargets(state, existing));
      existing.stacks = (existing.stacks ?? 1) + 1;
    }
    // 仅纯永久 buff（无回合制）刷新时视为无实质变化，不记录日志
    const isInfiniteRefresh = existing.endTick === Infinity && buffObj.endTick === Infinity
      && buffObj.endRounds === undefined;
    // 传入 post-refresh endTick（Math.max 之后），确保事件记录的是最终到期时刻
    if (logCtx && !isInfiniteRefresh) _emitBuffEvent(state, { ...buffObj, endTick: existing.endTick }, logCtx);
    return !isInfiniteRefresh;
  }
  // 初次推入：设置 roundsLeft（回合制）和 stacks（初始层数为 1）
  const buff = { ...buffObj, ..._sourceFieldsFrom(logCtx), stacks: buffObj.stacks ?? 1 };
  if (buff.endRounds !== undefined && buff.roundsLeft === undefined)
    buff.roundsLeft = buff.endRounds;
  if (_hasMaxHpEffect(buff)) markMaxHpChange(state, _buffTargets(state, buff));
  state.buffs.push(buff);
  if (logCtx) _emitBuffEvent(state, buff, logCtx);
  if (state.buffLog) {
    state.buffLog.push({
      _seq: state._logSeq++,
      type: 'buff_gain', tick: state.tick, name: buff.name, unitId: buff.unitId, endTick: buff.endTick,
      ...Object.fromEntries(BUFF_NUMERIC_FIELDS.map(f => [f, buff[f] ?? 0])),
    });
  }
  return true;
}

// ─── Max HP 变化与当前 HP ────────────────────────────────────────────────────
//
// 游戏基础机制：Max HP 变化只改变上限，不按比例保持当前 HP（无论描述是否写「without restoring HP」）。
//   · Max HP ▲：当前 HP 不变（满 HP 时获得提升 → 变为不满 HP）。
//   · Max HP 效果到期 / 数值降低：当前 HP 若高于新的上限则截断（clampHpToMax，由 battle.js 过期清理调用），
//     否则不变。

// buff 所作用的单位列表（unitId null → 全队）
function _buffTargets(state, buff) {
  if (!state.squad) return [];
  if (buff.unitId === null || buff.unitId === undefined) return state.squad;
  if (buff.unitId === ENEMY_UNIT_ID) return [];
  const u = state.squad.find(u => u.id === buff.unitId);
  return u ? [u] : [];
}

// ─── 当前 HP / HP 比例变化记录 ──────────────────────────────────────────────
//
// 所有改变 unit.unitHp 的路径（治疗、生命偷取、截断、自损、将来的受伤）都经 _setUnitHp；
// 所有改变最终 MaxHP 的路径（Max HP buff 推入 / 叠层 / 改值 / 到期 / 技能主动移除）在变化**之前**
// 调用 _markHpState / markMaxHpChange。二者把「首次变化前的 HP 与 MaxHP」记入
// state.pendingHpChanged（unitId → { unit, prevHp, prevMaxHp }），
// 由 skill-executor.dispatchHpChanged 派发 HP_CHANGED（ctx.prevHp / newHp / prevRatio / newRatio）。
function _markHpState(state, unit) {
  if (!(state.pendingHpChanged instanceof Map) || state.pendingHpChanged.has(unit.id)) return;
  if (unit.unitHp === undefined) return;   // 未初始化 HP 的单位（测试 mock）
  state.pendingHpChanged.set(unit.id,
    { unit, prevHp: unit.unitHp, prevMaxHp: getFinalMaxHp(state, unit) });
}

function _setUnitHp(state, unit, newHp) {
  if (newHp === unit.unitHp) return;
  _markHpState(state, unit);
  unit.unitHp = newHp;
}

function _hasMaxHpEffect(buff) {
  return (buff.maxHpPct ?? 0) !== 0 || (buff.maxHpFlat ?? 0) !== 0;
}

/**
 * 最终 MaxHP 即将变化前调用：记录各单位变化前的 HP 与 MaxHP，供 HP_CHANGED 计算比例变化。
 * 技能文件直接移除 / 减层带 Max HP 的 buff 时须在修改**之前**调用（pushBuff / setMaxHpBuffValue 已内置）。
 * @param {object}   state
 * @param {object[]} units
 * @param {{ beforeTick?: number }} [opts]  buff 到期清理时传上一 tick：到期那一 tick getBuffSums 已排除
 *                                          该 buff，需按上一 tick 计算变化前的 MaxHP
 */
export function markMaxHpChange(state, units, { beforeTick } = {}) {
  const savedTick = state.tick;
  if (beforeTick !== undefined) state.tick = beforeTick;
  try {
    for (const u of units) _markHpState(state, u);
  } finally {
    state.tick = savedTick;
  }
}

/**
 * 就地改写已存在 buff 的 Max HP 数值（如 Laplace: Ultimate Hero Over Energy 阶段推进、
 * Maxwell: Ordinary Mechanic 叠层写入「层数 × 每层」）。
 * 数值提升时当前 HP 不变；数值降低时截断当前 HP 到新的上限。
 * 技能文件修改 maxHpPct / maxHpFlat 字段时必须经此函数，不要直接赋值。
 * @param {object} state
 * @param {object} buff   state.buffs 中的 buff 对象
 * @param {{ maxHpPct?: number, maxHpFlat?: number }} next  新的数值（缺省字段保持不变）
 */
export function setMaxHpBuffValue(state, buff, next) {
  markMaxHpChange(state, _buffTargets(state, buff));
  if (next.maxHpPct  !== undefined) buff.maxHpPct  = next.maxHpPct;
  if (next.maxHpFlat !== undefined) buff.maxHpFlat = next.maxHpFlat;
  for (const u of _buffTargets(state, buff)) clampHpToMax(state, u);
}

/**
 * 当前 HP 截断到最终 MaxHP（Max HP 效果到期 / 数值降低后调用）。
 */
export function clampHpToMax(state, unit) {
  if (unit.unitHp === undefined) return;
  const max = getFinalMaxHp(state, unit);
  if (unit.unitHp > max) _setUnitHp(state, unit, max);
}

// buff 推入后：若含 maxAmmo 相关字段，对受影响单位重新计算最大弹匣。
function _maybeRecalcMaxAmmo(state, buffObj) {
  if (!state.squad) return;
  if (buffObj.maxAmmoPct == null && buffObj.maxAmmoFlat == null) return;
  const affected = buffObj.unitId != null
    ? [state.squad.find(u => u.id === buffObj.unitId)].filter(Boolean)
    : state.squad;
  for (const u of affected) recalcMaxAmmo(state, u);
}

/**
 * 推入 buff。
 *
 * buffObj 目标字段（三选一）：
 *   unitId: <id>      单个单位
 *   unitId: null      全队共享（一条 buff 对象，getBuffSums 对所有单位生效；可配 weaponFilter）
 *   unitIds: [<id>…]  多个指定单位：为每个单位各推入一条独立 buff（层数 / 回合各自维护），
 *                     但战斗日志只记录一行（目标列为各单位名，覆盖全队时显示「全体队友」）。
 *                     技能文件中「对若干目标施加同一效果」须用此字段，不要在 pushBuff 外循环。
 *
 * buffObj.multiplier（可选）：效果数值已按动态倍率 n（如 Drunken 层数）放大时传入 n，
 *   伤害公式明细会在 buff 名后显示「*n」（见 store.buildDmgTooltipHTML）。
 *
 * logCtx：缺省沿用 state._logCtx；传 false 可抑制日志（见 Crown Relax）。
 */
export function pushBuff(state, buffObj, logCtx = null) {
  const effectiveLogCtx = logCtx ?? state._logCtx ?? null;
  // 规则1：回合制 buff endTick 强制为 Infinity
  if (buffObj.endRounds !== undefined && buffObj.endRounds > 0) {
    buffObj = { ...buffObj, endTick: Infinity };
  }
  // 规则0：多目标（unitIds）→ 逐单位推入独立 buff，日志合并为一行
  //   逐单位推入时不传 logCtx（避免每单位各发一条事件），但来源字段仍需写入，
  //   否则 Buff 悬浮提示无法链接到来源技能描述。
  if (Array.isArray(buffObj.unitIds)) {
    const { unitIds, ...rest } = buffObj;
    if (unitIds.length === 0) return;
    const sourceFields = _sourceFieldsFrom(effectiveLogCtx);
    let shouldLog = false;
    for (const id of unitIds) {
      const single = { ...rest, ...sourceFields, unitId: id };
      if (_pushBuffCore(state, single)) shouldLog = true;
      _maybeRecalcMaxAmmo(state, single);
      _trackCsChange(state, single);
    }
    if (effectiveLogCtx && shouldLog) _emitBuffEvent(state, { ...rest, unitIds }, effectiveLogCtx);
    return;
  }
  // 规则2：回合制全体 buff → 拆分为每角色独立 buff，各自维护独立的 roundsLeft
  // 日志仍记录一条（目标：全体队友），由调用层统一发出
  if (buffObj.endRounds !== undefined && buffObj.endRounds > 0 && buffObj.unitId === null) {
    for (const u of state.squad) {
      _pushBuffCore(state, { ...buffObj, unitId: u.id });
    }
    if (effectiveLogCtx) _emitBuffEvent(state, buffObj, effectiveLogCtx);
    _maybeRecalcMaxAmmo(state, buffObj);
    _trackCsChange(state, buffObj);
    return;
  }
  _pushBuffCore(state, buffObj, effectiveLogCtx);
  _maybeRecalcMaxAmmo(state, buffObj);
  _trackCsChange(state, buffObj);
}

// CS buff 推入时记录受影响单位，供 battle.js flushCsChanged 分派 CS_BUFF_CHANGED 事件。
function _trackCsChange(state, buffObj) {
  if (!(buffObj.chargeSpeedPct ?? 0) || !state._pendingCsChangedIds) return;
  if (buffObj.unitId === null) {
    for (const u of state.squad) state._pendingCsChangedIds.add(u.id);
  } else {
    state._pendingCsChangedIds.add(buffObj.unitId);
  }
}

// ─── 回合制 Buff 消耗 ──────────────────────────────────────────────────────

/**
 * 每次单位射击后调用，消耗该单位所有 round-based buff 的一个回合。
 * 当 roundsLeft 归零后，getBuffSums 将自动跳过该 buff（不再计入）。
 */
export function decrementRoundBuffs(state, unitId) {
  for (const b of state.buffs) {
    if (b.roundsLeft === undefined || b.roundsLeft <= 0) continue;
    if (b.unitId !== null && b.unitId !== unitId) continue;
    b.roundsLeft--;
  }
}

// ─── 技能描述解析 ──────────────────────────────────────────────────────────

/**
 * 从 CDN 技能描述文本中解析持续时间。
 * 支持：
 *   "10s" / "10.5s"             → { type: 'time', seconds: 10 }
 *   "10 round(s)" / "for 10 round(s)" → { type: 'rounds', count: 10 }
 *
 * @param {string} text
 * @returns {{ type: 'time', seconds: number } | { type: 'rounds', count: number } | null}
 */
export function parseSkillDuration(text) {
  if (typeof text !== 'string') return null;
  const roundMatch = text.match(/(?:for\s+)?(\d+(?:\.\d+)?)\s+round\(s\)/i);
  if (roundMatch) return { type: 'rounds', count: parseFloat(roundMatch[1]) };
  const secMatch = text.match(/(\d+(?:\.\d+)?)s(?![a-z])/i);
  if (secMatch) return { type: 'time', seconds: parseFloat(secMatch[1]) };
  return null;
}

// ─── 爆裂槽 ────────────────────────────────────────────────────────────────

/**
 * 累加爆裂槽能量并写入 burstEnergyLog，不产生战斗日志行。
 * @returns {boolean} 是否实际累加（爆裂期间 burstPhase!==0 不充能）
 */
function accumulateBurstGauge(state, unitName, source, energy) {
  if (state.burstPhase !== 0) return false;
  state.burstGauge = Math.min(BURST_GAUGE_MAX, state.burstGauge + energy);
  if (state.burstEnergyLog) {
    state.burstEnergyLog.push({ tick: state.tick, unitName, source, energyAdded: energy, gaugeAfter: state.burstGauge });
  }
  return true;
}

/**
 * 纯充能效果（如 LM S1 P4）：累加能量，并在 handler 路径单独推入一条「爆裂槽」日志行。
 * 伴随伤害的充能应改用 fireSkillHit 的 opts.burstEnergy，使充能并入该伤害行。
 */
export function addBurstGauge(state, unitName, source, energy) {
  if (!accumulateBurstGauge(state, unitName, source, energy)) return;
  // handler 路径（state._logCtx 存在）时向战斗日志推入充能事件
  _emitSkillEvent(state, '爆裂槽');
}

// ─── 技能事件日志辅助 ──────────────────────────────────────────────────────

/**
 * 当 state._logCtx 存在（handler 执行期间由 skill-executor 注入）时，
 * 向 pendingSkillEvents 推入一条技能触发记录。
 * declarative 路径不设置 _logCtx，因此不会产生重复日志。
 *
 * override 可传 { partIdx, lineIdx } 覆盖默认值，与 pushBuff 第三参数语义一致：
 *   _emitSkillEvent(state, '全体队友', { partIdx: 2, lineIdx: 0 })
 */
function _emitSkillEvent(state, target, override = null) {
  const base = state._logCtx;
  if (!base || !state.pendingSkillEvents) return;
  const ctx = override ? { ...base, ...override } : base;
  state.pendingSkillEvents.push({
    type: 'skill_trigger', tick: state.tick,
    _seq: state._logSeq++,
    unitName: ctx.unitName, skillLabel: ctx.skillLabel, slot: ctx.slot,
    partIdx: ctx.partIdx, trigger: ctx.trigger ?? '',
    lineIdx: ctx.lineIdx ?? null,
    target,
    gaugeAfter: state.burstGauge,
  });
}

// ─── HP 回复 ────────────────────────────────────────────────────────────────

/**
 * 两侧相邻友军（按队伍站位 unit.position 判定，空位占位置：隔着空位的单位不相邻）。
 * 返回顺序：左侧在前。技能中「adjacent allies / both sides」一律用此函数，不要用 state.squad 下标。
 */
export function getAdjacentAllies(state, unit) {
  const pos = getUnitPosition(state, unit);
  return state.squad.filter(u => Math.abs(getUnitPosition(state, u) - pos) === 1);
}

/** 单位站位（0–4，含空位）；未设置 position 的单位（测试 mock）按 state.squad 下标。 */
export function getUnitPosition(state, unit) {
  return unit.position ?? state.squad.indexOf(unit);
}

/**
 * 单位当前 HP 占最终 MaxHP 的比例（「HP 低于 X%」类条件统一用此函数判定）。
 * unitHp 未初始化时视为满血。
 */
export function getHpRatio(state, unit) {
  const max = getFinalMaxHp(state, unit);
  if (!(max > 0)) return 1;
  return (unit.unitHp ?? max) / max;
}

// 实际回复量：基础量 × (1 + 治疗者治疗效能) × (1 + 受治疗者受治疗量加成)
function _effectiveHealAmount(state, baseAmount, caster, target) {
  const potency  = caster ? (getBuffSums(state, caster.id).healPotencyPct ?? 0) : 0;
  const incoming = getBuffSums(state, target.id).incomingHealPct ?? 0;
  return Math.round(baseAmount * (1 + potency) * (1 + incoming));
}

// 溢出治疗储存（Stockpile / Storage）是否处于生效期
function _overhealActive(state, unit) {
  const o = unit.overheal;
  return !!o && o.endTick > state.tick;
}

// 向单位增加 HP（上限为最终 MaxHP）；超出上限的部分在溢出储存生效期内存入储存池（不超过 cap）。
// 只改变 HP / 储存池并记录 HP_CHANGED，不视为「受到治疗」。
function _addHp(state, unit, amount) {
  const max     = getFinalMaxHp(state, unit);
  const cur     = unit.unitHp ?? max;
  const applied = Math.max(0, Math.min(amount, max - cur));
  _setUnitHp(state, unit, cur + applied);
  const excess = amount - applied;
  if (excess > 0 && _overhealActive(state, unit)) {
    const o = unit.overheal;
    o.hp = Math.min(o.cap, o.hp + excess);
  }
}

// 单位「受到治疗」：增加 HP 并排入 HEAL_RECEIVED 派发队列
function _healUnit(state, unit, amount) {
  _addHp(state, unit, amount);
  if (Array.isArray(state.pendingHealReceived)) state.pendingHealReceived.push(unit);
}

// 目标是否处于「平均分摊治疗」状态（buff 字段 shareHeal: true，如 Nayuta S1 P2 Hypocrisy）
function _hasShareHeal(state, unit) {
  return state.buffs.some(b => b.shareHeal
    && (b.unitId === null || b.unitId === unit.id)
    && !(b.endTick !== undefined && b.endTick !== Infinity && b.endTick <= state.tick));
}

// 对单个目标结算一次治疗：
//   平均分摊状态下，实际回复量均分给全队 —— 只有原目标「受到治疗」（HEAL_RECEIVED），
//   其余队员仅发生 HP 变化（HP_CHANGED）。
function _healTarget(state, target, effectiveAmount) {
  if (_hasShareHeal(state, target) && state.squad?.length > 1) {
    const share = Math.round(effectiveAmount / state.squad.length);
    for (const u of state.squad) {
      if (u === target) _healUnit(state, u, share);
      else _addHp(state, u, share);
    }
    return;
  }
  _healUnit(state, target, effectiveAmount);
}

/**
 * 对目标单位施加 HP 回复。
 * targetUnit 可为单位对象或 ALL_ALLIES 哨兵（内部遍历 state.squad）。
 * amount 为技能描述给出的基础回复量；实际回复量另乘治疗者的治疗效能（healPotencyPct）
 * 与受治疗者的受治疗量加成（incomingHealPct），上限为受治疗者的最终 MaxHP，
 * 超出部分在溢出治疗储存（applyOverhealStorage）生效期内存入储存池。
 * caster 为治疗者（施法单位）；省略时不计治疗效能。
 * 若 state._logCtx 存在（handler 路径），自动向战斗日志推入合并记录。
 * 调用方负责在回复后分派 HEAL_RECEIVED / HP_CHANGED 触发（battle.js flushHpEvents）。
 */
export function applyHeal(state, targetUnit, amount, logCtxOverride = null, caster = null) {
  if (amount <= 0) return;
  if (targetUnit === ALL_ALLIES) {
    _emitSkillEvent(state, '全体队友', logCtxOverride);
    for (const u of state.squad) _healTarget(state, u, _effectiveHealAmount(state, amount, caster, u));
    return;
  }
  _emitSkillEvent(state, targetUnit.name, logCtxOverride);
  _healTarget(state, targetUnit, _effectiveHealAmount(state, amount, caster, targetUnit));
}

/**
 * 生命偷取（「Restores HP equal to X% of attack damage」）：命中造成伤害后按 sums.lifeStealPct 回复自身。
 * 视为一次 HP 回复：受自身治疗效能 / 受治疗量加成影响，并派发 HEAL_RECEIVED
 * （如 Crown S2 P3「recovery takes effect」可由 Helm 爆裂的全员生命偷取触发）。
 * 不写战斗日志（每发射击都会触发，避免刷屏）。
 */
export function applyLifeSteal(state, unit, damage, sums) {
  const pct = sums?.lifeStealPct ?? 0;
  if (!(pct > 0) || !(damage > 0)) return;
  _healTarget(state, unit, _effectiveHealAmount(state, damage * pct, unit, unit));
}

/**
 * 扣减当前 HP（「Current HP ▼ X%」类自损效果，如 Scarlet S1、Grave 爆裂 Prediction）。
 * amount 为扣减量（「Current HP ▼ X%」= 当前 HP × X%，由调用方换算）。
 * 溢出治疗储存生效期内先扣储存池，再扣 HP；HP 不会降到 1 以下（自损不致死）。
 * 若 state._logCtx 存在（handler 路径），自动向战斗日志推入记录。
 * @returns {number} 实际扣减量（含储存池部分）
 */
export function applyHpLoss(state, unit, amount, logCtxOverride = null) {
  if (!(amount > 0)) return 0;
  let remaining = amount;
  if (_overhealActive(state, unit) && unit.overheal.hp > 0) {
    const fromStore = Math.min(unit.overheal.hp, remaining);
    unit.overheal.hp -= fromStore;
    remaining        -= fromStore;
  }
  const before = unit.unitHp ?? getFinalMaxHp(state, unit);
  const after  = Math.max(1, before - remaining);
  _setUnitHp(state, unit, after);
  _emitSkillEvent(state, unit.name, logCtxOverride);
  return (amount - remaining) + (before - after);
}

// ─── 溢出治疗储存 ─────────────────────────────────────────────────────────────

/**
 * 开启溢出治疗储存（Centi S1 P3 Stockpile / Anchor 爆裂 Storage）：
 * 生效期内超出最终 MaxHP 的治疗量存入 unit.overheal.hp（上限 cap），HP 扣减时优先扣储存池；
 * 到期由 expireOverheal 移除储存部分。储存池不计入 HP 比例（getHpRatio）。
 * 重复开启：储存量保留，上限与到期取较大值。
 * target 可为单位对象或 ALL_ALLIES；cap 可为数值或 (unit) => 数值（如「their Max HP」按各目标换算）。
 */
export function applyOverhealStorage(state, target, cap, endTick, logCtxOverride = null) {
  const units = target === ALL_ALLIES ? state.squad : [target];
  _emitSkillEvent(state, target === ALL_ALLIES ? '全体队友' : target.name, logCtxOverride);
  for (const u of units) {
    const c = Math.round(typeof cap === 'function' ? cap(u) : cap);
    if (!(c > 0)) continue;
    if (_overhealActive(state, u)) {
      u.overheal.cap     = Math.max(u.overheal.cap, c);
      u.overheal.endTick = Math.max(u.overheal.endTick, endTick);
    } else {
      u.overheal = { hp: 0, cap: c, endTick };
    }
  }
}

/** 溢出治疗储存到期清理（battle.js 每 tick 调用）：移除储存部分。 */
export function expireOverheal(state, unit) {
  if (unit.overheal && unit.overheal.endTick <= state.tick) unit.overheal = null;
}

// ─── 护盾 ──────────────────────────────────────────────────────────────────

function _applyShieldUnit(state, unit, shieldAmt, shieldEndTick) {
  if (unit.shieldHp > 0) {
    unit.shieldHp      = Math.max(unit.shieldHp, shieldAmt);
    unit.shieldEndTick = Math.max(unit.shieldEndTick, shieldEndTick);
  } else {
    unit.shieldHp      = shieldAmt;
    unit.shieldEndTick = shieldEndTick;
  }
  if (Array.isArray(state.pendingShieldReceived)) state.pendingShieldReceived.push(unit);
}

/**
 * 对目标单位施加护盾，并将该单位推入 state.pendingShieldReceived 队列。
 * unit 可为单位对象或 ALL_ALLIES 哨兵（内部遍历 state.squad）。
 * 若 state._logCtx 存在（handler 路径），自动向战斗日志推入合并记录。
 * battle.js 在每次可能触发护盾的操作后调用 flushShieldReceived，
 * 逐单位分派 APPLY_SHIELD 触发（技能触发条件为"自身护盾生效时"，
 * 与 HEAL_RECEIVED 语义一致：谁收到护盾，谁的单位 id 作为 ctx.unit）。
 * 刷新语义：已有护盾时取两者较大值（量与到期 tick 均取 max）。
 */
export function applyShield(state, unit, shieldAmt, shieldEndTick, logCtxOverride = null) {
  if (shieldAmt <= 0) return;
  if (unit === ALL_ALLIES) {
    _emitSkillEvent(state, '全体队友', logCtxOverride);
    for (const u of state.squad) _applyShieldUnit(state, u, shieldAmt, shieldEndTick);
    return;
  }
  _emitSkillEvent(state, unit.name, logCtxOverride);
  _applyShieldUnit(state, unit, shieldAmt, shieldEndTick);
}

/**
 * 施加「共享护盾」（shared shield，如 Centi S2）：单一护盾池挡在全队身前，
 * 与各单位自身持有的护盾（unit.shieldHp）是不同机制：
 *   - 不写入任何单位的 shieldHp，不推入 pendingShieldReceived，因此**不会**派发 APPLY_SHIELD
 *     （「when applying Shield」类技能如 Naga S1 P2 不响应共享护盾）；
 *   - 「自身持有生效护盾」类条件（如 Naga 爆裂 P3 读取 caster.shieldHp）同样不计入共享护盾。
 * 存储于 state.sharedShieldHp / state.sharedShieldEndTick，刷新语义与 applyShield 相同（量与到期 tick 取 max）。
 * 若 state._logCtx 存在（handler 路径），自动向战斗日志推入一条目标为「全体队友」的记录。
 */
export function applySharedShield(state, shieldAmt, shieldEndTick, logCtxOverride = null) {
  if (shieldAmt <= 0) return;
  _emitSkillEvent(state, '全体队友', logCtxOverride);
  if ((state.sharedShieldHp ?? 0) > 0) {
    state.sharedShieldHp      = Math.max(state.sharedShieldHp, shieldAmt);
    state.sharedShieldEndTick = Math.max(state.sharedShieldEndTick ?? 0, shieldEndTick);
  } else {
    state.sharedShieldHp      = shieldAmt;
    state.sharedShieldEndTick = shieldEndTick;
  }
}

// ─── 掩体治疗 ─────────────────────────────────────────────────────────────

/**
 * 标记掩体受到治疗（设置 state.pendingCoverHeal = true）。
 * 若 state._logCtx 存在（handler 路径），自动向战斗日志推入记录；
 * targets 为受治疗掩体所属单位数组（如 Liter S2 的 2 名队友），缺省为全队掩体。
 * battle.js 的 flushCoverHeal 会分派 COVER_HEAL 团队触发。
 * 模拟器仅建模事件，不追踪掩体 HP 数值。
 */
export function applyCoverHeal(state, logCtxOverride = null, targets = null) {
  const label = targets?.length ? `掩体（${targets.map(u => u.name).join('、')}）` : '掩体';
  _emitSkillEvent(state, label, logCtxOverride);
  state.pendingCoverHeal = true;
}

// ─── 持续治疗辅助 ──────────────────────────────────────────────────────────

/**
 * 将持续治疗（HoT）推入 state.pendingHoTs。
 * target 可为单位对象或 ALL_ALLIES 哨兵（内部自动遍历 state.squad）。
 * amount 为每次的基础回复量；durationSecs：持续秒数，每整秒触发一次治疗。
 * caster 为治疗者，记录为条目的 casterId：每次触发时按当时的治疗效能 / 受治疗量计算实际回复量。
 * 若 state._logCtx 存在（handler 路径），自动向战斗日志推入一条合并开始记录。
 */
export function pushHoT(state, target, amount, durationSecs, logCtxOverride = null, caster = null) {
  if (amount <= 0 || durationSecs <= 0) return;
  _emitSkillEvent(state, target === ALL_ALLIES ? '全体队友' : target.name, logCtxOverride);
  const units = target === ALL_ALLIES ? state.squad : [target];
  for (const u of units) {
    for (let i = 1; i <= durationSecs; i++) {
      state.pendingHoTs.push({ fireTick: state.tick + i * TICK_RATE, targetId: u.id, amount,
        casterId: caster?.id ?? null });
    }
  }
}

// ─── 技能伤害 ───────────────────────────────────────────────────────────────

/**
 * 执行一次技能命中，累加 unit.totalDamage。
 * 返回实际造成的伤害量。
 *
 * opts 可选字段：
 *   hitPart                  {'body'|'core'|'parts'|'intercept_parts'}  命中部位（默认 'body'）
 *   coreDmgIncrement         {number}   核心额外加成（仅 hitPart==='core' 时有效）
 *   extraAttackDamagePct     {number}   本次命中独有的 xDmg 加成
 *   isDistributed            {boolean}  使用 distributedDamagePct
 *   extraAtkFlat             {number}   本次命中额外 ATK flat
 *   extraAtkFlatLabel        {string}   extraAtkFlat 在伤害明细中的显示名（缺省为「额外加成」）
 *   preBuffBreakdown         {object[]} 预快照的 buff 明细（见 snapshotBuffBreakdown），替代命中时刻的 buff 列表
 *   projectileExplosion      {boolean}  Projectile Explosion 命中（受 projectileExplosionDamagePct 影响）
 *   affectedByFullBurst      {boolean}  B3 爆裂技能描述为 "as additional damage" 时设置：该命中受全爆裂 +50% 与
 *                                       ENTER_FULL_BURST buff 影响（Rapi: Red Hood、Liberalio、Laplace: Ultimate Hero P3、
 *                                       Sin: Swift Bunny P3；实测例外 Elegg: Boom and Shock；Cinderella P2 走 pendingFireInBurstHits）
 *   suppressFullBurst        {boolean}  [引擎内部] 由引擎自动标记延迟爆裂技能命中，抑制全爆裂补正
 *   applyDistanceAdv         {boolean}  该技能命中受距离优势影响（默认仅普通攻击；Rapi S2 P1/P2 需显式开启）
 *   isSequentialAttack       {boolean}  依次攻击命中（受 sequentialAttackDamagePct buff 加成）
 *   isNormalAttack           {boolean}  技能产生的普通攻击命中（如 Anis: Star 的 Shooting Star）：
 *                                       额外享受 normalAttackDamagePct / normalAttackCritRatePct 加成
 *   burstEnergy              {number}   本次命中附带的爆裂槽充能（如全蓄力附加伤害的每发充能）。
 *                                       在写入 hitLog 前累加，使充能与伤害合并为同一日志行（同普通射击）；
 *                                       不再单独产生「爆裂槽」行。爆裂期间（burstPhase!==0）不充能
 *   burstEnergySource        {string}   burstEnergyLog 中的来源标识（缺省为解析后的 label）
 */
function resolveSkillLabel(unit, label) {
  if (!label || label === 'normal_shot') return label;
  // 匹配 "S1"、"S1 P2"、"S1 P2 L3" 三种格式
  const m = label.match(/^(S1|S2|Burst)( P\d+)?( L\d+)?$/);
  if (!m) return label;
  const slot = m[1];
  const part = m[2] ?? '';
  const line = m[3] ?? '';
  const raw = slot === 'S1' ? unit.rawSkill1
            : slot === 'S2' ? unit.rawSkill2
            : unit.rawBurst;
  return (raw?.name_localkey ?? slot) + part + line;
}

/**
 * 本次命中是否视作「命中零件」（零件伤害加成、PARTS_HIT 触发、IS_PARTS_HIT 条件共用）。
 * 零件核心敌人（Ultra / Material H / Storm Bringer）的核心即零件：核心命中同时算零件命中。
 * @param {{ enemyCoreIsParts?: boolean }} state
 * @param {'body'|'core'|'parts'|'intercept_parts'|undefined} hitPart
 * @returns {boolean}
 */
export function isPartsHit(state, hitPart) {
  return hitPart === 'parts' || (hitPart === 'core' && !!state.enemyCoreIsParts);
}

/**
 * 单位最终 ATK（基础 ATK × (1 + 装备词条 + buff ATK%) + 装备词条固定值 + buff 固定 ATK）。
 * 仅用于技能描述明确写有 "final ATK" 的场合；未写 "final" 时应取基础值 unit.stats.atk。
 * @param {object} state
 * @param {object} unit
 * @returns {number}
 */
export function getFinalAtk(state, unit) {
  const sums = getBuffSums(state, unit.id);
  return unit.stats.atk * (1 + sums.atkPct) + sums.atkFlat;
}

/**
 * 单位最终 MaxHP（基础 MaxHP × (1 + maxHpPct) + maxHpFlat）。
 * 仅用于技能描述明确写有 "final Max HP" 的场合；未写 "final" 时应取基础值 unit.stats.hp。
 * @param {object} state
 * @param {object} unit
 * @returns {number}
 */
export function getFinalMaxHp(state, unit) {
  const sums = getBuffSums(state, unit.id);
  return unit.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
}

/**
 * 按命中属性构造 buff 伤害明细（hitLog.buffBreakdown 条目格式）。
 * 只列出对本次命中实际生效的加成：技能伤害恒为非蓄力，蓄力伤害不列；依次 / 持续 / 真实 / 零件 / 分摊 /
 * 核心等加成仅在命中具备对应属性时列出（与 fireSkillHit 的伤害计算口径一致）。
 * @param {object} state
 * @param {number} unitId
 * @param {object} f  命中属性：charged, isNormalAttack, isCore, isSequentialAttack, sustained, isTrueDamage,
 *                    partsBonus, isDistributed, extraAtkDmg, projectileExplosion, allEnemies（均为 boolean）
 * @returns {object[]}
 */
function buildBuffBreakdown(state, unitId, f) {
  const on = (cond, v) => (cond ? (v ?? 0) : 0);
  const unit = state.squad.find(u => u.id === unitId);
  return state.buffs
    .filter(b => unit ? isBuffActiveFor(state, b, unit)
      : ((b.unitId === null || b.unitId === unitId)
        && !(b.roundsLeft !== undefined && b.roundsLeft <= 0)
        && !(b.endTick !== undefined && b.endTick !== Infinity && b.endTick <= state.tick)))
    .map(b => {
      // 叠层 buff：记录「层数 × 单层值」的实际贡献，与 getBuffSums 聚合口径一致
      const k = b.stacks ?? 1;
      return {
        name: b.name,
        atkFlat: (b.atkFlat ?? 0) * k, atkPct: (b.atkPct ?? 0) * k,
        attackDamagePct: ((b.attackDamagePct ?? 0)
          + on(f.extraAtkDmg, b.projectileAttachmentDamagePct)
          + on(f.projectileExplosion, b.projectileExplosionDamagePct)
          + on(f.isNormalAttack, b.normalAttackDamagePct)
          + on(f.allEnemies, b.allEnemiesBurstDamagePct)) * k,
        sequentialAttackDamagePct: on(f.isSequentialAttack, b.sequentialAttackDamagePct) * k,
        elementAdvantagePct: (b.elementAdvantagePct ?? 0) * k,
        coreDamagePct: on(f.isCore, b.coreDamagePct) * k,
        chargeDamagePct: on(f.charged, b.chargeDamagePct) * k,
        chargeDamageMultPct: on(f.charged, b.chargeDamageMultPct) * k,
        normalAttackDamageMultPct: on(f.isNormalAttack, b.normalAttackDamageMultPct) * k,
        critDamagePct: (b.critDamagePct ?? 0) * k,
        sustainedDamagePct: on(f.sustained, b.sustainedDamagePct) * k,
        trueDamagePct: on(f.isTrueDamage, b.trueDamagePct) * k,
        damageToPartsPct: on(f.partsBonus, b.damageToPartsPct) * k,
        distributedDamagePct: on(f.isDistributed, b.distributedDamagePct) * k,
        stacks: k,
        multiplier: b.multiplier ?? null,
        sourceCaster: b._sourceCaster ?? null,
        sourceSkillLabel: b._sourceSkillLabel ?? null,
        sourcePartIdx: b._sourcePartIdx ?? null,
        sourceLineIdx: b._sourceLineIdx ?? null,
      };
    })
    .filter(b => b.atkFlat || b.atkPct || b.attackDamagePct || b.sequentialAttackDamagePct || b.elementAdvantagePct
      || b.coreDamagePct || b.chargeDamagePct || b.chargeDamageMultPct || b.normalAttackDamageMultPct
      || b.critDamagePct || b.sustainedDamagePct
      || b.trueDamagePct || b.damageToPartsPct || b.distributedDamagePct);
}

// 由 fireSkillHit 的 opts 推出技能命中属性（技能命中恒为非蓄力）
function skillHitFlags(state, unit, label, opts) {
  const hitPart = opts.hitPart ?? (opts.isCore ? 'core' : 'body');
  return {
    charged: false,
    isNormalAttack: opts.isNormalAttack ?? false,
    isCore: hitPart === 'core',
    isSequentialAttack: opts.isSequentialAttack ?? false,
    sustained: opts.sustainedDamage ?? false,
    isTrueDamage: opts.isTrueDamage ?? false,
    partsBonus: isPartsHit(state, hitPart),
    isDistributed: opts.isDistributed ?? false,
    extraAtkDmg: (opts.extraAttackDamagePct ?? 0) > 0,
    projectileExplosion: !!opts.projectileExplosion,
    allEnemies: !!unit && isAllEnemiesBurstHit(unit, label),
  };
}

/**
 * 快照单位当前生效 buff 的伤害明细（hitLog.buffBreakdown 条目格式）。
 * 用于延迟命中：在伤害确定时刻（如 BURST_SKILL_USE）快照，经 opts.preBuffBreakdown 传入 fireSkillHit，
 * 使伤害明细与预捕获的 sums 一致，不混入之后才推入的 buff（如 ENTER_FULL_BURST 效果）。
 * 按该命中的 label / opts 判定生效的加成（与 fireSkillHit 口径一致，如真实伤害列出真实伤害 ▲、不列蓄力伤害）。
 * @param {object} state
 * @param {number} unitId
 * @param {string|null} [label]  原始命中标签（用于判定「全体敌人」爆裂伤害加成）
 * @param {object} [opts]        该命中的 fireSkillHit opts
 * @returns {object[]}
 */
export function snapshotBuffBreakdown(state, unitId, label = null, opts = {}) {
  const unit = state.squad?.find(u => u.id === unitId);
  return buildBuffBreakdown(state, unitId, skillHitFlags(state, unit, label, opts));
}

// 爆裂技能描述按 ■ 拆段，记录各段是否以「Affects all enemies」为目标（按 rawBurst 对象缓存）
const _allEnemiesPartsCache = new WeakMap();
function _allEnemiesBurstParts(rawBurst) {
  if (!rawBurst) return [];
  let parts = _allEnemiesPartsCache.get(rawBurst);
  if (!parts) {
    const desc = String(rawBurst.description_localkey ?? '');
    parts = desc.split('■').slice(1).map(p => /^\s*Affects all enemies\b/i.test(p));
    _allEnemiesPartsCache.set(rawBurst, parts);
  }
  return parts;
}

/**
 * 本次技能命中是否属于「目标说明以『全体敌人』结尾的爆裂技能伤害」（Trina 爆裂 Spread Roots 的作用范围）。
 * 依据命中标签（技能文件传入的原始 label）：须为爆裂槽（'Burst…'）；带 P<n> 时检查该 ■ 段的目标说明，
 * 不带段号时只要爆裂描述中存在「Affects all enemies」段即视为命中该段。
 * @param {object} unit
 * @param {string|null} label  原始命中标签（如 'Burst'、'Burst P2'、'Burst P1 Assalto'）
 * @returns {boolean}
 */
export function isAllEnemiesBurstHit(unit, label) {
  if (typeof label !== 'string' || !label.startsWith('Burst')) return false;
  const parts = _allEnemiesBurstParts(unit.rawBurst);
  const m = label.match(/^Burst P(\d+)/);
  if (m) return parts[Number(m[1]) - 1] === true;
  return parts.some(Boolean);
}

export function fireSkillHit(state, unit, hitMult, sums, label, opts = {}) {
  // B3 施放期间的爆裂技能直接伤害：不即时结算，排入延迟命中队列（fireTick 由 executeSkillTriggers
  // 统一后移到进入全爆裂时刻，§6.2）。默认命中预捕获施放时的 sums 与 buff 明细，不受进入全爆裂后
  // 才推入的 buff 影响；affectedByFullBurst 命中则在进入全爆裂瞬间统一快照 sums（enterFullBurst）。
  if (state._deferB3HitsFor != null && state._deferB3HitsFor === unit.id) {
    const affected = !!opts.affectedByFullBurst;
    state.pendingSkillHits.push({
      fireTick: state.tick, caster: unit, mult: hitMult, label,
      sums: affected ? null : sums,
      opts: affected ? opts
        : { ...opts, preBuffBreakdown: opts.preBuffBreakdown ?? snapshotBuffBreakdown(state, unit.id, label, opts) },
    });
    return 0;
  }
  // 「全体敌人」爆裂技能伤害加成（Spread Roots）：在解析显示名之前按原始标签判定
  const allEnemiesBurstPct = isAllEnemiesBurstHit(unit, label) ? (sums.allEnemiesBurstDamagePct ?? 0) : 0;
  label = resolveSkillLabel(unit, label);
  const charged          = false;
  // normalAttack* 加成仅适用于普通攻击；普通技能伤害不受此加成，isNormalAttack 命中例外
  const isNormalAttack   = opts.isNormalAttack ?? false;
  const normalAtkDmgPct  = isNormalAttack ? (sums.normalAttackDamagePct ?? 0) : 0;
  // 技能产生的普通攻击不吃珍藏品普攻倍率（基数 1），但吃技能 "Normal Attack Damage Multiplier"
  const normalAtkDmgMult = 1 + (isNormalAttack ? (sums.normalAttackDamageMultPct ?? 0) : 0);
  const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRatePct
    + (isNormalAttack ? (sums.normalAttackCritRatePct ?? 0) : 0));
  const isCrit           = rollCrit(effectiveCritRate);
  const hitPart          = opts.hitPart ?? (opts.isCore ? 'core' : 'body');
  const isCore           = hitPart === 'core';
  // 零件核心敌人：命中核心即命中零件，同时受零件伤害加成
  const coreIsParts      = !!state.enemyCoreIsParts;
  const partsBonusApplies = isPartsHit(state, hitPart);
  const coreDmgIncrement = (opts.coreDmgIncrement ?? 0) + (isCore ? (sums.coreDamagePct ?? 0) : 0);
  const extraAtkDmgPct   = opts.extraAttackDamagePct ?? 0;
  const isDistributed    = opts.isDistributed    ?? false;
  const distributedDamagePct = isDistributed ? (sums.distributedDamagePct ?? 0) : 0;
  const extraAtkFlat         = opts.extraAtkFlat ?? 0;
  // Projectile Explosion 伤害：受 projectileExplosionDamagePct 加成（累加至 extraAtkDmgPct）
  const projectileExplosionDamagePct = opts.projectileExplosion ? (sums.projectileExplosionDamagePct ?? 0) : 0;
  const isTrueDamage       = opts.isTrueDamage ?? false;
  const distAdvForHit      = opts.applyDistanceAdv ? unitDistanceAdvantage(unit, state.enemyDistance) : false;
  // B3 爆裂技能伤害一律经延迟命中队列在进入全爆裂后结算（§6.2），
  // 由引擎统一标记 suppressFullBurst:true（affectedByFullBurst 的除外）。
  const isFullBurst = state.fullBurstActive &&
    (opts.affectedByFullBurst || !opts.suppressFullBurst);
  const { damage, breakdown: bd } = calcDamage({
    atk:               unit.stats.atk,
    atkMultiplier:     1 + sums.atkPct,
    otherAtkIncrement: sums.atkFlat + extraAtkFlat,
    enemyDef:          getEffectiveEnemyDef(state),
    hitMultiplier:     hitMult,
    weaponType:        unit.weaponType,
    isCrit,
    critDmgIncrement:  (unit.stats.critDmg ?? 0.50) - 0.50 + sums.critDamagePct,
    hitPart,
    coreDmgIncrement,
    coreIsParts,
    distanceAdvantage: distAdvForHit,
    isFullBurst,
    attackerElement:   resolveAttackerElement(unit, sums, state.enemyElement),
    defenderElement:   state.enemyElement,
    elementAdvantageDmgIncrement: (unit.stats.elementDmgPct ?? 0) + (sums.elementAdvantagePct ?? 0),
    isCharged:         charged,
    fullChargeDamage:  unit.fullChargeDamage,
    chargeDmgStat:     1 + (unit.stats.chargeDmgPct ?? 0) + sums.chargeDamagePct,
    chargeDmgMultPct:  sums.chargeDamageMultPct ?? 0,
    favNormalAttackDamageMult: normalAtkDmgMult,
    isTrueDamage,
    extra:             { attackDamageMult: sums.attackDamagePct + extraAtkDmgPct + projectileExplosionDamagePct + normalAtkDmgPct
                           + allEnemiesBurstPct,
                         sustainedDamagePct: opts.sustainedDamage ? (sums.sustainedDamagePct ?? 0) : 0,
                         trueDamageMult: isTrueDamage ? (sums.trueDamagePct ?? 0) : 0,
                         sequentialAttackDamageMult: opts.isSequentialAttack ? (sums.sequentialAttackDamagePct ?? 0) : 0,
                         damageToPartsMult: sums.damageToPartsPct ?? 0 },
    damageTakenMult:   getEnemyDamageTakenPct(state) + distributedDamagePct,
  });
  unit.totalDamage += damage;
  applyLifeSteal(state, unit, damage, sums);
  if (label) {
    unit.skillDamage        ??= {};
    unit.skillDamageCount   ??= {};
    unit.skillDamage[label]  = (unit.skillDamage[label]  ?? 0) + damage;
    unit.skillDamageCount[label] = (unit.skillDamageCount[label] ?? 0) + 1;
  }
  // ⚠ 必须在 hitLog 记录之前累积：本行 gaugeAfter 已含本次充能，日志「充能列」据此按行计算增量
  if (opts.burstEnergy > 0) {
    accumulateBurstGauge(state, unit.name, opts.burstEnergySource ?? label ?? 'skill', opts.burstEnergy);
  }
  if (state.hitLog) {
    state.hitLog.push({
      _seq: state._logSeq++,
      tick: state.tick, unitId: unit.id, label: label ?? 'skill',
      gaugeAfter: state.burstGauge,
      atk: unit.stats.atk, atkPct: sums.atkPct, atkFlat: sums.atkFlat,
      // 本次命中独有的额外 ATK 加算项（不在 atkFlat 中，由 UI 单列展示）
      extraAtkFlat, extraAtkFlatLabel: opts.extraAtkFlatLabel ?? null,
      hitMult, isCrit, critDmgInc: (unit.stats.critDmg ?? 0.50) - 0.50 + sums.critDamagePct,
      favNormalAttackDamageMult: normalAtkDmgMult,
      attackDamagePct: sums.attackDamagePct + extraAtkDmgPct + projectileExplosionDamagePct + normalAtkDmgPct
        + allEnemiesBurstPct,
      extraAttackDamagePct: extraAtkDmgPct,
      // 攻击属性标记（UI 日志 Buff 列「依次 / 持续 / 真实 / 爆炸 / 分摊」标签）
      isSequentialAttack: opts.isSequentialAttack ?? false,
      isSustained: opts.sustainedDamage ?? false,
      sequentialAttackDamagePct: opts.isSequentialAttack ? (sums.sequentialAttackDamagePct ?? 0) : 0,
      sustainedDamagePct: opts.sustainedDamage ? (sums.sustainedDamagePct ?? 0) : 0,
      trueDamagePct: isTrueDamage ? (sums.trueDamagePct ?? 0) : 0,
      isTrueDamage,
      projectileExplosion: opts.projectileExplosion ?? false,
      projectileExplosionDamagePct,
      affectedByFullBurst: opts.affectedByFullBurst ?? false,
      isFullBurst,
      damageTakenPct: getEnemyDamageTakenPct(state) + distributedDamagePct,
      enemyDef: isTrueDamage ? 0 : getEffectiveEnemyDef(state),
      enemyBaseDef: state.enemyDef,   // 降防前的基础 DEF（公式导出反推降防比例）
      isDistributed, distributedDamagePct,
      isCore, coreDmgIncrement, damage,
      damageToPartsPct: partsBonusApplies ? (sums.damageToPartsPct ?? 0) : 0,
      elementDmgPct: unit.stats.elementDmgPct ?? 0,
      equipElementDmgPct: unit.stats.equipElementDmgPct ?? 0,
      equipChargeDmgPct: unit.stats.chargeDmgPct ?? 0,
      elemMult: bd.elemMult,
      chargeMult: bd.chargeMult,
      distanceAdv: distAdvForHit,
      buffBreakdown: [
        // 技能伤害恒为非蓄力（charged=false），蓄力伤害 / 蓄力伤害倍率不参与计算，明细中不列出
        ...(opts.preBuffBreakdown ?? buildBuffBreakdown(state, unit.id, {
          charged, isNormalAttack, isCore,
          isSequentialAttack: opts.isSequentialAttack ?? false,
          sustained: opts.sustainedDamage ?? false,
          isTrueDamage, partsBonus: partsBonusApplies, isDistributed,
          extraAtkDmg: extraAtkDmgPct > 0, projectileExplosion: projectileExplosionDamagePct > 0,
          allEnemies: allEnemiesBurstPct !== 0,
        })),
        ...getEnemyDebuffBreakdown(state),
      ],
    });
  }
  return damage;
}

// ─── 持续伤害（DoT）池 ──────────────────────────────────────────────────────
//
// state.dots 中每条记录的结构：
//   casterId      {number}   施放者单位 ID
//   label         {string}   伤害标签（用于日志）
//   dotName       {string}   唯一标识符（便于技能查找同名 DoT）
//   multPerStack  {number}   每层每 tick 的命中倍率（如 0.2508 = 25.08% ATK）
//   stacks        {number}   当前层数
//   endTick       {number}   过期 tick（Infinity = 永久，直到手动移除）
//   nextFireTick  {number}   下一次触发伤害的 tick
//   intervalTicks {number}   每次触发间隔的 tick 数（60 = 每秒）
//   sustainedDamage {boolean} 默认 true；false → 普通技能伤害（不受 sustainedDamagePct 加成）
//
export function fireDotPool(state) {
  for (const dot of state.dots) {
    if (dot.nextFireTick > state.tick) continue;
    if (dot.nextFireTick > dot.endTick) continue;
    dot.nextFireTick += dot.intervalTicks;
    const caster = state.squad.find(u => u.id === dot.casterId);
    if (!caster) {
      console.error(`[fireDotPool] dot.casterId=${dot.casterId} 在 squad 中不存在`, { dot, squadIds: state.squad.map(u => u.id) });
      continue;
    }
    const sums = getBuffSums(state, caster.id);
    fireSkillHit(state, caster, dot.multPerStack * dot.stacks, sums, dot.label,
      { sustainedDamage: dot.sustainedDamage !== false });
  }
  state.dots = state.dots.filter(d => d.endTick >= state.tick);
}
