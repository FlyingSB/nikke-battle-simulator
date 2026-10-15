/**
 * 战斗模拟引擎。
 *
 * 以离散 tick 模拟基于时间的战斗。
 * 每 tick = 1/60 秒（60fps 模拟）。
 *
 * 流程：
 *   initBattle(config) → BattleState
 *   while (!isOver):
 *     tick(state) → events[]
 *   getResults(state) → BattleResult
 *
 */

import { calcDamage, rollCrit } from './damage.js';
import { rng, setRng } from './rng.js';
import { computeFinalStats } from './stats.js';
import { WEAPON_AMMO, WEAPON_HIT_MULT, ZONE_TO_DISTANCE, CORE0_DEFAULT, D0_DEFAULT, HITRATE_CORE_COEF_DEFAULT,
         SG_PELLET_HIT_RATE_DEFAULT, DUAL_GUN_MULT } from './constants.js';
import { parseAccuracyProfile, initAccuracyState, rampAccuracyOnShot, recoverAccuracy, coreHitChance } from './accuracy.js';
import { getFavItemSkillEffects, getSsrFavSkills, getSkillValue } from '../data/models.js';
import { getCharacterTraits } from '../data/skill-traits.js';
import { getBuffSums, pushBuff, addBurstGauge, applyHeal, applyLifeSteal, clampHpToMax, markMaxHpChange, expireOverheal, getFinalMaxHp, applyShield, fireSkillHit, snapshotBuffBreakdown, snapshotEnemyDebuffs, fireDotPool, decrementRoundBuffs, getEnemyDamageTakenPct, getEnemyDebuffBreakdown, getEffectiveEnemyDef, initUnitMaxAmmo, recalcMaxAmmo, isWeaponSwitchAmmoFixed, unitDistanceAdvantage, resolveAttackerElement, isPartsHit, shotPelletCount, rollHitPellets, rollPelletGroups, rlCoreHitRate, isEnemyHittable, logMissedSkillHit, sgPelletHitRate, isBuffActiveFor, sumBuffField } from './battle-utils.js';
import { executeSkillTriggers, dispatchHpChanged, onShotFired, onIntervalInBurst, onInterval, onReloadEnd, fireShotCountTriggers, fireDuringFullChargeTriggers } from './skill-executor.js';

export const TICK_RATE = 60; // 每秒 tick 数
const MAX_TICKS = TICK_RATE * 180; // 战斗上限 3 分钟

// 每帧（tick）最多一次普通攻击：游戏客户端按帧结算射击，60fps 上限下每秒最多 60 发。
// MG 顶速 4200 RPM（70 发/s）超过此上限，实际只能打出 60 发/s。
// 实测校准（2026-10-09）：Rapi: Red Hood 913 发弹匣在换弹几乎瞬时（Crown 爆裂换弹速度）时
// 仍需 ≈16s 打空（≈57–60 发/s），而非 70 发/s 对应的 13s；全场 3 分钟普攻 9101 次，
// 封顶前引擎跑出 10807 次。2025-04 客户端加入「修正最小发射次数」后，低帧率设备按 60fps
// 基准补发，故射速上限即 60 发/s，与设备实际帧率无关。
const MAX_SHOTS_PER_TICK = 1;

// 爆裂阶段延迟上限（秒）：自动战斗中槽满→B1、B1→B2、B2→B3 各延迟 0.4s（2026-10-09 实测），
// 手动操作只会更快，故 0.4s 既是默认值也是上限。
export const BURST_STEP_SECS_MAX = 0.4;

// B3 施放到进入全爆裂状态的固定延迟（2026-10-12 实测 0.05s，更正此前记录的 0.4s / 0.1s；
// 无法通过操作缩短，不随 burstStepSecs 变化）。
const FULL_BURST_ENTRY_DELAY_TICKS = Math.round(TICK_RATE * 0.05);


// ─── 武器射速（每 tick 的开火概率） ────────────────────
const ATTACK_SPEED = {
  AR:  0.10,   // ~6 发/秒
  SMG: 0.165,  // ~10 发/秒
  SR:  0.025,  // ~1.5 发/秒
  MG:  0.135,  // ~8 发/秒（通用 MG；Crown 会用逐发起速模型覆盖）
  SG:  0.05,   // ~3 发/秒
  RL:  0.025,  // ~1.5 发/秒
};

// 默认装填时长（tick）。可通过 config.reloadTicks 按单位覆盖。
const RELOAD_TICKS_DEFAULT = {
  AR:  120, // 2 秒
  SMG: 120,
  SR:   90, // 1.5 秒
  MG:  180, // 3 秒
  SG:  150, // 2.5 秒
  RL:  180, // 3 秒
};

// 爆裂槽能量系统 — 全队共享同一个能量计数器（0..BURST_GAUGE_MAX）。
// 每发的单位能量来自 CDN shot_detail.target_burst_energy_pershot（原值，不缩放）。
// SG 武器：每发弹丸独立充能 → 本次射击 = target_burst_energy_pershot × shotCount（弹丸数）。
// 蓄力武器（SR/RL）：非Focus 充能 = target（无倍率，实测确认）；
//   仅 Focus（受控）蓄力角色 = target × (fullChargeBurstEnergy / 10000)。
// 共享槽达到上限后 burst_i 触发；所有写入均通过 addBurstGauge() → state.burstGauge。
const BURST_GAUGE_MAX = 1_000_000;

/**
 * 返回指定 tick 生效的 zone。
 * phases 必须按 startTick 升序排列。
 * @param {{ startTick: number, zone: string }[]} phases
 * @param {number} tick
 * @returns {string}
 */
/**
 * 全队停火的敌人区段：HIDDEN（完全不可攻击）与 JUMP（「跳起」行动的起跳段，敌人仍可被已打出的技能命中）。
 * @param {number|string|null} zone
 * @returns {boolean}
 */
function isHoldFireZone(zone) {
  return zone === 'HIDDEN' || zone === 'JUMP';
}

/**
 * 本 tick 是否禁止施放爆裂技能（B1 / B2 / B3）。
 * 自动战斗实测：敌人跳起 / 隐藏（停火区段）期间不会自动施放爆裂，落地后才继续爆裂序列
 * （Raven 队 BIGARMS 实测：起跳 2483f、落地 2592f，全爆裂动画 2628f 才开始）。
 * 模拟选项「在敌人隐藏时继续开爆裂」（config.burstDuringHidden）勾选时不做限制。
 * 仅拦截施放；槽满进入阶段 1 与各阶段 10s 超时照常计时。
 * @param {object} state
 * @returns {boolean}
 */
function isBurstCastBlocked(state) {
  return !state.burstDuringHidden && isHoldFireZone(state.currentPhaseZone);
}

function getPhaseAtTick(phases, tick) {
  for (let i = phases.length - 1; i >= 0; i--) {
    if (tick >= phases[i].startTick) return phases[i].zone;
  }
  return phases[0]?.zone ?? 'NEAR';
}

/**
 * 相位值 → 连续距离（0..100）。
 * 数字直接用；离散标签 NEAR/MID/FAR 按默认映射；HIDDEN/CANNOT_BE_AIMED 及未知 → null（不可瞄准/无优势）。
 * @param {number|string|null} v
 * @returns {number|null}
 */
function phaseToDistance(v) {
  if (typeof v === 'number') return v;
  if (v == null) return null;
  return ZONE_TO_DISTANCE[v] ?? null;
}

/**
 * Alice「Wonderland」快速攻击发间。
 * Wonderland 生效期间 Alice 蓄速接近满，蓄力武器以 40 发/10s（每 15 ticks）连发并规避前后摇。
 * 满足条件时返回快速攻击发间（ticks），否则返回 null（调用方回退到正常蓄力周期）。
 * 仅 Alice 设置 aliceWonderlandEndTick，其余单位恒返回 null。
 *
 * 修复①（边界泄漏）：若下一发会越过 Wonderland 结束 tick，则不再快速攻击——
 * 否则那一发会落在 burst_end 之后的 phase-0 充能阶段，却拿满额蓄力充能，导致充能虚高。
 * @param {object} state
 * @param {object} unit
 * @param {number} effectiveCharge 当前蓄速折减后的有效蓄力 ticks
 * @returns {number|null}
 */
function aliceFastAttackNextTicks(state, unit, effectiveCharge) {
  const end = unit.skillState?.aliceWonderlandEndTick ?? 0;
  if (end < state.tick) return null;
  // 蓄力段（% + flat 减少后）≤ 99.52% 蓄速等价 ticks 时才进入快速攻击
  const threshold = Math.round(unit.chargeTimeTicks * (1 - 0.9952));
  if (effectiveCharge > threshold) return null;
  const ticks = FAST_ATTACK_SHOT_TICKS;
  if (state.tick + ticks > end) return null;  // 下一发越过 Wonderland 窗口 → 回退正常蓄力
  return ticks;
}

// Alice Wonderland 快速攻击发间：40 发/10s（每 15 ticks），规避前后摇。
const FAST_ATTACK_SHOT_TICKS = Math.round(TICK_RATE * 10 / 40);
// 速充攻击：蓄力 13 帧 + 空闲 2 帧（发间 15 帧，同 Alice 快速攻击节奏），规避前后摇。
const QUICK_CHARGE_TICKS      = 13;
const QUICK_CHARGE_IDLE_TICKS = 2;
const QUICK_CHARGE_SHOT_TICKS = QUICK_CHARGE_TICKS + QUICK_CHARGE_IDLE_TICKS;

/**
 * 是否武器切换期间（切换武器自带蓄力规则，速充不适用）。
 * @param {object} state
 * @param {object} unit
 * @returns {boolean}
 */
function isWeaponSwitchActive(state, unit) {
  const end = unit.skillState?.weaponSwitchEndTick ?? 0;
  return end > 0 && state.tick <= end;
}

/**
 * 「速充」手动打法（Focus 的 UP 型 SR/RL，见 config.quickChargeMode）：下一发是否打速充攻击。
 * 速充攻击按 Alice 快速攻击节奏（蓄力 13 帧 + 空闲 2 帧、规避前后摇）连发短蓄力攻击。仍算蓄力攻击，
 * 蓄力比例 r = min(1, 13 / 当前有效蓄力帧数)：蓄力伤害倍率与 Focus 全蓄力充能倍率按 r 线性插值，
 * r < 1 时不触发全蓄力类效果——以发数换取更快的爆裂充能。
 *   always    — 始终速充（全爆裂结束前的全蓄力收尾除外）
 *   untilFull — 仅爆裂槽充能阶段（burstPhase 0）速充；槽满后（爆裂阶段 / 全爆裂期间）恢复全蓄力攻击
 * 全爆裂收尾（qcFinisherPending，见 maybeStartQuickChargeFinisher）期间一律全蓄力。
 * @param {object} state
 * @param {object} unit
 * @returns {boolean}
 */
function quickChargeWanted(state, unit) {
  if (!unit.quickChargeMode || unit.qcFinisherPending) return false;
  if (isWeaponSwitchActive(state, unit)) return false;
  if (unit.quickChargeMode === 'untilFull' && state.burstPhase !== 0) return false;
  return true;
}

/**
 * DOWN_Charge 型发射间隔下限（tick）：武器 rate_of_fire RPM → 3600/RPM。
 * 蓄速把蓄力压至近零时（如 Cinderella S1 P2 +100% 蓄速 → effectiveCharge≈1t），
 * 持续按住的连发节奏仍受武器 RPM 约束，不可能一 tick 一发。
 * 实测校准（2026-07-17）：Cinderella 180 RPM → 20t 发间，开场 33s 攻击 88 次
 * （54 弹匣、1 次换弹、2 次全蓄力）精确吻合；Liberalio 200 RPM → 18t 远低于其
 * 86t 蓄力发间，不受影响。UP 型不适用（发间由前摇+蓄力+后摇决定，见 game-data.md）。
 * @param {object} unit
 * @returns {number} 下限 ticks（非 DOWN_Charge 或无 RPM 数据时为 0）
 */
function downChargeRofFloorTicks(unit) {
  return unit.isDownCharge && unit.rateOfFire > 0
    ? Math.round(TICK_RATE * 60 / unit.rateOfFire) : 0;
}

/**
 * 计算蓄力武器（SR/RL）当前一次蓄力的有效时长 ticks（蓄速加成作用于每一次蓄力，含换弹后首发）。
 * chargeSpeedPct 只缩短蓄力（瞄准）阶段，不影响 fore/backswing。
 * immuneSkillChargeSpeed 只屏蔽技能/buff 来源的 chargeSpeedPct 与 chargeTimeReductionTicks；
 * 装备词条与魔方技能带来的 unit.stats.chargeSpeedPct 始终生效，不受屏蔽。
 * @param {object} state
 * @param {object} unit
 * @param {object} sums getBuffSums 汇总
 * @returns {number} 有效蓄力 ticks
 */
function effectiveChargeTicks(state, unit, sums) {
  // 固定蓄力时间覆盖（如 Anis: Star 爆裂期间）：忽略技能类蓄力速度 buff，仅保留装备/魔方加成
  if ((unit.skillState?.fixedChargeEndTick ?? 0) >= state.tick &&
      unit.skillState.fixedChargeTimeTicks != null) {
    return Math.max(0, Math.round(
      unit.skillState.fixedChargeTimeTicks * (1 - Math.min(0.99, unit.stats.chargeSpeedPct ?? 0)),
    ));
  }
  const csFromBuff    = unit.immuneSkillChargeSpeed ? 0 : sums.chargeSpeedPct;
  const flatReduction = unit.immuneSkillChargeSpeed ? 0 : (sums.chargeTimeReductionTicks ?? 0);
  const afterPct      = Math.round(unit.chargeTimeTicks * (1 - Math.min(0.99, (unit.stats.chargeSpeedPct ?? 0) + csFromBuff)));
  return Math.max(0, afterPct - flatReduction);
}

/**
 * 计算蓄力武器（SR/RL）下一发的发间 ticks（不含武器切换覆盖场景）。
 * UP 型：backswing + foreswing + effectiveCharge；DOWN_Charge 型：仅 effectiveCharge（受 RPM 下限约束）。
 * @param {object} state
 * @param {object} unit
 * @param {object} sums getBuffSums 汇总
 * @returns {number} 发间 ticks
 */
function nextChargeShotDelayTicks(state, unit, sums) {
  const effectiveCharge = effectiveChargeTicks(state, unit, sums);
  // Alice Wonderland 快速攻击：40次/10s（每 15 ticks，fore/backswing 被规避）
  const fastTicks = aliceFastAttackNextTicks(state, unit, effectiveCharge);
  if (fastTicks != null) return fastTicks;
  return (unit.isDownCharge ? 0 : unit.backswingTicks + unit.foreswingTicks)
    + Math.max(effectiveCharge, downChargeRofFloorTicks(unit));
}

/**
 * 当前换弹（装填动作）时长 ticks，不含非蓄力武器的末发后摇 reloadRecoveryTicks。
 * 换弹时长 = 基础时长 ×(1 − 换弹速度%)，下限 0（≥100% 换弹速度即瞬间装填）。
 * 注意是乘法折减，不是除以 (1 + speed)：+29.69% → 2s ×0.7031 ≈ 1.41s。
 * fixedReloadSpeedPct：固定换弹速度加成，屏蔽其他换弹速度效果（如 Asuka: WILLE S2）。
 *   可配 fixedReloadSpeedEndTick：「Reloading Speed is fixed at X% for N sec」的到期 tick（如 Jill 爆裂、
 *   Exia SSR S1 P2），超过后视为未设置；缺省为不限时（由技能自行清除）。
 * fixedReloadTicks + fixedReloadEndTick：固定换弹时长（「Reload time is fixed at X sec」，
 *   如 Cinderella: Crystal Wave 的 Preparation for Change），生效期间忽略基础时长与换弹速度。
 * @param {object} state
 * @param {object} unit
 * @param {object} sums getBuffSums 汇总
 * @returns {number} 换弹时长 ticks
 */
function reloadDurationTicks(state, unit, sums) {
  const st = unit.skillState;
  if (st?.fixedReloadTicks != null && (st.fixedReloadEndTick ?? 0) >= state.tick)
    return st.fixedReloadTicks;
  const fixedActive = st?.fixedReloadSpeedPct != null
    && (st.fixedReloadSpeedEndTick == null || st.fixedReloadSpeedEndTick > state.tick);
  const effectiveReloadSpeed = fixedActive ? st.fixedReloadSpeedPct : sums.reloadSpeedPct;
  return Math.round(unit.reloadTicks * Math.max(0, 1 - effectiveReloadSpeed));
}

/**
 * 引擎排定蓄力武器下一发：chargeTick = baseTick + fixedTicks + max(有效蓄力, DOWN_Charge RPM 下限)。
 * 记录 chargeBaseTick / chargeFixedTicks / engineChargeTick，供 rescheduleEngineCharge 每 tick 按
 * 当前蓄力时长重算（蓄速 buff / 固定蓄力在蓄力中途变化时立即生效，见 §4.3.10）。
 * Alice Wonderland 快速攻击：发间固定 15t，不参与重算（engineChargeTick = null）。
 * 速充：下一发为速充攻击时固定 13 + 2 帧（自发间起点起算），并以 qcShotTick 标记该发。
 * @param {object} state
 * @param {object} unit
 * @param {number} baseTick   发间起点（通常为射击 tick / 换弹相位结束 tick / HIDDEN 结束 tick）
 * @param {number} fixedTicks 非蓄力段（UP 型：后摇+前摇或仅前摇；DOWN_Charge 型：0）
 * @param {object} sums getBuffSums 汇总
 */
function scheduleEngineCharge(state, unit, baseTick, fixedTicks, sums) {
  unit.qcShotTick = null;
  const effCharge = effectiveChargeTicks(state, unit, sums);
  const fastTicks = aliceFastAttackNextTicks(state, unit, effCharge);
  if (fastTicks != null) {
    unit.chargeTick       = state.tick + fastTicks;
    unit.engineChargeTick = null;
    return;
  }
  if (quickChargeWanted(state, unit)) {
    unit.chargeTick       = Math.max(state.tick, baseTick) + QUICK_CHARGE_SHOT_TICKS;
    unit.engineChargeTick = null;
    unit.qcShotTick       = unit.chargeTick;
    return;
  }
  unit.chargeBaseTick   = baseTick;
  unit.chargeFixedTicks = fixedTicks;
  unit.chargeTick       = baseTick + fixedTicks + Math.max(effCharge, downChargeRofFloorTicks(unit));
  unit.engineChargeTick = unit.chargeTick;
}

/**
 * 每 tick 重算引擎排定的 chargeTick：蓄力中途蓄力时长变化时按新时长结算，
 * 已蓄力时长 ≥ 新时长则视为已满蓄，本 tick 立即击发（实测：Anis: Star 爆裂固定蓄力 0.7s 在两发间
 * 生效/过期时，该发分别按 42t / 60t 打出）。技能 handler 显式改写过的 chargeTick 不重算。
 * @param {object} state
 * @param {object} unit
 */
function rescheduleEngineCharge(state, unit) {
  if (unit.engineChargeTick == null || unit.chargeTick !== unit.engineChargeTick) return;
  if ((unit.skillState?.aliceWonderlandEndTick ?? 0) >= state.tick) return;
  const effCharge = effectiveChargeTicks(state, unit, getBuffSums(state, unit.id));
  const next = unit.chargeBaseTick + unit.chargeFixedTicks + Math.max(effCharge, downChargeRofFloorTicks(unit));
  if (next === unit.chargeTick) return;
  unit.chargeTick       = next;
  unit.engineChargeTick = next;
}

/**
 * 完成一次装填动作：恢复弹药、计数、记录装填事件（不处理射击节奏衔接与 RELOAD_END 触发）。
 * 分段装填（reloadFraction < 1）每次恢复 round(maxAmmo × reloadFraction) 发，不超过上限；
 * 弹匣未空时（后摇期间换弹）在剩余弹药基础上累加。
 * unit.maxAmmo 由 recalcMaxAmmo 维护，始终反映当前所有效果的最终弹匣上限。
 * @param {object} state
 * @param {object} unit
 * @param {object[]} events 本 tick 事件列表
 */
function refillMagazine(state, unit, events) {
  unit.ammoLeft = unit.reloadFraction < 1
    ? Math.min(unit.maxAmmo, Math.max(0, unit.ammoLeft) + Math.round(unit.maxAmmo * unit.reloadFraction))
    : unit.maxAmmo;
  unit.reloadCount++;
  unit.reloadTick = 0;
  // _seq 用于同 tick 内日志排序：装填在本 tick 的射击之前完成（UP 型蓄力武器换弹完成后会
  // 立即补射），缺少 _seq 会让换弹后那一发在详情日志中错误地排在"装填"行之前，
  // 表现为"弹药到 0 后又打一发才装填、且装填未满"。赋予递增 _seq 还原真实执行顺序。
  events.push({ type: 'reload', tick: state.tick, unitId: unit.id, unitName: unit.name,
    ammoRefilled: unit.ammoLeft, maxAmmo: unit.maxAmmo, _seq: state._logSeq++ });
}

/**
 * UP 型蓄力武器射击后的后摇期间换弹（§4.3.9）。每发射击后进入后摇即开始换弹：
 *   - 换弹时长 ≤ 后摇：后摇内补满（dur=0 时本 tick 立即补满），记录装填事件；射击节奏不变。
 *   - 换弹时长 > 后摇且弹匣已空：本 tick 起正常换弹，后摇与换弹同时计时（§4.3.6）。
 *   - 换弹时长 > 后摇且弹匣未空：后摇结束时换弹被打断，不恢复弹药。
 * 调用方保证：本发为引擎排定的蓄力射击（非武器切换）。
 * DOWN_Charge 型无后摇、Alice Wonderland 快速攻击规避后摇、无限弹药期间不消耗弹药，均不适用。
 * @param {object} state
 * @param {object} unit
 * @param {object[]} events 本 tick 事件列表
 */
