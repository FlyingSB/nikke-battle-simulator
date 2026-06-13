/**
 * 战斗引擎共享工具。
 * 被 battle.js 和 skill-executor.js 同时引用，避免循环依赖。
 */

import { calcDamage, rollCrit, hasDistanceAdvantage } from './damage.js';

export const TICK_RATE       = 60;         // 每秒 tick 数

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
  'chargeDamagePct', 'chargeSpeedPct', 'reloadSpeedPct',
  'lifeStealPct', 'distributedDamagePct',
  'chargeTimeReductionTicks', 'hitRatePct', 'elementAdvantagePct',
  'projectileAttachmentDamagePct', 'projectileExplosionDamagePct', 'coreDamagePct',
  'maxHpPct', 'maxHpFlat', 'burstGaugeFlat',
  'pierceDamagePct', 'sustainedDamagePct',
  'maxAmmoPct', 'maxAmmoFlat',
  'trueDamagePct', 'atkSpeedPct', 'sequentialAttackDamagePct',
  'damageToPartsPct',
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
  if (unit.ammoLeft > rawMax) unit.ammoLeft = rawMax;
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
  let elementAdvantageVsElectric = false;
  for (const b of state.buffs) {
    if (b.unitId !== null && b.unitId !== unitId) continue;
    if (b.roundsLeft !== undefined && b.roundsLeft <= 0) continue;
    if (b.endTick !== undefined && b.endTick !== Infinity && b.endTick <= state.tick) continue;
    if (b.weaponFilter && unit.weaponType !== b.weaponFilter) continue;
    // 可叠加 buff（stacks > 1）：各字段按层数等比累加
    const k = b.stacks ?? 1;
    for (const f of BUFF_NUMERIC_FIELDS) sums[f] += (b[f] ?? 0) * k;
    if (b.pierce) pierce = true;
    if (b.elementAdvantageVsElectric) elementAdvantageVsElectric = true;
  }
  return { ...sums, pierce, elementAdvantageVsElectric };
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
function _emitBuffEvent(state, buffObj, logCtx) {
  if (!state.pendingSkillEvents) return;
  const targetName = buffObj.unitId === null
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
    return;
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

export function pushBuff(state, buffObj, logCtx = null) {
  const effectiveLogCtx = logCtx ?? state._logCtx ?? null;
  // 规则1：回合制 buff endTick 强制为 Infinity
  if (buffObj.endRounds !== undefined && buffObj.endRounds > 0) {
    buffObj = { ...buffObj, endTick: Infinity };
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

export function addBurstGauge(state, unitName, source, energy) {
  if (state.burstPhase !== 0) return;
  state.burstGauge = Math.min(BURST_GAUGE_MAX, state.burstGauge + energy);
  if (state.burstEnergyLog) {
    state.burstEnergyLog.push({ tick: state.tick, unitName, source, energyAdded: energy, gaugeAfter: state.burstGauge });
  }
  // handler 路径（state._logCtx 存在）时向战斗日志推入充能事件，用于纯充能技能（如 LM S1 P4）
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
 *   projectileExplosion      {boolean}  Projectile Explosion 命中（受 projectileExplosionDamagePct 影响）
 *   affectedByFullBurst      {boolean}  非默认：该命中受全爆裂补正影响（仅 Rapi: Red Hood、Liberellio）
 *   suppressFullBurst        {boolean}  [引擎内部] 由引擎自动标记延迟爆裂技能命中，抑制全爆裂补正
 *   applyDistanceAdv         {boolean}  该技能命中受距离优势影响（默认仅普通攻击；Rapi S2 P1/P2 需显式开启）
 *   isSequentialAttack       {boolean}  依次攻击命中（受 sequentialAttackDamagePct buff 加成）
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

export function fireSkillHit(state, unit, hitMult, sums, label, opts = {}) {
  label = resolveSkillLabel(unit, label);
  const charged          = false;
  // normalAttackCritRatePct 仅适用于普通攻击，技能伤害不受此加成
  const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRatePct);
  const isCrit           = rollCrit(effectiveCritRate);
  const hitPart          = opts.hitPart ?? (opts.isCore ? 'core' : 'body');
  const isCore           = hitPart === 'core';
  const coreDmgIncrement = (opts.coreDmgIncrement ?? 0) + (isCore ? (sums.coreDamagePct ?? 0) : 0);
  const extraAtkDmgPct   = opts.extraAttackDamagePct ?? 0;
  const isDistributed    = opts.isDistributed    ?? false;
  const distributedDamagePct = isDistributed ? (sums.distributedDamagePct ?? 0) : 0;
  const extraAtkFlat         = opts.extraAtkFlat ?? 0;
  // Projectile Explosion 伤害：受 projectileExplosionDamagePct 加成（累加至 extraAtkDmgPct）
  const projectileExplosionDamagePct = opts.projectileExplosion ? (sums.projectileExplosionDamagePct ?? 0) : 0;
  const isTrueDamage       = opts.isTrueDamage ?? false;
  const distanceZoneForHit = opts.applyDistanceAdv ? (state.distanceZone ?? null) : null;
  // B3 爆裂技能施放时 fullBurstActive 尚未置为 true，直接命中自然不受 +50% 补正。
  // 延迟命中（pendingSkillHits）由引擎统一标记 suppressFullBurst:true（affectedByFullBurst 的除外）。
  const isFullBurst = state.fullBurstActive &&
    (opts.affectedByFullBurst || !opts.suppressFullBurst);
  const { damage, breakdown: bd } = calcDamage({
    atk:               unit.stats.atk,
    atkMultiplier:     1 + sums.atkPct,
    otherAtkIncrement: sums.atkFlat + extraAtkFlat,
    enemyDef:          state.enemyDef,
    hitMultiplier:     hitMult,
    weaponType:        unit.weaponType,
    isCrit,
    critDmgIncrement:  (unit.stats.critDmg ?? 0.50) - 0.50 + sums.critDamagePct,
    hitPart,
    coreDmgIncrement,
    distanceZone:      distanceZoneForHit,
    isFullBurst,
    attackerElement:   (sums.elementAdvantageVsElectric && state.enemyElement === 'Electric') ? 'Iron' : unit.element,
    defenderElement:   state.enemyElement,
    elementAdvantageDmgIncrement: (unit.stats.elementDmgPct ?? 0) + (sums.elementAdvantagePct ?? 0),
    isCharged:         charged,
    fullChargeDamage:  unit.fullChargeDamage,
    chargeDmgStat:     1 + (unit.stats.chargeDmgPct ?? 0) + sums.chargeDamagePct,
    isTrueDamage,
    extra:             { attackDamageMult: sums.attackDamagePct + extraAtkDmgPct + projectileExplosionDamagePct,
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
  if (state.hitLog) {
    state.hitLog.push({
      _seq: state._logSeq++,
      tick: state.tick, unitId: unit.id, label: label ?? 'skill',
      gaugeAfter: state.burstGauge,
      atk: unit.stats.atk, atkPct: sums.atkPct, atkFlat: sums.atkFlat,
      hitMult, isCrit, critDmgInc: (unit.stats.critDmg ?? 0.50) - 0.50 + sums.critDamagePct,
      attackDamagePct: sums.attackDamagePct + extraAtkDmgPct + projectileExplosionDamagePct,
      extraAttackDamagePct: extraAtkDmgPct,
      sequentialAttackDamagePct: opts.isSequentialAttack ? (sums.sequentialAttackDamagePct ?? 0) : 0,
      sustainedDamagePct: opts.sustainedDamage ? (sums.sustainedDamagePct ?? 0) : 0,
      trueDamagePct: isTrueDamage ? (sums.trueDamagePct ?? 0) : 0,
      isTrueDamage,
      projectileExplosion: opts.projectileExplosion ?? false,
      projectileExplosionDamagePct,
      affectedByFullBurst: opts.affectedByFullBurst ?? false,
      isFullBurst,
      damageTakenPct: state.enemyDamageTakenPct + getEnemyDamageTakenPct(state) + distributedDamagePct,
      enemyDef: isTrueDamage ? 0 : state.enemyDef,
      isDistributed, distributedDamagePct,
      isCore, coreDmgIncrement, damage,
      elementDmgPct: unit.stats.elementDmgPct ?? 0,
      equipElementDmgPct: unit.stats.equipElementDmgPct ?? 0,
      equipChargeDmgPct: unit.stats.chargeDmgPct ?? 0,
      elemMult: bd.elemMult,
      chargeMult: bd.chargeMult,
      distanceAdv: distanceZoneForHit !== null && hasDistanceAdvantage(unit.weaponType, distanceZoneForHit),
      buffBreakdown: [
        ...(opts.preBuffBreakdown ?? state.buffs
          .filter(b => (b.unitId === null || b.unitId === unit.id)
            && !(b.roundsLeft !== undefined && b.roundsLeft <= 0)
            && !(b.endTick !== undefined && b.endTick !== Infinity && b.endTick <= state.tick))
          .map(b => ({ name: b.name, atkFlat: b.atkFlat ?? 0, atkPct: b.atkPct ?? 0,
            attackDamagePct: (b.attackDamagePct ?? 0)
              + (extraAtkDmgPct > 0 ? (b.projectileAttachmentDamagePct ?? 0) : 0)
              + (projectileExplosionDamagePct > 0 ? (b.projectileExplosionDamagePct ?? 0) : 0),
            sequentialAttackDamagePct: b.sequentialAttackDamagePct ?? 0, elementAdvantagePct: b.elementAdvantagePct ?? 0, coreDamagePct: b.coreDamagePct ?? 0, chargeDamagePct: b.chargeDamagePct ?? 0, sourceCaster: b._sourceCaster ?? null, sourceSkillLabel: b._sourceSkillLabel ?? null, sourcePartIdx: b._sourcePartIdx ?? null, sourceLineIdx: b._sourceLineIdx ?? null }))
          .filter(b => b.atkFlat || b.atkPct || b.attackDamagePct || b.sequentialAttackDamagePct || b.elementAdvantagePct || b.coreDamagePct || b.chargeDamagePct)),
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
