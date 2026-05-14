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
 * ── 技能覆盖（以下均为 Lv.10） ────────────────────────────────────────────
 *   Little Mermaid  Skill 1: Attack Damage ▲4% at Full Burst; Gauge ▲37% of max every 400 ammo
 *                   Skill 2: Bubble debuff (Damage Taken ▲5.05% passive; Explosive Bubble replaces
 *                             Bubble after 50 LM shots — same 5.05%, not additive);
 *                             4×63.36% ATK every 1s during Full Burst; Barrage 10×85% every 500 ammo
 *                   Burst:   Attack Damage ▲10.13% + reload 33.26% (all, cancel only if full);
 *                            ATK flat +17.28% LM ATK (self)
 *   Liter           Skill 1: On Full Burst entry → Burst CD ▼ (all, cumulative per rotation):
 *                             1st: ▼2.34s; 2nd: +▼2.70s; 3rd+: +▼3.17s (total ▼8.21s from rot 3)
 *                             On each Burst Skill use → (cumulative, "Previous effects trigger repeatedly"):
 *                             1st use: Max Ammo ▲45.17% 5s (not modelled — complex temp ammo)
 *                             2nd use: +Crit Damage ▲12.46% 5s (all)
 *                             3rd+ use: +ATK ▲14.42% 5s (all)
 *                   Skill 2: Recovers Cover HP of 2 allies — not modelled (no incoming damage)
 *                   Burst:   ATK ▲66% for 5s (all)
 *   Mast:RM         Skill 1: On B1 entry → Drunken: Hit Rate ▼20% self, stacks to 3
 *                             While Drunken (≥1 stack): CritRate ▲20.05% + ATK ▲35.02% Mast ATK (all, permanent)
 *                   Skill 2: On B3 entry while Drunken → Distributed Damage ▲15.03%×stacks (modelled as attackDmg) +
 *                             Reload Speed ▲15.04%×stacks (all, 10s);
 *                             At max stacks (3) on Full Burst end → Hangover: self stun 10s + stacks reset
 *                   Burst:   CritDmg ▲40.04% + AttackDmg ▲15.04% (all, 10s);
 *                             If Drunken: ATK ▲20.06%×stacks Mast ATK (all, 10s)
 *   Anchor:IM       Skill 1: On Full Burst entry ("Previous effects trigger repeatedly"):
 *                             Once (rot 1+): Distributed Damage ▲30.96% 5s (all; same-squad condition always met)
 *                             Twice (rot 2+): Distributed Damage ▲30.40% 10s (all)
 *                             Three times (rot 3+): remove 1 Drunken stack from Mast (prevents Hangover)
 *                   Skill 2: After Full Burst ends ("Previous effects trigger repeatedly"):
 *                             Once (rot 1+): Attack Damage ▲10.13% 10s (all)
 *                             Twice (rot 2+): ATK flat ▲35.02% Anchor ATK 10s (all)
 *                             Three times (rot 3+): Reload Speed ▲40.04% 15s (all)
 *                   Burst:   ATK flat ▲30.09% Anchor ATK 10s (all); HP storage/recovery not modelled
 *   Liberalio       Skill 1: On Full Burst → ATK ▲160% for 3s (self)
 *                             On FC shot → Attack Damage ▲20.83% 60s (self), refreshing
 *                             On FC shot → 5 × 40.5% ATK skill damage (isCore=false, no distance advantage)
 *                             On Full Burst → Charge Speed ▲12.74% 10s to lowest-ATK B3 ally
 *                             (Liberalio immune to skill-based CS buffs; in current team build no other B3 → no effect)
 *                   Skill 2: On first FC hit → Raging Current: Attack Damage ▲231% permanently (self)
 *                   Burst:   ATK ▲50% 10s (self) + 925% ATK skill damage hit
 *   Crown           Skill 1: ATK flat +64.51% Crown ATK + Reload Speed ▲44.35% (burst-casters, 15s)
 *                            DEF flat +37.44% Crown DEF + Reload Speed ▲44.35% (non-casters, 15s)
 *                   Skill 2: Relax stack every 43 Crown shots (max 20); on full stack:
 *                            recover 5.23% Crown max HP (all), Attack Damage ▲20.99% for 7s (all)
 *                   Burst:   Attack Damage ▲36.24% for 15s (all);
 *                            Shield 10.45% Crown max HP for 15s (all)
 *   Rapi:RH         Skill 1: ATK ▲95.04% (self, on Full Burst; Stage 3 — LM is B1, no Combat Assist)
 *                   Skill 2: Projectile every 120 shots (60 during burst); passive +150.72% attach /
 *                            +100.6% explode; base hit 88.11% ATK × 2.5072 attach / 2.006 explode
 *                   Burst:   2808% ATK; attach mult → 6.7192 for 10s; threshold → 60 for 10s
 *   Scarlet:BS      Skill 1: 250.47%/500%/750.47% ATK on 3rd/6th/9th charge; 1/2/3 during Full Burst
 *                   Skill 2: Ammo ×1.6 + reload on Full Burst
 *                   Burst:   ATK ▲115.12% + Charge Damage ▲150.12% for 10s (self)
 *   Helm            Skill 1: Crit Rate ▲{SSR lv} for 5s (all) when last bullet fires
 *                            [SSR] Full Charge → recover 0.{SSR lv}% caster max HP + Burst Gauge ▲{lv}% (all)
 *                   Skill 2: [SSR] Attack Damage ▲{SSR lv}% for 10s (all) on Full Burst
 *                            [SSR] Full Charge hit → extra {lv}% ATK to target
 *                   Burst:   [SSR] {lv}% ATK burst damage; lifesteal {lv}% own dmg as HP for 10s (all);
 *                            [SSR] Charge Damage ▲{lv}% (self) for 10 charge rounds
 *                   (All Helm values read from SSR fav item Antique Compass — vary by item/skill level)
 *
 *   Moran           Skill 1: DEF ▲3.51%/1%HP lost (passive, not modelled); every 5 burst-weapon shots → 47.18% ATK hit
 *                   Skill 2: Taunt + HP threshold MaxHP buffs (not modelled)
 *                   Burst:   Weapon change 10s (14.7% ATK/shot) + unlimited ammo 10s + lifesteal 36.14% 10s (self)
 *                            All allies Damage Taken ▼35.14% + DEF ▲14.85% caster DEF 10s (not modelled — defensive)
 *   Nayuta          Skill 1: Indomitability + Memory Incineration weapon change (not modelled)
 *                   Skill 2: Hit Rate self-stack (not modelled)
 *                   Burst:   Attack Damage ▲35.45% 15s (all) + 275.18% + 645.33% ATK burst hits
 *   Cinderella      Skill 1: ATK ▲2.71% Max HP flat (self, 10s) on Full Burst entry
 *                   Skill 2: Decoy avatar (not modelled)
 *                   Burst:   10 × 1365.92% ATK sequential hits
 *   Anis:SS         Skill 1: On Full Burst → Electric allies: ATK ▲55.31% Anis ATK flat + Reload Speed ▲49.28% (10s)
 *                   Skill 2: 382.42% ATK on last bullet (not modelled)
 *                   Burst:   Self: Reload Speed ▲27.72% + Elem Adv ATK Damage ▲42.24% (10s); ammo capacity change skipped
 *   Maiden:IR       Skill 1: MP system on B1 entry (not modelled — no B1 unit)
 *                   Skill 2: Elem Adv ATK Damage to Electric allies on MP gain (not modelled)
 *                   Burst:   1372.8% × (10% Max HP + ATK) to 1 enemy
 *
 * ── 尚未建模 ─────────────────────────────────────────────────────────────
 *   Rapi Skill 2 对 Electric 的属性克制（当前敌人为 Iron）
 *   Helm Skill 2 Interruption Part Damage（部件系统未建模）
 */