function scheduleBackswingReload(state, unit, events) {
  if ((unit.skillState?.aliceWonderlandEndTick ?? 0) >= state.tick) return;
  // DOWN_Charge 型同样记录末发 tick：换弹后首发需在末发后摇 + 前摇之后（§4.3.6），但不做后摇期间换弹
  unit.lastChargeShotTick = state.tick;
  if (unit.isDownCharge || unit.backswingTicks <= 0) return;
  if ((unit.skillState.unlimitedAmmoEndTick ?? 0) > state.tick) return;
  if (unit.ammoLeft >= unit.maxAmmo) return;
  const dur = reloadDurationTicks(state, unit, getBuffSums(state, unit.id));
  if (dur <= unit.backswingTicks) {
    if (dur === 0) {
      refillMagazine(state, unit, events);
      onReloadEnd(state, unit);
    } else {
      unit.backswingReloadTick = state.tick + dur;
    }
  } else if (unit.ammoLeft <= 0) {
    unit.reloadTick      = state.tick + dur;
    unit.reloadStartTick = state.tick;
  }
}

/**
 * 「百暴」手动打法（config.fullCritCharIds）：本 tick 是否停止普通攻击。
 * Miranda S2 P3「Wake Up! (Crit Rate)」为 1 回合的回合制 buff——不进行普通攻击就不会被消耗，
 * 但对所有技能伤害同样生效（buff 带 fullCritSource 标记，见 32.js）。选中的角色在自己轮次
 * （本轮施放过爆裂技能）的全爆裂期间、且身上持有该 buff 时停火，依靠技能输出。
 *   - Miranda 把 buff 给了别人（本单位身上没有）→ 百暴失效，照常攻击；
 *   - 无限弹射击（武器切换无限弹 / unlimitedAmmoEndTick）不消耗回合制 buff，照常射击。
 *     （Nayuta 这类无限弹爆裂角色因此本就无需百暴，UI 不提供该选项；此处仅作通用保护。）
 * @param {object} state
 * @param {object} unit
 * @returns {boolean}
 */
function fullCritHoldActive(state, unit) {
  if (!unit.fullCritHold || !state.fullBurstActive) return false;
  if (!state.burstCastersThisRotation?.has(unit.id)) return false;
  if (isWeaponSwitchActive(state, unit) && unit.skillState.weaponSwitchUnlimitedAmmo) return false;
  if ((unit.skillState.unlimitedAmmoEndTick ?? 0) > state.tick) return false;
  return state.buffs.some(b => b.unitId === unit.id && b.fullCritSource && (b.roundsLeft ?? 0) > 0);
}

/**
 * 百暴停火中的一 tick：弹匣未满且未在换弹 → 标记手动换弹（下一 tick 由装填分支开始），之后空闲。
 * 空闲期间 MG 射速衰减、散布恢复（同停火区段）。
 * @param {object} state
 * @param {object} unit
 */
function holdFireForFullCrit(state, unit) {
  unit.fullCritHolding = true;
  if (unit.ammoLeft < unit.maxAmmo && unit.reloadTick === 0 && unit.backswingReloadTick === 0)
    unit.manualReload = true;
  if (unit.mgCurrentRof != null && unit.mgRofDecayPerTick > 0)
    unit.mgCurrentRof = Math.max(unit.mgStartRof, unit.mgCurrentRof - unit.mgRofDecayPerTick);
  recoverAccuracy(unit, 1);
}

/**
 * 百暴停火结束（全爆裂结束 / buff 消失）：重新开始攻击。
 * 蓄力武器从本 tick 起重新蓄力（UP 型含前摇），非蓄力武器进入对准期（spot_first_delay）。
 * @param {object} state
 * @param {object} unit
 */
function resumeAfterFullCritHold(state, unit) {
  unit.fullCritHolding = false;
  if (isWeaponSwitchActive(state, unit)) return;
  if (unit.chargeTimeTicks > 0) {
    scheduleEngineCharge(state, unit, state.tick, unit.isDownCharge ? 0 : unit.foreswingTicks,
      getBuffSums(state, unit.id));
  } else if (unit.reloadAimTicks > 0) {
    unit.aimReadyTick = state.tick + unit.reloadAimTicks;
  }
}

/**
 * 速充的全爆裂收尾：全爆裂结束前预留「换弹 + 前摇 + 全蓄力」，手动换弹后全蓄力，
 * 使该发恰好在全爆裂结束瞬间打出（此时槽已清零，全蓄力充能计入下一轮），之后继续速充。
 * 每 tick 检查：按当前换弹 / 蓄力时长估算收尾发 tick，首次 ≥ 全爆裂结束 tick 时开始（每轮全爆裂一次）。
 *   - 已在换弹中：仅标记收尾，换弹完成后按全蓄力排定；
 *   - 弹匣未满：打断当前攻击 / 后摇期间换弹，开始手动换弹（manualReload，装填分支照常处理）；
 *   - 弹匣已满或换弹瞬间完成：直接排定前摇 + 全蓄力。
 *   - 弹匣已满但已排定的下一发打出后再换弹会赶不上全爆裂结束（nextShotSpoilsFinisher）：
 *     提前开始收尾，不打该发，全蓄力按住至全爆裂结束 tick 打出。
 * 蓄速 buff 在收尾蓄力中途到期时由 rescheduleEngineCharge 按新时长顺延（与实机一致）。
 * @param {object} state
 * @param {object} unit
 * @param {object[]} events 本 tick 事件列表
 */
function maybeStartQuickChargeFinisher(state, unit, events) {
  if (!unit.quickChargeMode || !state.fullBurstActive) return;
  if (fullCritHoldActive(state, unit)) return;  // 百暴停火优先：本轮全爆裂不做收尾
  const fbEnd = state.fullBurstTick;
  if (unit.qcFinisherFbTick === fbEnd || isWeaponSwitchActive(state, unit)) return;
  const sums       = getBuffSums(state, unit.id);
  const reloading  = unit.reloadTick > 0;
  const unlimited  = (unit.skillState.unlimitedAmmoEndTick ?? 0) > state.tick;
  const needReload = !reloading && !unlimited && unit.ammoLeft < unit.maxAmmo;
  const reloadDur  = needReload ? reloadDurationTicks(state, unit, sums) : 0;
  // UP 型换弹相位结束 = max(换弹完成, 末发 + 后摇)，之后前摇 + 全蓄力（§4.3.6）
  const phaseEnd = Math.max(reloading ? unit.reloadTick : state.tick + reloadDur,
    unit.lastChargeShotTick + unit.backswingTicks);
  const effCharge = effectiveChargeTicks(state, unit, sums);
  const holdForFinisher = !reloading && !needReload && nextShotSpoilsFinisher(state, unit, sums, fbEnd, effCharge);
  if (!holdForFinisher && phaseEnd + unit.foreswingTicks + effCharge < fbEnd) return;
  unit.qcFinisherFbTick  = fbEnd;
  unit.qcFinisherPending = true;
  if (reloading) return;
  unit.backswingReloadTick = 0;
  if (reloadDur > 0) {
    unit.manualReload  = true;
    unit.reloadTick      = state.tick + reloadDur;
    unit.reloadStartTick = state.tick;
    return;
  }
  if (needReload) {
    refillMagazine(state, unit, events);
    onReloadEnd(state, unit);
  }
  // 弹匣满时提前进入收尾：全蓄力后按住，至全爆裂结束 tick 打出（排定起点顺延到 fbEnd − 前摇 − 蓄力）
  scheduleEngineCharge(state, unit,
    Math.max(state.tick, unit.lastChargeShotTick + unit.backswingTicks, fbEnd - unit.foreswingTicks - effCharge),
    unit.foreswingTicks, getBuffSums(state, unit.id));
}

/**
 * 速充收尾判定（弹匣满、未换弹时）：已排定的下一发若照常打出，之后「换弹相位 + 前摇 + 全蓄力」
 * 将越过全爆裂结束 tick，则不应打出该发，而应改为收尾全蓄力并按住至全爆裂结束。
 * 典型场景：全爆裂开始后换弹完成（弹匣满），换弹较慢（如未装 Resilience 魔方）时，
 * 打出换弹后首发再手动换弹已赶不上全爆裂结束，收尾发会晚于全爆裂结束打出。
 * @param {object} state
 * @param {object} unit
 * @param {object} sums getBuffSums 汇总
 * @param {number} fbEnd 全爆裂结束 tick
 * @param {number} effCharge 当前有效蓄力 ticks
 * @returns {boolean}
 */
function nextShotSpoilsFinisher(state, unit, sums, fbEnd, effCharge) {
  const next = unit.chargeTick;
  if (!(next > state.tick) || next >= fbEnd) return false;
  if ((unit.skillState.unlimitedAmmoEndTick ?? 0) > next) return false;
  // 打出后弹匣未满：换弹与后摇同时计时（换弹 ≤ 后摇时即后摇期间换弹）
  const phaseEnd = next + Math.max(reloadDurationTicks(state, unit, sums), unit.backswingTicks);
  return phaseEnd + unit.foreswingTicks + effCharge > fbEnd;
}

/**
 * rate_of_fire 武器当前每 tick 发数（RPM ÷ 3600，含攻速 buff；MG 起速用 mgCurrentRof 覆盖）。
 * 射击累加器与换弹期间的并行累积共用此值，保证两处节奏一致。
 * 武器切换期间若技能指定了 weaponSwitchRateOfFire（RPM），则以其覆盖原武器射速（如 Moran 爆裂）。
 * 结果封顶 MAX_SHOTS_PER_TICK：客户端每帧最多一次射击，MG 顶速 4200 RPM 实际只打出 60 发/s。
 * @param {object} state
 * @param {object} unit
 * @returns {number} 每 tick 发数
 */
function shotsPerTick(state, unit) {
  const switchRof = (unit.skillState?.weaponSwitchEndTick ?? 0) > 0
    && state.tick <= unit.skillState.weaponSwitchEndTick
    ? (unit.skillState.weaponSwitchRateOfFire ?? 0) : 0;
  const baseRof = switchRof > 0 ? switchRof : (unit.mgCurrentRof ?? unit.rateOfFire);
  // Attack speed ▲：从 buff 系统汇总，支持多来源叠加（Dorothy burst、Tove S2 等）；
  // 口径同 getBuffSums（含 weaponFilter 与叠层：Tove S2「仅 SG 友军」攻速不作用于 AR 的 Tove 自身）
  const atkSpeedPct = sumBuffField(state, unit, 'atkSpeedPct');
  return Math.min(MAX_SHOTS_PER_TICK, baseRof * (1 + atkSpeedPct) / 60 / TICK_RATE);
}

// ─── Buff/伤害/回复辅助均已从 battle-utils.js 导入 ──────────────────────────
// getBuffSums, pushBuff, addBurstGauge, applyHeal, fireSkillHit


// ─── 技能事件处理器 ─────────────────────────────────────────────────────

/**
 * B1 选择：与 selectBurst2Unit 相同的轮次策略规则（策略单位在自己的轮次优先，其余轮次跳过），
 * 无策略单位按 §6.0 从左到右。b1Once 策略单位（Red Hood「第 N 轮爆裂 1」系列用法）
 * 本身为 Step3，仅在第 policy.b1Cycle 轮作为 B1 候选。
 */
function selectBurst1Unit(state) {
  const ready = state.squad.filter(u =>
    (u.burstStep === 'Step1' || u.burstRoundPolicy?.mode === 'b1Once') &&
    u.canBurst !== false && u.burstCdRemaining <= 0 && !isStunned(state, u));
  return ready.find(u => u.burstRoundPolicy && isPolicyBurstRound(state, u))
    ?? ready.find(u => !u.burstRoundPolicy)
    ?? null;
}

const RED_HOOD_ID = 470;

/**
 * Red Hood（AllStep）作为 B1 用法（config.rhBurstMode = b1odd / b1even）时的爆裂阶段：Step1；
 * 其余用法（b3 / b1r1b3 / b1r2b3even）或非 Red Hood 返回 null（沿用槽位配置的 Step3）。
 */
function redHoodBurstStep(config, cfg) {
  if (cfg.characterId !== RED_HOOD_ID) return null;
  return config.rhBurstMode === 'b1odd' || config.rhBurstMode === 'b1even' ? 'Step1' : null;
}

/** 眩晕中（如 Mast: Romantic Maid 的 Hangover）的单位无法施放爆裂技能，由同阶段其他单位接替。 */
function isStunned(state, u) {
  return state.tick < (u.skillState.stunnedUntilTick ?? 0);
}

/**
 * lastBurstOnly 策略：当前是否为战斗最后一个爆裂循环。
 * 以上一轮充能耗时估算下一轮：本轮全爆裂结束 → 槽充满 → 槽满→B1、B1→B2、B2→B3 三段阶段延迟，
 * 若下一轮 B3 施放时刻已超出战斗时长，则本轮即为最后一轮。
 */
function isLastBurstCycle(state) {
  const gaugeRefill = state.burstCycleStartTick - state.lastBurstEndTick;
  if (gaugeRefill <= 0) return false;
  const fullBurstEnd = state.tick + FULL_BURST_ENTRY_DELAY_TICKS + TICK_RATE * 10;
  const nextB3Tick   = fullBurstEnd + gaugeRefill + state.burstStepTicks * 3;
  return nextB3Tick >= MAX_TICKS;
}

/**
 * B3 候选：Step3 / StepFull、可施放，且未被 lastBurstOnly 策略在非最后一轮排除，
 * 也未被 B3 轮次奇偶策略（burstRoundPolicy.b3Parity）在非自己的轮次排除。
 */
function isBurst3Candidate(state, u, lastCycle) {
  const b3Parity = u.burstRoundPolicy?.b3Parity;
  return (u.burstStep === 'Step3' || u.burstStep === 'StepFull') &&
    u.canBurst !== false && !(u.lastBurstOnly && !lastCycle) &&
    (b3Parity == null || state.burstCycleCount % 2 === b3Parity);
}

/**
 * 按 §6.0 从左到右选出本轮施放 B3 的单位；最后一轮时 lastBurstOnly 单位优先；
 * 带 b3Parity 策略的单位在自己的轮次无视站位优先（冷却未就绪时由其他 B3 按站位施放）。
 * cdLookahead > 0 时为预测用法：B2 阶段预判 cdLookahead tick 后进入阶段 3 时由谁施放 B3。
 */
function selectBurst3Unit(state, cdLookahead = 0) {
  const lastCycle = state.squad.some(u => u.lastBurstOnly) && isLastBurstCycle(state);
  const ready = state.squad.filter(u => isBurst3Candidate(state, u, lastCycle) &&
    u.burstCdRemaining <= cdLookahead && !isStunned(state, u));
  return ready.find(u => u.burstRoundPolicy?.b3Parity != null)
    ?? (lastCycle ? ready.find(u => u.lastBurstOnly) : null) ?? ready[0] ?? null;
}

/**
 * 爆裂轮次策略（unit.burstRoundPolicy）：本轮是否轮到该单位施放爆裂技能。
 *   drunken3 — 自身 Drunken 叠满 3 层的轮次（Mast: Romantic Maid）
 *   withB3   — 预测本轮 B3 施放者为 policy.b3Id 的轮次
 *   parity   — 爆裂轮次序号（第 1 轮起）奇偶与 policy.parity 相同的轮次（1 = 奇数轮，0 = 偶数轮）
 *   b1Once   — 爆裂轮次序号等于 policy.b1Cycle 的轮次（仅该轮可作为 B1；B3 按站位照常选择，
 *              另设 policy.b3Parity 时仅在该奇偶轮次作为 B3，见 isBurst3Candidate）
 * 策略单位只在自己的轮次施放：即使冷却已就绪，非自己的轮次也不施放。
 */
function isPolicyBurstRound(state, u) {
  const policy = u.burstRoundPolicy;
  if (policy.mode === 'drunken3') {
    const stacks = state.buffs.find(b => b.name === 'Drunken' && b.unitId === u.id)?.stackCount ?? 0;
    return stacks >= 3;
  }
  if (policy.mode === 'withB3') return selectBurst3Unit(state, state.burstStepTicks)?.id === policy.b3Id;
  if (policy.mode === 'parity') return state.burstCycleCount % 2 === policy.parity;
  if (policy.mode === 'b1Once') return state.burstCycleCount === policy.b1Cycle;
  return true;
}

/**
 * B2 选择：带爆裂轮次策略的单位在「自己的轮次」优先施放，其余轮次跳过；
 * 无策略单位按 §6.0 从左到右照常选择。眩晕中的单位（任何策略下）均跳过。
 */
function selectBurst2Unit(state) {
  const ready = state.squad.filter(u =>
    u.burstStep === 'Step2' && u.canBurst !== false && u.burstCdRemaining <= 0 && !isStunned(state, u));
  return ready.find(u => u.burstRoundPolicy && isPolicyBurstRound(state, u))
    ?? ready.find(u => !u.burstRoundPolicy)
    ?? null;
}

/**
 * 分派 HEAL_RECEIVED 与 HP_CHANGED 触发（flushHpEvents）：
 *   1. 消费 state.pendingHealReceived 队列（由 applyHeal 填充），去重后逐单位派发 HEAL_RECEIVED；
 *   2. 消费 state.pendingHpChanged（由 battle-utils 写入 HP 时填充），逐单位派发 HP_CHANGED；
 *   3. handler 内可能再次治疗 / 改变 HP → 循环直到两个队列都为空（上限 8 轮，防止互相触发的死循环）。
 * 调用时机：每次可能改变 HP 的操作（onShotFired、executeSkillTriggers、buff 到期截断）之后。
 */
const FLUSH_HP_EVENTS_MAX_ROUNDS = 8;
function flushHpEvents(state) {
  for (let round = 0; round < FLUSH_HP_EVENTS_MAX_ROUNDS; round++) {
    let any = false;
    if (state.pendingHealReceived?.length) {
      any = true;
      const seen   = new Set();
      const healed = state.pendingHealReceived.splice(0);
      for (const u of healed) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        executeSkillTriggers(state, 'HEAL_RECEIVED', { unit: u });
      }
    }
    if (dispatchHpChanged(state)) any = true;
    if (!any) return;
  }
}
const flushHealReceived = flushHpEvents;

/**
 * 分派 APPLY_SHIELD 触发：消费 state.pendingShieldReceived 队列（由 applyShield 填充）。
 * 每个获盾单位独立分派一次 APPLY_SHIELD，ctx.unit = 受盾单位；
 * 技能处理器通过 caster.id === ctx.unit.id 判断是否为自身获盾。
 */
function flushShieldReceived(state) {
  if (!state.pendingShieldReceived.length) return;
  const units = state.pendingShieldReceived.splice(0);
  const seen  = new Set();
  for (const u of units) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    executeSkillTriggers(state, 'APPLY_SHIELD', { unit: u });
  }
}

/**
 * 分派 COVER_HEAL 触发：消费 state.pendingCoverHeal 标记（由 applyCoverHeal 填充）。
 * COVER_HEAL 为团队触发，所有持有该技能的单位均触发，ctx.unit 无意义。
 */
function flushCoverHeal(state) {
  if (!state.pendingCoverHeal) return;
  state.pendingCoverHeal = false;
  executeSkillTriggers(state, 'COVER_HEAL');
}

/**
 * 分派 CS_BUFF_CHANGED 触发：消费 state._pendingCsChangedIds（由 pushBuff → _trackCsChange 填充）。
 * 每个受影响单位独立分派一次非团队触发，供蓄力速度依赖转化技能（如 Red Hood S1 P2）重算。
 * 先清空集合再迭代，防止 CS_BUFF_CHANGED handler 内再次推入 CS buff 时产生重入循环。
 */
function flushCsChanged(state) {
  if (!state._pendingCsChangedIds.size) return;
  const ids = [...state._pendingCsChangedIds];
  state._pendingCsChangedIds.clear();
  for (const uid of ids) {
    const u = state.squad.find(u => u.id === uid);
    if (u) executeSkillTriggers(state, 'CS_BUFF_CHANGED', { unit: u });
  }
}

/**
 * 进入 Burst 1 阶段时触发的被动效果（槽填满那一 tick 立即触发，不依赖 B1 单位是否 cast）。
 * 触发时机：burstPhase 从 0 变为 1（共享槽填满）。
 */
function applyEnterBurst1Passives(state) {
  executeSkillTriggers(state, 'ENTER_BURST_I');
  flushCsChanged(state);
}

/**
 * 进入 Burst 2 阶段时触发的被动效果（B1 技能施放后立即触发，然后才开始 burstStepTicks 延迟）。
 * 不依赖 B2 单位是否冷却结束。
 */
function applyEnterBurst2Passives(state) {
  executeSkillTriggers(state, 'ENTER_BURST_II');
  flushCsChanged(state);
}

/**
 * 进入 Burst 3 阶段时触发的被动效果（B2 技能施放后立即触发，然后才开始 burstStepTicks 延迟）。
 * 不依赖 B3 单位是否冷却结束。
 */
function applyEnterBurst3Passives(state) {
  executeSkillTriggers(state, 'ENTER_BURST_III');
  flushCsChanged(state);
  flushHealReceived(state);
}

/** Step1 burst：若冷却结束则释放。返回释放的单位，或 null。
 * §6.4：不存在 Step1 单位，或 Step1 单位冷却中，均返回 null（阶段无法推进，等待 §6.3 超时）。
 */
