/**
 * 战斗引擎共享工具。
 * 被 battle.js 和 skill-executor.js 同时引用，避免循环依赖。
 */

import { calcDamage, rollCrit } from './damage.js';

export const TICK_RATE       = 60;         // 每秒 tick 数
export const BURST_GAUGE_MAX = 1_000_000;  // 共享爆裂槽上限

// ─── Buff 汇总 ──────────────────────────────────────────────────────────────

export function getBuffSums(state, unitId) {
  const unit = state.squad.find(u => u.id === unitId);
  if (!unit) {
    const err = `[getBuffSums] unitId=${unitId} 在 squad 中不存在`;
    console.error(err, { unitId, squadIds: state.squad.map(u => u.id) });
    throw new Error(err);
  }
  let atkPct  = unit.equipAtkPct  ?? 0;
  let atkFlat = unit.equipAtkFlat ?? 0, defFlat = 0, defPct = 0, attackDamagePct = 0,
      normalAttackDamagePct = 0, critRateBonus = 0, normalAttackCritRateBonus = 0, critDmgBonus = 0, chargeDamagePct = 0,
      chargeSpeedPct = 0, reloadSpeedPct = 0, lifeStealPct = 0, distributedDamagePct = 0,
      chargeTimeReductionTicks = 0, hitRateBonus = 0, elementAdvantageBonus = 0,
      projectileExplosionDamagePct = 0, coreDamagePct = 0, maxHpPct = 0, maxHpFlat = 0,
      burstGaugeFlat = 0, pierceDamagePct = 0, sustainedDamagePct = 0, maxAmmoFlat = 0,
      trueDamagePct = 0, atkSpeedPct = 0;
  for (const b of state.buffs) {
    if (b.unitId !== null && b.unitId !== unitId) continue;
    if (b.roundsLeft !== undefined && b.roundsLeft <= 0) continue;
    // 可叠加 buff（stacks > 1）：各字段按层数等比累加
    const k = b.stacks ?? 1;
    atkPct                       += (b.atkPct                       ?? 0) * k;
    atkFlat                      += (b.atkFlat                      ?? 0) * k;
    defFlat                      += (b.defFlat                      ?? 0) * k;
    defPct                       += (b.defPct                       ?? 0) * k;
    attackDamagePct              += (b.attackDamagePct              ?? 0) * k;
    normalAttackDamagePct        += (b.normalAttackDamagePct        ?? 0) * k;
    critRateBonus                += (b.critRateBonus                ?? 0) * k;
    normalAttackCritRateBonus    += (b.normalAttackCritRateBonus    ?? 0) * k;
    critDmgBonus                 += (b.critDmgBonus                 ?? 0) * k;
    chargeDamagePct              += (b.chargeDamagePct              ?? 0) * k;
    chargeSpeedPct               += (b.chargeSpeedPct               ?? 0) * k;
    reloadSpeedPct               += (b.reloadSpeedPct               ?? 0) * k;
    lifeStealPct                 += (b.lifeStealPct                 ?? 0) * k;
    distributedDamagePct         += (b.distributedDamagePct         ?? 0) * k;
    chargeTimeReductionTicks     += (b.chargeTimeReductionTicks     ?? 0) * k;
    hitRateBonus                 += (b.hitRateBonus                 ?? 0) * k;
    elementAdvantageBonus        += (b.elementAdvantageBonus        ?? 0) * k;
    projectileExplosionDamagePct += (b.projectileExplosionDamagePct ?? 0) * k;
    coreDamagePct                += (b.coreDamagePct                ?? 0) * k;
    maxHpPct                     += (b.maxHpPct                     ?? 0) * k;
    maxHpFlat                    += (b.maxHpFlat                    ?? 0) * k;
    burstGaugeFlat               += (b.burstGaugeFlat               ?? 0) * k;
    pierceDamagePct              += (b.pierceDamagePct              ?? 0) * k;
    sustainedDamagePct           += (b.sustainedDamagePct           ?? 0) * k;
    maxAmmoFlat                  += (b.maxAmmoFlat                  ?? 0) * k;
    trueDamagePct                += (b.trueDamagePct                ?? 0) * k;
    atkSpeedPct                  += (b.atkSpeedPct                  ?? 0) * k;
  }
  return { atkPct, atkFlat, defFlat, defPct, attackDamagePct, normalAttackDamagePct,
    critRateBonus, normalAttackCritRateBonus, critDmgBonus, chargeDamagePct, chargeSpeedPct,
    reloadSpeedPct, lifeStealPct, distributedDamagePct,
    chargeTimeReductionTicks, hitRateBonus, elementAdvantageBonus,
    projectileExplosionDamagePct, coreDamagePct, maxHpPct, maxHpFlat, burstGaugeFlat,
    pierceDamagePct, sustainedDamagePct, maxAmmoFlat, trueDamagePct, atkSpeedPct };
}

