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

import { calcDamage, rollCrit, hasDistanceAdvantage } from './damage.js';
import { computeFinalStats } from './stats.js';
import { WEAPON_AMMO, WEAPON_HIT_MULT } from './constants.js';
import { getFavItemSkillEffects, getSsrFavSkills, getSkillValue } from '../data/models.js';
import { getCharacterTraits } from '../data/skill-traits.js';
import { getBuffSums, pushBuff, addBurstGauge, applyHeal, applyShield, fireSkillHit, fireDotPool } from './battle-utils.js';
import { executeSkillTriggers, onShotFired, onIntervalInBurst, onInterval, onReloadEnd } from './skill-executor.js';

export const TICK_RATE = 60; // 每秒 tick 数
const MAX_TICKS = TICK_RATE * 180; // 战斗上限 3 分钟

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
// 满蓄力能量 = burstEnergyPerShot × (fullChargeDamage / 10000)。
// 共享槽达到上限后 burst_i 触发；所有写入均通过 addBurstGauge() → state.burstGauge。
const BURST_GAUGE_MAX = 1_000_000;

/**
 * 返回指定 tick 生效的 zone。
 * phases 必须按 startTick 升序排列。
 * @param {{ startTick: number, zone: string }[]} phases
 * @param {number} tick
 * @returns {string}
 */
function getPhaseAtTick(phases, tick) {
  for (let i = phases.length - 1; i >= 0; i--) {
    if (tick >= phases[i].startTick) return phases[i].zone;
  }
  return phases[0]?.zone ?? 'NEAR';
}

// ─── Buff/伤害/回复辅助均已从 battle-utils.js 导入 ──────────────────────────
// getBuffSums, pushBuff, addBurstGauge, applyHeal, fireSkillHit


// ─── 技能事件处理器 ─────────────────────────────────────────────────────

/**
 * 寻找在指定 step 上可以释放 burst 技能的最高优先级（最左侧）单位。
 * 若其 burst 技能冷却已结束则返回该单位，否则返回 null。
 */
function selectBurstUnit(state, burstStep) {
  return state.squad.find(u => u.burstStep === burstStep && u.canBurst !== false && u.burstSkillCooldownEndTick <= state.tick) ?? null;
}

/**
 * 分派 HEAL_RECEIVED 触发：消费 state.pendingHealReceived 队列（由 applyHeal 填充），
 * 去重后逐单位调用 executeSkillTriggers。
 * 调用时机：每次可能触发 applyHeal 的操作（onShotFired、executeSkillTriggers）之后。
 */
function flushHealReceived(state) {
  if (!state.pendingHealReceived?.length) return;
  const seen   = new Set();
  const healed = state.pendingHealReceived.splice(0);
  for (const u of healed) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    executeSkillTriggers(state, 'HEAL_RECEIVED', { unit: u });
  }
}

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
 * 进入 Burst 1 阶段时触发的被动效果（槽填满那一 tick 立即触发，不依赖 B1 单位是否 cast）。
 * 触发时机：burstPhase 从 0 变为 1（共享槽填满）。
 */
function applyEnterBurst1Passives(state) {
  executeSkillTriggers(state, 'ENTER_BURST_I');
}

/**
 * 进入 Burst 2 阶段时触发的被动效果（B1 技能施放后立即触发，然后才开始 burstStepTicks 延迟）。
 * 不依赖 B2 单位是否冷却结束。
 */
function applyEnterBurst2Passives(state) {
  executeSkillTriggers(state, 'ENTER_BURST_II');
}

/**
 * 进入 Burst 3 阶段时触发的被动效果（B2 技能施放后立即触发，然后才开始 burstStepTicks 延迟）。
 * 不依赖 B3 单位是否冷却结束。
 */
function applyEnterBurst3Passives(state) {
  executeSkillTriggers(state, 'ENTER_BURST_III');
  flushHealReceived(state);
}

/** Step1 burst：若冷却结束则释放。返回释放的单位，或 null。 */
function applyBurstISkills(state) {
  const b1 = selectBurstUnit(state, 'Step1');
  if (!b1) {
    // 队伍中完全没有 Step1 单位 → 立即推进阶段且不触发任何技能效果。
    //（若存在 Step1 单位但冷却中，返回 null 继续等待。）
    if (!state.squad.some(u => u.burstStep === 'Step1' && u.canBurst !== false)) {
      return { name: null };
    }
    return null;
  }

  b1.burstSkillCooldownEndTick = state.tick + b1.burstSkillCooltime;
  state.burstCastersThisRotation?.add(b1.id);
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: b1 });
  flushHealReceived(state);
  flushShieldReceived(state);
  return b1;
}

/** Step2 burst：若冷却结束则释放。返回释放的单位，或 null。 */
function applyBurstIISkills(state) {
  const b2 = selectBurstUnit(state, 'Step2');
  if (!b2) return null;

  b2.burstSkillCooldownEndTick = state.tick + b2.burstSkillCooltime;
  state.burstCastersThisRotation?.add(b2.id);
  executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: b2 });
  flushHealReceived(state);
  flushShieldReceived(state);
  return b2;
}

/**
 * 所有"进入 Full Burst"时的效果。
 * 被动技能（ENTER_FULL_BURST）和 Step3 burst 技能（BURST_SKILL_USE）均由
 * executeSkillTriggers 分派。
 */
function applyFullBurstSkills(state) {
  // 1. B3 单位依次施放爆裂技能
  const burstFireOrder = state.squad.filter(u =>
    (u.burstStep === 'Step3' || u.burstStep === 'StepFull') &&
    u.canBurst !== false &&
    u.burstSkillCooldownEndTick <= state.tick
  );

  let firstFired = null;
  for (const step3 of burstFireOrder) {
    step3.burstSkillCooldownEndTick = state.tick + step3.burstSkillCooltime;
    state.burstCastersThisRotation?.add(step3.id);
    if (!firstFired) firstFired = step3;

    // 标记"爆裂技能施放中"：使同步命中自动跳过全爆裂补正（默认结算）
    const prePendingLen = state.pendingSkillHits.length;
    state.burstSkillFiring = true;
    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: step3 });
    state.burstSkillFiring = false;

    // 自动为此期间新增的延迟命中打 suppressFullBurst 标记（affectedByFullBurst 的除外）
    for (let i = prePendingLen; i < state.pendingSkillHits.length; i++) {
      const h = state.pendingSkillHits[i];
      if (!h.opts) h.opts = {};
      if (!h.opts.affectedByFullBurst) h.opts.suppressFullBurst = true;
    }

    flushHealReceived(state);
    flushShieldReceived(state);
  }

  // 2. 全爆裂阶段生效（B3 施放完毕后）— 绝大多数技能的 ENTER_FULL_BURST 在此触发
  executeSkillTriggers(state, 'ENTER_FULL_BURST');
  flushHealReceived(state);

  // 3. 结算 BURST_SKILL_USE / ENTER_FULL_BURST 期间入队的 pendingFireInBurstHits（全爆裂后触发）
  for (const h of state.pendingFireInBurstHits) {
    const sums = h.sums ?? getBuffSums(state, h.caster.id);
    fireSkillHit(state, h.caster, h.mult, sums, h.isCharged, h.label, h.opts);
  }
  state.pendingFireInBurstHits.length = 0;

  return firstFired;
}