function applyBurstISkills(state) {
  const b1 = selectBurst1Unit(state);
  if (!b1) return null;

  b1.burstCdRemaining = b1.burstSkillCooltime;
  state.burstCastersThisRotation?.add(b1.id);
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: b1 });
  flushCsChanged(state);
  flushHealReceived(state);
  flushShieldReceived(state);
  return b1;
}

/**
 * B1 施放后的阶段推进：触发"进入下一阶段"被动并开始 burstStepTicks 延迟。
 * 常规 B1 推进到阶段 2；施放者 changeBurstStep === 'Step1'（如 Anis: Star 的 Everyone's Star）
 * 时重入阶段 1：延迟结束后停留在阶段 1，由其他冷却就绪的 B1 继续施放。
 */
function advanceAfterBurstI(state, fired) {
  state.burstReenterStage1 = fired.changeBurstStep === 'Step1';
  if (state.burstReenterStage1) applyEnterBurst1Passives(state);
  else applyEnterBurst2Passives(state);
  state.burstPhaseTick = state.tick + state.burstStepTicks;
}

/** Step2 burst：若冷却结束则释放。返回释放的单位，或 null。 */
function applyBurstIISkills(state) {
  const b2 = selectBurst2Unit(state);
  if (!b2) return null;

  b2.burstCdRemaining = b2.burstSkillCooltime;
  state.burstCastersThisRotation?.add(b2.id);
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: b2 });
  flushCsChanged(state);
  flushHealReceived(state);
  flushShieldReceived(state);
  return b2;
}

/**
 * 施放 B3（进入全爆裂的第 1 步；第 2–4 步在 FULL_BURST_ENTRY_DELAY_TICKS 后由 enterFullBurst 执行）。
 *
 * 不变量：B3 的所有即时效果（buff、治疗、护盾）必须完全结算完毕，
 * 才能开始结算 Full Burst 效果（fullBurstActive=true、ENTER_FULL_BURST 触发器）。
 *
 * B3 直接伤害从进入全爆裂开始计时（§6.2）：B3 施放者爆裂技能的伤害命中一律走延迟命中队列，
 * fireTick = 施放 tick + FULL_BURST_ENTRY_DELAY_TICKS + 技能自身延迟（技能文件写的延迟均指「进入全爆裂后」）。
 * 即时 fireSkillHit 由引擎自动转为延迟命中并预捕获施放时 sums。
 * 延迟命中默认标记 suppressFullBurst=true，不受全爆裂补正；
 * 例外：opts.affectedByFullBurst=true（技能描述为 "as additional damage"，见 skill-modeling-guide），
 * 受全爆裂 +50% 与 ENTER_FULL_BURST buff 影响；若早于进入全爆裂到期，由兜底推迟到 enterFullBurst 结算。
 *
 * 执行顺序：
 *   1. BURST_SKILL_USE（buff 等即时效果在 fullBurstActive=false 下结算；伤害排入延迟队列并后移）
 *   2. 延迟命中标记 suppressFullBurst
 *   3. flushHealReceived / flushShieldReceived
 *   （FULL_BURST_ENTRY_DELAY_TICKS 后由 enterFullBurst 执行以下步骤）
 *   4. fullBurstActive = true
 *   5. ENTER_FULL_BURST 触发器
 *   6. pendingFireInBurstHits 结算
 */
function applyFullBurstSkills(state, events) {
  // 1. 按 §6.0 从左到右选第一个 CD 就绪的 B3 单位施放；其余本轮无法施放。
  // lastBurstOnly 策略：非最后一轮跳过该单位；最后一轮时该单位优先于其他 B3。
  const step3 = selectBurst3Unit(state);

  const firstFired = step3;

  if (step3) {
    step3.burstCdRemaining = step3.burstSkillCooltime;
    state.burstCastersThisRotation?.add(step3.id);

    // burst_iii 标记在 B3 即时效果之前推入，确保日志顺序：B3 → 效果 → Full Burst
    const bev = { type: 'burst_iii', tick: state.tick, unitName: step3.name, _seq: state._logSeq++ };
    if (step3.combatAssistStatus != null) bev.isCA = !!step3.combatAssistStatus;
    events.push(bev);

    const prePendingLen = state.pendingSkillHits.length;
    // B3 直接伤害从进入全爆裂开始计时：施放者爆裂技能的即时命中改为延迟命中，
    // 所有延迟命中统一后移 FULL_BURST_ENTRY_DELAY_TICKS（由 executeSkillTriggers / fireSkillHit 处理）
    state.b3Cast = { casterId: step3.id, delayTicks: FULL_BURST_ENTRY_DELAY_TICKS };
    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: step3 });
    state.b3Cast = null;
    flushCsChanged(state);

    // B3 期间新增的延迟命中将在全爆裂窗口内触发（届时 fullBurstActive=true），需屏蔽补正
    for (let i = prePendingLen; i < state.pendingSkillHits.length; i++) {
      const h = state.pendingSkillHits[i];
      if (!h.opts) h.opts = {};
      if (!h.opts.affectedByFullBurst) h.opts.suppressFullBurst = true;
    }

    flushHealReceived(state);
    flushShieldReceived(state);
  }
  return firstFired;
}

/**
 * 进入全爆裂状态：B3 施放后固定延迟 FULL_BURST_ENTRY_DELAY_TICKS（0.05s）再执行
 * （fullBurstActive=true → ENTER_FULL_BURST → 受全爆裂影响的 B3 伤害快照 → FULL_BURST_SNAPSHOT → pendingFireInBurstHits）。
 * @param {object} state
 * @param {object[]} events
 */
function enterFullBurst(state, events) {
  // 2. 所有 B3 施放完毕后，进入全爆裂状态
  state.fullBurstActive = true;
  state.fullBurstStartTick = state.tick;

  // full_burst 标记在 ENTER_FULL_BURST 之前推入，确保日志顺序：B3效果 → Full Burst → FB效果
  events.push({ type: 'full_burst', tick: state.tick, burstNum: state.fullBurstCount, _seq: state._logSeq++ });

  // 3. ENTER_FULL_BURST 被动触发（此时 fullBurstActive 已为 true）
  const prePendingLenFull = state.pendingSkillHits.length;
  executeSkillTriggers(state, 'ENTER_FULL_BURST');
  flushCsChanged(state);
  flushHealReceived(state);

  // ENTER_FULL_BURST 期间新增的延迟命中同样屏蔽全爆裂补正
  for (let i = prePendingLenFull; i < state.pendingSkillHits.length; i++) {
    const h = state.pendingSkillHits[i];
    if (!h.opts) h.opts = {};
    if (!h.opts.affectedByFullBurst) h.opts.suppressFullBurst = true;
  }

  // 3b. 全爆裂开始瞬间快照：受全爆裂影响的 B3 伤害（affectedByFullBurst 延迟命中、pendingFireInBurstHits）
  //     在此刻（ENTER_FULL_BURST 及其连带效果全部生效后）捕获 sums 与 buff 明细，之后按各自延迟用该快照出伤
  // sums 按施放者缓存；buff 明细按命中属性（真实 / 依次等）逐条快照，只列对该命中生效的加成
  const sumsCache = new Map();
  const applySnapshot = h => {
    if (h.sums) return;
    if (!sumsCache.has(h.caster.id)) sumsCache.set(h.caster.id, getBuffSums(state, h.caster.id));
    h.sums = sumsCache.get(h.caster.id);
    h.opts = { ...(h.opts ?? {}),
      preBuffBreakdown: snapshotBuffBreakdown(state, h.caster.id, h.label, h.opts ?? {}),
      ...(h.opts?.snapshotEnemyDebuffs ? { enemyDebuffSnapshot: snapshotEnemyDebuffs(state) } : {}) };
  };
  for (const h of state.pendingSkillHits) if (h.opts?.affectedByFullBurst) applySnapshot(h);
  for (const h of state.pendingFireInBurstHits) applySnapshot(h);
  // 快照完成后的触发时机：需「先计入快照、再移除」的效果在此处理（如 Elegg S1 属性优势 buff）
  executeSkillTriggers(state, 'FULL_BURST_SNAPSHOT');
  flushCsChanged(state);

  // 4. 结算 pendingFireInBurstHits（在 ENTER_FULL_BURST 生效后触发，受全爆裂补正）
  for (const h of state.pendingFireInBurstHits) {
    const sums = h.sums ?? getBuffSums(state, h.caster.id);
    fireSkillHit(state, h.caster, h.mult, sums, h.label, h.opts);
  }
  state.pendingFireInBurstHits.length = 0;
}


/** 爆裂结束后的冷却效果与清理。 */
function applyBurstEndSkills(state) {
  executeSkillTriggers(state, 'FULL_BURST_END');
  flushCsChanged(state);
  flushHealReceived(state);
}

// ─── 公开 API ───────────────────────────────────────────────────────────────

/**
 * 校验必填的角色配置字段，缺失时抛出错误。
 * @param {object} cfg
 */
function validateUnitConfig(cfg) {
  const req = (field, val) => {
    if (val == null) throw new Error(`[initBattle] 角色「${cfg.name ?? cfg.characterId}」缺少必填字段：${field}`);
    return val;
  };
  req('characterId',               cfg.characterId);
  req('burstStep',                 cfg.burstStep);
  req('_nikkeData',                cfg._nikkeData);
  req('reloadTicks',               cfg.reloadTicks);
  req('burstSkillCooltime',        cfg.burstSkillCooltime);
  req('baseAmmo',                  cfg.baseAmmo);
  req('targetBurstEnergyPerShot',  cfg.targetBurstEnergyPerShot
                                    ?? cfg._nikkeData?.shot_detail?.target_burst_energy_pershot);
}

/**
 * 初始化全新的战斗状态。
 * @param {BattleConfig} config
 * @returns {BattleState}
 */
