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
 *                   Skill 2: Taunt + debuffs on last-bullet (not modelled)
 *                   Burst:   Weapon change 10s — shots deal 14.7% ATK (replaces normal AR shots)
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
import { getFavItemSkillEffects, getSsrFavSkills } from '../data/models.js';

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

// 爆裂槽能量系统 — 每个单位有独立的槽（0..BURST_GAUGE_MAX）。
// 每发的单位能量来自 CDN shot_detail.target_burst_energy_pershot（原值，不缩放）。
// 满蓄力能量 = burstEnergyPerShot × (fullChargeDamage / 10000)。
// 所有槽都达到上限后，burst_i 才能触发。
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

// ─── Buff 汇总辅助 ──────────────────────────────────────────────────────

/**
 * 汇总作用于指定单位的所有生效 buff（unitId=null 的 buff 对全员生效）。
 * @param {object} state
 * @param {number} unitId
 * @returns {{ atkPct, atkFlat, defFlat, attackDamagePct, normalAttackDamagePct, critRateBonus, critDmgBonus, chargeDamagePct, chargeSpeedPct, reloadSpeedPct, lifeStealPct }}
 */
function getBuffSums(state, unitId) {
  // atkPct 初始值为单位的装备 ATK% 永久倍率
  const unit = state.squad.find(u => u.id === unitId);
  let atkPct = unit?.equipAtkPct ?? 0;
  let atkFlat = 0, defFlat = 0, attackDamagePct = 0, normalAttackDamagePct = 0,
      critRateBonus = 0, critDmgBonus = 0, chargeDamagePct = 0, chargeSpeedPct = 0,
      reloadSpeedPct = 0, lifeStealPct = 0, distributedDamagePct = 0,
      chargeTimeReductionTicks = 0, hitRateBonus = 0, elementAdvantageBonus = 0;
  for (const b of state.buffs) {
    if (b.unitId !== null && b.unitId !== unitId) continue;
    atkPct                   += b.atkPct                   ?? 0;
    atkFlat                  += b.atkFlat                  ?? 0;
    defFlat                  += b.defFlat                  ?? 0;
    attackDamagePct          += b.attackDamagePct          ?? 0;
    normalAttackDamagePct    += b.normalAttackDamagePct    ?? 0;
    critRateBonus            += b.critRateBonus            ?? 0;
    critDmgBonus             += b.critDmgBonus             ?? 0;
    chargeDamagePct          += b.chargeDamagePct          ?? 0;
    chargeSpeedPct           += b.chargeSpeedPct           ?? 0;
    reloadSpeedPct           += b.reloadSpeedPct           ?? 0;
    lifeStealPct             += b.lifeStealPct             ?? 0;
    distributedDamagePct     += b.distributedDamagePct     ?? 0;
    chargeTimeReductionTicks += b.chargeTimeReductionTicks ?? 0;
    hitRateBonus             += b.hitRateBonus             ?? 0;
    elementAdvantageBonus    += b.elementAdvantageBonus    ?? 0;
  }
  return { atkPct, atkFlat, defFlat, attackDamagePct, normalAttackDamagePct, critRateBonus, critDmgBonus, chargeDamagePct, chargeSpeedPct, reloadSpeedPct, lifeStealPct, distributedDamagePct, chargeTimeReductionTicks, hitRateBonus, elementAdvantageBonus };
}

// ─── Buff 添加辅助 ─────────────────────────────────────────────────────────

/**
 * 添加 buff；若已存在相同 (name, unitId) 的 buff，则刷新它。
 * 刷新规则：endTick → max(已有，新值)。效果字段保持不变（不可叠加）。
 * @param {object} state
 * @param {object} buff  — 必须包含 { name, unitId, endTick } 及一个或多个效果字段
 */
function addBurstGauge(state, unitName, source, energy) {
  if (state.burstPhase !== 0) return;
  state.burstGauge = Math.min(BURST_GAUGE_MAX, state.burstGauge + energy);
  if (state.burstEnergyLog) {
    state.burstEnergyLog.push({ tick: state.tick, unitName, source, energyAdded: energy, gaugeAfter: state.burstGauge });
  }
}

function pushBuff(state, buff) {
  const existing = state.buffs.find(b => b.name === buff.name && b.unitId === buff.unitId);
  if (existing) {
    existing.endTick = Math.max(existing.endTick, buff.endTick);
    // 不可叠加：数值字段保持不变；只刷新持续时间。不记录日志。
    return;
  }
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
    });
  }
}

// ─── 技能伤害辅助 ──────────────────────────────────────────────────────

/**
 * 让单位执行一次技能命中。会应用 buff、属性克制、Full Burst 加成等。
 * 会减少 state.enemyHp 并累加 unit.totalDamage。
 * 返回造成的伤害（敌人已阵亡返回 0）。
 * @param {object} state
 * @param {object} unit
 * @param {number} hitMult   — 技能倍率（例如 2.5047 表示 250.47% ATK）
 * @param {object} sums      — 来自 getBuffSums 的汇总
 * @param {boolean} [isCharged]  — 覆盖默认值；SR/RL 默认为 true
 * @param {string}  [label]      — 用于 skillDamage 跟踪与 hitLog 的命中标签
 * @param {object}  [opts]       — 单次调用的覆盖项：
 *   opts.isCore            {boolean} — 此次命中是否可能命中核心（默认 false）
 *   opts.coreDmgIncrement  {number}  — 在 BASE_CORE_DAMAGE 之外追加的核心伤害加成（默认 0）
 *   opts.extraAttackDamagePct {number} — 针对这次命中的额外 ExtraMultiplier 加成
 *                              （例如 projectile attachment/explosion 类型加成 — 与 buff xDmg% 叠加）
 */
function fireSkillHit(state, unit, hitMult, sums, isCharged, label, opts = {}) {
  if (state.enemyHp <= 0) return 0;
  const charged          = isCharged !== undefined ? isCharged : ['SR', 'RL'].includes(unit.weaponType);
  const isCrit           = rollCrit(Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRateBonus));
  const isCore           = opts.isCore           ?? false;
  const coreDmgIncrement = opts.coreDmgIncrement ?? 0;
  const extraAtkDmgPct   = opts.extraAttackDamagePct ?? 0;
  const isDistributed    = opts.isDistributed    ?? false;
  const distributedBonus = isDistributed ? (sums.distributedDamagePct ?? 0) : 0;
  const extraAtkFlat     = opts.extraAtkFlat ?? 0;
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
    isFullBurst:       state.fullBurstActive,
    attackerElement:   unit.element,
    defenderElement:   state.enemyElement,
    elementAdvantageDmgIncrement: (unit.stats.elementDmgPct ?? 0) + (sums.elementAdvantageBonus ?? 0),
    isCharged:         charged,
    fullChargeDamage:  unit.fullChargeDamage ?? 10000,
    chargeDmgStat:     1 + (unit.stats.chargeDmgPct ?? 0) + sums.chargeDamagePct,
    extra:             { attackDamageMult: sums.attackDamagePct + extraAtkDmgPct },
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
      // attackDamagePct 同时包含 buff 的 xDmg% 与本次命中独有的 extraAttackDamagePct
      attackDamagePct: sums.attackDamagePct + extraAtkDmgPct,
      extraAttackDamagePct: extraAtkDmgPct,
      isFullBurst: state.fullBurstActive,
      // damageTakenPct = 敌人基础值 + distributed 加成（isDistributed 时）
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

// ─── 技能事件处理器 ─────────────────────────────────────────────────────

/**
 * 寻找在指定 step 上可以释放 burst 技能的最高优先级（最左侧）单位。
 * 若其 burst 技能冷却已结束则返回该单位，否则返回 null。
 */
function selectBurstUnit(state, burstStep) {
  return state.squad.find(u => u.burstStep === burstStep && u.canBurst !== false && u.burstSkillCooldownEndTick <= state.tick) ?? null;
}

/**
 * Liter Skill 1 Part 2 helper — fires once per Full Burst entry.
 * "Previous effects trigger repeatedly" — each effect applies from its Full Burst rotation onward:
 *   Rot 1 (≥1 FB):  Max Ammo ▲45.17% 5s — modelled separately in applyFullBurstSkills
 *   Rot 2 (≥2 FBs): Crit Damage ▲12.46% 5s (all)
 *   Rot 3 (≥3 FBs): ATK ▲14.42% 5s (all)
 * Called once per Full Burst from applyFullBurstSkills.
 */
