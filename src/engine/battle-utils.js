/**
 * 战斗引擎共享工具。
 * 被 battle.js 和 skill-executor.js 同时引用，避免循环依赖。
 */

import { calcDamage, rollCrit, hasDistanceAdvantage } from './damage.js';

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
    if (b.unitId !== null && b.unitId !== unitId) continue;
    if (b.roundsLeft !== undefined && b.roundsLeft <= 0) continue;
    if (b.endTick !== undefined && b.endTick !== Infinity && b.endTick <= state.tick) continue;
    if (b.weaponFilter && unit.weaponType !== b.weaponFilter) continue;
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
 * 当前引擎假设每发射击全部弹丸命中目标（无脱靶模型）。
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
 *   1. state.buffs 中 unitId === '__enemy__' 的具名条目
 *   2. state.enemyDamageTakenPct 标量（无 buff 条目的技能，如 Asuka:WILLE ATF 叠层）
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
  if (state.enemyDamageTakenPct !== 0) {
    // 无 buff 条目的标量承伤（当前仅 Asuka:WILLE ATF 叠层使用此路径）
    entries.push({
      name:           'ATF叠层',
      damageTakenPct: state.enemyDamageTakenPct,
      isEnemyDebuff:  true,
    });
  }
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
  const buff = { ...buffObj, stacks: buffObj.stacks ?? 1 };
  if (buff.endRounds !== undefined && buff.roundsLeft === undefined)
    buff.roundsLeft = buff.endRounds;
  if (logCtx) {
    buff._sourceCaster     = logCtx.unitName;
    buff._sourceSkillLabel = logCtx.skillLabel;
    buff._sourcePartIdx    = logCtx.partIdx ?? null;
    buff._sourceLineIdx    = logCtx.lineIdx ?? null;
  }
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
  if (Array.isArray(buffObj.unitIds)) {
    const { unitIds, ...rest } = buffObj;
    if (unitIds.length === 0) return;
    let shouldLog = false;
    for (const id of unitIds) {
      const single = { ...rest, unitId: id };
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
 * 对目标单位施加 HP 回复。
 * targetUnit 可为单位对象或 ALL_ALLIES 哨兵（内部遍历 state.squad）。
 * 若 state._logCtx 存在（handler 路径），自动向战斗日志推入合并记录。
 * 调用方负责在回复后分派 HEAL_RECEIVED 触发（skill-executor.executeSkillTriggers）。
 */
export function applyHeal(state, targetUnit, amount, logCtxOverride = null) {
  if (amount <= 0) return;
  if (targetUnit === ALL_ALLIES) {
    _emitSkillEvent(state, '全体队友', logCtxOverride);
    for (const u of state.squad) {
      u.unitHp = Math.min(u.stats.hp, u.unitHp + amount);
      if (Array.isArray(state.pendingHealReceived)) state.pendingHealReceived.push(u);
    }
    return;
  }
  _emitSkillEvent(state, targetUnit.name, logCtxOverride);
  targetUnit.unitHp = Math.min(targetUnit.stats.hp, targetUnit.unitHp + amount);
  if (Array.isArray(state.pendingHealReceived)) state.pendingHealReceived.push(targetUnit);
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
 * 若 state._logCtx 存在（handler 路径），自动向战斗日志推入记录。
 * battle.js 的 flushCoverHeal 会分派 COVER_HEAL 团队触发。
 * 调用方负责传入实际治疗量（模拟器仅建模事件，不追踪掩体 HP 数值）。
 */
export function applyCoverHeal(state, logCtxOverride = null) {
  _emitSkillEvent(state, '掩体', logCtxOverride);
  state.pendingCoverHeal = true;
}

// ─── 持续治疗辅助 ──────────────────────────────────────────────────────────

/**
 * 将持续治疗（HoT）推入 state.pendingHoTs。
 * target 可为单位对象或 ALL_ALLIES 哨兵（内部自动遍历 state.squad）。
 * durationSecs：持续秒数，每整秒触发一次治疗。
 * 若 state._logCtx 存在（handler 路径），自动向战斗日志推入一条合并开始记录。
 */
export function pushHoT(state, target, amount, durationSecs, logCtxOverride = null) {
  if (amount <= 0 || durationSecs <= 0) return;
  _emitSkillEvent(state, target === ALL_ALLIES ? '全体队友' : target.name, logCtxOverride);
  const units = target === ALL_ALLIES ? state.squad : [target];
  for (const u of units) {
    for (let i = 1; i <= durationSecs; i++) {
      state.pendingHoTs.push({ fireTick: state.tick + i * TICK_RATE, targetId: u.id, amount });
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
 *   affectedByFullBurst      {boolean}  非默认：该命中受全爆裂补正影响（仅 Rapi: Red Hood、Liberellio）
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
 * 快照单位当前生效 buff 的伤害明细（hitLog.buffBreakdown 条目格式）。
 * 用于延迟命中：在伤害确定时刻（如 BURST_SKILL_USE）快照，经 opts.preBuffBreakdown 传入 fireSkillHit，
 * 使伤害明细与预捕获的 sums 一致，不混入之后才推入的 buff（如 ENTER_FULL_BURST 效果）。
 * 仅适用于非蓄力、非普通攻击的技能命中（与 fireSkillHit 默认口径一致）。
 * @param {object} state
 * @param {number} unitId
 * @returns {object[]}
 */
export function snapshotBuffBreakdown(state, unitId) {
  return state.buffs
    .filter(b => (b.unitId === null || b.unitId === unitId)
      && !(b.roundsLeft !== undefined && b.roundsLeft <= 0)
      && !(b.endTick !== undefined && b.endTick !== Infinity && b.endTick <= state.tick))
    .map(b => {
      // 叠层 buff：记录「层数 × 单层值」的实际贡献，与 getBuffSums 聚合口径一致
      const k = b.stacks ?? 1;
      return {
        name: b.name,
        atkFlat: (b.atkFlat ?? 0) * k, atkPct: (b.atkPct ?? 0) * k,
        attackDamagePct: (b.attackDamagePct ?? 0) * k,
        sequentialAttackDamagePct: (b.sequentialAttackDamagePct ?? 0) * k,
        elementAdvantagePct: (b.elementAdvantagePct ?? 0) * k,
        coreDamagePct: (b.coreDamagePct ?? 0) * k,
        chargeDamagePct: (b.chargeDamagePct ?? 0) * k,
        critDamagePct: (b.critDamagePct ?? 0) * k,
        stacks: k,
        multiplier: b.multiplier ?? null,
        sourceCaster: b._sourceCaster ?? null,
        sourceSkillLabel: b._sourceSkillLabel ?? null,
        sourcePartIdx: b._sourcePartIdx ?? null,
        sourceLineIdx: b._sourceLineIdx ?? null,
      };
    })
    .filter(b => b.atkFlat || b.atkPct || b.attackDamagePct || b.sequentialAttackDamagePct || b.elementAdvantagePct || b.coreDamagePct || b.chargeDamagePct || b.critDamagePct);
}

export function fireSkillHit(state, unit, hitMult, sums, label, opts = {}) {
  label = resolveSkillLabel(unit, label);
  const charged          = false;
  // normalAttack* 加成仅适用于普通攻击；普通技能伤害不受此加成，isNormalAttack 命中例外
  const isNormalAttack   = opts.isNormalAttack ?? false;
  const normalAtkDmgPct  = isNormalAttack ? (sums.normalAttackDamagePct ?? 0) : 0;
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
  // B3 爆裂技能施放时 fullBurstActive 尚未置为 true，直接命中自然不受 +50% 补正。
  // 延迟命中（pendingSkillHits）由引擎统一标记 suppressFullBurst:true（affectedByFullBurst 的除外）。
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
    isTrueDamage,
    extra:             { attackDamageMult: sums.attackDamagePct + extraAtkDmgPct + projectileExplosionDamagePct + normalAtkDmgPct,
                         sustainedDamagePct: opts.sustainedDamage ? (sums.sustainedDamagePct ?? 0) : 0,
                         trueDamageMult: isTrueDamage ? (sums.trueDamagePct ?? 0) : 0,
                         sequentialAttackDamageMult: opts.isSequentialAttack ? (sums.sequentialAttackDamagePct ?? 0) : 0,
                         damageToPartsMult: sums.damageToPartsPct ?? 0 },
    damageTakenMult:   state.enemyDamageTakenPct + getEnemyDamageTakenPct(state) + distributedDamagePct,
  });
  unit.totalDamage += damage;
  if (sums.lifeStealPct > 0) {
    unit.unitHp = Math.min(unit.stats.hp, unit.unitHp + damage * sums.lifeStealPct);
  }
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
      attackDamagePct: sums.attackDamagePct + extraAtkDmgPct + projectileExplosionDamagePct + normalAtkDmgPct,
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
      damageTakenPct: state.enemyDamageTakenPct + getEnemyDamageTakenPct(state) + distributedDamagePct,
      enemyDef: isTrueDamage ? 0 : getEffectiveEnemyDef(state),
      isDistributed, distributedDamagePct,
      isCore, coreDmgIncrement, damage,
      elementDmgPct: unit.stats.elementDmgPct ?? 0,
      equipElementDmgPct: unit.stats.equipElementDmgPct ?? 0,
      equipChargeDmgPct: unit.stats.chargeDmgPct ?? 0,
      elemMult: bd.elemMult,
      chargeMult: bd.chargeMult,
      distanceAdv: distAdvForHit,
      buffBreakdown: [
        ...(opts.preBuffBreakdown ?? state.buffs
          .filter(b => (b.unitId === null || b.unitId === unit.id)
            && !(b.roundsLeft !== undefined && b.roundsLeft <= 0)
            && !(b.endTick !== undefined && b.endTick !== Infinity && b.endTick <= state.tick))
          .map(b => {
            // 叠层 buff：分解条目记录「层数 × 单层值」的实际贡献，与 getBuffSums 聚合口径一致
            const k = b.stacks ?? 1;
            return { name: b.name, atkFlat: (b.atkFlat ?? 0) * k, atkPct: (b.atkPct ?? 0) * k,
              attackDamagePct: ((b.attackDamagePct ?? 0)
                + (extraAtkDmgPct > 0 ? (b.projectileAttachmentDamagePct ?? 0) : 0)
                + (projectileExplosionDamagePct > 0 ? (b.projectileExplosionDamagePct ?? 0) : 0)
                + (isNormalAttack ? (b.normalAttackDamagePct ?? 0) : 0)) * k,
              // 技能伤害恒为非蓄力（charged=false），蓄力伤害 / 蓄力伤害倍率不参与计算，明细中不列出
              sequentialAttackDamagePct: (b.sequentialAttackDamagePct ?? 0) * k, elementAdvantagePct: (b.elementAdvantagePct ?? 0) * k, coreDamagePct: (b.coreDamagePct ?? 0) * k,
              chargeDamagePct: charged ? (b.chargeDamagePct ?? 0) * k : 0,
              chargeDamageMultPct: charged ? (b.chargeDamageMultPct ?? 0) * k : 0,
              critDamagePct: (b.critDamagePct ?? 0) * k,
              sustainedDamagePct: opts.sustainedDamage ? ((b.sustainedDamagePct ?? 0) * k) : 0,
              trueDamagePct: isTrueDamage ? (b.trueDamagePct ?? 0) * k : 0,
              damageToPartsPct: partsBonusApplies ? (b.damageToPartsPct ?? 0) * k : 0,
              distributedDamagePct: isDistributed ? (b.distributedDamagePct ?? 0) * k : 0,
              stacks: k, multiplier: b.multiplier ?? null,
              sourceCaster: b._sourceCaster ?? null, sourceSkillLabel: b._sourceSkillLabel ?? null, sourcePartIdx: b._sourcePartIdx ?? null, sourceLineIdx: b._sourceLineIdx ?? null };
          })
          .filter(b => b.atkFlat || b.atkPct || b.attackDamagePct || b.sequentialAttackDamagePct || b.elementAdvantagePct || b.coreDamagePct || b.chargeDamagePct || b.chargeDamageMultPct || b.critDamagePct || b.sustainedDamagePct || b.trueDamagePct || b.damageToPartsPct || b.distributedDamagePct)),
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