export function initBattle(config) {
  const squad = config.squad.map((cfg, idx) => {
    validateUnitConfig(cfg);
    const stats   = cfg._computedStats ?? (() => {
      if (cfg.level == null) {
        const err = `[initBattle] 角色「${cfg.name}」缺少 level 且无 _computedStats`;
        console.error(err, cfg);
        throw new Error(err);
      }
      return computeFinalStats(cfg, cfg.level, {});
    })();
    // CHARACTER_TRAITS.weaponType overrides CDN-derived cfg.weaponType when the CDN data is known to be wrong.
    const wt = (() => {
      const result = getCharacterTraits(cfg.characterId)?.weaponType ?? cfg.weaponType;
      if (result == null) {
        const err = `[initBattle] 角色「${cfg.name}」缺少 weaponType`;
        console.error(err, cfg);
        throw new Error(err);
      }
      return result;
    })();
    // Collection skill ammo bonus (MG items: Max Ammo ▲X%) applied at unit creation.
    // Other collection skill effects are applied as permanent buffs after state is built.
    const collFx  = cfg._favItemData
      ? getFavItemSkillEffects(cfg._favItemData, cfg.favoriteItem?.level ?? 0) : null;
    // Base ammo: prefer CDN-derived value from config (baseAmmo), fall back to weapon type table.
    const baseAmmo = cfg.baseAmmo ?? WEAPON_AMMO[wt] ?? 30;
    // Fav item ammo pct: applied as Math.round(base × pct), matching in-game rounding.
    // equipMaxAmmoPct (from OL equipment stats) is pre-computed using the grouped-ROUND rule:
    //   duplicate pct values are grouped → Math.round(base × pct × count) per group.
    const favMaxAmmoFlat = collFx?.ammoPct ? Math.round(baseAmmo * collFx.ammoPct) : 0;
    // initialMaxAmmo：仅含静态来源（baseAmmo + OL + 珍藏品），buff 效果为空故等价于 recalcMaxAmmo 初值。
    const initialMaxAmmo = Math.max(1,
      baseAmmo + Math.round(baseAmmo * (stats.equipMaxAmmoPct ?? 0)) + favMaxAmmoFlat);
    // FORESWING/BACKSWING for SR/RL/Charged weapons: time before and after each charge shot.
    // store.js 从 CDN spot_first_delay / spot_last_delay / maintain_fire_stance 计算并传入。
    // 默认 10t（≈16.67 百分秒）仅在无 CDN 数据时兜底；通常 CDN 值为 12t（20 百分秒）。
    const isChargWeapon = ['SR', 'RL', 'Charged'].includes(wt);
    // 命中率散布档：从 CDN 原始 shot_detail 读取 auto 散布字段（缺失回退手动字段）。
    const _sd = cfg._nikkeData?.shot_detail;
    const accProfile = parseAccuracyProfile(_sd ? {
      startAccuracyScale:    _sd.auto_start_accuracy_circle_scale ?? _sd.start_accuracy_circle_scale ?? null,
      endAccuracyScale:      _sd.auto_end_accuracy_circle_scale   ?? _sd.end_accuracy_circle_scale   ?? null,
      accuracyChangePerShot: _sd.auto_accuracy_change_pershot     ?? _sd.accuracy_change_pershot     ?? 0,
      accuracyChangeSpeed:   _sd.auto_accuracy_change_speed       ?? _sd.accuracy_change_speed       ?? 0,
    } : null, wt);
    // MG 起速武器（rate_of_fire_change_pershot > 0）：开火/换弹后从起始 RPM 逐发加速。
    // 起速武器不种子 shotAccumulator（见下），第一发需等满起始 RPM 的发间，否则会跳过最慢的预热段。
    const hasMgRamp = (cfg._nikkeData?.shot_detail?.rate_of_fire_change_pershot ?? 0) > 0;
    const foreswingTicks = isChargWeapon ? (cfg.foreswingTicks ?? 10) : 0;
    const backswingTicks = isChargWeapon ? (cfg.backswingTicks ?? 10) : 0;
    // 出停火区段（HIDDEN / 跳起）后重新举枪的后摇：取 spot_last_delay，不用 maintain_fire_stance
    // （停火期间早已收枪，「保持开火姿势」时长不再适用）。无 CDN 数据时回退 backswingTicks。
    const hiddenResetBackswingTicks = isChargWeapon ? (cfg.spotLastTicks ?? backswingTicks) : 0;
    // 非蓄力武器（AR/SMG/MG/SG）：末发后摇（CDN spot_last_delay）计入换弹相位。
    // 真机换弹相位 = 后摇 + 装填时长；引擎此前漏算后摇，使换弹偏快、整体偏慢。
    const reloadRecoveryTicks = isChargWeapon ? 0 : (cfg.reloadRecoveryTicks ?? 0);
    // 非蓄力武器换弹完成后的对准期（CDN spot_first_delay）：换弹动作不覆盖前摇，换弹完成后须重新对准才恢复射击。
    // 实测（2026-10-09，Rapi: Red Hood MG，后摇 12t、前摇 12t）：换弹速度 114%（换弹 0t）弹匣打空到首发 23t；
    // 84%（无魔方，换弹 2.5s × 0.156 = 23t）48t = 23 + 12 + 12 + 首发立即。
    const reloadAimTicks = isChargWeapon ? 0
      : (cfg.reloadAimTicks ?? Math.round((cfg._nikkeData?.shot_detail?.spot_first_delay ?? 0) / 100 * TICK_RATE));
    const chargeTimeTicks = cfg.chargeTimeTicks ?? 0;
    // DOWN_Charge 型（持续按住自动连发，如 Liberalio）：发间无前后摇，只计蓄力时长。
    // UP 型（松手触发）：每次发射需重新瞄准（前摇）和恢复（后摇），前后摇正常计入。
    const isDownCharge = cfg.isDownCharge ?? false;
    // 珍藏品技能等级跟随角色技能等级（cfg.skillLevels）；ssrFavSkillLevel 仅供脚本显式覆盖
    const ssrFavSkills = cfg._favItemData
      ? getSsrFavSkills(cfg._favItemData, cfg.favoriteItem?.level ?? 0, cfg.ssrFavSkillLevel ?? cfg.skillLevels)
      : null;
    const unit = {
      id:               cfg.characterId,
      name:             (() => {
        if (cfg.name == null) {
          const err = `[initBattle] 角色 characterId=${cfg.characterId} 缺少 name`;
          console.error(err, cfg);
          throw new Error(err);
        }
        return cfg.name;
      })(),
      element:          cfg.element ?? null,
      weaponType:       wt,
      burstStep:        redHoodBurstStep(config, cfg) ?? cfg.burstStep ?? 'Step3',
      // CDN native burst step (use_burst_skill). Used by skills like Rapi S1 to identify
      // "native B1/B2/B3 allies" (characters whose CDN burst step matches a given step).
      nativeBurstStep:  redHoodBurstStep(config, cfg) ?? cfg.nativeBurstStep ?? cfg.burstStep ?? 'Step3',
      // CDN native "change burst step" (change_burst_step): the burst step the engine advances to
      // after this unit fires its burst skill (e.g., Step2 for most B1 units).
      nativeChangeBurstStep: cfg.nativeChangeBurstStep ?? cfg._nikkeData?.change_burst_step ?? null,
      // Current "change burst step" — can be overridden by skills at runtime.
      // Example: Anis: Star in Everyone's Star mode sets this to 'Step1' (re-enters Stage 1).
      changeBurstStep:  cfg.changeBurstStep ?? cfg.nativeChangeBurstStep
                        ?? cfg._nikkeData?.change_burst_step ?? null,
      // 游戏内小队归属（如 "777"），用于"同小队友军存活"条件判断。
      // 来源为 CDN _nikkeData.squad；技能条件依赖此字段非 null。
      squad:            cfg._nikkeData?.squad ?? null,
      stats,
      baseAmmo,         // CDN base ammo (no OL, no fav%); anchor for recalcMaxAmmo 百分比计算
      favMaxAmmoFlat,   // Math.round(baseAmmo × favAmmoPct)；init 时推入 Fav Ammo 永久 buff
      // maxAmmo: getter 由 initUnitMaxAmmo 安装，只能通过 recalcMaxAmmo 更新
      ammoLeft:         0,   // initUnitMaxAmmo 写入真实初值
      reloadTick:       0,
      // UP 型蓄力武器后摇期间换弹（§4.3.9）：后摇内可完成的换弹预定完成 tick；0 = 无
      backswingReloadTick: 0,
      // UP 型蓄力武器最近一次射击 tick：打空换弹时后摇与换弹同时计时（§4.3.6）
      lastChargeShotTick:  -Infinity,
      ammoBeforeHidden: 0,   // non-zero only during a HIDDEN phase with a voluntary reload in progress
      // Per-unit reload duration (ticks). 必须由调用方提供（validateUnitConfig 已校验）。
      reloadTicks:      cfg.reloadTicks,
      // Charge time gating for SR/RL weapons (ticks between shots due to hold-to-charge).
      // 0 for non-charge weapons (AR/SMG/MG/SG).
      // UP 型（松手触发）：发间 = foreswingTicks + effectiveCharge + backswingTicks。
      // DOWN_Charge 型（持续按住，如 Liberalio）：发间 = effectiveCharge 仅蓄力，不含前后摇。
      chargeTimeTicks,
      foreswingTicks,
      backswingTicks,
      hiddenResetBackswingTicks,
      // 非蓄力武器换弹后摇（spot_last_delay）；蓄力武器为 0。仅用于换弹时长。
      reloadRecoveryTicks,
      // 非蓄力武器对准期 ticks（spot_first_delay）；aimReadyTick 之前不射击（射击累加器照常累积，封顶 1）。
      //   · 开局：初次对准目标，首发 @reloadAimTicks（同蓄力武器首发含前摇）。
      //     实测（2026-10-12，Tove spot_first_delay 33cs = 20t）：第 2/3 发 @22/28 帧（720 RPM 5t 发间），
      //     首发约 @16–17 帧，与 20t 对准差 3 帧左右（Anis: Star 首发实测 70 帧 vs 前摇 12 + 蓄力 60 = 72，同向偏差）。
      //   · 换弹完成后：aimReadyTick = 换弹完成 + reloadAimTicks（见装填路径）。
      reloadAimTicks,
      aimReadyTick:     reloadAimTicks,
      isDownCharge,
      // Initial chargeTick: foreswing + charge only (no backswing before first shot).
      // DOWN_Charge 型第 1 发仍含前摇（初次对准目标）。
      // 装备词条 / 魔方蓄速（stats.chargeSpeedPct）开局即生效，先于任何角色动作与技能，
      // 故首发蓄力同样应用此加成（技能 buff 此时尚未推入）。
      chargeTick:       foreswingTicks
        + Math.round(chargeTimeTicks * (1 - Math.min(0.99, stats.chargeSpeedPct ?? 0))),
      // 引擎排定蓄力的分解（scheduleEngineCharge / rescheduleEngineCharge）：
      // chargeTick = chargeBaseTick + chargeFixedTicks + 当前有效蓄力；engineChargeTick 记录引擎排定值，
      // 与 chargeTick 不等说明技能 handler 已显式改写，不再重算。开局：起点 0 + 前摇 + 蓄力。
      chargeBaseTick:   0,
      chargeFixedTicks: foreswingTicks,
      engineChargeTick: isChargWeapon
        ? foreswingTicks + Math.round(chargeTimeTicks * (1 - Math.min(0.99, stats.chargeSpeedPct ?? 0)))
        : null,
      // Permanent equipment ATK% multiplier (item "Increase ATK" + option ATK%).
      // Added to atkPct in getBuffSums so it stacks additively with skill ATK% buffs.
      equipAtkPct:              stats.equipAtkPct  ?? 0,
      // Permanent equipment flat ATK from option rolls (OL atkFlat).
      // Added to atkFlat in getBuffSums; excluded from stats.atk so that skill
      // calculations referencing "X% of caster's ATK" use base ATK only.
      equipAtkFlat:             stats.equipAtkFlat ?? 0,
      // Fire rate from CDN shot_detail.rate_of_fire (RPM). 0 = use ATTACK_SPEED fallback.
      rateOfFire: (() => {
        const v = cfg.rateOfFire ?? cfg._nikkeData?.shot_detail?.rate_of_fire;
        if (v === undefined) {
          const err = `[initBattle] 角色「${cfg.name}」缺少 rateOfFire（cfg 与 CDN 均无此字段）`;
          console.error(err, cfg);
          throw new Error(err);
        }
        return v;
      })(),
      // Normal shot hit multiplier from shot_detail.damage / 10000.
      // Prefer explicit cfg value, then derive from _nikkeData.
      shotDamageMult: (() => {
        const v = cfg.shotDamageMult
          ?? (cfg._nikkeData?.shot_detail?.damage != null ? cfg._nikkeData.shot_detail.damage / 10000 : undefined);
        if (v == null) {
          const err = `[initBattle] 角色「${cfg.name}」缺少 shotDamageMult（cfg 与 CDN shot_detail.damage 均缺失）`;
          console.error(err, cfg);
          throw new Error(err);
        }
        return v;
      })(),
      // 双枪（shot_detail.muzzle_count === 2）：普通攻击武器伤害系数 ×2，切换武器默认同样 ×2
      //   （技能可设 skillState.weaponSwitchDualGun = false 排除，如 Zwei 爆裂已用双重命中体现双枪）。
      //   实机：SMG / RL 每次射击造成 2 次伤害；SG 弹丸数不变、每颗弹丸伤害翻倍。
      //   引擎统一按「武器伤害系数 ×2」结算（命中次数仍计 1 次，按命中次数触发的技能不翻倍）。
      //   已核对：K (41)（含爆裂切换 SG）、Zwei (390)。
      //   TODO: Quency: Escape Queen (403) 双枪普攻未审核（技能未建模）；其余双枪角色
      //         （Crow 110 / Soline 71 / Quency 402 / Aigis 872 / Noah 232）建模时按双枪机制核对。
      dualGunMult: cfg.dualGunMult
        ?? (cfg._nikkeData?.shot_detail?.muzzle_count === 2 ? DUAL_GUN_MULT : 1),
      // Core hit damage increment: (core_damage_rate/10000) - 1 - BASE_CORE_DAMAGE (which is 1.0).
      // e.g. core_damage_rate=25000 → ×2.5 total → coreDmgIncrement=0.5
      coreDmgIncrement: (() => {
        if (cfg.coreDmgIncrement != null) return cfg.coreDmgIncrement;
        const rate = cfg._nikkeData?.shot_detail?.core_damage_rate;
        if (rate == null) {
          const err = `[initBattle] 角色「${cfg.name}」缺少 coreDmgIncrement（cfg 与 CDN shot_detail.core_damage_rate 均缺失）`;
          console.error(err, cfg);
          throw new Error(err);
        }
        return (rate / 10000) - 1 - 1;
      })(),
      // Full charge damage value from shot_detail (10000 = ×1.0 baseline).
      fullChargeDamage: (() => {
        if (cfg.fullChargeDamage == null) {
          const err = `[initBattle] 角色「${cfg.name}」缺少 fullChargeDamage`;
          console.error(err, cfg);
          throw new Error(err);
        }
        return cfg.fullChargeDamage;
      })(),
      // Per-shot burst energy contribution to the shared state.burstGauge.
      // burstEnergyPerShot: energy when hitting cover/missing (burst_energy_pershot).
      // targetBurstEnergyPerShot: energy when hitting the enemy target (target_burst_energy_pershot).
      // All shots and skill hits in this simulator hit the target → use targetBurstEnergyPerShot
      // for the main shot loop and all skill-hit addBurstGauge calls.
      // Full-charge energy = targetBurstEnergyPerShot × (fullChargeDamage / 10000).
      burstEnergyPerShot: (() => {
        if (cfg.burstEnergyPerShot == null) {
          const err = `[initBattle] 角色「${cfg.name}」缺少 burstEnergyPerShot`;
          console.error(err, cfg);
          throw new Error(err);
        }
        return cfg.burstEnergyPerShot;
      })(),
      targetBurstEnergyPerShot: (() => {
        const v = cfg.targetBurstEnergyPerShot
                  ?? cfg._nikkeData?.shot_detail?.target_burst_energy_pershot;
        if (v == null) throw new Error(`[initBattle] 角色「${cfg.name}」缺少 targetBurstEnergyPerShot`);
        return v;
      })(),
      // 全蓄力充能系数（百分比，单位 /10000）。仅 Focus 状态的蓄力角色生效：
      //   Focus 蓄力普通攻击充能 = targetBurstEnergyPerShot × (fullChargeBurstEnergy / 10000)。
      // 非Focus / 非蓄力武器：充能 = targetBurstEnergyPerShot（无倍率）。
      // 来源 CDN shot_detail.full_charge_burst_energy（与 full_charge_damage 同源但语义为"充能"）。
      fullChargeBurstEnergy: cfg.fullChargeBurstEnergy
                             ?? cfg._nikkeData?.shot_detail?.full_charge_burst_energy ?? 0,
      // 受控（Focus）角色标记。实机同时仅 1 个，可随时切换；模拟器中由用户在 UI 指定 1 个。
      // 仅影响蓄力武器的充能倍率（见上）。
      isFocus: cfg.isFocus ?? false,
      // 队伍站位（0–4，含空位）。空位不进入 squad，但占据位置：相邻 / 前后排等位置判定一律用 position
      // （实测：Trina 与 Flora 之间隔一个空位时互不相邻）。未提供时按 squad 顺序。
      position: cfg.position ?? idx,
      // Fav item "Normal Attack Damage Multiplier ▲" (SMG/SG items) — independent multiplier on baseDamage.
      favNormalAttackDamageMult: 1 + (collFx?.attackDmgPct ?? 0),
      // Fav item "Charge Damage Multiplier ▲" (SR/RL items) — multiplies shot_detail.damage specifically.
      favChargeDmgPct:          collFx?.chargeDmgPct ?? 0,
      // 普通射击核心命中率现由几何模型 accuracy.js:coreHitChance 计算（散布圆 vs 核心透视半径，
      // 受 HitRate 收圆），不再使用按武器类型硬编码的 coreHitRateMult。武器切换仍用切换武器类型的
      // 内联常量（见射击循环 pCore 分支）。cfg.coreHitRateMult 仅供个别测试覆盖。
      coreHitRateMult:          cfg.coreHitRateMult ?? 1,
      // SG 武器每次射击发射的弹丸数（shot_detail.shot_count）。
      // 每发弹丸造成 1/N 的普通攻击伤害（shot_detail.damage 为所有弹丸合计）。
      // 技能改变弹丸数时，每次射击总伤害不变，仅改变单发弹丸伤害。
      // 当前模拟器中弹丸数不影响伤害计算（100% 命中假设），仅供技能逻辑查询。
      shotCount:                cfg.shotCount ?? (cfg._nikkeData?.shot_detail?.shot_count ?? 1),
      // 分段装填比例（reload_bullet / 10000）。每次装填动作恢复 round(maxAmmo × reloadFraction) 发。
      // 1.0 = 一次装满（默认）；< 1.0 = 分段装填（如 Drake = 0.33，3 段装满）。
      reloadFraction: (() => {
        if (cfg.reloadFraction != null) return cfg.reloadFraction;
        const rb = cfg._nikkeData?.shot_detail?.reload_bullet;
        if (rb == null) {
          const err = `[initBattle] 角色「${cfg.name}」缺少 reloadFraction（cfg 与 CDN shot_detail.reload_bullet 均缺失）`;
          console.error(err, cfg);
          throw new Error(err);
        }
        return rb / 10000;
      })(),
      // false → unit fills gauge and participates in squad burst trigger, but never fires burst skill.
      // Useful for B3 units that are in the squad but excluded from the active rotation.
      canBurst:                 cfg.canBurst ?? true,
      // true → skill-based Charge Speed buffs (chargeSpeedPct on buff objects) do not apply to this unit.
      // Equipment and cube chargeSpeedPct from stats always applies regardless.
      // Used for Liberalio whose S2 P3 grants immunity to skill/buff-based CS effects.
      immuneSkillChargeSpeed:   cfg.immuneSkillChargeSpeed ?? false,
      // true → unit is in Combat Assist status (filling a burst step that is not its native step).
      // Set explicitly via cfg.combatAssist; re-evaluated at BATTLE_START and FULL_BURST_END
      // by SKILL_TRAITS triggers (see skill-traits.js entry for this character).
      configuredCombatAssist: cfg.combatAssist ?? false,
      combatAssistStatus: cfg.combatAssist ?? false,
      // 爆裂技能剩余冷却（ticks）。0 表示已可释放，每 tick 递减 1。
      // 爆裂技能开局 CD = 0（立即就绪）；其他普通/被动技能若有 CD，须在其 handler 中自行管理。
      // 减 CD 技能：u.burstCdRemaining = Math.max(0, u.burstCdRemaining - ticks)
      burstCdRemaining:         0,
      // Burst skill cooltime in ticks (from CDN ulti_skill_detail.skill_cooltime_list / 100 * 60).
      // 必须由调用方提供（validateUnitConfig 已校验）。
      burstSkillCooltime:       cfg.burstSkillCooltime,
      totalDamage:      0,
      hitCount:         0,
      critCount:        0,
      reloadCount:      0,
      burstCount:       0,
      // Tick at which the current reload started. Used to compute partial ammo on phase interrupt.
      reloadStartTick:  0,
      // Per-unit HP and shield (shield absorbs incoming damage before HP)
      unitHp:           stats.hp,
      shieldHp:         0,
      shieldEndTick:    0,
      // Fractional shot accumulator for rate_of_fire weapons (AR/SMG/MG/SG).
      // 消除逐 tick 取整损失（如 SMG 1440 RPM = 0.4 发/tick）；每 tick 发数封顶 1（见 MAX_SHOTS_PER_TICK）。
      // 种子 1：非蓄力武器开局/换弹后第一发立即击发（真机枪已对准），而非空等一个完整射击间隔。
      // 蓄力武器不读累加器，保持 0。
      // 种子 1 → 非蓄力武器第一发立即击发；蓄力武器与 MG 起速武器种子 0 →
      // 第一发需等满（蓄力时长 / 起始 RPM 发间），MG 起速武器据此保留最慢的预热首发。
      shotAccumulator:  (isChargWeapon || hasMgRamp) ? 0 : 1,
      skillState: {},
      // 命中率散布 ramp 运行态（accuracy.js）。核心命中率几何模型使用。
      accAlwaysCore:     accProfile.alwaysCore,
      accStartScale:     accProfile.startScale,
      accEndScale:       accProfile.endScale,
      accChangePerShot:  accProfile.changePerShot,
      accRecoverPerTick: accProfile.changeSpeed / TICK_RATE,
      accCurrentScale:   accProfile.startScale,
      // 距离优势区间（各角色 CDN bonusrange_min/max）。
      bonusRangeMin:     cfg._nikkeData?.bonusrange_min ?? cfg.bonusRangeMin ?? 0,
      bonusRangeMax:     cfg._nikkeData?.bonusrange_max ?? cfg.bonusRangeMax ?? 0,
      // 弹速（CDN spot_projectile_speed）：RL 飞行时间按弹速缩放，影响敌人移动时的核心命中（rlCoreHitRate）。
      projectileSpeed:   cfg._nikkeData?.shot_detail?.spot_projectile_speed ?? cfg.projectileSpeed ?? null,
      // MG 武器逐发起速参数（非 MG 或无起速时均为 null）。
      // 保存在单位上而非 skillState，因为这是武器物理属性，不是技能效果。
      mgCurrentRof:       cfg._nikkeData?.shot_detail?.rate_of_fire_change_pershot > 0
                              ? (cfg._nikkeData.shot_detail.rate_of_fire ?? 60) : null,
      mgMaxRof:           cfg._nikkeData?.shot_detail?.rate_of_fire_change_pershot > 0
                              ? (cfg._nikkeData.shot_detail.end_rate_of_fire ?? 4200) : null,
      mgRofChangePerShot: cfg._nikkeData?.shot_detail?.rate_of_fire_change_pershot > 0
                              ? cfg._nikkeData.shot_detail.rate_of_fire_change_pershot : null,
      mgStartRof:         cfg._nikkeData?.shot_detail?.rate_of_fire ?? null,
      mgRofDecayPerTick:  (() => {
        const sd = cfg._nikkeData?.shot_detail;
        if (!sd?.rate_of_fire_change_pershot || !sd?.rate_of_fire_reset_time) return 0;
        const resetSecs = sd.rate_of_fire_reset_time / 100;
        if (resetSecs <= 0) return 0;
        return ((sd.end_rate_of_fire ?? 4200) - (sd.rate_of_fire ?? 60)) / (resetSecs * TICK_RATE);
      })(),
      // Bastion Cube Skill 1（Reload Up HC）：每 N 发弹药立即补充 M 发。
      // triggerRounds=0 表示未装备 Bastion 或魔方无此技能。
      bastionShotCount: 0,
      bastionTriggerRounds: (() => {
        const sk  = cfg._cubeData?.harmonycube_skill_group?.[0];
        if (!sk?.description_localkey?.includes('when firing')) return 0;
        const lvArr   = cfg._cubeData.level1 ?? [];
        const idx     = Math.min(cfg.cubeLevel ?? lvArr.length - 1, lvArr.length - 1);
        const skillLv = lvArr[idx] ?? 0;
        return skillLv > 0 ? parseInt(sk.description_value_list?.[0]?.description_value?.[skillLv - 1] ?? '0', 10) : 0;
      })(),
      bastionReloadRounds: (() => {
        const sk  = cfg._cubeData?.harmonycube_skill_group?.[0];
        if (!sk?.description_localkey?.includes('when firing')) return 0;
        const lvArr   = cfg._cubeData.level1 ?? [];
        const idx     = Math.min(cfg.cubeLevel ?? lvArr.length - 1, lvArr.length - 1);
        const skillLv = lvArr[idx] ?? 0;
        return skillLv > 0 ? parseFloat(sk.description_value_list?.[1]?.description_value?.[skillLv - 1] ?? '0') : 0;
      })(),
      ssrFavSkills,
      // 技能等级（skill1/skill2/burst），默认均为 Lv.10
      skillLevels:  cfg.skillLevels ?? [10, 10, 10],
      // SSR 珍藏品时用珍藏品技能数据覆盖角色原始技能，其余情况读角色 CDN 数据
      rawSkill1:    ssrFavSkills?.skill1 ?? cfg._nikkeData?.skill1_detail    ?? null,
      rawSkill2:    ssrFavSkills?.skill2 ?? cfg._nikkeData?.skill2_detail    ?? null,
      rawBurst:     ssrFavSkills?.burst  ?? cfg._nikkeData?.ulti_skill_detail ?? null,
    };
    // 安装 maxAmmo 只读 getter（只能通过 recalcMaxAmmo 写入），同时设置 ammoLeft 初值。
    initUnitMaxAmmo(unit, initialMaxAmmo);
    // 最后一轮爆裂策略：仅在战斗最后一个爆裂循环中使用爆裂技能
    // （EBS = Elegg: Boom and Shock 502；MIR = Maiden: Ice Rose 183）
    if (config.ebsLastBurstOnly && cfg.characterId === 502) unit.lastBurstOnly = true;
    if (config.mirLastBurstOnly && cfg.characterId === 183) unit.lastBurstOnly = true;
    // Cinderella: Crystal Wave（515）手动打法：进入战斗时切换到 Snipe Mode（515.js 据此执行
    // 「射击 1 发 → 主动装填 → 射击 1 发 → 主动装填」的切枪流程）。
    if (config.ccwSnipeModeAtStart && cfg.characterId === 515) unit.ccwSnipeModeAtStart = true;
    // 速充（config.quickChargeMode：'always' / 'untilFull'，见 quickChargeWanted）：仅 Focus 的 UP 型 SR/RL
    // （DOWN_Charge 型按住自动全蓄力击发，无法提前松手）。开局处于充能阶段，第一发即为速充攻击。
    unit.quickChargeMode   = null;
    unit.qcShotTick        = null;   // 已排定的速充发 tick（chargeTick 等于它时本发为速充攻击）
    unit.qcFinisherFbTick  = null;   // 已开始收尾的全爆裂结束 tick（每轮全爆裂只收尾一次）
    unit.qcFinisherPending = false;  // 收尾全蓄力发尚未打出
    unit.manualReload      = false;  // 手动换弹进行中（弹匣未空；速充收尾 / 百暴停火前换弹）
    if ((config.quickChargeMode === 'always' || config.quickChargeMode === 'untilFull')
        && unit.isFocus && chargeTimeTicks > 0 && !isDownCharge) {
      unit.quickChargeMode  = config.quickChargeMode;
      unit.chargeTick       = QUICK_CHARGE_SHOT_TICKS;
      unit.engineChargeTick = null;
      unit.qcShotTick       = QUICK_CHARGE_SHOT_TICKS;
    }
    // 百暴（config.fullCritCharIds：选中角色的 resource_id 列表，见 fullCritHoldActive）
    unit.fullCritHold    = Array.isArray(config.fullCritCharIds) && config.fullCritCharIds.includes(cfg.characterId);
    unit.fullCritHolding = false;  // 本轮全爆裂停火中（停火结束时据此重新排定攻击）
    return unit;
  });

  // Mast: Romantic Maid（354）爆裂轮次策略（config.mastBurstMode，默认 auto = CD 好了就开）：
  //   drunken3 — 仅在 Drunken 3 层的轮次施放 B2
  //   b3a/b3b  — 仅在队伍中第 1 / 第 2 名 B3（含 StepFull）施放 B3 的轮次施放 B2
  const mastUnit = squad.find(u => u.id === 354);
  if (mastUnit && config.mastBurstMode === 'drunken3') {
    mastUnit.burstRoundPolicy = { mode: 'drunken3' };
  } else if (mastUnit && (config.mastBurstMode === 'b3a' || config.mastBurstMode === 'b3b')) {
    const b3Units = squad.filter(u => u.burstStep === 'Step3' || u.burstStep === 'StepFull');
    const b3 = b3Units[config.mastBurstMode === 'b3a' ? 0 : 1];
    if (b3) mastUnit.burstRoundPolicy = { mode: 'withB3', b3Id: b3.id };
  }

  // Red Hood（470，AllStep）爆裂用法（config.rhBurstMode，默认 b3 = 纯 B3）：
  //   b1odd / b1even — 作为 B1（burstStep 已在单位构建时改为 Step1），仅在奇数 / 偶数轮施放
  //   b1r1b3     — 第 1 轮施放 B1（Beast Cage 冷却 ▼40s），其余与 b3 相同：B3 按站位从左到右选择（含第 1 轮）
  //   b1r2b3even — 第 2 轮施放 B1；B3 仅在偶数轮施放且无视站位优先（含第 2 轮），奇数轮不施放 B3
  const rhUnit = squad.find(u => u.id === RED_HOOD_ID);
  if (rhUnit && (config.rhBurstMode === 'b1odd' || config.rhBurstMode === 'b1even')) {
    rhUnit.burstRoundPolicy = { mode: 'parity', parity: config.rhBurstMode === 'b1odd' ? 1 : 0 };
  } else if (rhUnit && config.rhBurstMode === 'b1r1b3') {
    rhUnit.burstRoundPolicy = { mode: 'b1Once', b1Cycle: 1 };
  } else if (rhUnit && config.rhBurstMode === 'b1r2b3even') {
    rhUnit.burstRoundPolicy = { mode: 'b1Once', b1Cycle: 2, b3Parity: 0 };
  }

  // 爆裂阶段间隔（ticks）：槽满→B1、B1→B2、B2→B3 各等待此时长。
  // config.burstStepSecs 范围 0.1–0.4；默认 0.4 秒（自动战斗实测值，且为上限）。
  const burstStepTicks = Math.round(TICK_RATE * Math.max(0.1, Math.min(BURST_STEP_SECS_MAX, config.burstStepSecs ?? BURST_STEP_SECS_MAX)));

  // Enemy phase schedule: array of { startTick, zone } sorted ascending.
  // If config.enemy.phases is provided it overrides the default schedule.
  const enemyPhases = config.enemy.phases ?? [];
  const initialZone = getPhaseAtTick(enemyPhases, 0);

  const state = {
    squad,
    // 敌人最大 HP（用于技能伤害守卫 `state.enemyHp > 0`）。
    // 当前模拟器不追踪 HP 递减，使用 Infinity 令守卫始终通过（DPS 全程模拟模式）。
    enemyHp:            config.enemy.hp ?? Infinity,
    enemyDef:           config.enemy.def ?? 0,
    enemyElement:       config.enemy.element ?? 'Iron',
    isStageTarget:      true,
    enemyHasCore:         config.enemy.hasCore ?? false,
    enemyCoreProtected:   config.enemy.coreProtected ?? false,
    // 零件核心（Ultra / Material H / Storm Bringer）：核心为无限血量零件。
    // 核心命中同时算核心命中与零件命中（加成与触发均生效）；穿透命中核心额外产生一次本体伤害。
    // 爆炸（RL / projectile explosion）命中不会像普通零件那样对零件+本体各结算一次，仅结算一次。
    enemyCoreIsParts:     config.enemy.coreIsParts ?? false,
    // 敌人连续距离（0..100，与 bonusrange 同刻度）。由相位时间表派生；null=不可瞄准（无优势）。
    // config.enemy.distance 可整体覆盖（legacy / test；接受数字或旧 zone 标签）。
    enemyDistance:      phaseToDistance(config.enemy.distance ?? initialZone),
    // Phase schedule and current zone tracker（HIDDEN 停火判定用 currentPhaseZone）。
    enemyPhases,
    currentPhaseZone:   initialZone,
    // 命中率核心命中模型校准常量（敌人配置 UI 可覆盖）。
    accCore0:           config.enemy.core0   ?? CORE0_DEFAULT,
    accD0:              config.enemy.d0      ?? D0_DEFAULT,
    accHitCoef:         config.enemy.hitCoef ?? HITRATE_CORE_COEF_DEFAULT,
    // 实战命中校正：SG 弹丸命中率（默认 1 = 理想命中）。
    accSgHitRate:       config.enemy.sgHitRate  ?? SG_PELLET_HIT_RATE_DEFAULT,
    // 敌人横向移动区间（[startTick, endTick)，speed 速度档）：RL / 弹道技能核心判定用（rlCoreHitRate）
    enemyLateralMoves:  config.enemy.lateralMoves ?? [],
    // Anis: Star 的 Shooting Stars 核心命中率修正系数（界面选项，默认 1）
    starCoreCoef:       config.starCoreCoef ?? 1,
    // 防御力/核心状态的定时行动（startTick 升序，不含初始值）
    enemyDefActions:    config.enemy.defActions  ?? [],
    enemyCoreActions:   config.enemy.coreActions ?? [],
    tick:               0,
    burstStepTicks,
    // 模拟选项「在敌人隐藏时继续开爆裂」：默认 false = 停火区段内不施放爆裂（自动战斗实测）
    burstDuringHidden:  config.burstDuringHidden === true,
    fullBurstActive:    false,
    fullBurstTick:      0,
    burstPhase:         0,
    // B1 施放者 changeBurstStep==='Step1' 时置 true：B1 延迟结束后停留在阶段 1（见 advanceAfterBurstI）
    burstReenterStage1: false,
    // When set to an array, every damage hit (normal and skill) appends a detail record.
    hitLog:             config.hitLog ? [] : null,
    buffLog:            config.hitLog ? [] : null,
    ammoLog:            config.hitLog ? [] : null,
    // When set to an array, every burst gauge change while burstPhase===0 appends a record.
    // { tick, unitName, source, energyAdded, gaugeAfter }
    burstEnergyLog:     config.burstEnergyLog ? [] : null,
    burstPhaseTick:     0,
    // 槽满后 B1 最早可施放的 tick（槽满 + burstStepTicks）：进入阶段 1 到 B1 施放之间同样有延迟。
    burstB1ReadyTick:   0,
    // Tick at which the current burst phase (1 or 2) times out if not advanced.
    // 0 when not in a timed phase. If state.tick >= burstPhaseTimeoutTick and phase is still 1 or 2,
    // the burst collapses and gauges reset to 0.
    burstPhaseTimeoutTick: 0,
    // Active buffs: { name, unitId (null=all), atkPct, atkFlat, defFlat,
    //                attackDamagePct, critRatePct, chargeDamagePct, reloadSpeedPct, endTick }
    buffs:              [],
    totalAmmoFired:     0,
    lastMilestone400:   0,   // how many 400-ammo milestones have been crossed
    lastMilestone500:   0,   // how many 500-ammo milestones have been crossed
    // Shared burst gauge (0..BURST_GAUGE_MAX). All units contribute via their shots/skills.
    // Rotation triggers when >= BURST_GAUGE_MAX; resets to 0 after Full Burst ends.
    burstGauge:         0,
    // Set of unit IDs that successfully fired their burst skill in the current rotation.
    // Populated during applyBurstISkills / applyBurstIISkills / applyFullBurstSkills.
    // Cleared when a new rotation begins (gauge fills → burstPhase 0→1).
    burstCastersThisRotation: new Set(),
    // 本 tick 内被推入含 chargeSpeedPct 的 buff 的单位 ID 集合。
    // 由 pushBuff → _trackCsChange 填充，由 flushCsChanged 消费分派 CS_BUFF_CHANGED。
    _pendingCsChangedIds:     new Set(),
    // 全队普通攻击命中计数，由 skill-executor.onShotFired 在每次射击时自增。
    squadShotCount: 0,
    fullBurstCount: 0,
    // EBS 最后一轮策略：追踪 burst 循环节奏
    lastBurstEndTick:    0,  // 上次 full burst 结束的 tick（初始=0=战斗开始）
    burstCycleStartTick: 0,  // 当前循环 burst gauge 填满（burstPhase 0→1）时的 tick
    // 爆裂轮次序号：槽满进入阶段 1 时自增（第 1 轮 = 1，含超时取消的轮次）；轮次策略 parity / b1Once 使用
    burstCycleCount:     0,
    // Deferred skill hits: [{ fireTick, caster, mult, sums, isCharged, label, opts }]
    // Processed at the start of each tick before unit loops.
    pendingSkillHits: [],
    // B3 施放期间 { casterId, delayTicks }，其余时刻 null（见 applyFullBurstSkills）
    b3Cast:           null,
    // executeSkillTriggers 内部标记：当前正在执行 B3 施放者爆裂技能 handler 时为其 id
    _deferB3HitsFor:  null,
    // Queue of units that received heals this tick. Populated by applyHeal (battle-utils).
    // Consumed by flushHealReceived() which dispatches HEAL_RECEIVED triggers.
    pendingHealReceived: [],
    // 当前 HP 发生变化的单位（unitId → { unit, prevHp }），由 battle-utils 写入 HP 时填充，
    // flushHpEvents → dispatchHpChanged 派发 HP_CHANGED。
    pendingHpChanged: new Map(),
    // Queue of units that received shields this tick. Populated by applyShield (battle-utils).
    // Consumed by flushShieldReceived() which dispatches APPLY_SHIELD triggers per unit.
    pendingShieldReceived: [],
    // 共享护盾（shared shield，如 Centi S2）：单一护盾池，由 applySharedShield 写入；
    // 不计入任何单位的 shieldHp，也不派发 APPLY_SHIELD。
    sharedShieldHp:      0,
    sharedShieldEndTick: 0,
    // Flag set when applyCoverHeal() is called (battle-utils). Consumed by flushCoverHeal()
    // which dispatches COVER_HEAL team trigger (e.g. Naga S1 Part1).
    pendingCoverHeal: false,
    // Scheduled periodic heals: [{ fireTick, targetId, amount }]
    // Processed each tick before unit loops; each entry calls applyHeal + flushHealReceived.
    pendingHoTs: [],
    // 在 ENTER_FULL_BURST 效果生效后再触发的命中（如 Cinderella S3 Part2）。
    // [{ caster, mult, sums, isCharged, label, opts }]
    pendingFireInBurstHits: [],
    // 持续伤害（DoT）池：见 battle-utils.js fireDotPool 注释中的字段说明。
    dots: [],
    // 技能触发事件缓冲区，由 skill-executor 在满足白名单触发条件时填充，每 tick 开始时排入 events。
    pendingSkillEvents: [],
    // 全局日志序列号，每次向 hitLog / buffLog / events 推送时自增。
    // full-damage-trace.mjs 以 _seq 作为同 tick 事件的次级排序键，还原真实执行顺序。
    _logSeq: 0,
  };

  // OL 装备词条（equipMaxAmmoPct）和珍藏品（favMaxAmmoFlat）作为永久 buff 推入，
  // 由 recalcMaxAmmo 统一通过 getBuffSums 读取（§5.1 第二期）。
  // 直接写入 state.buffs 避免 buffLog 噪声；之后调用 recalcMaxAmmo 更新 unit.maxAmmo。
  for (const unit of state.squad) {
    if ((unit.stats.equipMaxAmmoPct ?? 0) !== 0)
      state.buffs.push({ name: 'OL Ammo', unitId: unit.id, maxAmmoPct: unit.stats.equipMaxAmmoPct, endTick: Infinity });
    if ((unit.favMaxAmmoFlat ?? 0) !== 0)
      state.buffs.push({ name: 'Fav Ammo', unitId: unit.id, maxAmmoFlat: unit.favMaxAmmoFlat, endTick: Infinity });
    // 魔方开战永久 buff：换弹速度（Resilience Quick Reload HC）、Vigor Max HP / Destruction 零件 /
    // Piercing 穿透 / Rupture 真实 / Diffusion 分摊伤害。换弹时长与各伤害路径只从 getBuffSums 读取对应字段，
    // 故须作为永久 buff 推入，否则被静默丢弃。buff 名取魔方技能原名（stats.cubeBuffs），日志据此显示与翻译。
    if (unit.stats.cubeBuffs) {
      for (const cb of unit.stats.cubeBuffs) state.buffs.push({ ...cb, unitId: unit.id, endTick: Infinity });
    } else {
      // 兼容直接构造 stats（无 cubeBuffs）的调用方：按合计字段推入
      if ((unit.stats.reloadSpeedPct ?? 0) !== 0)
        state.buffs.push({ name: 'Cube Reload', unitId: unit.id, reloadSpeedPct: unit.stats.reloadSpeedPct, endTick: Infinity });
      const cubeBuffPcts = unit.stats.cubeBuffPcts ?? {};
      if (Object.keys(cubeBuffPcts).length > 0)
        state.buffs.push({ name: 'Cube', unitId: unit.id, ...cubeBuffPcts, endTick: Infinity });
    }
    recalcMaxAmmo(state, unit);   // 确认 unit.maxAmmo 与 initialMaxAmmo 一致
  }
  // 开战满血：当前 HP 对齐到含方块永久 buff（如 Vigor Max HP ▲）的最终 MaxHP
  for (const unit of state.squad) unit.unitHp = getFinalMaxHp(state, unit);

  // PROGRAM_INIT: 程序初始化阶段，仅用于 skillState 计数器/标志位归零，不写入战斗日志。
  executeSkillTriggers(state, 'PROGRAM_INIT');
  // BATTLE_START: dispatch all declarative battle-start triggers (e.g. LM Bubble debuff).
  executeSkillTriggers(state, 'BATTLE_START');
  flushCsChanged(state);
  flushHpEvents(state);
  flushShieldReceived(state);   // HP_CHANGED 触发的护盾（如 Flora S2 P1）→ APPLY_SHIELD（Flora S2 P3）

  // Note: fav item collection skill effects are applied at unit creation (favNormalAttackDamageMult,
  // favChargeDmgPct, maxAmmo via ammoPct). coreDmgPct is not modeled. DEF▲ etc. are ignored.

  return state;
}