function applyLiterS1PartTwo(state, liter) {
  const cnt = ++liter.skillState.lmS1BurstUseCount;
  const end5 = state.tick + TICK_RATE * 5;
  if (cnt >= 2) pushBuff(state, { name: 'liter_s1_critDmg', unitId: null, critDmgBonus: 0.1246, endTick: end5 });
  if (cnt >= 3) pushBuff(state, { name: 'liter_s1_atkPct',  unitId: null, atkPct:       0.1442, endTick: end5 });
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

  if (b1.name === 'Little Mermaid') {
    // LM Burst (Siren's Song)
    // All allies: Attack Damage ▲ 10.13% for 10s
    pushBuff(state, { name: 'lm_burst_attackDmg', unitId: null, attackDamagePct: 0.1013, endTick: state.tick + TICK_RATE * 10 });
    // All allies: reload 33.26% of maxAmmo (cancel pending reload only if mag is now full)
    for (const u of state.squad) {
      const ammoBefore = u.ammoLeft;
      u.ammoLeft = Math.min(u.maxAmmo, u.ammoLeft + Math.floor(u.maxAmmo * 0.3326));
      if (u.ammoLeft >= u.maxAmmo && u.reloadTick > 0) u.reloadTick = 0;
      if (state.ammoLog && u.ammoLeft !== ammoBefore)
        state.ammoLog.push({ tick: state.tick, unitId: u.id, unitName: u.name, delta: u.ammoLeft - ammoBefore, ammoAfter: u.ammoLeft, maxAmmo: u.maxAmmo, source: 'lm_burst_reload' });
    }
    // LM self: ATK flat ▲ 17.28% of LM's ATK for 10s
    pushBuff(state, { name: 'lm_burst_atkFlat', unitId: b1.id, atkFlat: Math.round(b1.stats.atk * 0.1728), endTick: state.tick + TICK_RATE * 10 });

  } else if (b1.name === 'Liter') {
    // Liter Burst (Double Boost): ATK ▲66% for 5s (all)
    pushBuff(state, { name: 'liter_burst_atkPct', unitId: null, atkPct: 0.66, endTick: state.tick + TICK_RATE * 5 });
  }

  // Mast S1 (A Pirate's Heart): on B1 entry → gain 1 Drunken stack (max 3)
  // On first stack: apply S1 passives (CritRate▲20.05% + ATK flat ▲35.02% Mast ATK, all, permanent while Drunken)
  const mast = state.squad.find(u => u.name === 'Mast: Romantic Maid');
  if (mast && mast.skillState.mastDrunkenStacks < 3) {
    mast.skillState.mastDrunkenStacks++;
    if (mast.skillState.mastDrunkenStacks === 1) {
      // Push with effectively-infinite duration; explicitly removed when Hangover clears stacks
      pushBuff(state, { name: 'mast_s1_critRate', unitId: null, critRateBonus: 0.2005, endTick: state.tick + TICK_RATE * 99999 });
      pushBuff(state, { name: 'mast_s1_atkFlat',  unitId: null, atkFlat: Math.round(mast.stats.atk * 0.3502), endTick: state.tick + TICK_RATE * 99999 });
    }
  }

  return b1;
}

/** Step2 burst：若冷却结束则释放。返回释放的单位，或 null。 */
function applyBurstIISkills(state) {
  const b2 = selectBurstUnit(state, 'Step2');
  if (!b2) return null;

  b2.burstSkillCooldownEndTick = state.tick + b2.burstSkillCooltime;

  if (b2.name === 'Moran') {
    // Moran Burst (Fair and Square!): weapon change for 10s — shots deal 14.7% ATK.
    // S1 "Bring It On!": every 5 shots during weapon change → 47.18% ATK additional damage.
    // Both are tracked via skillState; the actual shots fire inside tick() while weapon is active.
    b2.skillState.moranBurstEndTick  = state.tick + TICK_RATE * 10;
    b2.skillState.moranBurstS1Count  = 0;

  } else if (b2.name === 'Crown') {
    // Crown Burst (Last Kingdom): Attack Damage ▲ 36.24% for 15s (all allies)
    pushBuff(state, { name: 'crown_burst_attackDmg', unitId: null, attackDamagePct: 0.3624, endTick: state.tick + TICK_RATE * 15 });
    // Crown Burst: Shield 10.45% Crown max HP for 15s (all allies)
    // Shield absorbs incoming damage before unit HP. Refreshes to max(old, new) on re-cast.
    const shieldAmt = Math.round(b2.stats.hp * 0.1045);
    const shieldEnd = state.tick + TICK_RATE * 15;
    for (const u of state.squad) {
      if (u.shieldHp > 0) {
        u.shieldHp      = Math.max(u.shieldHp, shieldAmt);
        u.shieldEndTick = Math.max(u.shieldEndTick, shieldEnd);
      } else {
        u.shieldHp      = shieldAmt;
        u.shieldEndTick = shieldEnd;
      }
    }
  } else if (b2.name === 'Anchor: Innocent Maid') {
    // Anchor Burst (Seaside Stroll): ATK flat ▲30.09% Anchor ATK (all, 10s)
    // HP storage / recovery effects are not modelled (no incoming damage simulation).
    pushBuff(state, { name: 'anchor_burst_atkFlat', unitId: null, atkFlat: Math.round(b2.stats.atk * 0.3009), endTick: state.tick + TICK_RATE * 10 });

  } else if (b2.name === 'Mast: Romantic Maid') {
    // Mast Burst (A Pirate's Romance):
    // CritDmg ▲40.04% + AttackDmg ▲15.04% for 10s (all, unconditional)
    const end10 = state.tick + TICK_RATE * 10;
    pushBuff(state, { name: 'mast_burst_critDmg',    unitId: null, critDmgBonus:    0.4004, endTick: end10 });
    pushBuff(state, { name: 'mast_burst_attackDmg',  unitId: null, attackDamagePct: 0.1504, endTick: end10 });
    // Conditional: if Drunken stacks > 0 → ATK ▲20.06%×stacks of Mast's ATK (all, 10s)
    if (b2.skillState.mastDrunkenStacks > 0) {
      const atkFlat = Math.round(b2.stats.atk * 0.2006 * b2.skillState.mastDrunkenStacks);
      pushBuff(state, { name: 'mast_burst_atkFlat', unitId: null, atkFlat, endTick: end10 });
    }
  }

  return b2;
}

/**
 * 所有"进入 Full Burst"时的效果。
 *
 * 被动技能（每次 Full Burst 必触发，不检查冷却）：
 *   LM Skill 1、Crown Skill 1、Rapi Skill 1、Helm Skill 2、SBS Skill 2。
 *
 * Burst 技能（受冷却限制，按队伍顺序优先）：
 *   Step3 槽位 — 取 [Rapi、SBS、Helm] 中首个冷却已结束者。
 */