// ─── Buff 添加 ─────────────────────────────────────────────────────────────

export function pushBuff(state, buffObj) {
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
    return;
  }
  // 初次推入：设置 roundsLeft（回合制）和 stacks（初始层数为 1）
  const buff = { ...buffObj, stacks: buffObj.stacks ?? 1 };
  if (buff.endRounds !== undefined && buff.roundsLeft === undefined)
    buff.roundsLeft = buff.endRounds;
  state.buffs.push(buff);
  if (state.buffLog) {
    state.buffLog.push({ type: 'buff_gain', tick: state.tick, name: buff.name, unitId: buff.unitId, endTick: buff.endTick,
      atkPct:               buff.atkPct               ?? 0,
      atkFlat:              buff.atkFlat              ?? 0,
      attackDamagePct:      buff.attackDamagePct      ?? 0,
      critRateBonus:        buff.critRateBonus        ?? 0,
      critDmgBonus:         buff.critDmgBonus         ?? 0,
      chargeDamagePct:      buff.chargeDamagePct      ?? 0,
      chargeSpeedPct:       buff.chargeSpeedPct       ?? 0,
      reloadSpeedPct:            buff.reloadSpeedPct            ?? 0,
      distributedDamagePct:      buff.distributedDamagePct      ?? 0,
      maxAmmoPct:                buff.maxAmmoPct                ?? 0,
      chargeTimeReductionTicks:  buff.chargeTimeReductionTicks  ?? 0,
      hitRateBonus:              buff.hitRateBonus              ?? 0,
      coreDamagePct:             buff.coreDamagePct             ?? 0,
    });
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
}

// ─── HP 回复 ────────────────────────────────────────────────────────────────

/**
 * 对目标单位施加 HP 回复。
 * 调用方负责在回复后分派 HEAL_RECEIVED 触发（skill-executor.executeSkillTriggers）。
 */
export function applyHeal(state, targetUnit, amount) {
  if (amount <= 0) return;
  targetUnit.unitHp = Math.min(targetUnit.stats.hp, targetUnit.unitHp + amount);
  if (Array.isArray(state.pendingHealReceived)) state.pendingHealReceived.push(targetUnit);
}

// ─── 护盾 ──────────────────────────────────────────────────────────────────

/**
 * 对目标单位施加护盾，并将该单位推入 state.pendingShieldReceived 队列。
 * battle.js 在每次可能触发护盾的操作后调用 flushShieldReceived，
 * 逐单位分派 APPLY_SHIELD 触发（技能触发条件为"自身护盾生效时"，
 * 与 HEAL_RECEIVED 语义一致：谁收到护盾，谁的单位 id 作为 ctx.unit）。
 * 刷新语义：已有护盾时取两者较大值（量与到期 tick 均取 max）。
 */
export function applyShield(state, unit, shieldAmt, shieldEndTick) {
  if (shieldAmt <= 0) return;
  if (unit.shieldHp > 0) {
    unit.shieldHp      = Math.max(unit.shieldHp, shieldAmt);
    unit.shieldEndTick = Math.max(unit.shieldEndTick, shieldEndTick);
  } else {
    unit.shieldHp      = shieldAmt;
    unit.shieldEndTick = shieldEndTick;
  }
  if (Array.isArray(state.pendingShieldReceived)) state.pendingShieldReceived.push(unit);
}

// ─── 掩体治疗 ─────────────────────────────────────────────────────────────

/**
 * 标记掩体受到治疗（设置 state.pendingCoverHeal = true）。
 * battle.js 的 flushCoverHeal 会分派 COVER_HEAL 团队触发。
 * 调用方负责传入实际治疗量（模拟器仅建模事件，不追踪掩体 HP 数值）。
 */
export function applyCoverHeal(state) {
  state.pendingCoverHeal = true;
}

// ─── 技能伤害 ───────────────────────────────────────────────────────────────

/**
 * 执行一次技能命中，累加 unit.totalDamage。
 * 返回实际造成的伤害量。
 *
 * opts 可选字段：
 *   isCore                   {boolean}  命中核心
 *   coreDmgIncrement         {number}   核心额外加成
 *   extraAttackDamagePct     {number}   本次命中独有的 xDmg 加成
 *   isDistributed            {boolean}  使用 distributedDamagePct
 *   extraAtkFlat             {number}   本次命中额外 ATK flat
 *   projectileExplosion      {boolean}  Projectile Explosion 命中（受 projectileExplosionDamagePct 影响）
 *   affectedByFullBurst      {boolean}  非默认：该命中受全爆裂补正影响（仅 Rapi: Red Hood、Liberellio）
 *   suppressFullBurst        {boolean}  [引擎内部] 由引擎自动标记延迟爆裂技能命中，抑制全爆裂补正
 */