import { calcDamage, rollCrit, hasDistanceAdvantage } from './damage.js';
import { computeFinalStats } from './stats.js';
import { WEAPON_AMMO, WEAPON_HIT_MULT } from './constants.js';
import { getFavItemSkillEffects, getSsrFavSkills, getSkillValue } from '../data/models.js';
import { getCharacterTraits } from '../data/skill-traits.js';
import { getBuffSums, pushBuff, addBurstGauge, applyHeal, fireSkillHit, fireDotPool } from './battle-utils.js';
import { executeSkillTriggers, onShotFired, onIntervalInBurst, onInterval, onReloadEnd } from './skill-executor.js';

export const TICK_RATE = 60; // 每秒 tick 数
const MAX_TICKS = TICK_RATE * 180; // 战斗上限 3 分钟

// burst 阶段之间的 tick 数（每段 0.6 秒：B1→B2，B2→B3/FB）
const BURST_STEP_TICKS = Math.round(TICK_RATE * 0.6); // 36

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

// 默认敌人行动阶段表。
// Zone 值：'NEAR' | 'MID' | 'FAR' | 'HIDDEN'
// HIDDEN 期间：无法瞄准敌人 — 普通射击与装填启动暂停。
// 进行中的装填被取消且不恢复弹药；单位闲置直到下一阶段。
// 不需瞄准的技能（如 LM Bubble Wave、Rapi 待定的子弹爆炸）仍然触发。
// TODO: 提供 UI 让用户配置敌人行动阶段。
const DEFAULT_ENEMY_PHASES = [
  { startTick: 0,    zone: 'NEAR' },
  { startTick: 2010, zone: 'HIDDEN' },
  { startTick: 2130, zone: 'NEAR' },
  { startTick: 4320, zone: 'HIDDEN' },
  { startTick: 4440, zone: 'MID' },
  { startTick: 6690, zone: 'HIDDEN' },
  { startTick: 6810, zone: 'NEAR' },
  { startTick: 9000, zone: 'HIDDEN' },
  { startTick: 9120, zone: 'NEAR' },
];

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
 * 进入 Burst 1 阶段时触发的被动效果（槽填满那一 tick 立即触发，不依赖 B1 单位是否 cast）。
 * 触发时机：burstPhase 从 0 变为 1（共享槽填满）。
 */