/**
 * 将模拟推进一个 tick。
 * @param {BattleState} state
 * @returns {{ over: boolean, events: object[] }}
 */
export function tick(state) {
  if (state.tick >= MAX_TICKS) return { over: true, events: [] };

  const events = [];
  // 排入由 skill-executor 在上一 tick（或 BATTLE_START）写入的技能触发事件
  if (state.pendingSkillEvents.length) {
    events.push(...state.pendingSkillEvents);
    state.pendingSkillEvents = [];
  }
  state.tick++;

  // ── 敌人阶段切换 ───────────────────────────────────────────────────────────
  if (state.enemyPhases?.length > 0) {
    const newZone = getPhaseAtTick(state.enemyPhases, state.tick);
    if (newZone !== state.currentPhaseZone) {
      const wasHoldFire = isHoldFireZone(state.currentPhaseZone);
      state.currentPhaseZone = newZone;
      if (isHoldFireZone(newZone)) {
        // 进入停火区段（HIDDEN，或「跳起」的起跳段 JUMP）：所有单位停止攻击。
        //   HIDDEN 敌人完全不可攻击（DoT 仍正常造成伤害；延迟技能命中到期时落空记为「未命中」，
        //   见 tick() 延迟命中队列）；JUMP 敌人仍可被已打出的技能命中。
        // 跳起 JUMP → 空中 HIDDEN 属同一次停火，不重复执行以下进入逻辑。各单位按弹匣状态分流：
        //   · 弹匣已满，或正处于武器切换（特殊武器）中 → 待命，不装填、保留弹药。
        //   · 弹匣未满且非空（>0）→ 开始装填：保存当前弹药、将 ammoLeft 置 0，
        //     下一 tick 由装填机制接管。敌人再次出现时若装填未完成，弹药会恢复
        //     （自愿装填被打断，弹匣剩余不变）。
        //   · 弹匣已空（==0，本就在装填）→ 装填继续不中断。
        for (const u of (wasHoldFire ? [] : state.squad)) {
          const weaponSwitching = (u.skillState?.weaponSwitchEndTick ?? 0) > 0
            && state.tick <= u.skillState.weaponSwitchEndTick;
          if (weaponSwitching || u.ammoLeft >= u.maxAmmo) continue; // 待命，不装填
          if (u.ammoLeft > 0) {
            u.ammoBeforeHidden = u.ammoLeft;
            u.ammoLeft  = 0;
            u.reloadTick = 0; // 装填机制在下一 tick 接管
          }
          // ammoLeft==0 情况：原有装填继续自然进行
        }
      } else {
        // 进入可瞄准的相位 — 更新伤害计算用的连续距离（CANNOT_BE_AIMED → null，无优势）。
        state.enemyDistance = phaseToDistance(newZone);
        // 对自愿 HIDDEN 装填未完成的单位恢复原弹药。
        for (const u of state.squad) {
          if (u.ammoBeforeHidden > 0) {
            if (u.reloadTick > 0 && state.tick < u.reloadTick) {
              // 装填仍在进行 — 恢复原弹药并取消装填。
              events.push({ type: 'reload_interrupted', tick: state.tick, unitId: u.id, unitName: u.name, ammoRestored: u.ammoBeforeHidden, _seq: state._logSeq++ });
              u.ammoLeft   = u.ammoBeforeHidden;
              u.reloadTick = 0;
            }
            u.ammoBeforeHidden = 0;
          }
        }
        // 蓄力武器 HIDDEN 结束后需重新蓄力，chargeTick 重置（无论 HIDDEN 期间是否发生换弹）：
        //   DOWN_Charge 型（持续按住）：出 HIDDEN 的第一发等完整 effectiveCharge（受 RPM 发间下限约束）。
        //   UP 型（松手触发）：重置为完整发间（后摇+前摇+蓄力）。
        //   实测：Helm 180s=121发，完整发间重置(84t)预测精确匹配；不重置则预测125（每次HIDDEN多1发）。
        //   Scarlet:BS 233发同模型误差≤1发。
        //   后摇取 spot_last_delay（hiddenResetBackswingTicks），不取 maintain_fire_stance：
        //   Raven（mfs 83 → 50t，spot_last 20 → 12t）BIGARMS 落地 → 首发实测 84–87t（全爆裂计时器 1.44–1.45s），
        //   = 12 + 12 + 蓄力 58 = 82t，而非 50 + 12 + 58 = 120t。
        for (const u of state.squad) {
          // 非蓄力武器处于蓄力型切换武器期间（如 Cinderella: Crystal Wave Snipe Mode）：
          // 出 HIDDEN 后同样重新蓄力一次（切换武器固定蓄力时长，不含前后摇）。
          const switchCharge = (u.skillState?.weaponSwitchEndTick ?? 0) > 0
            && state.tick <= u.skillState.weaponSwitchEndTick
            ? (u.skillState.weaponSwitchChargeTimeTicks ?? 0) : 0;
          if (u.chargeTimeTicks <= 0 && switchCharge > 0) {
            u.chargeTick = state.tick + switchCharge;
            continue;
          }
          if (u.chargeTimeTicks <= 0) continue;
          scheduleEngineCharge(state, u, state.tick,
            u.isDownCharge ? 0 : u.hiddenResetBackswingTicks + u.foreswingTicks, getBuffSums(state, u.id));
        }
      }
      events.push({ type: 'phase_change', tick: state.tick, zone: newZone });
    }
  }

  // ── 敌人防御力行动 ──────────────────────────────────────────────────────────
  for (const a of state.enemyDefActions) {
    if (a.startTick === state.tick) {
      events.push({ type: 'enemy_action', tick: state.tick, actionType: 'def', value: a.value });
      state.enemyDef = a.value;
      break;
    }
  }

  // ── 敌人核心状态行动 ────────────────────────────────────────────────────────
  for (const a of state.enemyCoreActions) {
    if (a.startTick === state.tick) {
      events.push({ type: 'enemy_action', tick: state.tick, actionType: 'core', value: a.value });
      state.enemyHasCore        = a.value !== 'NONE';
      state.enemyCoreProtected  = a.value === 'PROTECTED';
      state.enemyCoreIsParts    = a.value === 'PARTS_CORE';
      break;
    }
  }

  // 清理过期 buff — 移除前收集需要重算 maxAmmo 的单位 ID，以及 CS buff 过期的单位 ID
  const _ammoRecalcIds  = new Set();
  const _csExpiredIds   = new Set();
  const _hpClampIds     = new Set();
  const _expiredBuffs   = [];
  for (const b of state.buffs) {
    if (b.endTick <= state.tick) {
      if (state.buffLog)
        state.buffLog.push({ type: 'buff_expire', tick: state.tick, name: b.name, unitId: b.unitId });
      if (b.maxAmmoPct != null || b.maxAmmoFlat != null) {
        if (b.unitId != null) {
          _ammoRecalcIds.add(b.unitId);
        } else {
          for (const u of state.squad) _ammoRecalcIds.add(u.id);
        }
      }
      // Max HP buff 到期 → 记录到期前的 HP / MaxHP（HP 比例变化派发 HP_CHANGED），
      // 再把当前 HP 截断到新的最终 MaxHP
      if (b.maxHpPct != null || b.maxHpFlat != null) {
        const affected = b.unitId != null ? state.squad.filter(u => u.id === b.unitId) : state.squad;
        markMaxHpChange(state, affected, { beforeTick: state.tick - 1 });
        for (const u of affected) _hpClampIds.add(u.id);
      }
      if (b.chargeSpeedPct) {
        if (b.unitId != null) {
          _csExpiredIds.add(b.unitId);
        } else {
          for (const u of state.squad) _csExpiredIds.add(u.id);
        }
      }
      _expiredBuffs.push(b);
    }
  }
  state.buffs = state.buffs.filter(b => b.endTick > state.tick);

  // maxAmmo 相关 buff 过期后重算（此时过期 buff 已从 state.buffs 移除）
  for (const uid of _ammoRecalcIds) {
    const u = state.squad.find(u => u.id === uid);
    if (u) recalcMaxAmmo(state, u);
  }
  for (const uid of _hpClampIds) {
    const u = state.squad.find(u => u.id === uid);
    if (u) clampHpToMax(state, u);
  }
  // 溢出治疗储存到期清理
  for (const u of state.squad) expireOverheal(state, u);
  if (_hpClampIds.size > 0) flushHpEvents(state);

  // CS buff 过期后通知受影响单位重算（此时过期 buff 已移除，getBuffSums 返回更新后的值）
  for (const uid of _csExpiredIds) {
    const u = state.squad.find(u => u.id === uid);
    if (u) executeSkillTriggers(state, 'CS_BUFF_CHANGED', { unit: u });
  }

  // BUFF_EXPIRE：过期 buff 已移除，逐个通知技能系统
  for (const b of _expiredBuffs) {
    executeSkillTriggers(state, 'BUFF_EXPIRE', { buffName: b.name, buffUnitId: b.unitId });
  }

  // ── 持续伤害（DoT）池 ────────────────────────────────────────────────────────
  if (state.dots?.length > 0) {
    fireDotPool(state);
  }

  // ── 持续治疗（HoT）队列 ────────────────────────────────────────────────────
  if (state.pendingHoTs?.length > 0) {
    const dueHeals = state.pendingHoTs.filter(h => h.fireTick <= state.tick);
    state.pendingHoTs = state.pendingHoTs.filter(h => h.fireTick > state.tick);
    for (const h of dueHeals) {
      const target = state.squad.find(u => u.id === h.targetId);
      // 治疗者（casterId）用于按触发时刻的治疗效能计算实际回复量
      const caster = h.casterId != null ? state.squad.find(u => u.id === h.casterId) ?? null : null;
      if (target) applyHeal(state, target, h.amount, null, caster);
    }
    if (dueHeals.length > 0) flushHealReceived(state);
  }

  // ── 延迟技能命中队列 ──────────────────────────────────────────────────────
  if (state.pendingSkillHits?.length > 0) {
    const due = state.pendingSkillHits.filter(h => h.fireTick <= state.tick);
    state.pendingSkillHits = state.pendingSkillHits.filter(h => h.fireTick > state.tick);
    for (const h of due) {
      // 可选到期回调：与本命中同时生效、须先于伤害结算的效果（如 Isabel 爆裂 P1 延迟生效的承伤 ▲）
      h.onDue?.(state);
      // 带延迟的技能伤害在敌人隐藏期间到达 → 落空：伤害 0，日志标为「未命中」
      if (!isEnemyHittable(state)) {
        logMissedSkillHit(state, h.caster, h.mult, h.label);
        continue;
      }
      // 兜底：受全爆裂补正的命中若在 B3 施放后、进入全爆裂前到期（含「进入全爆裂后 0s」的命中——
      // 本队列先于本 tick 的 enterFullBurst 处理），改由 enterFullBurst 在 ENTER_FULL_BURST 后结算
      if (h.opts?.affectedByFullBurst && state.burstPhase === 3 && !state.fullBurstActive) {
        state.pendingFireInBurstHits.push({ caster: h.caster, mult: h.mult, sums: h.sums ?? null,
          label: h.label, opts: h.opts });
        continue;
      }
      const sums = h.sums ?? getBuffSums(state, h.caster.id);
      fireSkillHit(state, h.caster, h.mult, sums, h.label, h.opts ?? {});
    }
  }

  // 清理过期的护盾
  for (const u of state.squad) {
    if (u.shieldHp > 0 && state.tick >= u.shieldEndTick) u.shieldHp = 0;
  }
  if (state.sharedShieldHp > 0 && state.tick >= state.sharedShieldEndTick) state.sharedShieldHp = 0;

  // ── 爆裂技能冷却递减 ─────────────────────────────────────────────────────────
  for (const u of state.squad) {
    if (u.burstCdRemaining > 0) u.burstCdRemaining--;
  }

  // ── 爆裂序列状态机 ─────────────────────────────────────────────

  // Full Burst 窗口到期 → 共享槽清零，团队需重新填充
  if (state.fullBurstActive && state.tick >= state.fullBurstTick) {
    state.fullBurstActive  = false;
    state.burstPhase       = 0;
    state.burstGauge       = 0;
    state.lastBurstEndTick = state.tick;
    events.push({ type: 'burst_end', tick: state.tick, gaugeAfter: 0 });
    applyBurstEndSkills(state);
  }

  // 爆裂阶段 1 / 2 / 3（B3 尚未施放）超时（各自 10 秒窗口）：若未推进，爆裂取消 → 槽归零
  if ((state.burstPhase === 1 || state.burstPhase === 2 ||
       (state.burstPhase === 3 && !state.fullBurstActive)) &&
      state.burstPhaseTimeoutTick > 0 && state.tick >= state.burstPhaseTimeoutTick) {
    state.burstPhase          = 0;
    state.burstPhaseTimeoutTick = 0;
    state.burstGauge          = 0;
    events.push({ type: 'burst_timeout', tick: state.tick, gaugeAfter: 0 });
  }

  // 阶段 1：等待槽满延迟结束且有 B1 单位冷却结束 — 每 tick 重试。
  // 槽满那一 tick 只进入阶段 1（触发 ENTER_BURST_I 被动），B1 最早在 burstStepTicks 后施放。
  // 停火区段（敌人跳起 / 隐藏）内默认不施放 B1 / B2 / B3（isBurstCastBlocked），落地后继续。
  const burstCastBlocked = isBurstCastBlocked(state);
  if (state.burstPhase === 1 && state.burstPhaseTick === Infinity && state.tick >= state.burstB1ReadyTick
      && !burstCastBlocked) {
    // _bSeq：在 executeSkillTriggers（BURST_SKILL_USE）运行前占用序列号，保证 burst_i 排在技能触发事件之前
    const _bSeq = state._logSeq++;
    const fired = applyBurstISkills(state);
    if (fired) {
      // 进入下一阶段的被动在 B1 施放后立即触发，然后才开始延迟
      advanceAfterBurstI(state, fired);
      if (fired.name != null) {
        const bev = { type: 'burst_i', tick: state.tick, unitName: fired.name, _seq: _bSeq };
        if (fired.combatAssistStatus != null) bev.isCA = !!fired.combatAssistStatus;
        events.push(bev);
      }
      if (fired.name === 'Liter') events.push({ type: 'heal_cover', tick: state.tick });
    }
  }

  // B1 延迟结束 → 推进到阶段 2（等待 B2 冷却）；重入阶段 1 时停留在阶段 1（等待其他 B1 冷却）
  if (state.burstPhase === 1 && state.burstPhaseTick !== Infinity && state.tick >= state.burstPhaseTick) {
    state.burstPhase          = state.burstReenterStage1 ? 1 : 2;
    state.burstReenterStage1  = false;
    state.burstPhaseTick      = Infinity;
    state.burstPhaseTimeoutTick = state.tick + TICK_RATE * 10;
  }

  // 阶段 2：等待 B2 冷却 — 每 tick 重试，直到有 B2 单位冷却结束。
  if (state.burstPhase === 2 && state.burstPhaseTick === Infinity && !burstCastBlocked) {
    const _bSeq = state._logSeq++;
    const fired = applyBurstIISkills(state);
    if (fired) {
      // 进入 B3 被动在 B2 施放后立即触发，然后才开始延迟
      applyEnterBurst3Passives(state);
      state.burstPhaseTick = state.tick + state.burstStepTicks;
      events.push({ type: 'burst_ii', tick: state.tick, unitName: fired.name, _seq: _bSeq });
    }
  }

  // B2 延迟结束 → 进入阶段 3，等待 B3 冷却（与 B1→B2 模式对称）
  if (state.burstPhase === 2 && state.burstPhaseTick !== Infinity && state.tick >= state.burstPhaseTick) {
    state.burstPhase            = 3;
    state.burstPhaseTick        = Infinity;
    state.burstPhaseTimeoutTick = state.tick + TICK_RATE * 10;
  }

  // 阶段 3：等待 B3 冷却 — 每 tick 重试，直到有 B3 单位冷却结束（或无 B3 单位则立即触发）。
  // fullBurstActive 由 applyFullBurstSkills 在 B3 全部施放完毕后设置（文档 §6.5 时序）。
  if (state.burstPhase === 3 && !state.fullBurstActive && state.burstPhaseTick === Infinity
      && !burstCastBlocked) {
    // lastBurstOnly：非最后一轮时跳过带策略标记的单位（其他 B3 照常触发全爆裂）
    const lastCycle = state.squad.some(u => u.lastBurstOnly) && isLastBurstCycle(state);
    const hasB3     = state.squad.some(u => isBurst3Candidate(state, u, lastCycle));
    const b3Ready   = !hasB3 || selectBurst3Unit(state) !== null;
    if (b3Ready) {
      state.burstPhaseTimeoutTick = 0;
      state.fullBurstCount++;
      for (const u of state.squad) u.burstCount++;
      applyFullBurstSkills(state, events);
      // B3 施放后固定 0.05s 再进入全爆裂（实测，无法通过操作缩短）
      state.burstPhaseTick = state.tick + FULL_BURST_ENTRY_DELAY_TICKS;
    }
  }

  // B3 施放后的固定延迟结束 → 进入全爆裂状态，开始 10s 窗口
  if (state.burstPhase === 3 && !state.fullBurstActive && state.burstPhaseTick !== Infinity
      && state.tick >= state.burstPhaseTick) {
    state.burstPhaseTick = Infinity;
    enterFullBurst(state, events);
    // 10s 全爆裂窗口；「Full Burst Time ▼ N sec」（如 Isabel 爆裂）由技能写入 fullBurstTimeReductionTicks，
    // 仅作用于本轮全爆裂，进入时消费并清零
    state.fullBurstTick = state.tick
      + Math.max(0, TICK_RATE * 10 - (state.fullBurstTimeReductionTicks ?? 0));
    state.fullBurstTimeReductionTicks = 0;
  }

  // 共享槽填满 → 进入阶段 1。B1 不在本 tick 施放：与 B1→B2、B2→B3 相同，槽满到 B1 施放
  // 之间也有 burstStepTicks 延迟（自动战斗实测 0.4s），由上方阶段 1 分支在延迟结束后施放。
  if (state.burstPhase === 0 && state.burstGauge >= BURST_GAUGE_MAX) {
    state.burstCycleStartTick  = state.tick;   // 记录本轮 gauge 填满时刻
    state.burstCycleCount++;
    state.burstPhase           = 1;
    state.burstPhaseTick       = Infinity;
    state.burstB1ReadyTick     = state.tick + state.burstStepTicks;
    state.burstPhaseTimeoutTick = state.tick + TICK_RATE * 10;
    state.burstCastersThisRotation = new Set();
    // 进入 Burst 1 阶段时立即触发被动（不依赖 B1 是否 cast）
    applyEnterBurst1Passives(state);
  }

  // ── 全程定时技能（INTERVAL）：如 Nayuta S2 Memory Absorption ──────────
  onInterval(state);

  // ── 全爆裂期间定时技能（INTERVAL_IN_BURST）：如 LM Bubble Wave ─────────
  if (state.fullBurstActive) {
    onIntervalInBurst(state);
    flushHealReceived(state);
  }

  // 兜底：本 tick 至此推入的 Max HP buff（如 ENTER_BURST_II 的 Flora S1 P3）、INTERVAL 治疗等
  // 引起的 HP / HP 比例变化，以及由此产生的护盾，在攻击前统一派发
  flushHpEvents(state);
  flushShieldReceived(state);

  // ── 每个单位进行攻击 ─────────────────────────────────────────────────────
  // HIDDEN 阶段：装填仍然处理（自愿 HIDDEN 装填可以完成），
  // 但射击跳过。保护判断位于装填块之后的循环内部。

  for (const unit of state.squad) {
    // 单位眩晕：眩晕期间跳过所有处理
    if ((unit.skillState.stunnedUntilTick ?? 0) > 0 && state.tick < unit.skillState.stunnedUntilTick) continue;
    // 武器切换结束后 backswing 封锁（如 Snow White burst 击发后 90 ticks）
    if ((unit.skillState.weaponSwitchPostBackswingEndTick ?? 0) > 0
        && state.tick < unit.skillState.weaponSwitchPostBackswingEndTick) continue;

    // 速充：全爆裂结束前开始手动换弹 + 全蓄力收尾
    maybeStartQuickChargeFinisher(state, unit, events);

    // UP 型蓄力武器后摇期间换弹（§4.3.9）：后摇内完成的换弹到点补满（HIDDEN 期间同样完成）。
    // 射击节奏不受影响（chargeTick 已按常规发间排定），仅恢复弹药并触发 RELOAD_END。
    if (unit.backswingReloadTick > 0 && state.tick >= unit.backswingReloadTick) {
      unit.backswingReloadTick = 0;
      refillMagazine(state, unit, events);
      onReloadEnd(state, unit);
    }

    // 装填处理（HIDDEN 期间也会运行，让进行中的装填能够完成）
    // unlimitedAmmoEndTick 激活期间弹药不消耗，永远不会达到 0，跳过装填逻辑
    // 后摇期间换弹尚未完成时（backswingReloadTick > 0）由上方补满，不另起常规换弹
    // 手动换弹（manualReload：速充收尾 / 百暴停火前）弹匣未空也走本分支
    // （速充收尾已设置 reloadTick；百暴仅置标记，由本分支按常规换弹时长开始换弹）
    if ((unit.ammoLeft <= 0 || unit.manualReload) && unit.backswingReloadTick === 0
        && !((unit.skillState.unlimitedAmmoEndTick ?? 0) > state.tick)) {
      if (unit.reloadTick === 0) {
        // 换弹相位 = 折减后的装填时长 + 末发后摇（非蓄力武器 spot_last_delay，不受换弹速度折减）。
        // UP 型蓄力武器的打空换弹已在射击 tick 由 scheduleBackswingReload 提前开始（后摇与换弹同时计时）。
        const dur = reloadDurationTicks(state, unit, getBuffSums(state, unit.id)) + (unit.reloadRecoveryTicks ?? 0);
        unit.reloadTick      = state.tick + dur;
        unit.reloadStartTick = state.tick;
      }
      if (state.tick < unit.reloadTick) {
        // 换弹与射击间隔并行消化：换弹期间累加器按 RPM 继续累积（封顶 1 发），
        // 换弹完成后下一发不早于「上一发 + RPM 发间」。换弹速度 buff 总和 ≥100%（瞬间装填）
        // 时射击节奏回落到武器 RPM，而非「换弹完成即补射」的 13t 死循环。
        // 实测校准（2026-07-17）：Anis SS（SG 90 RPM）15 级 Resilience 魔方 + S1 + 爆裂
        // 换弹速度 >100%，爆裂 9s 内攻击 14 次 = 精确的 40t RPM 节奏。
        if (unit.chargeTimeTicks === 0 && unit.mgCurrentRof == null && unit.rateOfFire > 0)
          unit.shotAccumulator = Math.min(1, unit.shotAccumulator + shotsPerTick(state, unit));
        // 换弹期间枪管停转，MG ROF 衰减 + 散布恢复（MG 重新预热）
        if (unit.mgCurrentRof != null && unit.mgRofDecayPerTick > 0) {
          unit.mgCurrentRof = Math.max(unit.mgStartRof, unit.mgCurrentRof - unit.mgRofDecayPerTick);
        }
        recoverAccuracy(unit, 1);
        continue;
      }
      refillMagazine(state, unit, events);
      unit.manualReload = false;
      // 装填后射击周期衔接：非蓄力 RPM 武器保留换弹期间累积的累加器（封顶 1）——
      // 装填时长 ≥ RPM 发间时累加器已到 1，换弹完成第一发立即击发（与旧行为一致）；
      // 装填被换弹速度 buff 压缩到发间以内时，下一发仍落在「上一发 + RPM 发间」。
      // MG 起速武器种子 0：换弹期间 ROF 已衰减，需重新预热，第一发按当前 RPM 发间等待（与开局一致）。
      unit.shotAccumulator = (unit.chargeTimeTicks > 0 || unit.mgCurrentRof != null)
        ? 0 : Math.min(1, unit.rateOfFire > 0 ? unit.shotAccumulator : 1);
      // 蓄力武器：换弹完成后需重新经过完整蓄力才打出第一发，绝不立即补射。
      // UP 型：前摇 + 有效蓄力；DOWN_Charge 型：仅有效蓄力，无前摇（持续按住，换弹期间不松手、无需重新瞄准）。
      // 蓄速加成作用于每一次蓄力，换弹后首发亦不例外（与射后发间同口径，见 effectiveChargeTicks）。
      // 实测校准：Cinderella 33s=88 发要求换弹后第一发全蓄力 = 换弹完成 + 60t（不含前摇）；
      // 其 S1 P2 蓄速 buff 在 RELOAD_END 被移除，故此时有效蓄力即基础 60t，与本口径一致。
      // 须在 onReloadEnd 之后计算：RELOAD_END 触发器移除的蓄速 buff 不应作用于换弹后首发；
      // 触发器若显式改写 chargeTick（如 104.js SDO 固定蓄力），以触发器为准。
      const chargeTickBeforeReloadHooks = unit.chargeTick;
      onReloadEnd(state, unit);
      // 非蓄力武器：换弹完成后进入对准期（spot_first_delay），期间不射击（见下方门控）
      if (unit.chargeTimeTicks === 0 && unit.reloadAimTicks > 0)
        unit.aimReadyTick = state.tick + unit.reloadAimTicks;
      if (unit.chargeTimeTicks > 0 && unit.chargeTick === chargeTickBeforeReloadHooks) {
        // UP 型：末发后摇与换弹同时计时，换弹相位结束 = max(换弹完成, 末发 + 后摇)，之后前摇 + 蓄力（§4.3.6）。
        // DOWN_Charge 型：换弹动作不重置也不覆盖前后摇，三者串联；首发 = 换弹完成 + 后摇 + 前摇 + 蓄力。
        //   实测（2026-10-09，Anis: Star，后摇 12t、前摇 12t、固定蓄力 42t）：
        //     换弹速度 114%（换弹 0t）→ 弹匣归 0 到首发 66t = 0 + 12 + 12 + 42；
        //     换弹速度 74%（换弹 2.0s × 0.26 = 31t）→ 96t ≈ 31 + 12 + 12 + 42 = 97。
        //   并行模型（max(换弹, 前后摇) + 蓄力）对第二组只能给出 73t，排除。
        const phaseEnd  = unit.isDownCharge
          ? state.tick + unit.backswingTicks + unit.foreswingTicks
          : Math.max(state.tick, unit.lastChargeShotTick + unit.backswingTicks);
        // Alice Wonderland 快速攻击期间换弹：scheduleEngineCharge 内按快速攻击发间续发，
        // 而非重新满蓄（否则会出现"打完最后一发→装填→隔一个完整蓄力周期才续发"的错误间隔）。
        scheduleEngineCharge(state, unit, phaseEnd,
          unit.isDownCharge ? 0 : unit.foreswingTicks, getBuffSums(state, unit.id));
      }
    }

    // 停火区段（HIDDEN / 跳起 JUMP）跳过射击（上方装填仍然允许）。
    if (isHoldFireZone(state.currentPhaseZone)) {
      if (unit.mgCurrentRof != null && unit.mgRofDecayPerTick > 0) {
        unit.mgCurrentRof = Math.max(unit.mgStartRof, unit.mgCurrentRof - unit.mgRofDecayPerTick);
      }
      recoverAccuracy(unit, 1);
      continue;
    }

    // 非蓄力武器换弹后对准期（spot_first_delay，§5.2）：不射击；射击累加器按当前 RPM 继续累积（封顶 1），
    // MG 射速继续衰减。衰减不深时对准结束立即击发（Rapi: Red Hood 实测 23t = 后摇 12 + 前摇 12），
    // 衰减到起始 RPM 时仍需等满一个发间。
    if (unit.chargeTimeTicks === 0 && state.tick < unit.aimReadyTick) {
      if (unit.rateOfFire > 0)
        unit.shotAccumulator = Math.min(1, unit.shotAccumulator + shotsPerTick(state, unit));
      if (unit.mgCurrentRof != null && unit.mgRofDecayPerTick > 0) {
        unit.mgCurrentRof = Math.max(unit.mgStartRof, unit.mgCurrentRof - unit.mgRofDecayPerTick);
      }
      recoverAccuracy(unit, 1);
      continue;
    }

    // 决定本 tick 的射击数。
    // SR/RL（蓄力武器）：确定性 — chargeTick 到达时恰好打出 1 发。
    // 带有 CDN rateOfFire 的单位：累加器模型（发数/分钟 ÷ 3600 = 发数/tick）。
    //   MG 起速通过 mgCurrentRof 覆盖 rateOfFire。
    // 回退：使用 ATTACK_SPEED 表的 0/1 概率门。
    // 武器切换（WEAPON_SWITCH 效果）：覆盖 hitMult / isCharged，以及蓄力模式（hoisted）
    const weaponSwitchActive = (unit.skillState?.weaponSwitchEndTick ?? 0) > 0
      && state.tick <= unit.skillState.weaponSwitchEndTick;

    // 武器切换刚结束：将原始武器弹匣填满（文档 §4.6）
    // _weaponSwitchAmmoFilled 记录已处理的 endTick，避免每 tick 重复执行
    if (!weaponSwitchActive
        && (unit.skillState.weaponSwitchEndTick ?? 0) > 0
        && unit.skillState._weaponSwitchAmmoFilled !== unit.skillState.weaponSwitchEndTick) {
      unit.skillState._weaponSwitchAmmoFilled = unit.skillState.weaponSwitchEndTick;
      const beforeFill = unit.ammoLeft;
      unit.ammoLeft = unit.maxAmmo;
      unit.reloadTick = 0;
      unit.backswingReloadTick = 0;
      if (state.ammoLog && unit.ammoLeft !== beforeFill)
        state.ammoLog.push({ tick: state.tick, unitId: unit.id, unitName: unit.name,
          delta: unit.ammoLeft - beforeFill, ammoAfter: unit.ammoLeft, maxAmmo: unit.maxAmmo,
          source: 'weapon_switch_end' });
    }

    // 百暴：自己轮次全爆裂期间停止普通攻击（保留 Miranda S2 P3 暴击率），按规则装弹后空闲至全爆裂结束。
    // 放在武器切换结束补满之后：切换刚结束（如 Nayuta）时弹匣已补满，不再多余换弹。
    if (fullCritHoldActive(state, unit)) {
      holdFireForFullCrit(state, unit);
      continue;
    }
    if (unit.fullCritHolding) {
      resumeAfterFullCritHold(state, unit);
      continue;  // 本 tick 起重新蓄力 / 对准
    }

    let shotsThisTick;
    // 武器切换时允许非蓄力武器（如 SMG）临时以蓄力模式开火。
    const weaponSwitchChargeTimeTicks = weaponSwitchActive
      ? (unit.skillState.weaponSwitchChargeTimeTicks ?? 0) : 0;
    const effectiveChargeTimeTicks = weaponSwitchChargeTimeTicks > 0
      ? weaponSwitchChargeTimeTicks : unit.chargeTimeTicks;
    if (effectiveChargeTimeTicks > 0) {
      // 蓄力中途蓄力时长变化（蓄速 buff 推入/过期、固定蓄力生效/过期）按新时长结算（§4.3.10）
      if (weaponSwitchChargeTimeTicks === 0) rescheduleEngineCharge(state, unit);
      // 蓄力武器：蓄力完成时打出 1 发，然后重置计时器。
      shotsThisTick = state.tick >= unit.chargeTick ? 1 : 0;
    } else if (unit.rateOfFire > 0) {
      unit.shotAccumulator += shotsPerTick(state, unit);
      shotsThisTick         = Math.min(MAX_SHOTS_PER_TICK, Math.floor(unit.shotAccumulator));
      // 帧率封顶：一帧内无法补发，累加器残量最多保留 1 发（种子 1 + 本 tick 满额累积时）。
      unit.shotAccumulator  = Math.min(unit.shotAccumulator - shotsThisTick, 1);
    } else {
      shotsThisTick = rng() < (ATTACK_SPEED[unit.weaponType] ?? 0.20) ? 1 : 0;
    }
    if (shotsThisTick === 0) continue;

    for (let _s = 0; _s < shotsThisTick; _s++) {
      if (unit.ammoLeft <= 0) break; // 本 tick 中途弹尽；下一 tick 开始装填

      // 武器切换（WEAPON_SWITCH 效果）：期间覆盖 hitMult 和 isCharged
      // 提前到 getBuffSums 之前计算，供 DURING_FULL_CHARGE 触发器使用。
      const effectiveWeaponType = weaponSwitchActive
        ? (unit.skillState.weaponSwitchType ?? unit.weaponType)
        : unit.weaponType;
      // 双枪：武器伤害系数 ×2（切换武器默认同样适用，技能以 weaponSwitchDualGun = false 排除）
      const dualGunMult = weaponSwitchActive && unit.skillState.weaponSwitchDualGun === false
        ? 1 : (unit.dualGunMult ?? 1);
      const hitMult = (weaponSwitchActive
        ? (unit.skillState.weaponSwitchHitMult ?? WEAPON_HIT_MULT[effectiveWeaponType] ?? 0.03)
        : unit.shotDamageMult) * dualGunMult;
      const isCharged = ['SR', 'RL', 'Charged'].includes(effectiveWeaponType);
      // 速充攻击（蓄力 13 帧）：仍是蓄力攻击，蓄力比例 r = min(1, 13 / 当前有效蓄力帧数)；
      // 蓄力伤害倍率与 Focus 全蓄力充能倍率按 r 插值，r < 1 时不算全蓄力（不触发全蓄力类效果）
      const isQuickShot = !weaponSwitchActive && unit.qcShotTick != null && unit.chargeTick === unit.qcShotTick;
      unit.qcShotTick = null;
      const quickEffCharge = isQuickShot ? effectiveChargeTicks(state, unit, getBuffSums(state, unit.id)) : 0;
      const chargeRatio  = isQuickShot && quickEffCharge > QUICK_CHARGE_TICKS
        ? QUICK_CHARGE_TICKS / quickEffCharge : 1;
      const isFullCharge = isCharged && chargeRatio >= 1;
      // 速充收尾的全蓄力发已打出 → 恢复速充排定
      if (isCharged && !isQuickShot && !weaponSwitchActive) unit.qcFinisherPending = false;
      // RL 普攻即 Projectile Explosion：受 projectileExplosionDamagePct 加成（伤害计算与日志明细共用此口径）
      const isExplosive = effectiveWeaponType === 'RL';
      const projExpOf = b => (isExplosive ? (b.projectileExplosionDamagePct ?? 0) : 0);
      // 普攻伤害倍率：珍藏品 "Normal Attack Damage Multiplier"（武器切换期间不生效）与技能同名效果
      // （buff 字段 normalAttackDamageMultPct）同一乘区，相加后乘在 BaseDamage 上（同 Charge Damage Multiplier）
      const favNormalBase = weaponSwitchActive ? 1 : (unit.favNormalAttackDamageMult ?? 1);
      const normalMultOf  = (s, favBase = favNormalBase) => favBase + (s.normalAttackDamageMultPct ?? 0);

      // DURING_FULL_CHARGE：全蓄力击发前触发，推入的 buff 立即被 getBuffSums 读取
      if (isFullCharge) fireDuringFullChargeTriggers(state, unit);

      // 计算 buff 汇总（round-based buff 由 getBuffSums 自动根据 roundsLeft 过滤）
      const sums = getBuffSums(state, unit.id);
      // 本次射击命中弹丸数（SG 受「弹丸数 ▲ / 固定为 N」影响）：用回合扣减前的 sums，
      // 供爆裂充能（按命中比例折算整发充能）与按弹丸计数的技能（shotCtx.pellets）共用
      // SG 实战弹丸命中：每颗弹丸按 sgHitRate（随敌人距离缩放，并按有效散布缩放打空率）独立判定是否命中躯体，
      // 伤害倍率按命中弹丸比例缩放（hitMult 为整发全部弹丸的合计倍率），充能与弹丸计数按命中弹丸数。
      // 有效散布：武器切换取技能给出的切换散布（缺失按标定散布），否则取当前散布（含收束 ramp）；
      // 命中率 ▲ 收圆（如 Dorothy: Serendipity 的 Flash 单弹丸）→ 几乎不再打空。
      const isSgShot     = effectiveWeaponType === 'SG';
      const hitRateNow   = (unit.stats.hitRatePct ?? 0) + (sums.hitRatePct ?? 0);
      const firedPellets = shotPelletCount(unit, effectiveWeaponType, sums);
      const pellets      = rollHitPellets(firedPellets, isSgShot
        ? sgPelletHitRate(state.accSgHitRate, state.enemyDistance,
            weaponSwitchActive ? (unit.skillState.weaponSwitchAccuracyScale ?? 0) : unit.accCurrentScale,
            hitRateNow, state.accHitCoef)
        : 1);
      const shotHitMult  = hitMult * pellets / firedPellets;
      // normalAttackCritRatePct 适用于所有普通攻击（含蓄力），不区分蓄力与否
      const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRatePct
        + (sums.normalAttackCritRatePct ?? 0));
      // 核心命中判定（文档 §3.8）。
      // 穿透攻击：weaponSwitchPierce（Zwei 武器切换）或 sums.pierce（buff 系统）生效时命中穿透。
      // 核心被保护（enemyCoreProtected=true）：仅穿透攻击可命中核心。
      const isPierce = (weaponSwitchActive && unit.skillState.weaponSwitchPierce)
        || sums.pierce;
      // 距离优势（bonusrange 连续距离；含 Ade 扩展有效射程 effRangeMin）。
      const distAdv = unitDistanceAdvantage(unit, state.enemyDistance);
      // 核心命中率：
      //   · 武器切换：沿用切换武器类型硬编码核心率（缺乏切换武器散布数据）。
      //   · 普通射击：几何模型 coreHitChance（散布圆 vs 核心透视半径，受 HitRate 收圆）。
      //     SR/RL 等精准武器 alwaysCore=1；SG 逐弹丸判定见下方拆分。
      // weaponSwitchCoreRate：技能显式指定切换武器核心率（如 Drake: Great Villain 的蓄力霰弹枪
      // 以 'Charged' 类型获得蓄力倍率，但散布仍为霰弹 → 沿用 SG 核心率）。
      // weaponSwitchAccuracyScale：技能给出切换武器散布圈（固定 scale，无收束）时改用几何模型（如 K 爆裂，目测 250）。
      // RL：敌人静止时必中核心；命中时刻（出手 + 飞行时间）敌人横向移动则按飞行时间打偏（rlCoreHitRate；
      //   技能显式指定切换武器核心率时除外）。切换武器为 RL 时缺乏其弹速数据，按标定弹速处理。
      const switchScale = unit.skillState.weaponSwitchAccuracyScale;
      const rlCoreOverride = effectiveWeaponType === 'RL'
        && !(weaponSwitchActive && unit.skillState.weaponSwitchCoreRate != null);
      const pCore = rlCoreOverride
        ? rlCoreHitRate(state, weaponSwitchActive ? null : unit.projectileSpeed)
        : weaponSwitchActive
        ? (unit.skillState.weaponSwitchCoreRate
          ?? (switchScale != null
            ? coreHitChance({
                alwaysCore:   false,
                currentScale: switchScale,
                hitRatePct:   hitRateNow,
                distance:     state.enemyDistance,
                CORE0: state.accCore0, D0: state.accD0, coef: state.accHitCoef,
              })
            : effectiveWeaponType === 'SMG' ? 0.033
            : effectiveWeaponType === 'SG'  ? 0.20 : 1.0))
        : coreHitChance({
            alwaysCore:   unit.accAlwaysCore,
            currentScale: unit.accCurrentScale,
            hitRatePct:   hitRateNow,
            distance:     state.enemyDistance,
            CORE0: state.accCore0, D0: state.accD0, coef: state.accHitCoef,
          });
      const rollCoreHit = () => {
        const coreRoll = pCore >= 1 || rng() < pCore;
        return state.enemyHasCore && (state.enemyCoreProtected ? (isPierce && coreRoll) : coreRoll);
      };
      // 暴击 / 核心判定：
      //   · SG：每颗命中弹丸独立判定暴击与核心，按（暴击, 核心）分为至多 4 类（pelletGroups），
      //     每类伤害 = 每弹丸系数（整发系数 ÷ 发射弹丸数）× 该类弹丸数，分别结算后相加。
      //     整发 isCrit / isCore = 至少一颗弹丸暴击 / 命中核心（供 CORE_HIT 等整发触发器使用）。
      //   · 其余武器：整发一次判定（1 类，count = 1）。
      const pelletGroups = isSgShot
        ? rollPelletGroups(pellets, effectiveCritRate, rollCoreHit)
        : [{ isCrit: rollCrit(effectiveCritRate), isCore: rollCoreHit(), count: 1 }];
      const isCrit      = pelletGroups.some(g => g.isCrit);
      const isCore      = pelletGroups.some(g => g.isCore);
      const critPellets = pelletGroups.reduce((n, g) => n + (g.isCrit ? g.count : 0), 0);
      const corePellets = pelletGroups.reduce((n, g) => n + (g.isCore ? g.count : 0), 0);
      // 推进散布收束（MG 暖机；AR/SMG/SG 恒定）。判定用推进前的 currentScale，判定后推进。
      rampAccuracyOnShot(unit);
      // 普通零件不参与伤害计算（血量难以估算）；仅零件核心的核心命中同时算命中零件。
      const hitPart = isCore ? 'core' : 'body';
      const isParts = isPartsHit(state, hitPart);
      // 零件核心：穿透攻击命中核心时，额外产生一次纯本体伤害（不吃零件/核心加成）。
      // SG 按命中核心的弹丸数结算（每颗独立判定暴击）。
      // 穿透仅见于 SG / SR（及形似它们的技能切换武器），爆炸类武器无穿透，故爆炸命中恒只结算一次。
      const isPartsCoreBody = state.enemyCoreIsParts && isPierce && isCore;
      // 普通攻击真实伤害（buff 标记 normalAttackTrueDamage）：无视防御 + trueDamagePct 加成。
      const isTrueDamage = sums.normalAttackTrueDamage;

      // 一类命中（g：{ isCrit, isCore, count }）的伤害：系数 = 每弹丸系数 × 弹丸数。
      // partsBody：零件核心穿透的额外本体伤害（不吃零件/核心加成，恒吃穿透伤害）。
      // unitFav：主命中沿用单位珍藏品普攻倍率
      //   （TODO(TODOS.md) 此处珍藏品倍率未按武器切换置 1（已知问题，与日志口径不一致），暂保持原行为）
      const calcShotDamage = (s, g, { partsBody = false, unitFav = false } = {}) => calcDamage({
        atk:               unit.stats.atk,
        atkMultiplier:     1 + s.atkPct,
        otherAtkIncrement: s.atkFlat,
        enemyDef:          getEffectiveEnemyDef(state),
        hitMultiplier:     hitMult / firedPellets * g.count,
        weaponType:        effectiveWeaponType,
        isCrit:            g.isCrit,
        critDmgIncrement:  (unit.stats.critDmg ?? 0.50) - 0.50 + s.critDamagePct,
        hitPart:           g.isCore ? 'core' : 'body',
        coreDmgIncrement:  unit.coreDmgIncrement + (g.isCore ? (s.coreDamagePct ?? 0) : 0),
        ...(partsBody ? {} : { coreIsParts: state.enemyCoreIsParts }),
        distanceAdvantage: distAdv,
        isFullBurst:       state.fullBurstActive,
        attackerElement:   resolveAttackerElement(unit, s, state.enemyElement),
        defenderElement:   state.enemyElement,
        elementAdvantageDmgIncrement: (unit.stats.elementDmgPct ?? 0) + (s.elementAdvantagePct ?? 0),
        isCharged,
        fullChargeDamage:  weaponSwitchActive && unit.skillState.weaponSwitchFullChargeDamage != null
          ? unit.skillState.weaponSwitchFullChargeDamage
          : unit.fullChargeDamage,
        favChargeDmgPct:   unit.favChargeDmgPct ?? 0,
        chargeDmgStat:     1 + (unit.stats.chargeDmgPct ?? 0) + s.chargeDamagePct,
        chargeDmgMultPct:  s.chargeDamageMultPct ?? 0,
        chargeRatio,
        favNormalAttackDamageMult: unitFav ? normalMultOf(s, unit.favNormalAttackDamageMult ?? 1) : normalMultOf(s),
        isTrueDamage:      s.normalAttackTrueDamage,
        extra:             { attackDamageMult: s.attackDamagePct + s.normalAttackDamagePct + projExpOf(s),
                             damageToPartsMult: s.damageToPartsPct ?? 0,
                             trueDamageMult: s.normalAttackTrueDamage ? (s.trueDamagePct ?? 0) : 0,
                             ...(isPierce || partsBody ? { pierceDamageMult: s.pierceDamagePct } : {}) },
        damageTakenMult:   getEnemyDamageTakenPct(state),
      });
      // 日志用分类明细：附上该类实际生效的核心伤害增量（非核心类不含核心 buff）
      const pelletGroupLog = (groups, s) => groups.map(g => ({
        isCrit: g.isCrit, isCore: g.isCore, count: g.count, damage: g.damage,
        coreDmgIncrement: (unit.coreDmgIncrement ?? 0) + (g.isCore ? (s.coreDamagePct ?? 0) : 0),
      }));
      // 各类分别结算；全部弹丸打空（pelletGroups 为空）时以 0 系数结算一次，仅取乘区明细（bd）
      const groupResults = (pelletGroups.length ? pelletGroups : [{ isCrit: false, isCore: false, count: 0 }])
        .map(g => ({ g, ...calcShotDamage(sums, g, { unitFav: true }) }));
      const damage = groupResults.reduce((n, r) => n + r.damage, 0);
      const bd     = groupResults[0].breakdown;

      // ── 零件核心穿透：额外本体伤害（与核心命中同时产生，使用相同 buff 快照，独立判定暴击）──
      let damagePartsCoreBody = 0, isCritPartsCoreBody = false, partsBodyGroups = null;
      if (isPartsCoreBody) {
        partsBodyGroups = isSgShot
          ? rollPelletGroups(corePellets, effectiveCritRate, () => false)
          : [{ isCrit: rollCrit(effectiveCritRate), isCore: false, count: 1 }];
        partsBodyGroups = partsBodyGroups.map(g => ({ ...g, damage: calcShotDamage(sums, g, { partsBody: true }).damage }));
        damagePartsCoreBody = partsBodyGroups.reduce((n, g) => n + g.damage, 0);
        isCritPartsCoreBody = partsBodyGroups.some(g => g.isCrit);
      }

      // ── Zwei 爆裂双重命中（游戏实机特性/bug）──────────────────────────────
      // weaponSwitchDoubleHit=true 时，武器切换后的一次射击产生两次独立伤害：
      //   ① 第一次命中：使用当前 buff（含 pierce1r）；
      //      命中后立即消耗回合制 buff（decrementRoundBuffs），pierce1r roundsLeft 1→0；
      //      然后触发 SHOT_COUNT（S1 P2 添加 pierce_stack，roundsLeft=1）。
      //   ② 第二次命中：使用更新后的 buff（pierce_stack 已存在，pierce1r 已消耗）；
      //      暴击与第一次独立判定；pierce_stack 在本次射击结束后保留（不被 onShotFired 再次递减）。
      const isDoubleHit = weaponSwitchActive && (unit.skillState.weaponSwitchDoubleHit ?? false);

      // 回合制 buff 在实弹命中时（ammoLeft-- 处）扣减并在归零时 splice，早于 hitLog 写入；
      // 若写 hitLog 时再读 state.buffs，本发消耗的最后一回合 buff 会从伤害明细中漏掉（伤害已计入）。
      // 解决：在扣减前快照 buffBreakdown（双重命中另在第二次命中前再快照），只保留 roundsLeft>0 的活跃 buff。
      // 口径同 getBuffSums（isBuffActiveFor：目标 / 回合 / 到期 / weaponFilter）
      const _snapActiveBufs = () => state.buffs
        .filter(b => isBuffActiveFor(state, b, unit))
        .map(b => {
          // 叠层 buff：记录「层数 × 单层值」的实际贡献，与 getBuffSums 聚合口径一致
          const k = b.stacks ?? 1;
          return { name: b.name, atkFlat: (b.atkFlat ?? 0) * k, atkPct: (b.atkPct ?? 0) * k,
                   attackDamagePct: ((b.attackDamagePct ?? 0) + (b.normalAttackDamagePct ?? 0) + projExpOf(b)) * k,
                   // 穿透伤害仅对穿透攻击生效（与 calcDamage 的 pierceDamageMult 口径一致）
                   pierceDamagePct: isPierce ? (b.pierceDamagePct ?? 0) * k : 0, coreDamagePct: (b.coreDamagePct ?? 0) * k,
                   chargeDamagePct: (b.chargeDamagePct ?? 0) * k, critDamagePct: (b.critDamagePct ?? 0) * k,
                   chargeDamageMultPct: (b.chargeDamageMultPct ?? 0) * k,
                   normalAttackDamageMultPct: (b.normalAttackDamageMultPct ?? 0) * k,
                   // 优越代码伤害仅在本次命中具备克制时生效（与 calcDamage 的 elemMult 口径一致）
                   elementAdvantagePct: bd.elemMult > 1 ? (b.elementAdvantagePct ?? 0) * k : 0,
                   // 零件伤害仅零件核心敌人的核心命中生效（与 calcShotDamage 的 damageToPartsMult 口径一致）
                   damageToPartsPct: isParts ? (b.damageToPartsPct ?? 0) * k : 0,
                   stacks: k, multiplier: b.multiplier ?? null,
                   sourceCaster: b._sourceCaster ?? null, sourceSkillLabel: b._sourceSkillLabel ?? null,
                   sourcePartIdx: b._sourcePartIdx ?? null };
        })
        .filter(b => b.atkFlat || b.atkPct || b.attackDamagePct || b.pierceDamagePct || b.coreDamagePct || b.chargeDamagePct || b.chargeDamageMultPct || b.normalAttackDamageMultPct || b.critDamagePct || b.elementAdvantagePct || b.damageToPartsPct);
      let _hit1BreakdownBufs = null, _hit2BreakdownBufs = null;
      if (state.hitLog) _hit1BreakdownBufs = _snapActiveBufs();

      // 双重命中时，SHOT_COUNT 事件（Pierce Equation P2 等）需排在命中行之后；
      // 记录 fireShotCountTriggers 前的 pendingSkillEvents 长度，事后重新赋 _seq。
      let _shotCountPendingLen = 0;

      let damage2 = 0, isCrit2 = false;
      if (isDoubleHit) {
        _shotCountPendingLen = state.pendingSkillEvents?.length ?? 0;
        decrementRoundBuffs(state, unit.id);
        fireShotCountTriggers(state, unit, { sums, isCharged, isFullCharge, hitPart, pellets, isCrit, critPellets, corePellets,
          weaponType: effectiveWeaponType, ammoAfterShot: unit.ammoLeft - 1 });
        if (state.hitLog) _hit2BreakdownBufs = _snapActiveBufs();
        const sums2 = getBuffSums(state, unit.id);
        const eCritRate2 = Math.min(1,
          (unit.stats.critRate ?? 0.15) + sums2.critRatePct + (sums2.normalAttackCritRatePct ?? 0));
        isCrit2 = rollCrit(eCritRate2);
        // 第二次命中整发结算（不逐弹丸拆分），核心沿用第一次命中的判定
        ({ damage: damage2 } = calcShotDamage(sums2, { isCrit: isCrit2, isCore, count: pellets }));
      }

      const ammoBeforeShot = unit.ammoLeft;
      // 武器替换期间无限弹药（如 Moran burst），或 skillState.unlimitedAmmoEndTick 激活期间（如 Grave Prediction）
      const isUnlimitedAmmoShot = (weaponSwitchActive && unit.skillState.weaponSwitchUnlimitedAmmo)
        || (unit.skillState.unlimitedAmmoEndTick ?? 0) > state.tick;
      // 「Expends ammo. Amount: N round(s)」（weaponSwitchAmmoCountPerShot，如 Cinderella: Crystal Wave
      // Snipe Mode 全蓄力 = 40 发）：仅表示本发按 N 发计入「全队累计消耗弹药」类计数，弹匣实际仍只扣 1 发。
      const ammoCounted = weaponSwitchActive ? Math.max(1, unit.skillState.weaponSwitchAmmoCountPerShot ?? 1) : 1;
      if (!isUnlimitedAmmoShot) {
        unit.ammoLeft--;
        // round-based buff（roundsLeft）：实弹命中时消耗 1 回合；无限弹期间不消耗。
        // 这是普通射击的唯一消耗点（onShotFired 不再重复扣减）；技能伤害（fireSkillHit）不消耗回合。
        // 双重命中的第一次命中已在上方 decrementRoundBuffs 扣 1，此处扣第二次命中。
        let bi = state.buffs.length;
        while (bi--) {
          const b = state.buffs[bi];
          if (b.unitId !== unit.id || b.roundsLeft == null) continue;
          if (--b.roundsLeft <= 0) state.buffs.splice(bi, 1);
        }
      }
      unit.hitCount += (isDoubleHit ? 2 : 1) + (isPartsCoreBody ? 1 : 0);
      // 暴击统计：SG 按本发命中弹丸中的暴击比例计（整发计 1 次命中），避免「任一弹丸暴击」高估暴击率
      const critFraction = (crits, total) => (total > 0 ? crits / total : 0);
      unit.critCount += isSgShot ? critFraction(critPellets, pellets) : (isCrit ? 1 : 0);
      if (isDoubleHit && isCrit2) unit.critCount++;
      if (isPartsCoreBody) {
        unit.critCount += isSgShot
          ? critFraction(partsBodyGroups.reduce((n, g) => n + (g.isCrit ? g.count : 0), 0), corePellets)
          : (isCritPartsCoreBody ? 1 : 0);
      }
      unit.totalDamage += damage + damage2 + damagePartsCoreBody;
      // 调试：按单位记录普通射击伤害
      // 武器切换期间用 burst 技能名标记，与普通攻击分离统计；
      // 切换来源非爆裂技能时由技能显式指定 weaponSwitchLabel（如 Drake: Great Villain S1）
      unit.skillDamage        ??= {};
      unit.skillDamageCount   ??= {};
      const shotLabel = weaponSwitchActive
        ? (unit.skillState.weaponSwitchLabel
          ?? `Burst${unit.rawBurst?.name_localkey ? ' ' + unit.rawBurst.name_localkey : ''}`)
        : 'normal_shot';
      unit.skillDamage[shotLabel]      = (unit.skillDamage[shotLabel]      ?? 0) + damage + damage2 + damagePartsCoreBody;
      unit.skillDamageCount[shotLabel] = (unit.skillDamageCount[shotLabel] ?? 0) + (isDoubleHit ? 2 : 1) + (isPartsCoreBody ? 1 : 0);

      // 本次射击充能 = 整发充能 × 命中弹丸数 / 发射弹丸数 + burstGaugeFlat。
      // 蓄力武器（SR/RL）：仅【Focus 受控角色】额外乘以全蓄力系数 (fullChargeBurstEnergy/10000)；
      //   非Focus 蓄力角色与非蓄力武器均无倍率（实测：非Focus 蓄力充能 = target，见 battle-logic §6.1）。
      // SG：整发充能 = target_burst_energy_pershot × 基础 shot_count，为【全部弹丸命中】时的充能，
      //   与弹丸数 ▲ / 「固定为 N」无关（同伤害系数口径）；每颗弹丸充能 = 整发充能 / 发射弹丸数，动态计算。
      //   命中弹丸数按 sgHitRate 逐弹丸判定（默认 1 = 全部命中）。其余武器 pellets = firedPellets = 1。
      // burstGaugeFlat：来自 buff 的 flat 加成（如 Neon: Vision Eye S2 Part4），按【每次射击】计（非每弹丸），
      //   与弹丸充能合并后整体（Focus 时）乘以全蓄力系数（flat 加法，不得改为百分比乘法）。
      // ⚠ 必须在 hitLog 记录之前累积，使本发命中行记录的 gaugeAfter 已包含本发充能，
      //   战斗日志「充能列」据此按行计算增量；否则会把本发充能误记到下一行。
      const fullShotEnergy = unit.targetBurstEnergyPerShot * (effectiveWeaponType === 'SG' ? (unit.shotCount ?? 1) : 1);
      const baseEnergy  = Math.round(fullShotEnergy * pellets / firedPellets) + (sums.burstGaugeFlat ?? 0);
      // 未蓄满（速充 chargeRatio < 1）：全蓄力充能系数按蓄力比例线性插值 1 → fullChargeBurstEnergy/10000
      const focusCharged = unit.isFocus && isCharged && unit.fullChargeBurstEnergy > 10000;
      const burstEnergy = focusCharged
        ? Math.round(baseEnergy * (1 + (unit.fullChargeBurstEnergy / 10000 - 1) * chargeRatio))
        : baseEnergy;
      addBurstGauge(state, unit.name, focusCharged ? 'fc_shot' : 'shot', burstEnergy);

      // 普通射击的逐发详细日志
      if (state.hitLog) {
        // 武器切换期间临时武器弹匣上限固定，不受魔方/珍藏品/技能影响
        const effectiveMaxAmmo = weaponSwitchActive
          ? (unit.skillState.weaponSwitchMaxAmmo ?? unit.maxAmmo)
          : unit.maxAmmo;
        state.hitLog.push({
          _seq: state._logSeq++,
          tick: state.tick, unitId: unit.id, label: shotLabel,
          gaugeAfter: state.burstGauge,
          atk: unit.stats.atk, atkPct: sums.atkPct, atkFlat: sums.atkFlat,
          hitMult: shotHitMult, ...(dualGunMult !== 1 ? { dualGunMult } : {}), isCrit, critDmgInc: (unit.stats.critDmg ?? 0.50) - 0.50 + sums.critDamagePct,
          favNormalAttackDamageMult: normalMultOf(sums),
          attackDamagePct: sums.attackDamagePct + sums.normalAttackDamagePct + projExpOf(sums), isFullBurst: state.fullBurstActive,
          damageTakenPct: getEnemyDamageTakenPct(state),
          enemyDef: isTrueDamage ? 0 : getEffectiveEnemyDef(state),
          enemyBaseDef: state.enemyDef,   // 降防前的基础 DEF（公式导出反推降防比例）
          isTrueDamage, trueDamagePct: isTrueDamage ? (sums.trueDamagePct ?? 0) : 0,
          isPierce, pierceDamagePct: isPierce ? (sums.pierceDamagePct ?? 0) : 0,
          isExplosive,
          ammoBeforeShot, hitPart, isCore, isParts,
          coreDmgIncrement: (unit.coreDmgIncrement ?? 0) + (isCore ? (sums.coreDamagePct ?? 0) : 0),
          // 零件伤害加成（仅零件核心敌人的核心命中；SG 只作用于核心类弹丸）
          damageToPartsPct: isParts ? (sums.damageToPartsPct ?? 0) : 0,
          damage,
          // SG 逐弹丸分类明细（伤害明细按类横向分栏）：每类的暴击/核心、弹丸数与伤害；
          // pelletHitMult = 整发伤害系数 ÷ 发射弹丸数
          ...(isSgShot ? {
            firedPellets, pelletHitMult: hitMult / firedPellets,
            pelletGroups: pelletGroupLog(groupResults.filter(r => r.g.count > 0)
              .map(r => ({ ...r.g, damage: r.damage })), sums),
          } : {}),
          elementDmgPct: unit.stats.elementDmgPct ?? 0,
          equipElementDmgPct: unit.stats.equipElementDmgPct ?? 0,
          equipChargeDmgPct: unit.stats.chargeDmgPct ?? 0, favChargeDmgPct: unit.favChargeDmgPct ?? 0,
          elemMult: bd.elemMult,
          chargeMult: bd.chargeMult,
          // 速充未蓄满的蓄力比例（满蓄时省略）
          ...(chargeRatio < 1 ? { chargeRatio } : {}),
          // 武器切换期间距离加成仍按原始武器判定（游戏实测规则）
          distanceAdv: distAdv,
          ammoLeft: unit.ammoLeft,
          maxAmmo: effectiveMaxAmmo,
          isUnlimitedAmmo: isUnlimitedAmmoShot,
          // 使用回合扣减前的快照，避免本发耗尽的回合制 buff 从明细中漏掉
          buffBreakdown: [
            ...(_hit1BreakdownBufs ?? _snapActiveBufs()),
            ...getEnemyDebuffBreakdown(state),
          ],
        });
        // 零件核心穿透额外本体伤害单独记录
        if (isPartsCoreBody) {
          state.hitLog.push({
            _seq: state._logSeq++,
            tick: state.tick, unitId: unit.id, label: shotLabel + '_pierce_body',
            gaugeAfter: state.burstGauge,
            atk: unit.stats.atk, atkPct: sums.atkPct, atkFlat: sums.atkFlat,
            hitMult, ...(dualGunMult !== 1 ? { dualGunMult } : {}), isCrit: isCritPartsCoreBody, critDmgInc: (unit.stats.critDmg ?? 0.50) - 0.50 + sums.critDamagePct,
            favNormalAttackDamageMult: normalMultOf(sums),
            attackDamagePct: sums.attackDamagePct + sums.normalAttackDamagePct + projExpOf(sums), isFullBurst: state.fullBurstActive,
            damageTakenPct: getEnemyDamageTakenPct(state),
            enemyDef: isTrueDamage ? 0 : getEffectiveEnemyDef(state),
            enemyBaseDef: state.enemyDef,
            isPierce, pierceDamagePct: sums.pierceDamagePct ?? 0,
            isExplosive, isTrueDamage, trueDamagePct: isTrueDamage ? (sums.trueDamagePct ?? 0) : 0,
            ammoBeforeShot, hitPart: 'body', isCore: false,
            coreDmgIncrement: unit.coreDmgIncrement ?? 0,
            damage: damagePartsCoreBody,
            ...(isSgShot ? {
              firedPellets, pelletHitMult: hitMult / firedPellets,
              pelletGroups: pelletGroupLog(partsBodyGroups, sums),
            } : {}),
            elementDmgPct: unit.stats.elementDmgPct ?? 0,
            equipElementDmgPct: unit.stats.equipElementDmgPct ?? 0,
            equipChargeDmgPct: unit.stats.chargeDmgPct ?? 0, favChargeDmgPct: unit.favChargeDmgPct ?? 0,
            elemMult: bd.elemMult,
            chargeMult: bd.chargeMult,
            ...(chargeRatio < 1 ? { chargeRatio } : {}),
            distanceAdv: distAdv,
            ammoLeft: unit.ammoLeft,
            maxAmmo: effectiveMaxAmmo,
            isUnlimitedAmmo: isUnlimitedAmmoShot,
            buffBreakdown: [
              ...(_hit1BreakdownBufs ?? []),
              ...getEnemyDebuffBreakdown(state),
            ],
          });
        }
        // 双重命中第二次伤害单独记录
        if (isDoubleHit) {
          const sums2log = getBuffSums(state, unit.id);
          state.hitLog.push({
            _seq: state._logSeq++,
            tick: state.tick, unitId: unit.id, label: shotLabel + '_2',
            gaugeAfter: state.burstGauge,
            atk: unit.stats.atk, atkPct: sums2log.atkPct, atkFlat: sums2log.atkFlat,
            hitMult, ...(dualGunMult !== 1 ? { dualGunMult } : {}), isCrit: isCrit2, critDmgInc: (unit.stats.critDmg ?? 0.50) - 0.50 + sums2log.critDamagePct,
            favNormalAttackDamageMult: normalMultOf(sums2log),
            attackDamagePct: sums2log.attackDamagePct + sums2log.normalAttackDamagePct + projExpOf(sums2log),
            isFullBurst: state.fullBurstActive,
            damageTakenPct: getEnemyDamageTakenPct(state),
            enemyDef: sums2log.normalAttackTrueDamage ? 0 : getEffectiveEnemyDef(state),
            enemyBaseDef: state.enemyDef,
            isPierce, pierceDamagePct: isPierce ? (sums2log.pierceDamagePct ?? 0) : 0,
            isExplosive, isTrueDamage: sums2log.normalAttackTrueDamage,
            trueDamagePct: sums2log.normalAttackTrueDamage ? (sums2log.trueDamagePct ?? 0) : 0,
            ammoBeforeShot, hitPart, isCore, isParts,
            coreDmgIncrement: (unit.coreDmgIncrement ?? 0) + (isCore ? (sums2log.coreDamagePct ?? 0) : 0),
            damageToPartsPct: isParts ? (sums2log.damageToPartsPct ?? 0) : 0,
            damage: damage2,
            elementDmgPct: unit.stats.elementDmgPct ?? 0,
            equipElementDmgPct: unit.stats.equipElementDmgPct ?? 0,
            equipChargeDmgPct: unit.stats.chargeDmgPct ?? 0, favChargeDmgPct: unit.favChargeDmgPct ?? 0,
            elemMult: bd.elemMult,
            chargeMult: bd.chargeMult,
            ...(chargeRatio < 1 ? { chargeRatio } : {}),
            distanceAdv: distAdv,
            ammoLeft: unit.ammoLeft,
            maxAmmo: effectiveMaxAmmo,
            isUnlimitedAmmo: isUnlimitedAmmoShot,
            buffBreakdown: [
              ...(_hit2BreakdownBufs ?? []),
              ...getEnemyDebuffBreakdown(state),
            ],
          });
        }
      }
      // 双重命中：把 fireShotCountTriggers 产生的 SHOT_COUNT 事件重新赋更大的 _seq，
      // 使其在日志排序中出现在命中行之后（而非之前）。
      if (isDoubleHit && state.pendingSkillEvents) {
        for (let i = _shotCountPendingLen; i < state.pendingSkillEvents.length; i++) {
          state.pendingSkillEvents[i]._seq = state._logSeq++;
        }
      }
      // 为下一发设置蓄力冷却（SR/RL）。发间计算细节见 nextChargeShotDelayTicks。
      // UP 型：backswing + foreswing + effectiveCharge（每次松手后需重新按下/瞄准）。
      // DOWN_Charge 型：仅 effectiveCharge（持续按住，无前后摇；第 1 发前摇已在初始 chargeTick 计入）。
      let _engineScheduledChargeTick = null;
      if (effectiveChargeTimeTicks > 0) {
        if (weaponSwitchChargeTimeTicks > 0) {
          // 武器切换期间：直接使用切换武器的蓄力时长，不应用 fore/backswing，且不参与每 tick 重算
          unit.chargeTick       = state.tick + weaponSwitchChargeTimeTicks;
          unit.engineChargeTick = null;
        } else {
          scheduleEngineCharge(state, unit, state.tick,
            unit.isDownCharge ? 0 : unit.backswingTicks + unit.foreswingTicks, sums);
          _engineScheduledChargeTick = unit.chargeTick;
        }
      }
      // 全队累计消耗弹药：按本发计数（「Expends ammo」类切换武器按 N 发计，与 316.js 口径一致）。
      state.totalAmmoFired += ammoCounted;
      // 生命偷取（含双重命中的第二发），HEAL_RECEIVED 由下方 flushHealReceived 派发
      applyLifeSteal(state, unit, damage + (isDoubleHit ? damage2 : 0), sums);
      events.push({ type: 'hit', tick: state.tick, unitId: unit.id, unitName: unit.name, damage, isCrit });
      if (isDoubleHit)
        events.push({ type: 'hit', tick: state.tick, unitId: unit.id, unitName: unit.name, damage: damage2, isCrit: isCrit2 });

      // ── 每发射击后的单位技能触发（声明式执行器） ────────────────
      // 双重命中：SHOT_COUNT 已由 fireShotCountTriggers 处理，跳过。
      onShotFired(state, unit, { sums, isCharged, isFullCharge, hitPart, pellets, isCrit, critPellets, corePellets,
        weaponType: effectiveWeaponType, ammoAfterShot: unit.ammoLeft },
        isDoubleHit ? { skipShotCount: true } : undefined);
      flushCsChanged(state);
      flushHealReceived(state);
      flushShieldReceived(state);
      flushCoverHeal(state);

      // 射后触发器（FULL_CHARGE 等）可能改变本单位蓄速（如 Cinderella S1 P2 +100% 蓄速），
      // 真机中立即作用于紧接着开始的下一次蓄力。用触发器执行后的最新 buff 汇总重排下一发；
      // 仅当 chargeTick 仍是本次引擎排定值时重排，避免覆盖技能 handler 显式改写的 chargeTick。
      // 实测校准：Cinderella 首次全蓄力后第 2 发即按 20t RPM 发间打出（33s=88 发要求）。
      if (_engineScheduledChargeTick !== null && unit.chargeTick === _engineScheduledChargeTick) {
        scheduleEngineCharge(state, unit, state.tick,
          unit.isDownCharge ? 0 : unit.backswingTicks + unit.foreswingTicks, getBuffSums(state, unit.id));
      }

      // MG ramp：ROF per-shot ramp up（内联保留，非声明式）
      if (unit.mgCurrentRof != null) {
        const mgHeatMult = 1 + sumBuffField(state, unit, 'mgHeatSpeedPct');
        unit.mgCurrentRof = Math.min(
          unit.mgMaxRof,
          unit.mgCurrentRof + unit.mgRofChangePerShot * mgHeatMult
        );
      }

      // Bastion Cube Skill 1 (Reload Up HC): every N shots → add M ammo instantly.
      // Placed after onShotFired so last-bullet effects fire first.
      // 固定弹匣的切换武器（Red Hood: Red Wolf）不受补弹影响，计数也不累积
      if (unit.bastionTriggerRounds > 0 && !isWeaponSwitchAmmoFixed(state, unit)) {
        unit.bastionShotCount++;
        if (unit.bastionShotCount >= unit.bastionTriggerRounds) {
          unit.bastionShotCount = 0;
          const ammoBefore = unit.ammoLeft;
          unit.ammoLeft = Math.min(unit.maxAmmo, unit.ammoLeft + Math.ceil(unit.bastionReloadRounds));
          if (state.ammoLog && unit.ammoLeft !== ammoBefore)
            state.ammoLog.push({ tick: state.tick, unitId: unit.id, unitName: unit.name, delta: unit.ammoLeft - ammoBefore, ammoAfter: unit.ammoLeft, maxAmmo: unit.maxAmmo, source: 'bastion_cube' });
        }
      }

      // UP 型蓄力武器：进入后摇即开始换弹（§4.3.9）。放在射后触发器与 Bastion 补弹之后，
      // 以最终弹药与换弹速度判断；仅引擎排定的蓄力射击适用（武器切换期间不适用）。
      // 速充攻击规避后摇（同 Alice 快速攻击），不做后摇期间换弹，弹匣打空后走常规换弹。
      if (_engineScheduledChargeTick !== null && !isQuickShot) scheduleBackswingReload(state, unit, events);

      // ── 弹药里程碑（声明式） ──────────────────────────────────────────
      const cur400 = Math.floor(state.totalAmmoFired / 400);
      const cur500 = Math.floor(state.totalAmmoFired / 500);
      const milestone400 = cur400 > state.lastMilestone400;
      const milestone500 = cur500 > state.lastMilestone500;
      if (milestone400) state.lastMilestone400 = cur400;
      if (milestone500) state.lastMilestone500 = cur500;
      if (milestone400 || milestone500) {
        executeSkillTriggers(state, 'AMMO_MILESTONE', { milestone400, milestone500 });
        flushCsChanged(state);
      }
    } // 内层射击循环结束
  } // 单位循环结束

  // 兜底：射击循环中未随射击 flush 的触发（如 AMMO_MILESTONE）引起的 HP / HP 比例变化
  flushHpEvents(state);
  flushShieldReceived(state);

  return { over: false, events };
}