function applyFullBurstSkills(state) {
  const lm          = state.squad.find(u => u.name === 'Little Mermaid');
  const liter       = state.squad.find(u => u.name === 'Liter');
  const mast        = state.squad.find(u => u.name === 'Mast: Romantic Maid');
  const anchor      = state.squad.find(u => u.name === 'Anchor: Innocent Maid');
  const crown       = state.squad.find(u => u.name === 'Crown');
  const rapi        = state.squad.find(u => u.name === 'Rapi: Red Hood');
  const sbs         = state.squad.find(u => u.name === 'Scarlet: Black Shadow');
  const helm        = state.squad.find(u => u.name === 'Helm');
  const lib         = state.squad.find(u => u.name === 'Liberalio');
  const nayuta      = state.squad.find(u => u.name === 'Nayuta');
  const cinderella  = state.squad.find(u => u.name === 'Cinderella');
  const anisss      = state.squad.find(u => u.name === 'Anis: Sparkling Summer');
  const maidenir    = state.squad.find(u => u.name === 'Maiden: Ice Rose');

  // ── "进入 Full Burst"的被动触发（总是触发） ────────────────────────────

  // Liter Skill 1 Part 1 (Liter Boost): on Full Burst entry → Burst Skill CD ▼ (all, cumulative)
  // "Previous effects trigger repeatedly":
  //   1st FB: ▼2.34s; 2nd: +▼2.70s; 3rd+: +▼3.17s → total ▼8.21s/rotation from rotation 3
  if (liter) {
    liter.skillState.lmS1FbCount++;
    const cnt = liter.skillState.lmS1FbCount;
    let reductionSec = 0;
    if (cnt >= 1) reductionSec += 2.34;
    if (cnt >= 2) reductionSec += 2.70;
    if (cnt >= 3) reductionSec += 3.17;
    const reductionTicks = Math.round(TICK_RATE * reductionSec);
    for (const u of state.squad) {
      u.burstSkillCooldownEndTick = Math.max(state.tick, u.burstSkillCooldownEndTick - reductionTicks);
    }
    if (state.buffLog && reductionTicks > 0)
      state.buffLog.push({ type: 'cd_reduction', tick: state.tick, name: 'liter_s1_cdReduction', unitId: null, reductionTicks });
    // S1 T1: Max Ammunition Capacity ▲45.17% for 5s — capacity only, current ammo unchanged.
    // On each FB the boost window refreshes; the next reload during the window fills to maxAmmo+boostExtra.
    const literBoostExtra = Math.floor(liter.baseAmmo * 0.4517);
    const literBoostEndTick = state.tick + TICK_RATE * 5;
    liter.skillState.literAmmoBoostEndTick = literBoostEndTick;
    liter.skillState.literAmmoBoostExtra   = literBoostExtra;
    // Push as a real buff so it appears in buffLog with auto-expire at endTick
    pushBuff(state, { name: 'liter_s1_t1_maxAmmo', unitId: liter.id, maxAmmoPct: 0.4517, endTick: literBoostEndTick });
    if (state.ammoLog)
      state.ammoLog.push({ tick: state.tick, unitId: liter.id, unitName: liter.name,
        delta: 0, ammoAfter: liter.ammoLeft, maxAmmo: liter.maxAmmo + literBoostExtra,
        maxAmmoDelta: literBoostExtra, source: 'liter_s1_t1_maxAmmo(+45.17%)' });
  }

  // Liter S1 Part 2: fires once per Full Burst entry
  if (liter) applyLiterS1PartTwo(state, liter);

  // LM Skill 1 (Bubble Order): Attack Damage ▲ 4% for 10s (all)
  if (lm) {
    pushBuff(state, { name: 'lm_skill1_attackDmg', unitId: null, attackDamagePct: 0.04, endTick: state.tick + TICK_RATE * 10 });
    // Set timer back one period so the first wave fires immediately on this tick
    lm.skillState.lmLastBubbleShotTick = state.tick - TICK_RATE;
  }

  // Crown Skill 1 (One for All): split by burst-caster status (15s)
  //   Burst-casters (fired their burst skill this rotation):
  //     ATK flat ▲ 64.51% Crown ATK + Reload Speed ▲ 44.35%
  //   Non-casters:
  //     DEF flat ▲ 37.44% Crown DEF + Reload Speed ▲ 44.35%
  if (crown) {
    const step3Candidate = selectBurstUnit(state, 'Step3');
    const burstCasterIds = new Set(
      [lm?.id, crown.id, step3Candidate?.id].filter(x => x != null)
    );
    const endTick = state.tick + TICK_RATE * 15;
    for (const u of state.squad) {
      if (burstCasterIds.has(u.id)) {
        pushBuff(state, { name: 'crown_skill1_atkFlat',    unitId: u.id, atkFlat:       Math.round(crown.stats.atk * 0.6451), endTick });
      } else {
        pushBuff(state, { name: 'crown_skill1_defFlat',    unitId: u.id, defFlat:       Math.round(crown.stats.def * 0.3744), endTick });
      }
      pushBuff(state,   { name: 'crown_skill1_reloadSpd',  unitId: u.id, reloadSpeedPct: 0.4435, endTick });
    }
  }

  // Rapi Skill 1 Stage 3: ATK ▲ 95.04% (self, 10s) — always triggers on Full Burst
  if (rapi) {
    pushBuff(state, { name: 'rapi_skill1_atkPct', unitId: rapi.id, atkPct: 0.9504, endTick: state.tick + TICK_RATE * 10 });
  }

  // Helm Skill 2 (Fire Away): Attack Damage for 10s (all)
  // SSR fav item upgrades this value (placeholder 2 = attackDmgPct; lv10 base = 11.85%)
  if (helm) {
    const helmS2     = helm.ssrFavSkills?.skill2;
    const s2Lv       = helmS2?._activeSkillLevel ?? 0;
    const s2AtkVals  = helmS2?.description_value_list?.[1]?.description_value ?? [];
    const attackDmgPct = s2Lv > 0 ? parseFloat(s2AtkVals[s2Lv - 1] ?? '11.85') / 100 : 0.1185;
    pushBuff(state, { name: 'helm_skill2_attackDmg', unitId: null, attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 10 });
  }

  // Mast S2 (A Pirate's Spirit): on B3 entry while Drunken →
  //   Distributed Damage ▲15.03%×stacks + Reload Speed ▲15.04%×stacks (all, 10s)
  //   "Distributed Damage" sits in the same slot as enemy Damage Taken — only applies to
  //   Distributed Damage hit types (e.g. SBS S1 6th/9th shots, ti≥1).
  if (mast && mast.skillState.mastDrunkenStacks > 0) {
    const stacks = mast.skillState.mastDrunkenStacks;
    const end10  = state.tick + TICK_RATE * 10;
    pushBuff(state, { name: 'mast_s2_distributedDmg', unitId: null, distributedDamagePct: 0.1503 * stacks, endTick: end10 });
    pushBuff(state, { name: 'mast_s2_reloadSpd',      unitId: null, reloadSpeedPct:  0.1504 * stacks, endTick: end10 });
  }

  // SBS Skill 2 (Fleetly Fading: Asura): Max Ammo ▲60% for 10s + reload 100%
  // Note: ×1.6 applies to BASE ammo only; OL bonus is added flat.
  // Skill 1 burst charge mode is NOT triggered here — only when SBS fires her own burst skill.
  if (sbs) {
    const sbsAmmoBefore    = sbs.ammoLeft;
    sbs.tempMaxAmmoMult    = 1.6;
    sbs.tempMaxAmmoEndTick = state.tick + TICK_RATE * 10;
    const sbsExpandedMax   = Math.ceil(sbs.baseAmmo * 1.6) + (sbs.stats.bonusAmmo ?? 0) + sbs.favAmmoBonus;
    sbs.ammoLeft           = sbsExpandedMax; // immediate full reload at expanded cap
    sbs.reloadTick         = 0; // cancel any pending reload
    if (state.ammoLog)
      state.ammoLog.push({ tick: state.tick, unitId: sbs.id, unitName: sbs.name, delta: sbs.ammoLeft - sbsAmmoBefore, ammoAfter: sbs.ammoLeft, maxAmmo: sbsExpandedMax, source: 'sbs_burst_maxAmmo(+60%)' });
  }

  // Anchor Skill 1 (Starfish Omurice): progressive buffs on Full Burst entry.
  // "Previous effects trigger repeatedly" — each effect activates from its rotation onward.
  //   Once  (rot 1+): Distributed Damage ▲30.96% for 5s (all) [same-squad ally; Mast=Aegis=Anchor always met]
  //   Twice (rot 2+): Distributed Damage ▲30.40% for 10s (all)
  //   Three times (rot 3+): remove 1 Drunken stack from Mast (prevents Hangover; stacks reset to 0 removes S1 passives)
  if (anchor) {
    anchor.skillState.anchorFbCount++;
    const cnt = anchor.skillState.anchorFbCount;
    // TODO (low priority): S1 T1 'Potency of HP ▲30.96% for 5s (all)' — HP recovery potency, not a damage buff.
    // Model when healing/recovery systems are added.
    // T2: "Distributed Damage ▲30.40% for 10s" — same slot as enemy Damage Taken (like Mast S2)
    if (cnt >= 2) pushBuff(state, { name: 'anchor_s1_t2_distributedDmg', unitId: null, distributedDamagePct: 0.3040, endTick: state.tick + TICK_RATE * 10 });
    if (cnt >= 3 && mast && mast.skillState.mastDrunkenStacks > 0) {
      mast.skillState.mastDrunkenStacks--;
      if (mast.skillState.mastDrunkenStacks === 0) {
        // No longer Drunken — remove S1 passive buffs; they reapply on next B1 stack gain
        state.buffs = state.buffs.filter(b => b.name !== 'mast_s1_critRate' && b.name !== 'mast_s1_atkFlat');
      }
    }
  }

  // Liberalio Skill 1 T1 (Calm Depths): On Full Burst → ATK ▲160% for 3s (self)
  // T4: Charge Speed ▲12.74% for 10s to the B3 ally with the lowest ATK.
  //     Implemented as a flat tick reduction = 12.74% × CASTER (Lib) base chargeTimeTicks.
  //     (Liberalio is immune to skill-based Charge Speed buffs)
  if (lib) {
    pushBuff(state, { name: 'lib_s1_t1_atkPct', unitId: lib.id, atkPct: 1.60, endTick: state.tick + TICK_RATE * 3 });
    // T4: find lowest-ATK B3 unit; skip Liberalio herself (immune) and non-B3 units
    const b3Units = state.squad.filter(u => u.burstStep === 'Step3' && !u.immuneSkillChargeSpeed);
    if (b3Units.length > 0) {
      const target = b3Units.reduce((a, b) => a.stats.atk < b.stats.atk ? a : b);
      // Flat reduction: 12.74% × CASTER (Liberalio) base charge time in ticks
      const flatReductionTicks = Math.round(lib.chargeTimeTicks * 0.1274);
      pushBuff(state, { name: 'lib_s1_t4_chargeSpd', unitId: target.id, chargeTimeReductionTicks: flatReductionTicks, endTick: state.tick + TICK_RATE * 10 });
    }
  }

  // ── Cinderella Skill 1（Beautiful）：进入 Burst Stage 3 / Full Burst 时触发 ─────
  // ATK ▲ 2.71% of caster's final Max HP (flat bonus) for 10s (self).
  if (cinderella) {
    const hpBasedAtk = Math.round(cinderella.stats.hp * 0.0271);
    pushBuff(state, { name: 'cinderella_s1_atkFlat', unitId: cinderella.id, atkFlat: hpBasedAtk, endTick: state.tick + TICK_RATE * 10 });
  }

  // ── Anis:SS Skill 1（Summer Wave）：进入 Full Burst 时对 Electric Code 友军触发 ─
  // ATK ▲ 55.31% of Anis ATK (flat) + Reload Speed ▲ 49.28% for 10s.
  if (anisss) {
    const atkBonus = Math.round(anisss.stats.atk * 0.5531);
    const end10    = state.tick + TICK_RATE * 10;
    for (const u of state.squad) {
      if (u.element !== 'Electric') continue;
      pushBuff(state, { name: 'anisss_s1_atkFlat',   unitId: u.id, atkFlat:        atkBonus, endTick: end10 });
      pushBuff(state, { name: 'anisss_s1_reloadSpd', unitId: u.id, reloadSpeedPct: 0.4928,   endTick: end10 });
    }
  }

  // ── Step3 / StepFull burst 技能（受冷却限制，所有符合条件的单位按队伍顺序触发） ─
  const burstFireOrder = state.squad.filter(u =>
    (u.burstStep === 'Step3' || u.burstStep === 'StepFull') &&
    u.canBurst !== false &&
    u.burstSkillCooldownEndTick <= state.tick
  );

  let firstFired = null;
  for (const step3 of burstFireOrder) {
    step3.burstSkillCooldownEndTick = state.tick + step3.burstSkillCooltime;
    if (!firstFired) firstFired = step3;

    if (step3 === rapi) {
      // Rapi Burst Stage 3: 2808% ATK damage
      const sums = getBuffSums(state, rapi.id); // includes the just-applied atkPct buff
      fireSkillHit(state, rapi, 28.08, sums, false, 'burst');
      // Enhanced Skill 2 projectile during Full Burst
      rapi.skillState.rapiProjectileThreshold    = 60;
      rapi.skillState.rapiProjectileAttachMult   = 6.7192; // passive 1.5072 + burst 4.212 + base 1
      // explosion mult unchanged by burst (passive 2.006 remains)
    } else if (step3 === sbs) {
      // SBS Burst: ATK ▲ 115.12% + Charge Damage ▲ 150.12% (self, 10s)
      pushBuff(state, { name: 'sbs_burst_atkPct',    unitId: sbs.id, atkPct:          1.1512, endTick: state.tick + TICK_RATE * 10 });
      pushBuff(state, { name: 'sbs_burst_chargeDmg', unitId: sbs.id, chargeDamagePct: 1.5012, endTick: state.tick + TICK_RATE * 10 });
      // Skill 1 burst charge mode: 1/2/3 cycle active for 10s after SBS fires her OWN burst
      sbs.skillState.sbsBurstChargeModeEndTick = state.tick + TICK_RATE * 10;
      sbs.skillState.sbsChargeCount            = 0;
    } else if (step3 === lib) {
      // Liberalio Burst (Submerged World): Attack Damage ▲50% for 10s (self) + 925% ATK direct hit
      // "Attack Damage" = attackDamagePct (ExtraMultiplier slot), NOT atkPct
      pushBuff(state, { name: 'lib_burst_attackDmg', unitId: lib.id, attackDamagePct: 0.50, endTick: state.tick + TICK_RATE * 10 });
      const sums = getBuffSums(state, lib.id);
      fireSkillHit(state, lib, 9.25, sums, false, 'burst');
    } else if (step3 === helm) {
      // Helm Burst (Aegis Cannon): SSR burst damage + lifesteal + self charge damage buff
      // placeholder 1 = burst damage %; placeholder 2 = lifesteal %; placeholder 4 = charge dmg %
      const helmBurst  = helm.ssrFavSkills?.burst;
      const bLv        = helmBurst?._activeSkillLevel ?? 0;
      const bDmgVals   = helmBurst?.description_value_list?.[0]?.description_value ?? [];
      const lsVals     = helmBurst?.description_value_list?.[1]?.description_value ?? [];
      const cdVals     = helmBurst?.description_value_list?.[3]?.description_value ?? [];
      const burstMult  = bLv > 0 ? parseFloat(bDmgVals[bLv - 1] ?? '1237.5') / 100 : 12.375;
      const lsPct      = bLv > 0 ? parseFloat(lsVals[bLv - 1]   ?? '54.45')  / 100 : 0.5445;
      const cdPct      = bLv > 0 ? parseFloat(cdVals[bLv - 1]   ?? '0')      / 100 : 0;
      const sums = getBuffSums(state, helm.id);
      fireSkillHit(state, helm, burstMult, sums, false);
      // All allies recover lifesteal% of their own attack damage as HP for 10s
      pushBuff(state, { name: 'helm_burst_heal', unitId: null, lifeStealPct: lsPct, endTick: state.tick + TICK_RATE * 10 });
      // Self: Charge Damage Multiplier ▲cdPct for 10 charge rounds (count-based)
      if (cdPct > 0) {
        helm.skillState.helmChargeShots   = 10;
        helm.skillState.helmChargeDmgBuff = cdPct;
      }

    } else if (step3 === nayuta) {
      // Nayuta Burst (Asceticism): Attack Damage ▲35.45% (all, 15s) + two burst hits
      // Note: buff applied first so Nayuta's own hits benefit from it.
      pushBuff(state, { name: 'nayuta_burst_attackDmg', unitId: null, attackDamagePct: 0.3545, endTick: state.tick + TICK_RATE * 15 });
      const sums = getBuffSums(state, nayuta.id);
      fireSkillHit(state, nayuta, 2.7518, sums, false, 'burst_hit1');
      if (state.enemyHp > 0) fireSkillHit(state, nayuta, 6.4533, sums, false, 'burst_hit2');

    } else if (step3 === cinderella) {
      // Cinderella Burst (Glass Slippers. Full Contact.): 10 × 1365.92% ATK sequential hits.
      const sums = getBuffSums(state, cinderella.id);
      for (let h = 0; h < 10 && state.enemyHp > 0; h++) {
        fireSkillHit(state, cinderella, 13.6592, sums, false, 'burst_seq');
      }

    } else if (step3 === anisss) {
      // Anis:SS Burst (Sparkling Wave): self buffs for 10s + ammo capacity change (skipped).
      // Reload Speed ▲27.72% (self, 10s)
      // Elemental Advantage Attack Damage ▲42.24% (self, 10s)
      const end10 = state.tick + TICK_RATE * 10;
      pushBuff(state, { name: 'anisss_burst_reloadSpd',  unitId: anisss.id, reloadSpeedPct:       0.2772, endTick: end10 });
      pushBuff(state, { name: 'anisss_burst_elemAdvDmg', unitId: anisss.id, elementAdvantageBonus: 0.4224, endTick: end10 });

    } else if (step3 === maidenir) {
      // Maiden: Ice Rose Burst (Diamond Dust): 1372.8% × (10% Max HP + ATK) to 1 enemy.
      const hpComponent = Math.round(maidenir.stats.hp * 0.10);
      const sums = getBuffSums(state, maidenir.id);
      fireSkillHit(state, maidenir, 13.728, sums, false, 'burst', { extraAtkFlat: hpComponent });
    }

    if (state.enemyHp <= 0) break;
  }

  // ── Rapi Skill 2：待定的 projectile 在进入 Full Burst 时爆炸 ──────────
  // S2_attach 在 projectile 放置时已触发；此处只触发 S2_explode。
  //（无论 Rapi 的 burst 技能是否已使用都触发）
  if (rapi && rapi.skillState.rapiPendingProjectile) {
    const sums = getBuffSums(state, rapi.id);
    const em = rapi.skillState.rapiProjectileExplosionMult;
    fireSkillHit(state, rapi, 0.8811, sums, false, 'S2_explode', {
      isCore:               false,
      extraAttackDamagePct: em - 1,
    });
    rapi.skillState.rapiPendingProjectile = false;
  }

  return firstFired; // null if no Step3/StepFull unit had their CD ready
}