function applyEnterBurst1Passives(state) {
  executeSkillTriggers(state, 'ENTER_BURST_I');
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
  return b2;
}

/**
 * 所有"进入 Full Burst"时的效果。
 * 被动技能（ENTER_FULL_BURST）和 Step3 burst 技能（BURST_SKILL_USE）均由
 * executeSkillTriggers 分派。
 */
function applyFullBurstSkills(state) {
  // 1. 进入爆裂阶段 3（B3 施放前）— 如 Mast S2 在此阶段触发
  executeSkillTriggers(state, 'ENTER_BURST_III');
  flushHealReceived(state);

  // 2. B3 单位依次施放爆裂技能
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
    executeSkillTriggers(state, 'BURST_SKILL_USE', { unit: step3 });
    flushHealReceived(state);
    if (state.enemyHp <= 0) break;
  }

  // 3. 全爆裂阶段生效（B3 施放完毕后）— 绝大多数技能的 ENTER_FULL_BURST 在此触发
  executeSkillTriggers(state, 'ENTER_FULL_BURST');
  flushHealReceived(state);

  // 4. Flush FIRE_IN_FULL_BURST hits enqueued during BURST_SKILL_USE / ENTER_FULL_BURST handlers.
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
 * 初始化全新的战斗状态。
 * @param {BattleConfig} config
 * @returns {BattleState}
 */