/**
 * 运行完整模拟直到结束。
 * @param {BattleConfig} config
 * @returns {BattleResult}
 */
export function simulate(config) {
  // 注入随机源（config.rng 缺省时用 Math.random）；结束后恢复默认，避免污染后续调用。
  setRng(config.rng);
  try {
    const state     = initBattle(config);
    // 只收集 buildResult 会用到的事件类型：每发射击的 hit 事件数量达数万条，
    // 全量累积会让单次模拟的内存峰值翻倍，而结果中从不使用它们。
    const logEvents = [];

    while (true) {
      const { over, events } = tick(state);
      for (const e of events) {
        if (LOG_EVENT_TYPES.has(e.type)) logEvents.push(e);
      }
      if (over) break;
    }

    return buildResult(state, logEvents);
  } finally {
    setRng(null);
  }
}

/**
 * 运行 N 次蒙特卡洛模拟，返回平均结果。
 * 日志取自第一次运行；其余运行的日志立即丢弃，避免 N 份完整日志同时驻留内存。
 * @param {BattleConfig} config
 * @param {number} iterations
 * @param {(done: number, total: number) => void} [onProgress] 每完成一次运行回调一次
 * @returns {BattleResult}
 */
export function simulateMonteCarlo(config, iterations = 100, onProgress) {
  const results = [];
  for (let i = 0; i < iterations; i++) {
    const r = simulate(config);
    results.push(i === 0 ? r : { ...r, log: null });
    onProgress?.(i + 1, iterations);
  }
  return averageResults(results);
}