/** 爆裂结束后的冷却效果与清理。 */
function applyBurstEndSkills(state) {
  executeSkillTriggers(state, 'FULL_BURST_END');
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
  const squad = config.squad.map(cfg => {
    validateUnitConfig(cfg);
    const stats   = cfg._computedStats ?? computeFinalStats(cfg, cfg.level ?? 200, {});
    // CHARACTER_TRAITS.weaponType overrides CDN-derived cfg.weaponType when the CDN data is known to be wrong.
    const wt      = getCharacterTraits(cfg.characterId)?.weaponType ?? cfg.weaponType ?? 'AR';
    // Collection skill ammo bonus (MG items: Max Ammo ▲X%) applied at unit creation.
    // Other collection skill effects are applied as permanent buffs after state is built.
    const collFx  = cfg._favItemData
      ? getFavItemSkillEffects(cfg._favItemData, cfg.favoriteItem?.level ?? 0) : null;
    // Base ammo: prefer CDN-derived value from config (baseAmmo), fall back to weapon type table.
    const baseAmmo = cfg.baseAmmo ?? WEAPON_AMMO[wt] ?? 30;
    // Fav item ammo pct: applied as Math.round(base × pct), matching in-game rounding.
    // bonusAmmo (from OL equipment stats) is pre-computed using the grouped-ROUND rule:
    //   duplicate pct values are grouped → Math.round(base × pct × count) per group.
    const favAmmoBonus = collFx?.ammoPct ? Math.round(baseAmmo * collFx.ammoPct) : 0;
    const maxAmmo = baseAmmo + Math.round(baseAmmo * (stats.bonusAmmo ?? 0)) + favAmmoBonus;
    // FORESWING/BACKSWING for SR/RL weapons: time before and after each charge shot.
    // Default 10 ticks each; per-unit overrides via cfg.foreswingTicks / cfg.backswingTicks.
    // Note: maintain_fire_stance==0 in CDN also uses defaults; explicit overrides win.
    const isChargWeapon = ['SR', 'RL'].includes(wt);
    const foreswingTicks = isChargWeapon ? (cfg.foreswingTicks ?? 10) : 0;
    const backswingTicks = isChargWeapon ? (cfg.backswingTicks ?? 10) : 0;
    const chargeTimeTicks = cfg.chargeTimeTicks ?? 0;
    const ssrFavSkills = cfg._favItemData
      ? getSsrFavSkills(cfg._favItemData, cfg.favoriteItem?.level ?? 0, cfg.ssrFavSkillLevel)
      : null;
    return {
      id:               cfg.characterId ?? 0,
      name:             cfg.name ?? 'NIKKE',
      element:          cfg.element ?? 'Iron',
      weaponType:       wt,
      burstStep:        cfg.burstStep ?? 'Step3',
      // CDN native burst step (use_burst_skill). Used by skills like Rapi S1 to identify
      // "native B1/B2/B3 allies" (characters whose CDN burst step matches a given step).
      nativeBurstStep:  cfg.nativeBurstStep ?? cfg.burstStep ?? 'Step3',
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
      baseAmmo,         // CDN base ammo (no OL, no fav%); used for skill ammo scaling
      favAmmoBonus,     // Math.round(baseAmmo × favAmmoPct); stored for burst-expanded reload
      maxAmmo,
      ammoLeft:         maxAmmo,
      reloadTick:       0,
      ammoBeforeHidden: 0,   // non-zero only during a HIDDEN phase with a voluntary reload in progress
      // Per-unit reload duration (ticks). 必须由调用方提供（validateUnitConfig 已校验）。
      reloadTicks:      cfg.reloadTicks,
      // Charge time gating for SR/RL weapons (ticks between shots due to hold-to-charge).
      // 0 for non-charge weapons (AR/SMG/MG/SG). After each shot, chargeTick is set to
      // state.tick + foreswingTicks + chargeTimeTicks + backswingTicks.
      chargeTimeTicks,
      foreswingTicks,
      backswingTicks,
      // Initial chargeTick: foreswing + charge only (no backswing before first shot).
      chargeTick:       foreswingTicks + chargeTimeTicks,
      // Permanent equipment ATK% multiplier (item "Increase ATK" + option ATK%).
      // Added to atkPct in getBuffSums so it stacks additively with skill ATK% buffs.
      equipAtkPct:              stats.equipAtkPct  ?? 0,
      // Permanent equipment flat ATK from option rolls (OL atkFlat).
      // Added to atkFlat in getBuffSums; excluded from stats.atk so that skill
      // calculations referencing "X% of caster's ATK" use base ATK only.
      equipAtkFlat:             stats.equipAtkFlat ?? 0,
      // Fire rate from CDN shot_detail.rate_of_fire (RPM). 0 = use ATTACK_SPEED fallback.
      rateOfFire:       cfg.rateOfFire
                        ?? (cfg._nikkeData?.shot_detail?.rate_of_fire ?? 0),
      // Normal shot hit multiplier from shot_detail.damage / 10000.
      // Prefer explicit cfg value, then derive from _nikkeData, fall back to WEAPON_HIT_MULT table.
      shotDamageMult:   cfg.shotDamageMult
                        ?? (cfg._nikkeData?.shot_detail?.damage != null ? cfg._nikkeData.shot_detail.damage / 10000 : null),
      // Core hit damage increment: (core_damage_rate/10000) - 1 - BASE_CORE_DAMAGE (which is 1.0).
      // e.g. core_damage_rate=25000 → ×2.5 total → coreDmgIncrement=0.5
      coreDmgIncrement: cfg.coreDmgIncrement
                        ?? (cfg._nikkeData?.shot_detail?.core_damage_rate != null ? (cfg._nikkeData.shot_detail.core_damage_rate / 10000) - 1 - 1 : 0),
      // Full charge damage value from shot_detail (10000 = ×1.0 baseline).
      fullChargeDamage:         cfg.fullChargeDamage ?? 10000,
      // Per-shot burst energy contribution to the shared state.burstGauge.
      // burstEnergyPerShot: energy when hitting cover/missing (burst_energy_pershot).
      // targetBurstEnergyPerShot: energy when hitting the enemy target (target_burst_energy_pershot).
      // All shots and skill hits in this simulator hit the target → use targetBurstEnergyPerShot
      // for the main shot loop and all skill-hit addBurstGauge calls.
      // Full-charge energy = targetBurstEnergyPerShot × (fullChargeDamage / 10000).
      burstEnergyPerShot:       cfg.burstEnergyPerShot ?? 500,
      targetBurstEnergyPerShot: (() => {
        const v = cfg.targetBurstEnergyPerShot
                  ?? cfg._nikkeData?.shot_detail?.target_burst_energy_pershot;
        if (v == null) throw new Error(`[initBattle] 角色「${cfg.name}」缺少 targetBurstEnergyPerShot`);
        return v;
      })(),
      // Fav item "Normal Attack Damage Multiplier ▲" (SMG/SG items) — independent multiplier on baseDamage.
      favNormalAttackDamageMult: 1 + (collFx?.attackDmgPct ?? 0),
      // Fav item "Charge Damage Multiplier ▲" (SR/RL items) — multiplies shot_detail.damage specifically.
      favChargeDmgPct:          collFx?.chargeDmgPct ?? 0,
      // Fraction of normal shots that hit the enemy core (0=none, 1=all).
      // MG/SR/RL default to 1 (always hit core). SMG defaults to 0.033.
      // SG: 核心命中率 = 20% + 0.8 × HitRate；HitRate 属性待建模，当前固定 20%。
      // TODO: HitRate 属性建模后，改为 0.20 + 0.8 * (stats.hitRatePct ?? 0)。
      coreHitRateMult:          cfg.coreHitRateMult ?? (wt === 'SMG' ? 0.033 : wt === 'SG' ? 0.20 : 1),
      // SG 武器每次射击发射的弹丸数（shot_detail.shot_count）。
      // 每发弹丸造成 1/N 的普通攻击伤害（shot_detail.damage 为所有弹丸合计）。
      // 技能改变弹丸数时，每次射击总伤害不变，仅改变单发弹丸伤害。
      // 当前模拟器中弹丸数不影响伤害计算（100% 命中假设），仅供技能逻辑查询。
      shotCount:                cfg.shotCount ?? (cfg._nikkeData?.shot_detail?.shot_count ?? 1),
      // 分段装填比例（reload_bullet / 10000）。每次装填动作恢复 round(maxAmmo × reloadFraction) 发。
      // 1.0 = 一次装满（默认）；< 1.0 = 分段装填（如 Drake = 0.33，3 段装满）。
      reloadFraction:           cfg.reloadFraction
                                ?? (cfg._nikkeData?.shot_detail?.reload_bullet != null
                                    ? cfg._nikkeData.shot_detail.reload_bullet / 10000
                                    : 1),
      // false → unit fills gauge and participates in squad burst trigger, but never fires burst skill.
      // Useful for B3 units that are in the squad but excluded from the active rotation.
      canBurst:                 cfg.canBurst ?? true,
      // true → skill-based Charge Speed buffs (chargeSpeedPct on buff objects) do not apply to this unit.
      // Equipment chargeSpeedPct from stats always applies regardless.
      // Used for Liberalio whose S1 grants immunity to skill-based CS effects.
      immuneSkillChargeSpeed:   cfg.immuneSkillChargeSpeed ?? false,
      // true → unit is in Combat Assist status (filling a burst step that is not its native step).
      // Set explicitly via cfg.combatAssist; re-evaluated at BATTLE_START and FULL_BURST_END
      // by SKILL_TRAITS triggers (see skill-traits.js entry for this character).
      configuredCombatAssist: cfg.combatAssist ?? false,
      combatAssistStatus: cfg.combatAssist ?? false,
      // Burst skill cooldown: endTick=0 means ready from the start.
      burstSkillCooldownEndTick: 0,
      // Burst skill cooltime in ticks (from CDN ulti_skill_detail.skill_cooltime / 100 * 60).
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
      // Temporary max ammo multiplier (e.g. SBS Skill 2: ×1.6 for 10s during burst).
      // Applied to reload size only; does not change maxAmmo permanently.
      tempMaxAmmoMult:    1,
      tempMaxAmmoEndTick: 0,
      // Fractional shot accumulator for MG weapons.
      // Eliminates per-tick rounding loss at high ROF (e.g. Crown 4200 RPM = 1.17 shots/tick).
      shotAccumulator:  0,
      skillState: {},
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
  });

  // 爆裂阶段间隔（ticks）：B1→B2 和 B2→B3 各等待此时长。
  // config.burstStepSecs 范围 0.1–0.6；默认 0.6 秒（游戏内实测值）。
  const burstStepTicks = Math.round(TICK_RATE * Math.max(0.1, Math.min(0.6, config.burstStepSecs ?? 0.6)));

  // Enemy phase schedule: array of { startTick, zone } sorted ascending.
  // If config.enemy.phases is provided it overrides the default schedule.
  const enemyPhases = config.enemy.phases ?? [];
  const initialZone = getPhaseAtTick(enemyPhases, 0);

  const state = {
    squad,
    enemyDef:           config.enemy.def ?? 0,
    enemyElement:       config.enemy.element ?? 'Iron',
    enemyHasCore:       config.enemy.hasCore ?? false,
    // Active enemy zone for distance-based damage. Updated on each non-CANNOT_BE_AIMED phase entry.
    // config.enemy.distance overrides the phase schedule entirely (legacy / test usage).
    distanceZone:       config.enemy.distance ?? (initialZone !== 'CANNOT_BE_AIMED' ? initialZone : null),
    // Phase schedule and current zone tracker.
    enemyPhases,
    currentPhaseZone:   initialZone,
    tick:               0,
    burstStepTicks,
    fullBurstActive:    false,
    burstSkillFiring:   false,
    fullBurstTick:      0,
    burstPhase:         0,
    // When set to an array, every damage hit (normal and skill) appends a detail record.
    hitLog:             config.hitLog ? [] : null,
    buffLog:            config.hitLog ? [] : null,
    ammoLog:            config.hitLog ? [] : null,
    // When set to an array, every burst gauge change while burstPhase===0 appends a record.
    // { tick, unitName, source, energyAdded, gaugeAfter }
    burstEnergyLog:     config.burstEnergyLog ? [] : null,
    burstPhaseTick:     0,
    // Tick at which the current burst phase (1 or 2) times out if not advanced.
    // 0 when not in a timed phase. If state.tick >= burstPhaseTimeoutTick and phase is still 1 or 2,
    // the burst collapses and gauges reset to 0.
    burstPhaseTimeoutTick: 0,
    // Active buffs: { name, unitId (null=all), atkPct, atkFlat, defFlat,
    //                attackDamagePct, critRateBonus, chargeDamagePct, reloadSpeedPct, endTick }
    buffs:              [],
    totalAmmoFired:     0,
    lastMilestone400:   0,   // how many 400-ammo milestones have been crossed
    lastMilestone500:   0,   // how many 500-ammo milestones have been crossed
    enemyDamageTakenPct: 0,  // sum of all Damage Taken debuffs on enemy
    // Shared burst gauge (0..BURST_GAUGE_MAX). All units contribute via their shots/skills.
    // Rotation triggers when >= BURST_GAUGE_MAX; resets to 0 after Full Burst ends.
    burstGauge:         0,
    // Set of unit IDs that successfully fired their burst skill in the current rotation.
    // Populated during applyBurstISkills / applyBurstIISkills / applyFullBurstSkills.
    // Cleared when a new rotation begins (gauge fills → burstPhase 0→1).
    burstCastersThisRotation: new Set(),
    // 全队普通攻击命中计数，由 skill-executor.onShotFired 在每次射击时自增。
    squadShotCount: 0,
    // Deferred skill hits: [{ fireTick, caster, mult, sums, isCharged, label, opts }]
    // Processed at the start of each tick before unit loops.
    pendingSkillHits: [],
    // Queue of units that received heals this tick. Populated by applyHeal (battle-utils).
    // Consumed by flushHealReceived() which dispatches HEAL_RECEIVED triggers.
    pendingHealReceived: [],
    // Queue of units that received shields this tick. Populated by applyShield (battle-utils).
    // Consumed by flushShieldReceived() which dispatches APPLY_SHIELD triggers per unit.
    pendingShieldReceived: [],
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
  };

  // BATTLE_START: dispatch all declarative battle-start triggers (e.g. LM Bubble debuff).
  executeSkillTriggers(state, 'BATTLE_START');

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
      state.currentPhaseZone = newZone;
      if (newZone === 'HIDDEN') {
        // HIDDEN 阶段所有单位开始装填。
        // 仍有弹药的单位：保存当前弹药，将 ammoLeft 置 0 以便下一 tick
        // 启动装填机制。敌人再次出现时，若装填未完成，弹药会恢复
        // （自愿装填被打断）。
        // 本已 0 弹药的单位（正在装填）：其装填继续不中断。
        for (const u of state.squad) {
          if (u.ammoLeft > 0) {
            u.ammoBeforeHidden = u.ammoLeft;
            u.ammoLeft  = 0;
            u.reloadTick = 0; // 装填机制在下一 tick 接管
          }
          // ammoLeft==0 情况：原有装填继续自然进行
        }
      } else {
        // 进入可瞄准的 zone — 更新伤害计算用的 distance zone。
        state.distanceZone = newZone;
        // 对自愿 HIDDEN 装填未完成的单位恢复原弹药。
        for (const u of state.squad) {
          if (u.ammoBeforeHidden > 0) {
            if (u.reloadTick > 0 && state.tick < u.reloadTick) {
              // 装填仍在进行 — 恢复原弹药并取消装填。
              u.ammoLeft   = u.ammoBeforeHidden;
              u.reloadTick = 0;
            }
            u.ammoBeforeHidden = 0;
          }
        }
      }
      events.push({ type: 'phase_change', tick: state.tick, zone: newZone });
    }
  }

  // 清理过期 buff — 移除前先记录过期事件
  for (const b of state.buffs) {
    if (b.endTick <= state.tick) {
      if (state.buffLog)
        state.buffLog.push({ type: 'buff_expire', tick: state.tick, name: b.name, unitId: b.unitId });
      // 敌人承伤 debuff：到期时从全局累加器中减去
      if (b.enemyDamageTakenPct) state.enemyDamageTakenPct -= b.enemyDamageTakenPct;
      // 仅改容量的弹药 buff（maxAmmoPct 或 maxAmmoFlat > 0）：到期时将当前弹药截到基础 maxAmmo
      if (b.maxAmmoPct > 0 || b.maxAmmoFlat > 0) {
        const targets = b.unitId != null
          ? [state.squad.find(u => u.id === b.unitId)].filter(Boolean)
          : state.squad;
        for (const u of targets) {
          if (u.ammoLeft > u.maxAmmo) {
            const before = u.ammoLeft;
            u.ammoLeft = u.maxAmmo;
            if (state.ammoLog)
              state.ammoLog.push({ tick: state.tick, unitId: u.id, unitName: u.name,
                delta: u.ammoLeft - before, ammoAfter: u.ammoLeft, maxAmmo: u.maxAmmo,
                source: `${b.name}(expired)` });
          }
        }
      }
    }
  }
  state.buffs = state.buffs.filter(b => b.endTick > state.tick);

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
      if (target) applyHeal(state, target, h.amount);
    }
    if (dueHeals.length > 0) flushHealReceived(state);
  }

  // ── 延迟技能命中队列 ──────────────────────────────────────────────────────
  if (state.pendingSkillHits?.length > 0) {
    const due = state.pendingSkillHits.filter(h => h.fireTick <= state.tick);
    state.pendingSkillHits = state.pendingSkillHits.filter(h => h.fireTick > state.tick);
    for (const h of due) {
      const sums = h.sums ?? getBuffSums(state, h.caster.id);
      fireSkillHit(state, h.caster, h.mult, sums, h.isCharged, h.label, h.opts ?? {});
    }
  }

  // 清理过期的护盾
  for (const u of state.squad) {
    if (u.shieldHp > 0 && state.tick >= u.shieldEndTick) u.shieldHp = 0;
  }

  // ── 爆裂序列状态机 ─────────────────────────────────────────────

  // Full Burst 窗口到期 → 共享槽清零，团队需重新填充
  if (state.fullBurstActive && state.tick >= state.fullBurstTick) {
    state.fullBurstActive = false;
    state.burstPhase      = 0;
    state.burstGauge      = 0;
    events.push({ type: 'burst_end', tick: state.tick });
    applyBurstEndSkills(state);
  }

  // 爆裂阶段 1 或 2 超时（10 秒窗口）：若未推进，爆裂取消 → 槽归零
  if ((state.burstPhase === 1 || state.burstPhase === 2) &&
      state.burstPhaseTimeoutTick > 0 && state.tick >= state.burstPhaseTimeoutTick) {
    state.burstPhase          = 0;
    state.burstPhaseTimeoutTick = 0;
    state.burstGauge          = 0;
    events.push({ type: 'burst_timeout', tick: state.tick });
  }

  // 阶段 1：等待 B1 冷却 — 每 tick 重试，直到有 B1 单位冷却结束。
  //（槽填满的那一 tick 会跳过这段；那一 tick 由下方"填满槽"逻辑触发 B1。）
  if (state.burstPhase === 1 && state.burstPhaseTick === Infinity) {
    const fired = applyBurstISkills(state);
    if (fired) {
      // 进入 B2 被动在 B1 施放后立即触发，然后才开始延迟
      applyEnterBurst2Passives(state);
      state.burstPhaseTick = state.tick + state.burstStepTicks;
      events.push({ type: 'burst_i', tick: state.tick, unitName: fired.name });
      if (fired.name === 'Liter') events.push({ type: 'heal_cover', tick: state.tick });
    }
  }

  // B1 延迟结束 → 推进到阶段 2（等待 B2 冷却）
  if (state.burstPhase === 1 && state.burstPhaseTick !== Infinity && state.tick >= state.burstPhaseTick) {
    state.burstPhase          = 2;
    state.burstPhaseTick      = Infinity;
    state.burstPhaseTimeoutTick = state.tick + TICK_RATE * 10;
  }

  // 阶段 2：等待 B2 冷却 — 每 tick 重试，直到有 B2 单位冷却结束。
  if (state.burstPhase === 2 && state.burstPhaseTick === Infinity) {
    const fired = applyBurstIISkills(state);
    if (fired) {
      // 进入 B3 被动在 B2 施放后立即触发，然后才开始延迟
      applyEnterBurst3Passives(state);
      state.burstPhaseTick = state.tick + state.burstStepTicks;
      events.push({ type: 'burst_ii', tick: state.tick, unitName: fired.name });
    }
  }

  // B2 延迟结束 → Full Burst
  if (state.burstPhase === 2 && state.burstPhaseTick !== Infinity && state.tick >= state.burstPhaseTick) {
    state.burstPhase        = 3;
    state.fullBurstActive   = true;
    state.fullBurstTick     = state.tick + TICK_RATE * 10; // 10s burst window
    state.burstPhaseTimeoutTick = 0;
    // 此处不重置槽 — 重置在 Full Burst 结束时进行。
    for (const u of state.squad) u.burstCount++;
    const fired = applyFullBurstSkills(state);
    events.push({ type: 'full_burst', tick: state.tick, unitName: fired?.name ?? null });
  }

  // 共享槽填满 → 进入阶段 1（等待 B1 冷却；若冷却已结束立即尝试）
  if (state.burstPhase === 0 && state.burstGauge >= BURST_GAUGE_MAX) {
    state.burstPhase          = 1;
    state.burstPhaseTick      = Infinity;
    state.burstPhaseTimeoutTick = state.tick + TICK_RATE * 10;
    state.burstCastersThisRotation = new Set();
    // 进入 Burst 1 阶段时立即触发被动（不依赖 B1 是否 cast）
    applyEnterBurst1Passives(state);
    const fired = applyBurstISkills(state);
    if (fired) {
      // 进入 B2 被动在 B1 施放后立即触发，然后才开始延迟
      applyEnterBurst2Passives(state);
      state.burstPhaseTick = state.tick + state.burstStepTicks;
      events.push({ type: 'burst_i', tick: state.tick, unitName: fired.name });
      if (fired.name === 'Liter') events.push({ type: 'heal_cover', tick: state.tick });
    }
  }

  // ── 全程定时技能（INTERVAL）：如 Nayuta S2 Memory Absorption ──────────
  onInterval(state);

  // ── 全爆裂期间定时技能（INTERVAL_IN_BURST）：如 LM Bubble Wave ─────────
  if (state.fullBurstActive) {
    onIntervalInBurst(state);
    flushHealReceived(state);
  }

  // ── 每个单位进行攻击 ─────────────────────────────────────────────────────
  // HIDDEN 阶段：装填仍然处理（自愿 HIDDEN 装填可以完成），
  // 但射击跳过。保护判断位于装填块之后的循环内部。

  for (const unit of state.squad) {
    // 单位眩晕：眩晕期间跳过所有处理
    if ((unit.skillState.stunnedUntilTick ?? 0) > 0 && state.tick < unit.skillState.stunnedUntilTick) continue;
    // 武器切换结束后 backswing 封锁（如 Snow White burst 击发后 90 ticks）
    if ((unit.skillState.weaponSwitchPostBackswingEndTick ?? 0) > 0
        && state.tick < unit.skillState.weaponSwitchPostBackswingEndTick) continue;

    // 装填处理（HIDDEN 期间也会运行，让进行中的装填能够完成）
    // unlimitedAmmoEndTick 激活期间弹药不消耗，永远不会达到 0，跳过装填逻辑
    if (unit.ammoLeft <= 0 && !((unit.skillState.unlimitedAmmoEndTick ?? 0) > state.tick)) {
      const rSums = getBuffSums(state, unit.id);
      if (unit.reloadTick === 0) {
        // fixedReloadSpeedPct：固定装填速度加成，屏蔽其他装填速度效果（如 Asuka: WILLE S2）
        const effectiveReloadSpeed = unit.skillState?.fixedReloadSpeedPct ?? rSums.reloadSpeedPct;
        const dur   = Math.round(unit.reloadTicks / (1 + effectiveReloadSpeed));
        unit.reloadTick      = state.tick + dur;
        unit.reloadStartTick = state.tick;
      }
      if (state.tick < unit.reloadTick) continue;
      const ammoMult       = (state.tick < unit.tempMaxAmmoEndTick) ? unit.tempMaxAmmoMult : 1;
      // maxAmmoFlat buff：来自技能的弹容量加成（如 Liter S1 T1、Noir S2、Grave 爆裂），
      // 所有来源通过 buff 系统叠加，由 getBuffSums 统一汇总。
      const flatBoost = rSums.maxAmmoFlat ?? 0;
      // 技能缩放弹匣：每个 pct 效果单独对 baseAmmo 取整（T33 per-effect round 公式）。
      // OL/fav 平坦加成在取整后叠加，整体结果 max(1, ...)。
      const effectiveMax = flatBoost > 0
        ? unit.maxAmmo + flatBoost
        : (ammoMult !== 1
          ? Math.max(1, unit.baseAmmo + Math.round(unit.baseAmmo * (ammoMult - 1)))
            + (unit.stats.bonusAmmo ?? 0) + unit.favAmmoBonus
          : unit.maxAmmo);
      // 分段装填：每次装填动作仅恢复 round(maxAmmo × reloadFraction) 发，不超过上限。
      // reloadFraction=1（默认）时等价于一次装满。
      unit.ammoLeft = unit.reloadFraction < 1
        ? Math.min(effectiveMax, Math.round(unit.maxAmmo * unit.reloadFraction))
        : effectiveMax;
      unit.reloadCount++;
      unit.reloadTick      = 0;
      events.push({ type: 'reload', tick: state.tick, unitId: unit.id, unitName: unit.name, ammoRefilled: unit.ammoLeft, maxAmmo: unit.maxAmmo });
      unit.shotAccumulator = 0; // 装填后射击周期重新开始
      onReloadEnd(state, unit);
    }

    // HIDDEN 阶段跳过射击（上方装填仍然允许）。
    if (state.currentPhaseZone === 'HIDDEN') continue;

    // 决定本 tick 的射击数。
    // SR/RL（蓄力武器）：确定性 — chargeTick 到达时恰好打出 1 发。
    // 带有 CDN rateOfFire 的单位：累加器模型（发数/分钟 ÷ 3600 = 发数/tick）。
    //   MG 起速通过 mgCurrentRof 覆盖 rateOfFire。
    // 回退：使用 ATTACK_SPEED 表的 0/1 概率门。
    // 武器切换（WEAPON_SWITCH 效果）：覆盖 hitMult / isCharged，以及蓄力模式（hoisted）
    const weaponSwitchActive = (unit.skillState?.weaponSwitchEndTick ?? 0) > 0
      && state.tick <= unit.skillState.weaponSwitchEndTick;
    let shotsThisTick;
    // 武器切换时允许非蓄力武器（如 SMG）临时以蓄力模式开火。
    const weaponSwitchChargeTimeTicks = weaponSwitchActive
      ? (unit.skillState.weaponSwitchChargeTimeTicks ?? 0) : 0;
    const effectiveChargeTimeTicks = weaponSwitchChargeTimeTicks > 0
      ? weaponSwitchChargeTimeTicks : unit.chargeTimeTicks;
    if (effectiveChargeTimeTicks > 0) {
      // 蓄力武器：蓄力完成时打出 1 发，然后重置计时器。
      shotsThisTick = state.tick >= unit.chargeTick ? 1 : 0;
    } else if (unit.rateOfFire > 0) {
      const baseRof = unit.mgCurrentRof ?? unit.rateOfFire;
      // Attack speed ▲：从 buff 系统汇总，支持多来源叠加（Dorothy burst、TV S1 等）
      const atkSpeedPct = state.buffs
        .filter(b => (b.unitId === null || b.unitId === unit.id) && b.endTick > state.tick && (b.roundsLeft ?? 1) > 0)
        .reduce((a, b) => a + (b.atkSpeedPct ?? 0), 0);
      const rof = baseRof * (1 + atkSpeedPct);
      const spt = rof / 60 / TICK_RATE; // RPM → 每 tick 发数
      unit.shotAccumulator += spt;
      shotsThisTick         = Math.floor(unit.shotAccumulator);
      unit.shotAccumulator -= shotsThisTick;
    } else {
      shotsThisTick = Math.random() < (ATTACK_SPEED[unit.weaponType] ?? 0.20) ? 1 : 0;
    }
    // MG ramp decay: when not firing this tick, ROF decays toward start ROF.
    if (shotsThisTick === 0) {
      if (unit.mgCurrentRof != null && unit.mgRofDecayPerTick > 0) {
        unit.mgCurrentRof = Math.max(
          unit.mgStartRof,
          unit.mgCurrentRof - unit.mgRofDecayPerTick
        );
      }
      continue;
    }

    for (let _s = 0; _s < shotsThisTick; _s++) {
      if (unit.ammoLeft <= 0) break; // 本 tick 中途弹尽；下一 tick 开始装填

      // 计算 buff 汇总（round-based buff 由 getBuffSums 自动根据 roundsLeft 过滤）
      const sums = getBuffSums(state, unit.id);
      // 武器切换（WEAPON_SWITCH 效果）：期间覆盖 hitMult 和 isCharged
      const effectiveWeaponType = weaponSwitchActive
        ? (unit.skillState.weaponSwitchType ?? unit.weaponType)
        : unit.weaponType;
      const hitMult = weaponSwitchActive
        ? (unit.skillState.weaponSwitchHitMult ?? WEAPON_HIT_MULT[effectiveWeaponType] ?? 0.03)
        : (unit.shotDamageMult ?? WEAPON_HIT_MULT[unit.weaponType] ?? 0.03);
      const isCharged = ['SR', 'RL'].includes(effectiveWeaponType);
      const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRateBonus
        + (isCharged ? 0 : (sums.normalAttackCritRateBonus ?? 0)));
      const isCrit    = rollCrit(effectiveCritRate);
      // 普通射击的核心命中概率。
      // MG/SR/RL 必定命中核心（coreHitRateMult=1，默认）。SMG：默认 0.033。
      // TODO: SG/AR — 标定核心命中率；在测定前默认 1
      // TODO: 基于 CDN shot spread / hitbox 数据实现真实的命中率机制
      const coreHitRateMult = unit.coreHitRateMult ?? 1;
      const isCore = state.enemyHasCore && (coreHitRateMult >= 1 || Math.random() < coreHitRateMult);

      const { damage, breakdown: bd } = calcDamage({
        atk:               unit.stats.atk,
        atkMultiplier:     1 + sums.atkPct,
        otherAtkIncrement: sums.atkFlat,
        enemyDef:          state.enemyDef,
        hitMultiplier:     hitMult,
        weaponType:        effectiveWeaponType,
        isCrit,
        critDmgIncrement:  (unit.stats.critDmg ?? 0.50) - 0.50 + sums.critDmgBonus,
        isCore,
        coreDmgIncrement:  (unit.coreDmgIncrement ?? 0) + (isCore ? (sums.coreDamagePct ?? 0) : 0),
        distanceZone:      state.distanceZone,
        isFullBurst:       state.fullBurstActive,
        attackerElement:   unit.element,
        defenderElement:   state.enemyElement,
        elementAdvantageDmgIncrement: (unit.stats.elementDmgPct ?? 0) + (sums.elementAdvantageBonus ?? 0),
        isCharged,
        fullChargeDamage:  weaponSwitchActive && unit.skillState.weaponSwitchFullChargeDamage != null
          ? unit.skillState.weaponSwitchFullChargeDamage
          : (unit.fullChargeDamage ?? 10000),
        favChargeDmgPct:   unit.favChargeDmgPct ?? 0,
        chargeDmgStat:     1 + (unit.stats.chargeDmgPct ?? 0) + sums.chargeDamagePct,
        favNormalAttackDamageMult: unit.favNormalAttackDamageMult ?? 1,
        extra:             { attackDamageMult: sums.attackDamagePct + sums.normalAttackDamagePct
                             + (effectiveWeaponType === 'RL' ? sums.projectileExplosionDamagePct : 0),
                             ...((weaponSwitchActive && unit.skillState.weaponSwitchPierce)
                                 || unit.skillState.pierceActive
                                 || (unit.skillState.pierceEndTick ?? 0) > state.tick
                               ? { pierceDamageMult: sums.pierceDamagePct } : {}) },
        damageTakenMult:   state.enemyDamageTakenPct,
      });

      const ammoBeforeShot = unit.ammoLeft;
      // 武器替换期间无限弹药（如 Moran burst），或 skillState.unlimitedAmmoEndTick 激活期间（如 Grave Prediction）
      const isUnlimitedAmmoShot = (weaponSwitchActive && unit.skillState.weaponSwitchUnlimitedAmmo)
        || (unit.skillState.unlimitedAmmoEndTick ?? 0) > state.tick;
      if (!isUnlimitedAmmoShot) {
        unit.ammoLeft--;
        // round-based buff（roundsLeft）：实弹命中时消耗 1 回合；无限弹期间不消耗
        let bi = state.buffs.length;
        while (bi--) {
          const b = state.buffs[bi];
          if (b.unitId !== unit.id || b.roundsLeft == null) continue;
          if (--b.roundsLeft <= 0) state.buffs.splice(bi, 1);
        }
      }
      unit.hitCount++;
      if (isCrit) unit.critCount++;
      unit.totalDamage += damage;
      // 调试：按单位记录普通射击伤害
      unit.skillDamage        ??= {};
      unit.skillDamageCount   ??= {};
      const normalLabel = 'normal_shot';
      unit.skillDamage[normalLabel]      = (unit.skillDamage[normalLabel]      ?? 0) + damage;
      unit.skillDamageCount[normalLabel] = (unit.skillDamageCount[normalLabel] ?? 0) + 1;
      // 普通射击的逐发详细日志
      if (state.hitLog) {
        state.hitLog.push({
          tick: state.tick, unitId: unit.id, label: normalLabel,
          atk: unit.stats.atk, atkPct: sums.atkPct, atkFlat: sums.atkFlat,
          hitMult, isCrit, critDmgInc: (unit.stats.critDmg ?? 0.50) - 0.50,
          favNormalAttackDamageMult: unit.favNormalAttackDamageMult ?? 1,
          attackDamagePct: sums.attackDamagePct + sums.normalAttackDamagePct, isFullBurst: state.fullBurstActive,
          damageTakenPct: state.enemyDamageTakenPct, enemyDef: state.enemyDef,
          ammoBeforeShot, isCore, coreDmgIncrement: unit.coreDmgIncrement ?? 0, damage,
          elementDmgPct: unit.stats.elementDmgPct ?? 0,
          elemMult: bd.elemMult,
          chargeMult: bd.chargeMult,
          // 武器切换期间距离加成仍按原始武器判定（游戏实测规则）
          // extraDistZones：角色技能扩展的额外优势射程区间（如 Ade 的 Minimum Effective Range）
          distanceAdv: hasDistanceAdvantage(unit.weaponType, state.distanceZone)
                       || (unit.skillState.extraDistZones?.includes(state.distanceZone) ?? false),
          ammoLeft: unit.ammoLeft,
          // 射击时刻的有效最大弹匣 — 包含当前生效的容量加成（如 Liter S1T1、Noir S2）
          maxAmmo: unit.maxAmmo + (sums.maxAmmoFlat ?? 0),
          buffBreakdown: state.buffs
            .filter(b => b.unitId === null || b.unitId === unit.id)
            .map(b => ({ name: b.name, atkFlat: b.atkFlat ?? 0, atkPct: b.atkPct ?? 0, attackDamagePct: (b.attackDamagePct ?? 0) + (b.normalAttackDamagePct ?? 0) }))
            .filter(b => b.atkFlat || b.atkPct || b.attackDamagePct),
        });
      }
      // 满蓄力能量 = (targetBurstEnergyPerShot + burstGaugeFlat) × (fullChargeDamage / 10000)。
      // 模拟器中所有攻击均命中目标，故使用 target_burst_energy_pershot（非掩体/未命中值）。
      // burstGaugeFlat：来自 buff 的 flat 加成（如 Neon: Vision Eye S2 Part4），
      // 与基础充能叠加后整体乘以 FC 倍率（flat 加法，不得改为百分比乘法）。
      // 非蓄力武器 fullChargeDamage=10000，系数为 ×1（无加成）。
      const baseEnergy  = unit.targetBurstEnergyPerShot + (sums.burstGaugeFlat ?? 0);
      const burstEnergy = isCharged && unit.fullChargeDamage > 10000
        ? Math.round(baseEnergy * unit.fullChargeDamage / 10000)
        : baseEnergy;
      addBurstGauge(state, unit.name, isCharged ? 'fc_shot' : 'shot', burstEnergy);
      // 为下一发设置蓄力冷却（SR/RL）：backswing + foreswing + 蓄力时长。
      // chargeSpeedPct 只缩短蓄力（瞄准）阶段，不影响 fore/backswing。
      // 对拥有 immuneSkillChargeSpeed 的单位（如 Liberalio），基于 buff 的 chargeSpeedPct 被屏蔽。
      if (effectiveChargeTimeTicks > 0) {
        if (weaponSwitchChargeTimeTicks > 0) {
          // 武器切换期间：直接使用切换武器的蓄力时长，不应用 fore/backswing
          unit.chargeTick = state.tick + weaponSwitchChargeTimeTicks;
        } else {
          const csFromBuff           = unit.immuneSkillChargeSpeed ? 0 : sums.chargeSpeedPct;
          const flatReduction        = unit.immuneSkillChargeSpeed ? 0 : (sums.chargeTimeReductionTicks ?? 0);
          const afterPct             = Math.round(unit.chargeTimeTicks * (1 - Math.min(0.99, (unit.stats.chargeSpeedPct ?? 0) + csFromBuff)));
          let effectiveCharge         = Math.max(0, afterPct - flatReduction);
          // 固定蓄力时间覆盖（如 Anis: Star 爆裂期间）：忽略技能类蓄力速度 buff，仅保留装备/魔方加成
          if ((unit.skillState?.fixedChargeEndTick ?? 0) >= state.tick &&
              unit.skillState.fixedChargeTimeTicks != null) {
            effectiveCharge = Math.max(0, Math.round(
              unit.skillState.fixedChargeTimeTicks * (1 - Math.min(0.99, unit.stats.chargeSpeedPct ?? 0)),
            ));
          }
          const aliceFastAttackTicks     = Math.round(TICK_RATE * 10 / 40);
          const aliceFastAttackThreshold = Math.round(unit.chargeTimeTicks * (1 - 0.9952));
          if (
            (unit.skillState?.aliceWonderlandEndTick ?? 0) >= state.tick &&
            effectiveCharge <= aliceFastAttackThreshold
          ) {
            // Alice Wonderland 快速攻击：蓄力段（% + flat 减少后）≤ 99.52% 蓄速等价 ticks → 40次/10s（fore/backswing 被规避）
            unit.chargeTick = state.tick + aliceFastAttackTicks;
          } else {
            unit.chargeTick = state.tick + unit.backswingTicks + unit.foreswingTicks + effectiveCharge;
          }
        }
      }
      state.totalAmmoFired++;
      if (sums.lifeStealPct > 0) {
        unit.unitHp = Math.min(unit.stats.hp, unit.unitHp + damage * sums.lifeStealPct);
      }
      events.push({ type: 'hit', tick: state.tick, unitId: unit.id, damage, isCrit });

      // ── 每发射击后的单位技能触发（声明式执行器） ────────────────
      onShotFired(state, unit, { sums, isCharged, isCore, ammoAfterShot: unit.ammoLeft });
      flushHealReceived(state);
      flushShieldReceived(state);
      flushCoverHeal(state);

      // MG ramp：ROF per-shot ramp up（内联保留，非声明式）
      if (unit.mgCurrentRof != null) {
        unit.mgCurrentRof = Math.min(
          unit.mgMaxRof,
          unit.mgCurrentRof + unit.mgRofChangePerShot
        );
      }

      // Bastion Cube Skill 1 (Reload Up HC): every N shots → add M ammo instantly.
      // Placed after onShotFired so last-bullet effects fire first.
      if (unit.bastionTriggerRounds > 0) {
        unit.bastionShotCount++;
        if (unit.bastionShotCount >= unit.bastionTriggerRounds) {
          unit.bastionShotCount = 0;
          const ammoBefore = unit.ammoLeft;
          unit.ammoLeft = Math.min(unit.maxAmmo, unit.ammoLeft + Math.ceil(unit.bastionReloadRounds));
          if (state.ammoLog && unit.ammoLeft !== ammoBefore)
            state.ammoLog.push({ tick: state.tick, unitId: unit.id, unitName: unit.name, delta: unit.ammoLeft - ammoBefore, ammoAfter: unit.ammoLeft, maxAmmo: unit.maxAmmo, source: 'bastion_cube' });
        }
      }

      // ── 弹药里程碑（声明式） ──────────────────────────────────────────
      const cur400 = Math.floor(state.totalAmmoFired / 400);
      const cur500 = Math.floor(state.totalAmmoFired / 500);
      const milestone400 = cur400 > state.lastMilestone400;
      const milestone500 = cur500 > state.lastMilestone500;
      if (milestone400) state.lastMilestone400 = cur400;
      if (milestone500) state.lastMilestone500 = cur500;
      if (milestone400 || milestone500) {
        executeSkillTriggers(state, 'AMMO_MILESTONE', { milestone400, milestone500 });
      }
    } // 内层射击循环结束
  } // 单位循环结束

  return { over: false, events };
}

/**
 * 运行完整模拟直到结束。
 * @param {BattleConfig} config
 * @returns {BattleResult}
 */
export function simulate(config) {
  const state     = initBattle(config);
  const allEvents = [];

  while (true) {
    const { over, events } = tick(state);
    allEvents.push(...events);
    if (over) break;
  }

  return buildResult(state, allEvents);
}

/**
 * 运行 N 次蒙特卡洛模拟，返回平均结果。
 * 日志取自第一次运行。
 * @param {BattleConfig} config
 * @param {number} iterations
 * @returns {BattleResult}
 */
export function simulateMonteCarlo(config, iterations = 100) {
  const results = [];
  for (let i = 0; i < iterations; i++) {
    results.push(simulate(config));
  }
  return averageResults(results);
}

// ─── 结果构造 ──────────────────────────────────────────────────────────

const LOG_EVENT_TYPES = new Set(['burst_i', 'burst_ii', 'full_burst', 'burst_end', 'reload', 'phase_change', 'skill_trigger']);

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