/** 爆裂结束后的冷却效果与清理。 */
function applyBurstEndSkills(state) {
  // LM Skill 1 (Bubble Order): on Full Burst END → all allies Burst Skill Cooldown ▼ 7.48s
  if (state.squad.some(u => u.name === 'Little Mermaid')) {
    const reduction = Math.round(TICK_RATE * 7.48);
    for (const u of state.squad) {
      u.burstSkillCooldownEndTick = Math.max(state.tick, u.burstSkillCooldownEndTick - reduction);
    }
    if (state.buffLog)
      state.buffLog.push({ type: 'cd_reduction', tick: state.tick, name: 'lm_s1_cdReduction', unitId: null, reductionTicks: reduction });
  }

  // Rapi: reset burst projectile state to non-burst defaults (passive bonuses remain)
  const rapi = state.squad.find(u => u.name === 'Rapi: Red Hood');
  if (rapi) {
    rapi.skillState.rapiProjectileThreshold  = 120;
    rapi.skillState.rapiProjectileAttachMult = 2.5072; // passive +150.72% only
    // explosion mult never changes (burst doesn't touch it)
  }

  // SBS: burst charge mode uses sbsBurstChargeModeEndTick; no explicit reset needed here.

  // Anchor Skill 2 (Sea Anemone Pasta): progressive buffs after Full Burst ends.
  // "Previous effects trigger repeatedly" — each effect applies from its rotation onward.
  //   Once  (rot 1+): Attack Damage ▲10.13% for 10s (all)
  //   Twice (rot 2+): ATK flat ▲35.02% Anchor ATK for 10s (all)
  //   Three times (rot 3+): Reload Speed ▲40.04% for 15s (all)
  // Uses anchorFbCount which was incremented on FB entry this rotation.
  const anchor = state.squad.find(u => u.name === 'Anchor: Innocent Maid');
  if (anchor) {
    const cnt = anchor.skillState.anchorFbCount;
    const end10 = state.tick + TICK_RATE * 10;
    const end15 = state.tick + TICK_RATE * 15;
    if (cnt >= 1) pushBuff(state, { name: 'anchor_s2_t1_hitRate', unitId: null, hitRateBonus: 0.1013, endTick: end10 });
    if (cnt >= 2) pushBuff(state, { name: 'anchor_s2_t2_atkFlat',   unitId: null, atkFlat: Math.round(anchor.stats.atk * 0.3502), endTick: end10 });
    if (cnt >= 3) pushBuff(state, { name: 'anchor_s2_t3_reloadSpd', unitId: null, reloadSpeedPct: 0.4004, endTick: end15 });
  }

  // Mast S2 Hangover: at max 3 Drunken stacks on Full Burst end → self stun 10s + stacks reset
  const mast = state.squad.find(u => u.name === 'Mast: Romantic Maid');
  if (mast && mast.skillState.mastDrunkenStacks >= 3) {
    mast.skillState.mastHangoverEndTick = state.tick + TICK_RATE * 10;
    mast.skillState.mastDrunkenStacks   = 0;
    // Remove S1 passive buffs — Drunken cleared; they reapply when stacks regain on next B1
    state.buffs = state.buffs.filter(b => b.name !== 'mast_s1_critRate' && b.name !== 'mast_s1_atkFlat');
  }
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
    const wt      = cfg.weaponType ?? 'AR';
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
      equipAtkPct:              stats.equipAtkPct ?? 0,
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
      // Uses target_burst_energy_pershot (raw CDN value).
      // Full-charge energy = burstEnergyPerShot × (fullChargeDamage / 10000).
      burstEnergyPerShot:       cfg.burstEnergyPerShot ?? 500,
      // Fav item "Normal Attack Damage Multiplier ▲" (SMG/SG items) — independent multiplier on baseDamage.
      favNormalAttackDamageMult: 1 + (collFx?.attackDmgPct ?? 0),
      // Fav item "Charge Damage Multiplier ▲" (SR/RL items) — multiplies shot_detail.damage specifically.
      favChargeDmgPct:          collFx?.chargeDmgPct ?? 0,
      // Fraction of normal shots that hit the enemy core (0=none, 1=all).
      // MG/SR/RL default to 1 (always hit core). SMG defaults to 0.033. SG/AR require calibration.
      coreHitRateMult:          cfg.coreHitRateMult ?? (wt === 'SMG' ? 0.033 : 1),
      // false → unit fills gauge and participates in squad burst trigger, but never fires burst skill.
      // Useful for B3 units that are in the squad but excluded from the active rotation.
      canBurst:                 cfg.canBurst ?? true,
      // true → skill-based Charge Speed buffs (chargeSpeedPct on buff objects) do not apply to this unit.
      // Equipment chargeSpeedPct from stats always applies regardless.
      // Used for Liberalio whose S1 grants immunity to skill-based CS effects.
      immuneSkillChargeSpeed:   cfg.immuneSkillChargeSpeed ?? false,
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
        lmS1FbCount:                0,     // how many Full Bursts have been entered (Liter)
        lmS1BurstUseCount:          0,     // cumulative count of burst skills used with Liter in squad
        // Mast: Romantic Maid Skill 1 Drunken stacks and Hangover
        mastDrunkenStacks:          0,     // 0–3; S1 passive active while ≥1; S2 scales with stacks
        mastHangoverEndTick:        0,     // tick at which Hangover stun expires (0 = not stunned)
        // LM Skill 2
        lmShotCount:                0,     // shots fired since battle start (for Explosive Bubble)
        lmExplosiveBubble:          false, // whether 2nd Bubble tier has been applied
        lmLastBubbleShotTick:      -999,  // last tick LM fired periodic burst shots
        // Rapi Skill 2
        rapiShotCount:              0,     // shots since last projectile load
        rapiPendingProjectile:      false, // projectile waiting to explode on Full Burst
        rapiProjectileThreshold:    120,   // shots per projectile cycle (60 during Full Burst)
        rapiProjectileAttachMult:   2.5072, // passive +150.72% baked in; 6.7192 during Full Burst
        rapiProjectileExplosionMult:2.006, // passive +100.6% baked in; unchanged by burst
        // SBS Skill 1
        sbsChargeCount:             0,     // current position in charge cycle (1–9 or 1–3)
        sbsBurstChargeModeEndTick:  0,     // tick until SBS own-burst charge mode expires (0 = not active)
        // MG ramp model: currentRof starts at rate_of_fire, climbs by rateOfFireChange per shot.
        // Null for non-MG units and MGs without a ramp (rateOfFireChange == 0).
        // MG ramp model: currentRof starts at startRof, climbs by rofChangePerShot per shot.
        // Null for non-MG units and MGs without a ramp (rateOfFireChange == 0).
        crownCurrentRof:       cfg._nikkeData?.shot_detail?.rate_of_fire_change_pershot > 0
                                 ? (cfg._nikkeData.shot_detail.rate_of_fire ?? 60) : null,
        crownMaxRof:           cfg._nikkeData?.shot_detail?.rate_of_fire_change_pershot > 0
                                 ? (cfg._nikkeData.shot_detail.end_rate_of_fire ?? 4200) : null,
        crownRofChangePerShot: cfg._nikkeData?.shot_detail?.rate_of_fire_change_pershot > 0
                                 ? cfg._nikkeData.shot_detail.rate_of_fire_change_pershot : null,
        mgStartRof:            cfg._nikkeData?.shot_detail?.rate_of_fire ?? null,
        // Crown Skill 2 (Guardian / Relax stacks)
        crownShotCount:             0,   // shots mod 43 (resets after each stack gained)
        crownRelaxStacks:           0,   // current stack count (0–19; triggers on reaching 20)
        // Helm SSR fav charge-shot count for Skill 2 extra damage and Burst charge buff
        helmChargeShots:            0,   // shots remaining in Burst charge buff (max 10 rounds)
        helmChargeDmgBuff:          0,   // current charge damage bonus from Burst (0 when no charges left)
        // Anchor: Innocent Maid — S1/S2 progressive buff counter (incremented on each FB entry)
        anchorFbCount:              0,
        // Liter S1 T1: Max Ammo ▲45.17% for 5s — window and extra round count
        literAmmoBoostEndTick:      0,
        literAmmoBoostExtra:        0,
        // Moran burst weapon change (Fair and Square!)
        moranBurstEndTick:          0,   // tick when burst weapon expires (0 = not active)
        moranBurstS1Count:          0,   // shots since last S1 burst-weapon hit (resets every 5)
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
      },
      // SSR fav item upgraded skill definitions (null for R/SR items)
      // cfg.ssrFavSkillLevel overrides the item-derived skill level (e.g. 10 for fully levelled SSR skills)
      ssrFavSkills: (cfg._favItemData && (cfg.favoriteItem?.level ?? 0) > 0)
        ? getSsrFavSkills(cfg._favItemData, cfg.favoriteItem.level, cfg.ssrFavSkillLevel)
        : null,
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
  };

  // LM Skill 2 (Bubble Wave): passive Bubble applied at battle start
  // Enemy Damage Taken ▲ 5.05% continuously.
  // Only one of [Bubble, Explosive Bubble] can exist on the enemy at a time.
  // Explosive Bubble (after 50 LM shots) replaces Bubble — same value, tracked by lmExplosiveBubble flag.
  if (state.squad.some(u => u.name === 'Little Mermaid')) {
    state.enemyDamageTakenPct += 0.0505;
  }

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
      // 仅改容量的弹药 buff：到期时将当前弹药截到基础 maxAmmo
      if (b.maxAmmoPct > 0) {
        const u = b.unitId != null ? state.squad.find(u => u.id === b.unitId) : null;
        if (u && u.ammoLeft > u.maxAmmo) {
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
  state.buffs = state.buffs.filter(b => b.endTick > state.tick);

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
    const fired = applyBurstISkills(state);
    if (fired) {
      state.burstPhaseTick = state.tick + BURST_STEP_TICKS;
      events.push({ type: 'burst_i', tick: state.tick, unitName: fired.name });
    }
  }

  // ── LM Skill 2（Bubble Wave）：Full Burst 期间每 1 秒打出 4 次 ×63.36% ATK ─
  // HIDDEN 期间也会触发 — Bubble Wave 不需瞄准。
  if (state.fullBurstActive) {
    const lm = state.squad.find(u => u.name === 'Little Mermaid');
    if (lm && state.tick - lm.skillState.lmLastBubbleShotTick >= TICK_RATE) {
      lm.skillState.lmLastBubbleShotTick += TICK_RATE;
      const sums = getBuffSums(state, lm.id);
      for (let h = 0; h < 4 && state.enemyHp > 0; h++) {
        fireSkillHit(state, lm, 0.6336, sums, false, 'S2_bubble_wave');
      }
      if (state.enemyHp <= 0) {
        events.push({ type: 'kill', tick: state.tick });
        return { over: true, events };
      }
    }
  }

  // ── 每个单位进行攻击 ─────────────────────────────────────────────────────
  // HIDDEN 阶段：装填仍然处理（自愿 HIDDEN 装填可以完成），
  // 但射击跳过。保护判断位于装填块之后的循环内部。

  for (const unit of state.squad) {
    // Mast Hangover 眩晕：眩晕期间跳过所有处理
    if (unit.skillState.mastHangoverEndTick > 0 && state.tick < unit.skillState.mastHangoverEndTick) continue;

    // 装填处理（HIDDEN 期间也会运行，让进行中的装填能够完成）
    if (unit.ammoLeft <= 0) {
      if (unit.reloadTick === 0) {
        const rSums = getBuffSums(state, unit.id);
        const dur   = Math.round(unit.reloadTicks / (1 + rSums.reloadSpeedPct));
        unit.reloadTick      = state.tick + dur;
        unit.reloadStartTick = state.tick;
      }
      if (state.tick < unit.reloadTick) continue;
      const ammoMult       = (state.tick < unit.tempMaxAmmoEndTick) ? unit.tempMaxAmmoMult : 1;
      // Liter S1 T1：临时弹药加成 — 在 5 秒窗口内，装填后弹药 = maxAmmo + boostExtra。
      const literBoost = (unit.name === 'Liter'
        && unit.skillState.literAmmoBoostExtra > 0
        && state.tick < unit.skillState.literAmmoBoostEndTick)
        ? unit.skillState.literAmmoBoostExtra : 0;
      // 某些技能（如 SBS S2）只缩放基础弹匣；OL 加成按固定值叠加。
      unit.ammoLeft = literBoost > 0
        ? unit.maxAmmo + literBoost
        : (ammoMult > 1
          ? Math.ceil(unit.baseAmmo * ammoMult) + (unit.stats.bonusAmmo ?? 0) + unit.favAmmoBonus
          : unit.maxAmmo);
      unit.reloadCount++;
      unit.reloadTick      = 0;
      events.push({ type: 'reload', tick: state.tick, unitId: unit.id, unitName: unit.name, ammoRefilled: unit.ammoLeft, maxAmmo: unit.maxAmmo });
      unit.shotAccumulator = 0; // 装填后射击周期重新开始
      if (unit.skillState.crownCurrentRof != null)
        unit.skillState.crownCurrentRof = unit.skillState.mgStartRof ?? 60;
    }

    // HIDDEN 阶段跳过射击（上方装填仍然允许）。
    if (state.currentPhaseZone === 'HIDDEN') continue;

    // 决定本 tick 的射击数。
    // SR/RL（蓄力武器）：确定性 — chargeTick 到达时恰好打出 1 发。
    // 带有 CDN rateOfFire 的单位：累加器模型（发数/分钟 ÷ 3600 = 发数/tick）。
    //   MG Crown 的起速通过 crownCurrentRof 覆盖 rateOfFire。
    // 回退：使用 ATTACK_SPEED 表的 0/1 概率门。
    let shotsThisTick;
    if (unit.chargeTimeTicks > 0) {
      // 蓄力武器：蓄力完成时打出 1 发，然后重置计时器。
      shotsThisTick = state.tick >= unit.chargeTick ? 1 : 0;
    } else if (unit.rateOfFire > 0) {
      const rof = unit.skillState.crownCurrentRof ?? unit.rateOfFire;
      const spt = rof / 60 / TICK_RATE; // RPM → 每 tick 发数
      unit.shotAccumulator += spt;
      shotsThisTick         = Math.floor(unit.shotAccumulator);
      unit.shotAccumulator -= shotsThisTick;
    } else {
      shotsThisTick = Math.random() < (ATTACK_SPEED[unit.weaponType] ?? 0.20) ? 1 : 0;
    }
    if (shotsThisTick === 0) continue;

    for (let _s = 0; _s < shotsThisTick; _s++) {
      if (unit.ammoLeft <= 0) break; // 本 tick 中途弹尽；下一 tick 开始装填

      // 计算 buff 汇总
      const sums = getBuffSums(state, unit.id);
      // Helm Burst：基于计数的 Charge Damage 加成（10 发蓄力额度，每发消耗 1）
      if (unit.name === 'Helm' && unit.skillState.helmChargeShots > 0) {
        sums.chargeDamagePct += unit.skillState.helmChargeDmgBuff;
      }
      const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRateBonus);
      const isCrit    = rollCrit(effectiveCritRate);
      // Moran burst 武器替换：期间将 shotDamageMult 覆盖为 0.147。
      const moranBurstActive = unit.name === 'Moran'
        && (unit.skillState?.moranBurstEndTick ?? 0) > 0
        && state.tick <= unit.skillState.moranBurstEndTick;
      const hitMult = moranBurstActive
        ? 0.147
        : (unit.shotDamageMult ?? WEAPON_HIT_MULT[unit.weaponType] ?? 0.03);
      const isCharged = ['SR', 'RL'].includes(unit.weaponType);
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
        weaponType:        unit.weaponType,
        isCrit,
        critDmgIncrement:  (unit.stats.critDmg ?? 0.50) - 0.50 + sums.critDmgBonus,
        isCore,
        coreDmgIncrement:  unit.coreDmgIncrement ?? 0,
        distanceZone:      state.distanceZone,
        isFullBurst:       state.fullBurstActive,
        attackerElement:   unit.element,
        defenderElement:   state.enemyElement,
        elementAdvantageDmgIncrement: (unit.stats.elementDmgPct ?? 0) + (sums.elementAdvantageBonus ?? 0),
        isCharged,
        fullChargeDamage:  unit.fullChargeDamage ?? 10000,
        favChargeDmgPct:   unit.favChargeDmgPct ?? 0,
        chargeDmgStat:     1 + (unit.stats.chargeDmgPct ?? 0) + sums.chargeDamagePct,
        favNormalAttackDamageMult: unit.favNormalAttackDamageMult ?? 1,
        extra:             { attackDamageMult: sums.attackDamagePct + sums.normalAttackDamagePct },
        damageTakenMult:   state.enemyDamageTakenPct,
      });

      const ammoBeforeShot = unit.ammoLeft;
      unit.ammoLeft--;
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
      // 满蓄力能量 = burstEnergyPerShot × (fullChargeDamage / 10000)。
      // 非蓄力武器 fullChargeDamage=10000，因此系数为 ×1（无加成）。
      const burstEnergy = isCharged && unit.fullChargeDamage > 10000
        ? Math.round(unit.burstEnergyPerShot * unit.fullChargeDamage / 10000)
        : unit.burstEnergyPerShot;
      addBurstGauge(state, unit.name, isCharged ? 'fc_shot' : 'shot', burstEnergy);
      // 为下一发设置蓄力冷却（SR/RL）：backswing + foreswing + 蓄力时长。
      // chargeSpeedPct 只缩短蓄力（瞄准）阶段，不影响 fore/backswing。
      // 对拥有 immuneSkillChargeSpeed 的单位（如 Liberalio），基于 buff 的 chargeSpeedPct 被屏蔽。
      if (unit.chargeTimeTicks > 0) {
        const csFromBuff    = unit.immuneSkillChargeSpeed ? 0 : sums.chargeSpeedPct;
        const flatReduction = unit.immuneSkillChargeSpeed ? 0 : (sums.chargeTimeReductionTicks ?? 0);
        const afterPct      = Math.round(unit.chargeTimeTicks * (1 - Math.min(0.99, (unit.stats.chargeSpeedPct ?? 0) + csFromBuff)));
        const effectiveCharge = Math.max(0, afterPct - flatReduction);
        unit.chargeTick = state.tick + unit.backswingTicks + unit.foreswingTicks + effectiveCharge;
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

      // ── 每发射击后的单位技能触发 ─────────────────────────────

      // Bastion Cube Skill 1 (Reload Up HC): every N shots → add M ammo instantly to current mag.
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

      // Helm Skill 1 (Frontline Command): last bullet → Crit Rate for 5s (all)
      // SSR fav upgrades crit rate value (placeholder 1; lv10 base = 14.64%)
      if (unit.ammoLeft === 0 && unit.name === 'Helm') {
        const helmS1    = unit.ssrFavSkills?.skill1;
        const s1Lv      = helmS1?._activeSkillLevel ?? 0;
        const crVals    = helmS1?.description_value_list?.[0]?.description_value ?? [];
        const critBonus = s1Lv > 0 ? parseFloat(crVals[s1Lv - 1] ?? '14.64') / 100 : 0.1464;
        pushBuff(state, { name: 'helm_skill1_critRate', unitId: null, critRateBonus: critBonus, endTick: state.tick + TICK_RATE * 5 });
      }

      // Helm Skill 1 (SSR): Full Charge shot → recover HP (all) + fill Burst Gauge (all)
      // Helm uses SR weapon — every shot is a full-charge shot.
      if (unit.name === 'Helm' && isCharged && unit.ssrFavSkills?.skill1) {
        const helmS1 = unit.ssrFavSkills.skill1;
        const s1Lv   = helmS1._activeSkillLevel ?? 0;
        if (s1Lv > 0) {
          const hpVals = helmS1.description_value_list?.[2]?.description_value ?? [];
          const bgVals = helmS1.description_value_list?.[3]?.description_value ?? [];
          const hpPct  = parseFloat(hpVals[s1Lv - 1] ?? '0') / 100;
          const bgPct  = parseFloat(bgVals[s1Lv - 1] ?? '0') / 100;
          if (hpPct > 0) {
            const hpGain = Math.round(unit.stats.hp * hpPct);
            for (const u of state.squad) {
              u.unitHp = Math.min(u.stats.hp, u.unitHp + hpGain);
            }
            // HP recovery to allies triggers Crown Skill 2 Attack Damage buff (7s, all)
            const crown_ = state.squad.find(u => u.name === 'Crown');
            if (crown_) {
              pushBuff(state, { name: 'crown_skill2_attackDmg', unitId: null, attackDamagePct: 0.2099, endTick: state.tick + TICK_RATE * 7 });
            }
          }
          if (bgPct > 0) {
            const gaugeGain = Math.round(bgPct * BURST_GAUGE_MAX);
            addBurstGauge(state, unit.name, 'helm_s1_gaugeBoost', gaugeGain);
          }
        }
      }

      // Helm Skill 2 (SSR): Full Charge hit → extra ATK damage to target (dvl3)
      // The skill hit also generates burstEnergyPerShot gauge for Helm (same mechanic as Lib S1 T3).
      if (unit.name === 'Helm' && isCharged && unit.ssrFavSkills?.skill2) {
        const helmS2  = unit.ssrFavSkills.skill2;
        const s2Lv    = helmS2._activeSkillLevel ?? 0;
        if (s2Lv > 0) {
          const exVals  = helmS2.description_value_list?.[3]?.description_value ?? [];
          const exMult  = parseFloat(exVals[s2Lv - 1] ?? '0') / 100;
          if (exMult > 0) {
            fireSkillHit(state, unit, exMult, sums, false);
            addBurstGauge(state, unit.name, 'helm_s2_skill', unit.burstEnergyPerShot);
            if (state.enemyHp <= 0) {
              events.push({ type: 'kill', tick: state.tick });
              return { over: true, events };
            }
          }
        }
      }

      // Helm Burst count-based charge buff: consume one charge round per full-charge shot
      if (unit.name === 'Helm' && isCharged && unit.skillState.helmChargeShots > 0) {
        unit.skillState.helmChargeShots--;
        if (unit.skillState.helmChargeShots === 0) unit.skillState.helmChargeDmgBuff = 0;
      }

      // LM Skill 2 (Bubble Wave): after 50 LM shots → Explosive Bubble replaces Bubble.
      // Damage Taken stays at 5.05% (same value). Bubble is removed, Explosive Bubble applied.
      if (unit.name === 'Little Mermaid') {
        unit.skillState.lmShotCount++;
        if (!unit.skillState.lmExplosiveBubble && unit.skillState.lmShotCount >= 50) {
          unit.skillState.lmExplosiveBubble = true;
          // enemyDamageTakenPct unchanged — Explosive Bubble replaces Bubble at the same 5.05%
        }
      }

      // Rapi Skill 2 (Attachable Projectiles): every 120 shots (60 during her burst rotation),
      // fire attachment damage immediately and leave a projectile on the enemy.
      // The projectile explodes immediately if Full Burst is active, otherwise at next Full Burst entry.
      if (unit.name === 'Rapi: Red Hood') {
        unit.skillState.rapiShotCount++;
        if (unit.skillState.rapiShotCount >= unit.skillState.rapiProjectileThreshold) {
          unit.skillState.rapiShotCount = 0;
          const am = unit.skillState.rapiProjectileAttachMult;
          const em = unit.skillState.rapiProjectileExplosionMult;
          // S2_attach fires immediately when the projectile is placed.
          fireSkillHit(state, unit, 0.8811, sums, false, 'S2_attach', {
            isCore:               state.enemyHasCore,
            coreDmgIncrement:     unit.coreDmgIncrement ?? 0,
            extraAttackDamagePct: am - 1,
          });
          if (state.fullBurstActive) {
            // Explode immediately during Full Burst.
            fireSkillHit(state, unit, 0.8811, sums, false, 'S2_explode', {
              isCore:               false,
              extraAttackDamagePct: em - 1,
            });
          } else {
            // Leave projectile — will explode when next Full Burst begins.
            unit.skillState.rapiPendingProjectile = true;
          }
        }
      }

      // SBS Skill 1 (Fleetly Fading: Breakthrough): charge cycle procs
      // Burst mode (1/2/3 cycle) only active when SBS fired her OWN burst skill within 10s.
      if (unit.name === 'Scarlet: Black Shadow') {
        const inBurstMode = state.tick < unit.skillState.sbsBurstChargeModeEndTick;
        const cycleLen   = inBurstMode ? 3 : 9;
        unit.skillState.sbsChargeCount = (unit.skillState.sbsChargeCount % cycleLen) + 1;
        const cnt        = unit.skillState.sbsChargeCount;
        // Normal:  3rd → 250.47%, 6th → 500%, 9th → 750.47%
        // Burst:   1st → 250.47%, 2nd → 500%, 3rd → 750.47%
        const thresholds = inBurstMode ? [1, 2, 3] : [3, 6, 9];
        const dmgMults   = [2.5047, 5.0, 7.5047];
        const ti         = thresholds.indexOf(cnt);
        if (ti >= 0) {
          // Skill proc values (250/500/750% ATK) are absolute — no charge multiplier
          // 6th/9th shots (ti≥1) are "Distributed Damage" type — applies damageTaken slot bonus
          const s1Label = inBurstMode ? `S1_burst_${ti+1}` : `S1_normal_${ti+1}`;
          fireSkillHit(state, unit, dmgMults[ti], sums, false, s1Label, { isDistributed: ti >= 1 });
          if (state.enemyHp <= 0) {
            events.push({ type: 'kill', tick: state.tick });
            return { over: true, events };
          }
        }
      }

      // Liberalio per-shot triggers (SR weapon; every shot is a full-charge shot).
      if (unit.name === 'Liberalio' && isCharged) {
        // S2 (Strange Currents): Raging Current — Attack Damage ▲231% permanently on first FC hit.
        // "Stage target" = always the single enemy in this sim → activates on shot 1.
        if (!unit.skillState.libRagingCurrentActive) {
          unit.skillState.libRagingCurrentActive = true;
          pushBuff(state, { name: 'lib_s2_ragingCurrent', unitId: unit.id, attackDamagePct: 2.31, endTick: Infinity });
        }
        // S1 T2 (Calm Depths): On FC shot → Attack Damage ▲20.83% for 60s (self), refreshing.
        // Implemented as a non-stacking buff; endTick refresh via pushBuff.
        pushBuff(state, { name: 'lib_s1_t2_attackDmg', unitId: unit.id, attackDamagePct: 0.2083, endTick: state.tick + TICK_RATE * 60 });
        // S1 T3 (Calm Depths): On FC shot → 5 × 40.5% ATK additional skill damage hits.
        // These are skill damage (not normal shots): cannot hit core, no distance advantage effect
        // (fireSkillHit with isCharged=false never gets distance advantage — only distanceZone in normal shots).
        // Element advantage (Wind vs Iron ×1.10) still applies as it is element-based, not distance-based.
        // Each hit also generates burst gauge = burstEnergyPerShot (same as an uncharged shot, no charge bonus).
        const libSums = getBuffSums(state, unit.id);
        for (let h = 0; h < 5 && state.enemyHp > 0; h++) {
          fireSkillHit(state, unit, 0.405, libSums, false, 'S1_t3_skill', { isCore: false });
          addBurstGauge(state, unit.name, 'lib_s1_t3_skill', unit.burstEnergyPerShot);
        }
        if (state.enemyHp <= 0) {
          events.push({ type: 'kill', tick: state.tick });
          return { over: true, events };
        }
      }

      // MG ramp: ROF increases by crownRofChangePerShot per shot, capped at crownMaxRof.
      if (unit.skillState.crownCurrentRof != null) {
        unit.skillState.crownCurrentRof = Math.min(
          unit.skillState.crownMaxRof,
          unit.skillState.crownCurrentRof + unit.skillState.crownRofChangePerShot
        );
      }

      // Crown-specific: Relax stacks (Skill 2 / Guardian).
      if (unit.name === 'Crown') {

        // Skill 2 (Guardian / Relax): every 43 shots → +1 stack (max 20).
        // At 20 stacks: recover 5.23% Crown max HP (all allies), Attack Damage ▲ 20.99% for 7s.
        unit.skillState.crownShotCount++;
        if (unit.skillState.crownShotCount >= 43) {
          unit.skillState.crownShotCount -= 43;
          unit.skillState.crownRelaxStacks++;
          if (unit.skillState.crownRelaxStacks >= 20) {
            unit.skillState.crownRelaxStacks = 0;
            const recovery = Math.round(unit.stats.hp * 0.0523);
            unit.unitHp = Math.min(unit.stats.hp, unit.unitHp + recovery);
            pushBuff(state, { name: 'crown_skill2_attackDmg', unitId: null, attackDamagePct: 0.2099, endTick: state.tick + TICK_RATE * 7 });
          }
        }
      }

      // Moran Skill 1 (Bring It On!): during burst weapon change, every 5 shots → 47.18% ATK hit.
      if (moranBurstActive) {
        unit.skillState.moranBurstS1Count++;
        if (unit.skillState.moranBurstS1Count >= 5) {
          unit.skillState.moranBurstS1Count = 0;
          const mSums = getBuffSums(state, unit.id);
          fireSkillHit(state, unit, 0.4718, mSums, false, 'S1_burst_weapon_hit');
          if (state.enemyHp <= 0) {
            events.push({ type: 'kill', tick: state.tick });
            return { over: true, events };
          }
        }
      }

      // ── 弹药里程碑 ─────────────────────────────────────────────────────

      // LM Skill 1 (Bubble Order): every 400 total ammo → shared burst gauge ▲ 37%
      const cur400 = Math.floor(state.totalAmmoFired / 400);
      if (cur400 > state.lastMilestone400) {
        state.lastMilestone400 = cur400;
        const gaugeBoost = Math.round(0.37 * BURST_GAUGE_MAX); // 370,000
        addBurstGauge(state, 'Little Mermaid', 'lm_s1_gaugeBoost', gaugeBoost);
      }

      // LM Skill 2 (Bubble Wave): every 500 total ammo → Bubble Barrage 10×85% ATK
      const cur500 = Math.floor(state.totalAmmoFired / 500);
      if (cur500 > state.lastMilestone500) {
        state.lastMilestone500 = cur500;
        const lm = state.squad.find(u => u.name === 'Little Mermaid');
        if (lm) {
          const lmSums = getBuffSums(state, lm.id);
          for (let h = 0; h < 10 && state.enemyHp > 0; h++) {
            fireSkillHit(state, lm, 0.85, lmSums, false, 'S2_barrage');
          }
          if (state.enemyHp <= 0) {
            events.push({ type: 'kill', tick: state.tick });
            return { over: true, events };
          }
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