// ─── 结果构造 ──────────────────────────────────────────────────────────

const LOG_EVENT_TYPES = new Set(['burst_i', 'burst_ii', 'burst_iii', 'full_burst', 'burst_end', 'burst_timeout', 'reload', 'phase_change', 'skill_trigger', 'enemy_action', 'reload_interrupted']);

function buildResult(state, events) {
  const timeSeconds = state.tick / TICK_RATE;
  const totalDamage = state.squad.reduce((s, u) => s + u.totalDamage, 0);
  const burstCount  = events.filter(e => e.type === 'full_burst').length;
  const log         = events.filter(e => LOG_EVENT_TYPES.has(e.type));

  return {
    timeSeconds,
    totalDamage,
    dps:         timeSeconds > 0 ? totalDamage / timeSeconds : 0,
    burstCount,
    log,
    hitLog:          state.hitLog          ?? null,
    buffLog:         state.buffLog         ?? null,
    ammoLog:         state.ammoLog         ?? null,
    burstEnergyLog:  state.burstEnergyLog  ?? null,
    units: state.squad.map(u => ({
      id:               u.id,
      name:             u.name,
      weaponType:       u.weaponType,
      totalDamage:      u.totalDamage,
      dps:              timeSeconds > 0 ? u.totalDamage / timeSeconds : 0,
      critRate:         u.hitCount > 0 ? u.critCount / u.hitCount : 0,
      burstCount:       u.burstCount,
      hitCount:         u.hitCount,
      reloadCount:      u.reloadCount,
      skillDamage:      u.skillDamage ?? {},
      skillDamageCount: u.skillDamageCount ?? {},
    })),
  };
}