export function initBattle(config) {
  const squad = config.squad.map(cfg => {
    const stats   = cfg._computedStats ?? computeFinalStats(cfg, cfg.level ?? 200, {});
    // CHARACTER_TRAITS.weaponType overrides CDN-derived cfg.weaponType when the CDN data is known to be wrong.
    const wt      = getCharacterTraits(cfg.characterId)?.weaponType ?? cfg.weaponType ?? 'AR';
    // Collection skill ammo bonus (MG items: Max Ammo ▲X%) applied at unit creation.
    // Other collection skill effects are applied as permanent buffs after state is built.
    const collFx  = (cfg._favItemData && (cfg.favoriteItem?.level ?? 0) > 0)
      ? getFavItemSkillEffects(cfg._favItemData, cfg.favoriteItem.level) : null;
    // Base ammo: prefer CDN-derived value from config (baseAmmo), fall back to weapon type table.
    const baseAmmo = cfg.baseAmmo ?? WEAPON_AMMO[wt] ?? 30;
    // Fav item ammo pct: applied as Math.round(base × pct), matching in-game rounding.
    // bonusAmmo (from OL equipment stats) is pre-computed using the grouped-ROUND rule:
    //   duplicate pct values are grouped → Math.round(base × pct × count) per group.
    const favAmmoBonus = collFx?.ammoPct ? Math.round(baseAmmo * collFx.ammoPct) : 0;
    const maxAmmo = baseAmmo + (stats.bonusAmmo ?? 0) + favAmmoBonus;
    // FORESWING/BACKSWING for SR/RL weapons: time before and after each charge shot.
    // Default 10 ticks each; per-unit overrides via cfg.foreswingTicks / cfg.backswingTicks.
    // Note: maintain_fire_stance==0 in CDN also uses defaults; explicit overrides win.
    const isChargWeapon = ['SR', 'RL'].includes(wt);
    const foreswingTicks = isChargWeapon ? (cfg.foreswingTicks ?? 10) : 0;
    const backswingTicks = isChargWeapon ? (cfg.backswingTicks ?? 10) : 0;
    const chargeTimeTicks = cfg.chargeTimeTicks ?? 0;
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
      // Per-unit reload duration (ticks). Prefer CDN-derived value from config.
      reloadTicks:      cfg.reloadTicks ?? (RELOAD_TICKS_DEFAULT[wt] ?? 120),
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
      targetBurstEnergyPerShot: cfg.targetBurstEnergyPerShot
                                ?? cfg._nikkeData?.shot_detail?.target_burst_energy_pershot
                                ?? cfg.burstEnergyPerShot ?? 500,
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
      burstSkillCooltime:       cfg.burstSkillCooltime ?? TICK_RATE * 40,
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
      skillState: {
        // Liter Skill 1 Part 1 (FB entry CD reduction) and Part 2 (per-burst-use buffs)
        literFbCount:               0,     // how many Full Bursts have been entered (Liter S1 Part 1)
        literBurstUseCount:         0,     // cumulative count of burst skills used (Liter S1 Part 2)
        // Mast: Romantic Maid Skill 1 Drunken stacks and Hangover
        // mastDrunkenStacks removed — use state.buffs.find(b => b.name === 'mast_drunken')?.stackCount
        mastHangoverEndTick:        0,     // tick at which Hangover stun expires (0 = not stunned)
        // LM Skill 2
        lmShotCount:                0,     // shots fired since battle start (for Explosive Bubble)
        lmExplosiveBubble:          false, // whether 2nd Bubble tier has been applied
        lmLastBubbleShotTick:      -999,  // last tick LM fired periodic burst shots
        // Rapi Skill 2
        rapiShotCount:              0,     // shots since last projectile load
        rapiPendingProjectileCount: 0,     // projectiles waiting to explode on Full Burst
        rapiProjectileThreshold:    120,   // shots per projectile cycle (60 during Full Burst)
        // attach mult = 1 + S2 param[4]/100（passive Projectile Attachment Damage ▲）
        rapiProjectileAttachMult:    1 + getSkillValue(cfg._nikkeData?.skill2_detail, 4, cfg.skillLevels?.[1] ?? 10) / 100,
        // explode mult = 1 + S2 param[5]/100（passive Projectile Explosion Damage ▲）
        rapiProjectileExplosionMult: 1 + getSkillValue(cfg._nikkeData?.skill2_detail, 5, cfg.skillLevels?.[1] ?? 10) / 100,
        rapiProjectileBuffEndTick:  0,     // tick when burst projectile buffs expire (0 = not active)
        // SBS Skill 1
        sbsChargeCount:             0,     // current position in charge cycle (1–9 or 1–3)
        sbsBurstChargeModeEndTick:  0,     // tick until SBS own-burst charge mode expires (0 = not active)
        // MG ramp: mgCurrentRof starts at mgStartRof, climbs by mgRofChangePerShot per shot,
        // capped at mgMaxRof. Decays toward mgStartRof when not firing (rate_of_fire_reset_time).
        // All null for non-MG units or MGs without a ramp (rateOfFireChange == 0).
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
        // Crown Skill 2 (Guardian / Relax stacks)
        crownShotCount:             0,   // shots mod 43 (resets after each stack gained)
        crownRelaxStacks:           0,   // current stack count (0–19; triggers on reaching 20)
        // Anchor: Innocent Maid — S1/S2 progressive buff counter (incremented on each FB entry)
        anchorFbCount:              0,
        // Nayuta — S2 Memory Absorption stack counter (0–30)
        nayutaMemAbsStacks:         0,
        // Cinderella — S2 Beautiful stacks (0–12) + decoy active flag
        cinderellaBeautyStacks:     0,
        cinderellaDecoyActive:      false,
        // Liter S1 T1: Max Ammo ▲45.17% for 5s — window and extra round count
        literAmmoBoostEndTick:      0,
        literAmmoBoostExtra:        0,
        // Noir S2: flat MaxAmmo bonus (+3/+4/+5 rounds) for 10s on entering Full Burst
        noirAmmoBoostExtra:         0,
        noirAmmoBoostEndTick:       0,
        // Maiden: Ice Rose — S1/S2/Burst MP 系统（0–12，Burst 全数消耗）
        iceroseMP:                  0,
        // Liberalio — S2 Raging Current: applied permanently on first FC shot
        libRagingCurrentActive:     false,
        // Bastion Cube Skill 1 (Reload Up HC): every N shots → add M ammo to current mag.
        // trigger=0 means cube is not equipped or cube has no Reload Up skill.
        bastionShotCount:           0,
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
        // Red Hood (470) — AllStep SR DPS
        rhCsStacks: 0,         // S1 蓄力速度叠层数（0–10）
      },
      // SSR fav item upgraded skill definitions (null for R/SR items)
      // cfg.ssrFavSkillLevel overrides the item-derived skill level (e.g. 10 for fully levelled SSR skills)
      ssrFavSkills: (cfg._favItemData && (cfg.favoriteItem?.level ?? 0) > 0)
        ? getSsrFavSkills(cfg._favItemData, cfg.favoriteItem.level, cfg.ssrFavSkillLevel)
        : null,
      // 技能等级（skill1/skill2/burst），默认均为 Lv.10
      skillLevels:  cfg.skillLevels ?? [10, 10, 10],
      // 原始 CDN 技能详情，用于按实际技能等级动态读取数值
      rawSkill1:    cfg._nikkeData?.skill1_detail    ?? null,
      rawSkill2:    cfg._nikkeData?.skill2_detail    ?? null,
      rawBurst:     cfg._nikkeData?.ulti_skill_detail ?? null,
    };
  });

  // Enemy phase schedule: array of { startTick, zone } sorted ascending.
  // If config.enemy.phases is provided it overrides the default schedule.
  const enemyPhases = config.enemy.phases ?? DEFAULT_ENEMY_PHASES;
  const initialZone = getPhaseAtTick(enemyPhases, 0);

  const state = {
    squad,
    enemyHp:            config.enemy.maxHp,
    enemyMaxHp:         config.enemy.maxHp,
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
    fullBurstActive:    false,
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
    // Deferred skill hits: [{ fireTick, caster, mult, sums, isCharged, label, opts }]
    // Processed at the start of each tick before unit loops.
    pendingSkillHits: [],
    // Queue of units that received heals this tick. Populated by applyHeal (battle-utils).
    // Consumed by flushHealReceived() which dispatches HEAL_RECEIVED triggers.
    pendingHealReceived: [],
    // Scheduled periodic heals: [{ fireTick, targetId, amount }]
    // Processed each tick before unit loops; each entry calls applyHeal + flushHealReceived.
    pendingHoTs: [],
    // Zero-delay FIRE_IN_FULL_BURST hits that must execute after ENTER_FULL_BURST effects have applied.
    // [{ caster, mult, sums, isCharged, label, opts }]
    pendingFireInBurstHits: [],
    // 持续伤害（DoT）池：见 battle-utils.js fireDotPool 注释中的字段说明。
    dots: [],
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
  if (state.enemyHp <= 0) return { over: true, events: [] };
  if (state.tick >= MAX_TICKS) return { over: true, events: [] };

  const events = [];
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
      // 仅改容量的弹药 buff：到期时将当前弹药截到基础 maxAmmo（支持全员 buff unitId=null）
      if (b.maxAmmoPct > 0) {
        const targets = b.unitId != null
          ? [state.squad.find(u => u.id === b.unitId)].filter(Boolean)
          : state.squad;
        for (const u of targets) {
          // 清除技能状态中的 literBoost，使截弹逻辑生效
          u.skillState.literAmmoBoostExtra   = 0;
          u.skillState.literAmmoBoostEndTick = 0;
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
    if (state.enemyHp <= 0) {
      events.push({ type: 'kill', tick: state.tick });
      return { over: true, events };
    }
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
      const sums = getBuffSums(state, h.caster.id);
      fireSkillHit(state, h.caster, h.mult, sums, h.isCharged, h.label, h.opts ?? {});
      if (state.enemyHp <= 0) {
        events.push({ type: 'kill', tick: state.tick });
        return { over: true, events };
      }
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
      state.burstPhaseTick = state.tick + BURST_STEP_TICKS;
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
      state.burstPhaseTick = state.tick + BURST_STEP_TICKS;
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
    if (state.enemyHp <= 0) {
      events.push({ type: 'kill', tick: state.tick });
      return { over: true, events };
    }
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
      state.burstPhaseTick = state.tick + BURST_STEP_TICKS;
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
    if (state.enemyHp <= 0) {
      events.push({ type: 'kill', tick: state.tick });
      return { over: true, events };
    }
  }

  // ── 每个单位进行攻击 ─────────────────────────────────────────────────────
  // HIDDEN 阶段：装填仍然处理（自愿 HIDDEN 装填可以完成），
  // 但射击跳过。保护判断位于装填块之后的循环内部。

  for (const unit of state.squad) {
    // Mast Hangover 眩晕：眩晕期间跳过所有处理
    if (unit.skillState.mastHangoverEndTick > 0 && state.tick < unit.skillState.mastHangoverEndTick) continue;
    // 武器切换结束后 backswing 封锁（如 Snow White burst 击发后 90 ticks）
    if ((unit.skillState.weaponSwitchPostBackswingEndTick ?? 0) > 0
        && state.tick < unit.skillState.weaponSwitchPostBackswingEndTick) continue;

    // 装填处理（HIDDEN 期间也会运行，让进行中的装填能够完成）
    if (unit.ammoLeft <= 0) {
      if (unit.reloadTick === 0) {
        const rSums = getBuffSums(state, unit.id);
        // fixedReloadSpeedPct：固定装填速度加成，屏蔽其他装填速度效果（如 Asuka: WILLE S2）
        const effectiveReloadSpeed = unit.skillState?.fixedReloadSpeedPct ?? rSums.reloadSpeedPct;
        const dur   = Math.round(unit.reloadTicks / (1 + effectiveReloadSpeed));
        unit.reloadTick      = state.tick + dur;
        unit.reloadStartTick = state.tick;
      }
      if (state.tick < unit.reloadTick) continue;
      const ammoMult       = (state.tick < unit.tempMaxAmmoEndTick) ? unit.tempMaxAmmoMult : 1;
      // Liter S1 T1：临时弹药加成（全员）— 在 5 秒窗口内，装填后弹药 = maxAmmo + boostExtra。
      const literBoost = (unit.skillState.literAmmoBoostExtra > 0
        && state.tick < unit.skillState.literAmmoBoostEndTick)
        ? unit.skillState.literAmmoBoostExtra : 0;
      // Noir S2：进入全爆裂时扩充弹匣 flat 发数（+3/+4/+5），持续 10s。
      const noirBoost = (unit.skillState.noirAmmoBoostExtra > 0
        && state.tick < unit.skillState.noirAmmoBoostEndTick)
        ? unit.skillState.noirAmmoBoostExtra : 0;
      const flatBoost = literBoost + noirBoost;
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
      const baseRof = unit.skillState.mgCurrentRof ?? unit.rateOfFire;
      // Attack speed ▲（如 Dorothy: Serendipity burst）：通过 skillState.tempAtkSpeedPct 传入
      const atkSpeedMult = (unit.skillState.tempAtkSpeedEndTick ?? 0) > state.tick
        ? (1 + (unit.skillState.tempAtkSpeedPct ?? 0)) : 1;
      const rof = baseRof * atkSpeedMult;
      const spt = rof / 60 / TICK_RATE; // RPM → 每 tick 发数
      unit.shotAccumulator += spt;
      shotsThisTick         = Math.floor(unit.shotAccumulator);
      unit.shotAccumulator -= shotsThisTick;
    } else {
      shotsThisTick = Math.random() < (ATTACK_SPEED[unit.weaponType] ?? 0.20) ? 1 : 0;
    }
    // MG ramp decay: when not firing this tick, ROF decays toward start ROF.
    if (shotsThisTick === 0) {
      if (unit.skillState.mgCurrentRof != null && unit.skillState.mgRofDecayPerTick > 0) {
        unit.skillState.mgCurrentRof = Math.max(
          unit.skillState.mgStartRof,
          unit.skillState.mgCurrentRof - unit.skillState.mgRofDecayPerTick
        );
      }
      continue;
    }

    for (let _s = 0; _s < shotsThisTick; _s++) {
      if (unit.ammoLeft <= 0) break; // 本 tick 中途弹尽；下一 tick 开始装填

      // 计算 buff 汇总（round-based buff 由 getBuffSums 自动根据 roundsLeft 过滤）
      const sums = getBuffSums(state, unit.id);
      const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRateBonus);
      const isCrit    = rollCrit(effectiveCritRate);
      // 武器切换（WEAPON_SWITCH 效果）：期间覆盖 hitMult 和 isCharged
      const effectiveWeaponType = weaponSwitchActive
        ? (unit.skillState.weaponSwitchType ?? unit.weaponType)
        : unit.weaponType;
      const hitMult = weaponSwitchActive
        ? (unit.skillState.weaponSwitchHitMult ?? WEAPON_HIT_MULT[effectiveWeaponType] ?? 0.03)
        : (unit.shotDamageMult ?? WEAPON_HIT_MULT[unit.weaponType] ?? 0.03);
      const isCharged = ['SR', 'RL'].includes(effectiveWeaponType);
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
                               ? { pierceDamageMult: sums.pierceDamagePct } : {}) },
        damageTakenMult:   state.enemyDamageTakenPct,
      });

      const ammoBeforeShot = unit.ammoLeft;
      // 武器替换期间无限弹药：弹药不消耗（如 Moran burst）
      const isUnlimitedAmmoShot = weaponSwitchActive && unit.skillState.weaponSwitchUnlimitedAmmo;
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
          distanceAdv: hasDistanceAdvantage(unit.weaponType, state.distanceZone),
          ammoLeft: unit.ammoLeft,
          // 射击时刻的有效最大弹匣 — 包含当前生效的容量加成（如 Liter S1T1）
          maxAmmo: unit.maxAmmo + (
            (unit.skillState?.literAmmoBoostExtra ?? 0) > 0 && state.tick < (unit.skillState?.literAmmoBoostEndTick ?? 0)
              ? (unit.skillState.literAmmoBoostExtra ?? 0) : 0
          ),
          buffBreakdown: state.buffs
            .filter(b => b.unitId === null || b.unitId === unit.id)
            .map(b => ({ name: b.name, atkFlat: b.atkFlat ?? 0, atkPct: b.atkPct ?? 0, attackDamagePct: (b.attackDamagePct ?? 0) + (b.normalAttackDamagePct ?? 0) }))
            .filter(b => b.atkFlat || b.atkPct || b.attackDamagePct),
        });
      }
      // 满蓄力能量 = (burstEnergyPerShot + burstGaugeFlat) × (fullChargeDamage / 10000)。
      // burstGaugeFlat：来自 buff 的 flat 加成（如 Neon: Vision Eye S2 Part4），
      // 与基础充能叠加后整体乘以 FC 倍率（flat 加法，不得改为百分比乘法）。
      // 非蓄力武器 fullChargeDamage=10000，系数为 ×1（无加成）。
      const baseEnergy  = unit.burstEnergyPerShot + (sums.burstGaugeFlat ?? 0);
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
      state.enemyHp    -= damage;
      if (sums.lifeStealPct > 0) {
        unit.unitHp = Math.min(unit.stats.hp, unit.unitHp + damage * sums.lifeStealPct);
      }
      events.push({ type: 'hit', tick: state.tick, unitId: unit.id, damage, isCrit });

      if (state.enemyHp <= 0) {
        events.push({ type: 'kill', tick: state.tick });
        return { over: true, events };
      }

      // ── 每发射击后的单位技能触发（声明式执行器） ────────────────
      onShotFired(state, unit, { sums, isCharged, isCore, ammoAfterShot: unit.ammoLeft });
      flushHealReceived(state);
      if (state.enemyHp <= 0) {
        events.push({ type: 'kill', tick: state.tick });
        return { over: true, events };
      }

      // MG ramp：ROF per-shot ramp up（内联保留，非声明式）
      if (unit.skillState.mgCurrentRof != null) {
        unit.skillState.mgCurrentRof = Math.min(
          unit.skillState.mgMaxRof,
          unit.skillState.mgCurrentRof + unit.skillState.mgRofChangePerShot
        );
      }

      // Bastion Cube Skill 1 (Reload Up HC): every N shots → add M ammo instantly.
      // Placed after onShotFired so last-bullet effects fire first.
      if (unit.skillState.bastionTriggerRounds > 0) {
        unit.skillState.bastionShotCount++;
        if (unit.skillState.bastionShotCount >= unit.skillState.bastionTriggerRounds) {
          unit.skillState.bastionShotCount = 0;
          const ammoBefore = unit.ammoLeft;
          unit.ammoLeft = Math.min(unit.maxAmmo, unit.ammoLeft + Math.ceil(unit.skillState.bastionReloadRounds));
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
        if (state.enemyHp <= 0) {
          events.push({ type: 'kill', tick: state.tick });
          return { over: true, events };
        }
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

const LOG_EVENT_TYPES = new Set(['burst_i', 'burst_ii', 'full_burst', 'burst_end', 'reload', 'phase_change']);

function buildResult(state, events) {
  const timeSeconds = state.tick / TICK_RATE;
  const victory     = state.enemyHp <= 0;
  const totalDamage = state.squad.reduce((s, u) => s + u.totalDamage, 0);
  const burstCount  = events.filter(e => e.type === 'full_burst').length;
  const log         = events.filter(e => LOG_EVENT_TYPES.has(e.type));

  return {
    victory,
    timeSeconds,
    totalDamage,
    dps:         timeSeconds > 0 ? totalDamage / timeSeconds : 0,
    enemyMaxHp:  state.enemyMaxHp,
    enemyHpLeft: Math.max(0, state.enemyHp),
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
    victory:     results.filter(r => r.victory).length / n > 0.5,
    winRate:     results.filter(r => r.victory).length / n,
    timeSeconds: avg(results.map(r => r.timeSeconds)),
    totalDamage: avg(results.map(r => r.totalDamage)),
    dps:         avg(results.map(r => r.dps)),
    enemyMaxHp:  results[0]?.enemyMaxHp,
    enemyHpLeft: avg(results.map(r => r.enemyHpLeft)),
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
