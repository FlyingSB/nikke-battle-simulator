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
  let atkPct = unit?.equipAtkPct ?? 0;
  let atkFlat = 0, defFlat = 0, attackDamagePct = 0, normalAttackDamagePct = 0,
      critRateBonus = 0, critDmgBonus = 0, chargeDamagePct = 0, chargeSpeedPct = 0,
      reloadSpeedPct = 0, lifeStealPct = 0, distributedDamagePct = 0,
      chargeTimeReductionTicks = 0, hitRateBonus = 0, elementAdvantageBonus = 0,
      projectileExplosionDamagePct = 0, coreDamagePct = 0, maxHpPct = 0,
      burstGaugeFlat = 0, pierceDamagePct = 0;
  for (const b of state.buffs) {
    if (b.unitId !== null && b.unitId !== unitId) continue;
    if (b.roundsLeft !== undefined && b.roundsLeft <= 0) continue;
    atkPct                       += b.atkPct                       ?? 0;
    atkFlat                      += b.atkFlat                      ?? 0;
    defFlat                      += b.defFlat                      ?? 0;
    attackDamagePct              += b.attackDamagePct              ?? 0;
    normalAttackDamagePct        += b.normalAttackDamagePct        ?? 0;
    critRateBonus                += b.critRateBonus                ?? 0;
    critDmgBonus                 += b.critDmgBonus                 ?? 0;
    chargeDamagePct              += b.chargeDamagePct              ?? 0;
    chargeSpeedPct               += b.chargeSpeedPct               ?? 0;
    reloadSpeedPct               += b.reloadSpeedPct               ?? 0;
    lifeStealPct                 += b.lifeStealPct                 ?? 0;
    distributedDamagePct         += b.distributedDamagePct         ?? 0;
    chargeTimeReductionTicks     += b.chargeTimeReductionTicks     ?? 0;
    hitRateBonus                 += b.hitRateBonus                 ?? 0;
    elementAdvantageBonus        += b.elementAdvantageBonus        ?? 0;
    projectileExplosionDamagePct += b.projectileExplosionDamagePct ?? 0;
    coreDamagePct                += b.coreDamagePct                ?? 0;
    maxHpPct                     += b.maxHpPct                     ?? 0;
    burstGaugeFlat               += b.burstGaugeFlat               ?? 0;
    pierceDamagePct              += b.pierceDamagePct              ?? 0;
  }
  return { atkPct, atkFlat, defFlat, attackDamagePct, normalAttackDamagePct,
    critRateBonus, critDmgBonus, chargeDamagePct, chargeSpeedPct,
    reloadSpeedPct, lifeStealPct, distributedDamagePct,
    chargeTimeReductionTicks, hitRateBonus, elementAdvantageBonus,
    projectileExplosionDamagePct, coreDamagePct, maxHpPct, burstGaugeFlat,
    pierceDamagePct };
}

// ─── Buff 添加 ─────────────────────────────────────────────────────────────

export function pushBuff(state, buffObj) {
  const existing = state.buffs.find(b => b.name === buffObj.name && b.unitId === buffObj.unitId);
  if (existing) {
    existing.endTick = Math.max(existing.endTick, buffObj.endTick);
    // Round-based buff refresh: reset roundsLeft to max(current, new)
    if (buffObj.endRounds !== undefined)
      existing.roundsLeft = Math.max(existing.roundsLeft ?? 0, buffObj.endRounds);
    return;
  }
  // Initialize roundsLeft from endRounds when first pushed
  const buff = buffObj.endRounds !== undefined && buffObj.roundsLeft === undefined
    ? { ...buffObj, roundsLeft: buffObj.endRounds }
    : buffObj;
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

// ─── 技能伤害 ───────────────────────────────────────────────────────────────

/**
 * 执行一次技能命中，减少 enemyHp，累加 unit.totalDamage。
 * 返回实际造成的伤害量。
 *
 * opts 可选字段：
 *   isCore                   {boolean}  命中核心
 *   coreDmgIncrement         {number}   核心额外加成
 *   extraAttackDamagePct     {number}   本次命中独有的 xDmg 加成
 *   isDistributed            {boolean}  使用 distributedDamagePct
 *   extraAtkFlat             {number}   本次命中额外 ATK flat
 *   projectileExplosion      {boolean}  Projectile Explosion 命中（受 projectileExplosionDamagePct 影响）
 *   fireInFullBurst          {boolean}  Fire In Full Burst 标记（享受全爆裂补正及 ENTER_FULL_BURST 效果）
 *   burstSkillDamage         {boolean}  爆裂技能本体伤害标记；抑制全爆裂补正（50%）
 */
export function fireSkillHit(state, unit, hitMult, sums, isCharged, label, opts = {}) {
  if (state.enemyHp <= 0) return 0;
  const charged          = isCharged !== undefined ? isCharged : ['SR', 'RL'].includes(unit.weaponType);
  const isCrit           = rollCrit(Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRateBonus));
  const isCore           = opts.isCore           ?? false;
  const coreDmgIncrement = (opts.coreDmgIncrement ?? 0) + (isCore ? (sums.coreDamagePct ?? 0) : 0);
  const extraAtkDmgPct   = opts.extraAttackDamagePct ?? 0;
  const isDistributed    = opts.isDistributed    ?? false;
  const distributedBonus = isDistributed ? (sums.distributedDamagePct ?? 0) : 0;
  const extraAtkFlat     = opts.extraAtkFlat     ?? 0;
  // Projectile Explosion 伤害：受 projectileExplosionDamagePct 加成（累加至 extraAtkDmgPct）
  const projExplosionBonus = opts.projectileExplosion ? (sums.projectileExplosionDamagePct ?? 0) : 0;
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
    isFullBurst:       state.fullBurstActive && !opts.burstSkillDamage,
    attackerElement:   unit.element,
    defenderElement:   state.enemyElement,
    elementAdvantageDmgIncrement: (unit.stats.elementDmgPct ?? 0) + (sums.elementAdvantageBonus ?? 0),
    isCharged:         charged,
    fullChargeDamage:  unit.fullChargeDamage ?? 10000,
    chargeDmgStat:     1 + (unit.stats.chargeDmgPct ?? 0) + sums.chargeDamagePct,
    extra:             { attackDamageMult: sums.attackDamagePct + extraAtkDmgPct + projExplosionBonus },
    damageTakenMult:   state.enemyDamageTakenPct + distributedBonus,
  });
  unit.totalDamage += damage;
  state.enemyHp    -= damage;
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
      fireInFullBurst: opts.fireInFullBurst ?? false,
      isFullBurst: state.fullBurstActive,
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