function averageResults(results) {
  const n   = results.length;
  const avg = arr => arr.reduce((s, v) => s + v, 0) / n;

  return {
    timeSeconds: avg(results.map(r => r.timeSeconds)),
    totalDamage: avg(results.map(r => r.totalDamage)),
    dps:         avg(results.map(r => r.dps)),
    burstCount:  avg(results.map(r => r.burstCount)),
    log:         results[0]?.log ?? [],
    iterations:  n,
    units: results[0].units.map((_, i) => {
      // 对所有运行的 skillDamage 与 skillDamageCount 取平均
      const allLabels = new Set(results.flatMap(r => Object.keys(r.units[i]?.skillDamage ?? {})));
      const skillDamage = {}, skillDamageCount = {};
      for (const lbl of allLabels) {
        skillDamage[lbl]      = avg(results.map(r => r.units[i]?.skillDamage?.[lbl]      ?? 0));
        skillDamageCount[lbl] = avg(results.map(r => r.units[i]?.skillDamageCount?.[lbl] ?? 0));
      }
      return {
        id:               results[0].units[i].id,
        name:             results[0].units[i].name,
        totalDamage:      avg(results.map(r => r.units[i]?.totalDamage ?? 0)),
        dps:              avg(results.map(r => r.units[i]?.dps ?? 0)),
        critRate:         avg(results.map(r => r.units[i]?.critRate ?? 0)),
        burstCount:       avg(results.map(r => r.units[i]?.burstCount ?? 0)),
        skillDamage,
        skillDamageCount,
      };
    }),
  };
}