function resolveSkillLabel(unit, label) {
  if (!label || label === 'normal_shot') return label;
  const m = label.match(/^(S1|S2|Burst)( P\d+)?$/);
  if (!m) return label;
  const slot = m[1];
  const part = m[2] ?? '';
  const raw = slot === 'S1' ? unit.rawSkill1
            : slot === 'S2' ? unit.rawSkill2
            : unit.rawBurst;
  return (raw?.name_localkey ?? slot) + part;
}

export function fireSkillHit(state, unit, hitMult, sums, isCharged, label, opts = {}) {
  label = resolveSkillLabel(unit, label);
  const charged          = isCharged !== undefined ? isCharged : ['SR', 'RL'].includes(unit.weaponType);
  // normalAttackCritRateBonus 仅适用于普通攻击，技能伤害不受此加成
  const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRateBonus);
  const isCrit           = rollCrit(effectiveCritRate);
  const isCore           = opts.isCore           ?? false;
  const coreDmgIncrement = (opts.coreDmgIncrement ?? 0) + (isCore ? (sums.coreDamagePct ?? 0) : 0);
  const extraAtkDmgPct   = opts.extraAttackDamagePct ?? 0;
  const isDistributed    = opts.isDistributed    ?? false;
  const distributedBonus = isDistributed ? (sums.distributedDamagePct ?? 0) : 0;
  const extraAtkFlat     = opts.extraAtkFlat     ?? 0;
  // Projectile Explosion 伤害：受 projectileExplosionDamagePct 加成（累加至 extraAtkDmgPct）
  const projExplosionBonus = opts.projectileExplosion ? (sums.projectileExplosionDamagePct ?? 0) : 0;
  const isTrueDamage       = opts.isTrueDamage ?? false;
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
    critDmgIncrement:  (unit.stats.critDmg ?? 0.50) - 0.50 + sums.critDmgBonus,
    isCore,
    coreDmgIncrement,
    isFullBurst,
    attackerElement:   unit.element,
    defenderElement:   state.enemyElement,
    elementAdvantageDmgIncrement: (unit.stats.elementDmgPct ?? 0) + (sums.elementAdvantageBonus ?? 0),
    isCharged:         charged,
    fullChargeDamage:  unit.fullChargeDamage,
    chargeDmgStat:     1 + (unit.stats.chargeDmgPct ?? 0) + sums.chargeDamagePct,
    isTrueDamage,
    extra:             { attackDamageMult: sums.attackDamagePct + extraAtkDmgPct + projExplosionBonus,
                         sustainedDamagePct: opts.sustainedDamage ? (sums.sustainedDamagePct ?? 0) : 0,
                         trueDamageMult: isTrueDamage ? (sums.trueDamagePct ?? 0) : 0 },
    damageTakenMult:   state.enemyDamageTakenPct + distributedBonus,
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
      tick: state.tick, unitId: unit.id, label: label ?? 'skill',
      atk: unit.stats.atk, atkPct: sums.atkPct, atkFlat: sums.atkFlat,
      hitMult, isCrit, critDmgInc: (unit.stats.critDmg ?? 0.50) - 0.50,
      attackDamagePct: sums.attackDamagePct + extraAtkDmgPct + projExplosionBonus,
      extraAttackDamagePct: extraAtkDmgPct,
      projectileExplosion: opts.projectileExplosion ?? false,
      projectileExplosionBonus: projExplosionBonus,
      affectedByFullBurst: opts.affectedByFullBurst ?? false,
      isFullBurst,
      damageTakenPct: state.enemyDamageTakenPct + distributedBonus, enemyDef: state.enemyDef,
      isDistributed, distributedBonus,
      isCore, coreDmgIncrement, damage,
      elementDmgPct: unit.stats.elementDmgPct ?? 0,
      elemMult: bd.elemMult,
      chargeMult: bd.chargeMult,
      distanceAdv: false,
      buffBreakdown: state.buffs
        .filter(b => b.unitId === null || b.unitId === unit.id)
        .map(b => ({ name: b.name, atkFlat: b.atkFlat ?? 0, atkPct: b.atkPct ?? 0, attackDamagePct: b.attackDamagePct ?? 0 }))
        .filter(b => b.atkFlat || b.atkPct || b.attackDamagePct),
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
    fireSkillHit(state, caster, dot.multPerStack * dot.stacks, sums, false, dot.label,
      { sustainedDamage: dot.sustainedDamage !== false });
  }
  state.dots = state.dots.filter(d => d.endTick >= state.tick);
}
