/**
 * 技能属性注册表（SKILL_TRAITS）+ 角色静态属性覆盖表（CHARACTER_TRAITS）。
 *
 * SKILL_TRAITS 键为 resource_id（number 字符串形式）。
 * 每个条目包含 skill1 / skill2 / burst，每个技能含 triggers 数组。
 * 触发器结构、条件写法、作用范围、效果类型见 src/engine/skill-executor.js 文件头。
 *
 * 技能数值均取自 Lv.10。
 * handler(state, caster, ctx) 为逃生舱口，直接操作 state，等价于内联代码。
 *
 * [TODO] 标注的技能未实现，已记录在此文件中。
 */

import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../engine/battle-utils.js';

// ─── 角色静态属性覆盖 ────────────────────────────────────────────────────────

/**
 * CDN 数据中武器类型有误时在此覆盖。
 * @type {Record<number, { weaponType?: string }>}
 */
export const CHARACTER_TRAITS = {
  354: { squad: 'Aegis' },  // Mast: Romantic Maid
  355: { squad: 'Aegis' },  // Anchor: Innocent Maid
};

export function getCharacterTraits(resourceId) {
  if (resourceId == null) return null;
  return CHARACTER_TRAITS[resourceId] ?? null;
}

// ─── 旧 group_id 查询接口（保留向后兼容；引擎不再依赖） ─────────────────────

export const SKILL_TRAITS_BY_GROUP = {};
export function getSkillTraits(groupId) { return SKILL_TRAITS_BY_GROUP[groupId] ?? null; }
export function hasSkillTrait(groupId, trait) { const t = getSkillTraits(groupId); return t != null && t[trait] === true; }
export function hasSkillTag(groupId, tag) { const t = getSkillTraits(groupId); return t?.tags?.includes(tag) ?? false; }

// ─── 技能注册表（以 resource_id 字符串为键） ────────────────────────────────

// ─── Red Hood (470) S1 辅助：更新蓄力伤害转化 buff ────────────────────────────
// 超出 100% 的蓄力速度 → Charge Damage ▲240% × 超出量（连续）
// endTick 由调用方传入，与产生该超量的 CS buff 同生命周期。
function updateRhCsConversion(state, caster, endTick = Infinity) {
  const sums    = getBuffSums(state, caster.id);
  const totalCS = (caster.stats.chargeSpeedPct ?? 0) + sums.chargeSpeedPct;
  const excess  = Math.max(0, totalCS - 1.0);
  const cdBonus = excess > 0 ? Math.round(excess * 2.4 * 100000) / 100000 : 0;
  const conv    = state.buffs.find(b => b.name === 'rh_s1_cd_conv' && b.unitId === caster.id);
  if (cdBonus > 0) {
    if (conv) { conv.chargeDamagePct = cdBonus; conv.endTick = endTick; }
    else state.buffs.push({ name: 'rh_s1_cd_conv', unitId: caster.id, chargeDamagePct: cdBonus, endTick });
  } else if (conv) {
    state.buffs.splice(state.buffs.indexOf(conv), 1);
  }
}

export const SKILL_TRAITS = {

  // ══════════════════════════════════════════════════════════════════════════
  // 15 · Anis: Sparkling Summer（B3 · SG）
  // ══════════════════════════════════════════════════════════════════════════
  15: {
    skill1: {
      groupId: 20151,
      triggers: [
        // S1（Summer Wave）：进入全爆裂 → 队中 Electric Code 友军：
        //   ATK flat ▲55.31% Anis ATK + Reload Speed ▲49.28% 10s
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            const atkBonus = Math.round(caster.stats.atk * 0.5531);
            const end10    = state.tick + TICK_RATE * 10;
            for (const u of state.squad) {
              if (u.element !== 'Electric') continue;
              pushBuff(state, { name: 'anisss_s1_atkFlat',   unitId: u.id, atkFlat:        atkBonus, endTick: end10 });
              pushBuff(state, { name: 'anisss_s1_reloadSpd', unitId: u.id, reloadSpeedPct: 0.4928,   endTick: end10 });
            }
          },
        },
      ],
    },
    skill2: {
      groupId: 20152,
      triggers: [
        // S2（Sparkling Missile）：末弹 → 382.42% ATK 技能伤害
        //   自身 Damage to Interruption Parts ▲6.91% 10s（不计入伤害输出）
        {
          on: 'LAST_BULLET',
          handler(state, caster) {
            const sums = getBuffSums(state, caster.id);
            fireSkillHit(state, caster, 3.8242, sums, false, 'anisss_s2');
            pushBuff(state, { name: 'anisss_s2_partsDmg', unitId: caster.id,
              interruptionPartsDamagePct: 0.0691, endTick: state.tick + TICK_RATE * 10 });
          },
        },
      ],
    },
    burst: {
      groupId: 10153,
      triggers: [
        // Burst（Sparkling Wave）：
        //   Max Ammo ▼73.92% 10s + Reload Speed ▲27.72% 10s + Elem Adv ATK Dmg ▲42.24% 10s
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const end10 = state.tick + TICK_RATE * 10;
            // Max Ammo ▼73.92%：T33 per-effect round，mult=0.2608，立即截弹至新上限
            caster.tempMaxAmmoMult    = 0.2608;
            caster.tempMaxAmmoEndTick = end10;
            const reducedMax = Math.max(1, caster.baseAmmo + Math.round(caster.baseAmmo * (0.2608 - 1)))
                             + (caster.stats.bonusAmmo ?? 0) + caster.favAmmoBonus;
            caster.ammoLeft   = reducedMax;
            caster.reloadTick = 0;
            pushBuff(state, { name: 'anisss_burst_reloadSpd',  unitId: caster.id, reloadSpeedPct:        0.2772, endTick: end10 });
            pushBuff(state, { name: 'anisss_burst_elemAdvDmg', unitId: caster.id, elementAdvantageBonus: 0.4224, endTick: end10 });
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 16 · Rapi: Red Hood（B3 · MG）
  // ══════════════════════════════════════════════════════════════════════════
  16: {
    skill1: {
      groupId: 20161,
      triggers: [
        // S1（Battlefield Assessment）— Combat Assist 状态在战斗开始和全爆裂结束时结算：
        //   无原生 B1 友军 → combatAssistStatus = false（切换为 B1）
        //   有原生 B1 友军 → combatAssistStatus = configuredCombatAssist（玩家显式配置）
        {
          on: 'BATTLE_START',
          handler(state, caster) {
            const hasNativeB1 = state.squad.some(u => u.id !== caster.id && u.nativeBurstStep === 'Step1');
            caster.combatAssistStatus = hasNativeB1 && (caster.configuredCombatAssist ?? false);
          },
        },
        {
          on: 'FULL_BURST_END',
          handler(state, caster) {
            const hasNativeB1 = state.squad.some(u => u.id !== caster.id && u.nativeBurstStep === 'Step1');
            caster.combatAssistStatus = hasNativeB1 && (caster.configuredCombatAssist ?? false);
          },
        },
        // Scenario C（Combat Assist + 进入全爆裂）：
        //   全员爆裂冷却 ▼7.48s + 全员 Attack Damage ▲8.02% 10s
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            if (!caster.combatAssistStatus) return;
            const reductionTicks = Math.round(TICK_RATE * 7.48);
            for (const u of state.squad)
              u.burstSkillCooldownEndTick = Math.max(state.tick, u.burstSkillCooldownEndTick - reductionTicks);
            if (state.buffLog)
              state.buffLog.push({ type: 'cd_reduction', tick: state.tick, name: 'rapi_s1_ca_cdReduction', unitId: null, reductionTicks });
            pushBuff(state, { name: 'rapi_s1_ca_attackDmg', unitId: null,
              attackDamagePct: 0.0802, endTick: state.tick + TICK_RATE * 10 });
          },
        },
        // Scenario D（非 Combat Assist + 进入全爆裂）：
        //   自身 ATK ▲95.04% 10s + Damage to Interruption Parts ▲48% 10s
        //   适用于切换为 B1（无原生 B1 友军）及保持 B3（有原生 B1 但非 Combat Assist）两种情况。
        //   注：Interruption Parts 伤害系统当前未建模，interruptionPartsDamagePct 字段已记录但不计入伤害输出。
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            if (caster.combatAssistStatus) return;
            const endTick = state.tick + TICK_RATE * 10;
            pushBuff(state, { name: 'rapi_s1_enterBurst_atkPct', unitId: caster.id, atkPct: 0.9504, endTick });
            pushBuff(state, { name: 'rapi_s1_enterBurst_partsDmg', unitId: caster.id, interruptionPartsDamagePct: 0.48, endTick });
          },
        },
      ],
    },

    skill2: {
      groupId: 20162,
      triggers: [
        // S2 被动声明：战斗开始时初始化 attach/explode 倍率（与 skillState 初始值对应）
        {
          on: 'BATTLE_START',
          handler(state, caster) {
            // attach +150.72%（基础 ×2.5072）；explode +100.6%（基础 ×2.006）
            // 初始值已在 skillState 设定，此触发为声明式补充，无额外操作
          },
        },
        // S2（Attachable Projectiles）：每 120 发（全爆裂期间 60 发）触发 projectile
        // rapiShotCount 在 handler 内手动累积；若爆裂时计数 ≥60 则扣除 60 不发射
        {
          on: 'SHOT_COUNT',
          opts: { every: 1, counterKey: 'rapiRawShotCount' },
          handler(state, caster, ctx) {
            caster.skillState.rapiShotCount++;
            if (caster.skillState.rapiShotCount < caster.skillState.rapiProjectileThreshold) return;
            caster.skillState.rapiShotCount = 0;
            const sums = ctx.sums ?? getBuffSums(state, caster.id);
            const am   = caster.skillState.rapiProjectileAttachMult;
            const em   = caster.skillState.rapiProjectileExplosionMult;
            fireSkillHit(state, caster, 0.8811, sums, false, 'S2_attach', {
              isCore: state.enemyHasCore, coreDmgIncrement: caster.coreDmgIncrement ?? 0,
              extraAttackDamagePct: am - 1,
            });
            if (state.fullBurstActive) {
              // 全爆裂期间立即爆炸（不需等待，触发 projectileExplosion 加成）
              fireSkillHit(state, caster, 0.8811, sums, false, 'S2_explode', {
                isCore: false, extraAttackDamagePct: em - 1, projectileExplosion: true,
              });
            } else {
              caster.skillState.rapiPendingProjectile = true;
            }
          },
        },
        // 待定 projectile 在进入全爆裂时爆炸（享受 ENTER_FULL_BURST buff 加成）
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            if (!caster.skillState.rapiPendingProjectile) return;
            const sums = getBuffSums(state, caster.id);
            const em   = caster.skillState.rapiProjectileExplosionMult;
            fireSkillHit(state, caster, 0.8811, sums, false, 'S2_explode', {
              isCore: false, extraAttackDamagePct: em - 1, projectileExplosion: true,
            });
            caster.skillState.rapiPendingProjectile = false;
          },
        },
      ],
    },

    burst: {
      groupId: 10163,
      triggers: [
        // Burst（Combat Assist → Stage 1）：全员 ATK flat ▲18.01% Rapi ATK 10s
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            if (!caster.combatAssistStatus) return;
            const end10 = state.tick + TICK_RATE * 10;
            pushBuff(state, { name: 'rapi_burst_ca_atkFlat', unitId: null,
              atkFlat: Math.round(caster.stats.atk * 0.1801), endTick: end10 });
            // [TODO: Explosion Radius ▲100.62% — 未建模]
          },
        },
        // Burst（Stage 3）：2808% ATK 伤害（FIRE_IN_FULL_BURST）+ 激活增强 S2 projectile 参数 10s
        // 若 rapiShotCount >= 60：扣除 60，不发射 projectile
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            if (caster.combatAssistStatus) return;
            // 若计数 ≥ 60，消耗计数（代替 projectile 发射）
            if (caster.skillState.rapiShotCount >= 60) {
              caster.skillState.rapiShotCount -= 60;
            }
            const sums = getBuffSums(state, caster.id);
            // 2808% 命中 — FIRE_IN_FULL_BURST，需在 ENTER_FULL_BURST buff 后执行
            state.pendingFireInBurstHits.push({
              caster, mult: 28.08, sums, isCharged: false, label: 'burst',
              opts: { fireInFullBurst: true },
            });
            const end10 = state.tick + TICK_RATE * 10;
            caster.skillState.rapiProjectileThreshold    = 60;
            caster.skillState.rapiProjectileAttachMult   = 6.7192;
            caster.skillState.rapiProjectileBuffEndTick  = end10;
          },
        },
        // 全爆裂结束：若 buff 已过期则恢复 S2 非全爆裂默认参数
        {
          on: 'FULL_BURST_END',
          handler(state, caster) {
            if (state.tick < caster.skillState.rapiProjectileBuffEndTick) return;
            caster.skillState.rapiProjectileThreshold  = 120;
            caster.skillState.rapiProjectileAttachMult = 2.5072;
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 82 · Liter（B1 · SMG）
  // ══════════════════════════════════════════════════════════════════════════
  82: {
    skill1: {
      groupId: 20821,
      triggers: [
        // S1 Part 1（Liter Boost）："前效重复触发"，进入全爆裂时：
        //   爆裂冷却累进减少：1st ▼2.34s; 2nd +▼2.70s; 3rd+ +▼3.17s
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            caster.skillState.literFbCount++;
            const cnt = caster.skillState.literFbCount;
            let sec = 0;
            if (cnt >= 1) sec += 2.34;
            if (cnt >= 2) sec += 2.70;
            if (cnt >= 3) sec += 3.17;
            const reductionTicks = Math.round(TICK_RATE * sec);
            for (const u of state.squad) {
              u.burstSkillCooldownEndTick = Math.max(state.tick, u.burstSkillCooldownEndTick - reductionTicks);
            }
            if (state.buffLog && reductionTicks > 0)
              state.buffLog.push({ type: 'cd_reduction', tick: state.tick, name: 'liter_s1_cdReduction', unitId: null, reductionTicks });
          },
        },
        // S1 Part 2："前效重复触发"，每次使用爆裂技能时（累计计数）：
        //   第 1 次+：全员临时弹匣容量 ▲45.17% 5s（下次装填时生效）
        //   第 2 次+：全员 Crit Damage ▲12.46% 5s
        //   第 3 次+：全员 ATK ▲14.42% 5s
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const cnt  = ++caster.skillState.literBurstUseCount;
            const end5 = state.tick + TICK_RATE * 5;
            const literBoostEndTick = end5;
            for (const u of state.squad) {
              const boostExtra = Math.floor(u.baseAmmo * 0.4517);
              u.skillState.literAmmoBoostEndTick = literBoostEndTick;
              u.skillState.literAmmoBoostExtra   = boostExtra;
              if (state.ammoLog)
                state.ammoLog.push({ tick: state.tick, unitId: u.id, unitName: u.name,
                  delta: 0, ammoAfter: u.ammoLeft, maxAmmo: u.maxAmmo + boostExtra,
                  maxAmmoDelta: boostExtra, source: 'liter_s1_t1_maxAmmo(+45.17%)' });
            }
            pushBuff(state, { name: 'liter_s1_t1_maxAmmo', unitId: null, maxAmmoPct: 0.4517, endTick: literBoostEndTick });
            if (cnt >= 2) pushBuff(state, { name: 'liter_s1_critDmg', unitId: null, critDmgBonus: 0.1246, endTick: end5 });
            if (cnt >= 3) pushBuff(state, { name: 'liter_s1_atkPct',  unitId: null, atkPct:       0.1442, endTick: end5 });
          },
        },
      ],
    },

    skill2: {
      groupId: 10822,
      // [TODO] Liter S2：恢复 2 名友军的掩体 HP。
      // 当前模拟器无受伤/掩体模型，不实现。
      triggers: [],
    },

    burst: {
      groupId: 10823,
      triggers: [
        // Burst（Double Boost）：全员 ATK ▲66% 5s
        {
          on: 'BURST_SKILL_USE',
          effects: [{ type: 'BUFF_GLOBAL', name: 'liter_burst_atkPct', stat: { atkPct: 0.66 }, duration: 5 }],
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 183 · Maiden: Ice Rose（B3 · RL · Defender · ELYSION · Electric）
  // 核心机制：MP（最大 12，Burst 全数消耗）
  //   S1 Part1：进入 B1 阶段，MP=0 → MP=1；S2 Part1 同步对 Electric 友军施 buff
  //   S1 Part2：进入全爆裂，MP≥1 → MP+1（上限 12）；S2 Part1 同步施 buff
  //   S1 Part3：每 6 次全蓄力 → 自身 Max HP ▲6.34% 15s（叠加最多 10 层，数值与 endTick 均刷新）
  //   S2 Part1（inline S1）：Electric 友军（非自身）Elem Adv ATK Dmg ▲40.9% + ATK ▲20.9% ATK flat 10s
  //   S2 Part2（inline Burst）：自身 Elem Adv ATK Dmg ▲31.68% + ATK ▲3.2% buffed MaxHP flat 10s
  //   S2 Part3：每次全蓄力 → 547.62% ATK 技能伤害
  //   Burst：当前 MP 次 × 1372.8% × (10% buffed MaxHP + buffed ATK)
  // ══════════════════════════════════════════════════════════════════════════
  183: {
    skill1: {
      groupId: 21831,
      triggers: [
        // S1 Part1（Meditation）：进入 B1 阶段，MP=0 时 → MP=1 + S2 Part1 Electric 友军 buff
        {
          on: 'ENTER_BURST_I',
          handler(state, caster) {
            if ((caster.skillState.iceroseMP ?? 0) > 0) return;
            caster.skillState.iceroseMP = 1;
            const end10   = state.tick + TICK_RATE * 10;
            const atkFlat = Math.round(caster.stats.atk * 0.209);
            for (const u of state.squad) {
              if (u.id === caster.id || u.element !== 'Electric') continue;
              pushBuff(state, { name: 'icr_s2_elemAdv', unitId: u.id, elementAdvantageBonus: 0.409, endTick: end10 });
              pushBuff(state, { name: 'icr_s2_atkFlat', unitId: u.id, atkFlat, endTick: end10 });
            }
          },
        },
        // S1 Part2（Meditation）：进入全爆裂，MP≥1 时 → MP+1（上限 12）+ S2 Part1 Electric 友军 buff
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            if ((caster.skillState.iceroseMP ?? 0) < 1) return;
            caster.skillState.iceroseMP = Math.min(12, caster.skillState.iceroseMP + 1);
            const end10   = state.tick + TICK_RATE * 10;
            const atkFlat = Math.round(caster.stats.atk * 0.209);
            for (const u of state.squad) {
              if (u.id === caster.id || u.element !== 'Electric') continue;
              pushBuff(state, { name: 'icr_s2_elemAdv', unitId: u.id, elementAdvantageBonus: 0.409, endTick: end10 });
              pushBuff(state, { name: 'icr_s2_atkFlat', unitId: u.id, atkFlat, endTick: end10 });
            }
          },
        },
        // S1 Part3（Meditation）：每 6 次全蓄力 → 自身 Max HP ▲6.34% 15s（叠加至 10 层）
        {
          on: 'FULL_CHARGE',
          handler(state, caster) {
            caster.skillState.iceroseChargeCount = (caster.skillState.iceroseChargeCount ?? 0) + 1;
            if (caster.skillState.iceroseChargeCount < 6) return;
            caster.skillState.iceroseChargeCount = 0;
            const existing = state.buffs.find(b => b.name === 'icr_s1_maxHp' && b.unitId === caster.id);
            const stacks   = Math.min(10, (existing?.stackCount ?? 0) + 1);
            const end15    = state.tick + TICK_RATE * 15;
            if (existing) {
              existing.stackCount = stacks;
              existing.maxHpPct   = stacks * 0.0634;
              existing.endTick    = end15;
            } else {
              state.buffs.push({ name: 'icr_s1_maxHp', unitId: caster.id,
                maxHpPct: 0.0634, endTick: end15, stackCount: 1 });
            }
          },
        },
      ],
    },

    skill2: {
      groupId: 21832,
      triggers: [
        // S2 Part3（Blessings Upon You）：每次全蓄力 → 547.62% ATK 技能伤害
        // S2 Part1 inline 于 S1 触发器；S2 Part2 inline 于 Burst 触发器
        {
          on: 'FULL_CHARGE',
          handler(state, caster, ctx) {
            const sums = ctx.sums ?? getBuffSums(state, caster.id);
            fireSkillHit(state, caster, 5.4762, sums, false, 'icr_s2_fc_dmg');
            addBurstGauge(state, caster.name, 'icr_s2_fc_dmg', caster.burstEnergyPerShot);
          },
        },
      ],
    },

    burst: {
      groupId: 11833,
      triggers: [
        // Burst（Diamond Dust）：
        //   S2 Part2（MP 消耗时）先推：自身 Elem Adv ATK Dmg ▲31.68% + ATK ▲3.2% buffed MaxHP flat 10s
        //   主体：消耗全部 MP，每点 MP 发动 1 次 1372.8% × (10% buffed MaxHP + buffed ATK)
        //   extraAtkFlat = round(buffedMaxHP × 10%)，不受 ATK% 缩放，hitMult=13.728 正确还原公式
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const preSums     = getBuffSums(state, caster.id);
            const buffedMaxHp = Math.round(caster.stats.hp * (1 + preSums.maxHpPct));
            const end10       = state.tick + TICK_RATE * 10;
            pushBuff(state, { name: 'icr_s2_self_elemAdv', unitId: caster.id,
              elementAdvantageBonus: 0.3168, endTick: end10 });
            pushBuff(state, { name: 'icr_s2_self_atkFlat', unitId: caster.id,
              atkFlat: Math.round(buffedMaxHp * 0.032), endTick: end10 });

            const sums    = getBuffSums(state, caster.id);
            const hpAdded = Math.round(buffedMaxHp * 0.1);
            const mp      = caster.skillState.iceroseMP ?? 0;
            for (let i = 0; i < mp && state.enemyHp > 0; i++) {
              fireSkillHit(state, caster, 13.728, sums, false, 'burst_hit',
                { extraAtkFlat: hpAdded, burstSkillDamage: true });
            }
            caster.skillState.iceroseMP = 0;
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 191 · Alice（B3 · SR · Attacker · TETRA · Fire）
  // ══════════════════════════════════════════════════════════════════════════
  191: {
    skill1: {
      groupId: 21911,
      triggers: [
        // S1（Energizing Carrot）：进入全爆裂 → 全队 ATK 最高 2 名友军：
        //   Charge Speed ▲11.67% Alice 蓄力时间（flat 减少）10s
        //   Charge Damage ▲7% 10s
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            const sorted  = [...state.squad].sort((a, b) => b.stats.atk - a.stats.atk);
            const targets  = sorted.slice(0, 2);
            const end10    = state.tick + TICK_RATE * 10;
            const chargeReduction = Math.round(caster.chargeTimeTicks * 0.1167);
            for (const u of targets) {
              pushBuff(state, { name: 'alice_s1_chargeSpd', unitId: u.id,
                chargeTimeReductionTicks: chargeReduction, endTick: end10 });
              pushBuff(state, { name: 'alice_s1_chargeDmg', unitId: u.id,
                chargeDamagePct: 0.07, endTick: end10 });
            }
          },
        },
      ],
    },

    skill2: {
      groupId: 21912,
      // [TODO] S2 Part1（Healthy Carrot）：HP > 80% → 自身持续穿透 Pierce
      //   穿透机制涉及两个场景（均待敌人设置系统实现后启用）：
      //   (a) 隐藏核心：敌人有核心但被装甲覆盖，仅穿透攻击可命中核心获得核心伤害加成；
      //   (b) 零件：敌人有独立 HP 的零件，穿透攻击（含 RL/explosion）可同时命中敌人本体和零件；
      //       零件被击破后对敌人造成伤害并触发特定效果。
      // [TODO] S2 Part2：HP < 80% → 攻击时回复 8.12% ATK 量 HP（生命偷取）— HP 受伤追踪未建模
      triggers: [],
    },

    burst: {
      groupId: 11913,
      triggers: [
        // Burst（Wonderland）：自身 Charge Speed ▲80.15% + ATK ▲55.12% 10s
        // 同时记录 aliceWonderlandEndTick：若期间 final 蓄力速度 ≥ 99.52%，
        // 启用快速攻击模式（40次/min，由 battle.js 判定）
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const end10 = state.tick + TICK_RATE * 10;
            pushBuff(state, { name: 'alice_burst_chargeSpd', unitId: caster.id,
              chargeSpeedPct: 0.8015, endTick: end10 });
            pushBuff(state, { name: 'alice_burst_atkPct', unitId: caster.id,
              atkPct: 0.5512, endTick: end10 });
            caster.skillState.aliceWonderlandEndTick = end10;
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 223 · Nayuta（use_burst_skill=Step2 / change_burst_step=Step3 · SMG）
  //
  // CDN lv10 数值摘要：
  //   S1 (Hypocrisy, group 22231)
  //     Part1: 战斗开始 → Indomitability 9s（特殊蓄力武器，1次/战）
  //       [TODO] 引擎暂不支持 SMG→蓄力切换；Indomitability DPS 未建模
  //     Part2: Memory Absorption 每次生效 → 全员 Core Damage ▲25.15% 5s
  //            + 全员 ATK flat ▲30.16% Nayuta ATK 5s + 自身 HP 回复 25% MaxHP
  //     Part3: Memory Incineration（Burst）期间 FC 命中 → 150%+380.46% ATK 技能伤害
  //       [已内联到 Burst handler 的 pendingSkillHits]
  //   S2 (Impermanence, group 22232)
  //     每 3s Memory Absorption +1 层（上限 30；免疫增减；永久）
  //     每层 Hit Rate ▲1.4%（累计最高 42%）
  //     Stage 1 (≥2 层, ≈t6s):  自身 ATK ▲15.2%（永久）
  //     Stage 2 (≥10 层, ≈t30s): 自身 Attack Damage ▲20.27%（永久）
  //     Stage 3 (=30 层, ≈t90s): 自身 Core Damage ▲21.05%（永久）
  //   Burst (Asceticism, group 12233, CD=20s)
  //     全员 Attack Damage ▲35.45% 15s
  //     645.33% ATK 直击（Burst Skill Damage）
  //     自身 Memory Incineration 10s：武器切换为蓄力武器（275.18%×250%=687.95%/FC，每 1.8s）
  //       + S1 Part3 于每次 FC 追加 530.46% → 合计 1218.41% ATK / FC × 5 次
  // ══════════════════════════════════════════════════════════════════════════
  223: {
    skill1: {
      groupId: 22231,
      triggers: [
        // S1 Part1: Indomitability — 战斗开始 9s HP 不低于 1（1次/战）
        {
          on: 'BATTLE_START',
          handler(state, caster) {
            caster.skillState.nayutaIndomitabilityEndTick = state.tick + TICK_RATE * 9;
          },
        },
        // S1 Part3: Memory Incineration 期间全蓄力攻击 → 额外 530.46%（150% 全员 + 380.46% boss）
        {
          on: 'FULL_CHARGE',
          handler(state, caster, ctx) {
            if ((caster.skillState.weaponSwitchEndTick ?? 0) <= 0 ||
                state.tick > caster.skillState.weaponSwitchEndTick) return;
            const sums = ctx.sums ?? getBuffSums(state, caster.id);
            if (state.enemyHp > 0)
              fireSkillHit(state, caster, 5.3046, sums, false, 'memincin_s1p3');
          },
        },
      ],
    },

    skill2: {
      groupId: 22232,
      triggers: [
        // S2 Impermanence — Memory Absorption 每 3s 触发（首次 t=3s）
        // 同步执行 S1 Part2 ally buffs（每次生效均刷新，含满层后）
        {
          on: 'INTERVAL',
          opts: { seconds: 3 },
          handler(state, caster) {
            // S1 Part2：每次 Memory Absorption 生效 → 全员 5s buff + 自身治疗
            const end5 = state.tick + TICK_RATE * 5;
            pushBuff(state, { name: 'nayuta_s1_coreDmg', unitId: null,
              coreDamagePct: 0.2515, endTick: end5 });
            pushBuff(state, { name: 'nayuta_s1_atkFlat', unitId: null,
              atkFlat: Math.round(caster.stats.atk * 0.3016), endTick: end5 });
            applyHeal(state, caster, Math.round(caster.stats.hp * 0.25));

            // 层数上限 30；满层后 S1 Part2 仍每 3s 刷新
            if (caster.skillState.nayutaMemAbsStacks >= 30) return;
            caster.skillState.nayutaMemAbsStacks++;
            const s = caster.skillState.nayutaMemAbsStacks;

            // Hit Rate 累计值：直接写入已有 buff，因 pushBuff 不更新现有 buff 的数值字段
            const hrBuff = state.buffs.find(
              b => b.name === 'nayuta_s2_hitRate' && b.unitId === caster.id);
            if (hrBuff) {
              hrBuff.hitRateBonus = s * 0.014;
            } else {
              state.buffs.push({ name: 'nayuta_s2_hitRate', unitId: caster.id,
                hitRateBonus: s * 0.014, endTick: Infinity });
            }

            // Stage 1: s=2（≥2 层）→ 自身 ATK ▲15.2%（永久，仅首次推送）
            if (s === 2)
              pushBuff(state, { name: 'nayuta_s2_stage1_atkPct', unitId: caster.id,
                atkPct: 0.152, endTick: Infinity });

            // Stage 2: s=10（≥10 层）→ 自身 Attack Damage ▲20.27%（永久）
            if (s === 10)
              pushBuff(state, { name: 'nayuta_s2_stage2_attackDmg', unitId: caster.id,
                attackDamagePct: 0.2027, endTick: Infinity });

            // Stage 3: s=30（=30 层）→ 自身 Core Damage ▲21.05%（永久）
            if (s === 30)
              pushBuff(state, { name: 'nayuta_s2_stage3_coreDmg', unitId: caster.id,
                coreDamagePct: 0.2105, endTick: Infinity });
          },
        },
      ],
    },

    burst: {
      groupId: 12233,
      triggers: [
        // Burst（Asceticism）：
        //   1. 全员 Attack Damage ▲35.45% 15s（先推送，Nayuta 直击受益）
        //   2. 645.33% ATK 直击（Burst Skill Damage）
        //   3. Memory Incineration 10s：武器切换为蓄力武器（1.8s/FC，275.18%×250%）
        //      + S1 Part3 由 FULL_CHARGE 触发器追加 530.46%
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            pushBuff(state, { name: 'nayuta_burst_attackDmg', unitId: null,
              attackDamagePct: 0.3545, endTick: state.tick + TICK_RATE * 15 });

            const sums = getBuffSums(state, caster.id);
            if (state.enemyHp > 0)
              fireSkillHit(state, caster, 6.4533, sums, false, 'burst_hit');

            // Memory Incineration 武器切换：SMG → 蓄力武器（1.8s/FC，275.18% × 250%）
            // duration=10s, chargeTime=1.8s → floor(10/1.8)=5 FCs；第 6 次 t=10.8s 超出窗口丢失
            const chargeTimeTicks = Math.round(1.8 * TICK_RATE);
            caster.skillState.weaponSwitchHitMult          = 2.7518;   // 275.18%
            caster.skillState.weaponSwitchType             = 'SR';
            caster.skillState.weaponSwitchEndTick          = state.tick + TICK_RATE * 10;
            caster.skillState.weaponSwitchChargeTimeTicks  = chargeTimeTicks;
            caster.skillState.weaponSwitchFullChargeDamage = 25000;    // 250% FC = ×2.5
            caster.skillState.weaponSwitchUnlimitedAmmo    = true;
            // Full magazine on switch: begin charging immediately, first FC fires at t+1.8s
            caster.chargeTick = state.tick + chargeTimeTicks;
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 225 · Scarlet: Black Shadow（B3 · RL）
  // ══════════════════════════════════════════════════════════════════════════
  225: {
    skill1: {
      groupId: 22251,
      triggers: [
        // S1（Fleetly Fading: Breakthrough）：统一 9 步计数器，溢出保留
        // 普通模式每发 +1；Burst 模式每发 +3
        // 阈值 3/6/9：250.47% / 500% / 750.47% ATK
        // 第 6/9 步（普通）/ 第 2/3 步（Burst）为 Distributed Damage 命中
        {
          on: 'SHOT_COUNT',
          opts: { every: 1, counterKey: 'sbsRawCount' },
          handler(state, caster, ctx) {
            const inBurstMode = state.tick < caster.skillState.sbsBurstChargeModeEndTick;
            const delta = inBurstMode ? 3 : 1;
            const prev  = caster.skillState.sbsChargeCount;
            const next  = prev + delta;
            caster.skillState.sbsChargeCount = next >= 9 ? next - 9 : next;
            const sums       = ctx.sums ?? getBuffSums(state, caster.id);
            const dmgMults   = [2.5047, 5.0, 7.5047];
            const thresholds = [3, 6, 9];
            for (let i = 0; i < thresholds.length; i++) {
              const t = thresholds[i];
              if (prev < t && next >= t) {
                const label = inBurstMode ? `S1_burst_${i+1}` : `S1_normal_${i+1}`;
                fireSkillHit(state, caster, dmgMults[i], sums, false, label, { isDistributed: i >= 1 });
              }
            }
          },
        },
      ],
    },

    skill2: {
      groupId: 22252,
      triggers: [
        // S2（Fleetly Fading: Asura）：进入全爆裂 → 弹匣 ×1.6 10s + 立即补满
        {
          on: 'ENTER_FULL_BURST',
          target: 'SELF',
          effects: [{ type: 'AMMO_EXPAND', mult: 1.6, seconds: 10, label: 'sbs_s2_maxAmmo(×1.6)' }],
        },
      ],
    },

    burst: {
      groupId: 12254,
      triggers: [
        // Burst：自身 ATK ▲115.12% + Charge Damage ▲150.12% 10s
        //        激活 S1 Burst 充能模式（每发 +3 步）10s
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const end10 = state.tick + TICK_RATE * 10;
            pushBuff(state, { name: 'sbs_burst_atkPct',    unitId: caster.id, atkPct:          1.1512, endTick: end10 });
            pushBuff(state, { name: 'sbs_burst_chargeDmg', unitId: caster.id, chargeDamagePct: 1.5012, endTick: end10 });
            caster.skillState.sbsBurstChargeModeEndTick = end10;
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 262 · Liberalio（B3 · SR）
  // ══════════════════════════════════════════════════════════════════════════
  262: {
    skill1: {
      groupId: 22621,
      triggers: [
        // S1 T1（Calm Depths）：进入全爆裂 → 自身 ATK ▲160% 3s
        {
          on: 'ENTER_FULL_BURST',
          target: 'SELF',
          effects: [{ type: 'BUFF', name: 'lib_s1_t1_atkPct', stat: { atkPct: 1.60 }, duration: 3 }],
        },
        // S1 T4：进入全爆裂 → ATK 最低的 B3 友军（排除 Lib 自身）蓄力速度减少 12.74% 10s
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            const b3Units = state.squad.filter(u => u.burstStep === 'Step3');
            if (!b3Units.length) return;
            const target = b3Units.reduce((a, b) => a.stats.atk < b.stats.atk ? a : b);
            pushBuff(state, { name: 'lib_s1_t4_chargeSpd', unitId: target.id,
              chargeTimeReductionTicks: Math.round(caster.chargeTimeTicks * 0.1274),
              endTick: state.tick + TICK_RATE * 10 });
          },
        },
        // S1 T2：全蓄力命中核心 → 自身 Attack Damage ▲20.83% 60s（刷新）
        {
          on: 'FULL_CHARGE',
          conditions: [{ type: 'IS_CORE_HIT' }],
          target: 'SELF',
          effects: [{ type: 'BUFF', name: 'lib_s1_t2_attackDmg', stat: { attackDamagePct: 0.2083 }, duration: 60 }],
        },
        // S1 T3：全蓄力命中 → 5×40.5% ATK 技能伤害 + 为 Lib 补充爆裂槽
        {
          on: 'FULL_CHARGE',
          handler(state, caster, ctx) {
            const sums = ctx.sums ?? getBuffSums(state, caster.id);
            for (let h = 0; h < 5 && state.enemyHp > 0; h++) {
              fireSkillHit(state, caster, 0.405, sums, false, 'S1_t3_skill', { isCore: false });
              addBurstGauge(state, caster.name, 'lib_s1_t3_skill', caster.burstEnergyPerShot);
            }
          },
        },
      ],
    },

    skill2: {
      groupId: 22622,
      triggers: [
        // S2（Strange Currents）：首次全蓄力命中 → Raging Current：自身 Attack Damage ▲231% 永久
        // "stage target" = Boss 战唯一目标，首发即激活
        {
          on: 'FULL_CHARGE',
          handler(state, caster) {
            if (caster.skillState.libRagingCurrentActive) return;
            caster.skillState.libRagingCurrentActive = true;
            pushBuff(state, { name: 'lib_s2_ragingCurrent', unitId: caster.id,
              attackDamagePct: 2.31, endTick: Infinity });
          },
        },
      ],
    },

    burst: {
      groupId: 12623,
      triggers: [
        // Burst（Submerged World）：自身 Attack Damage ▲50% 10s
        //   + 延迟 0.97s 后 925% ATK 技能伤害
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            pushBuff(state, { name: 'lib_burst_attackDmg', unitId: caster.id,
              attackDamagePct: 0.50, endTick: state.tick + TICK_RATE * 10 });
            state.pendingSkillHits.push({
              fireTick: state.tick + Math.round(0.97 * TICK_RATE),
              caster, mult: 9.25, isCharged: false, label: 'burst', opts: { fireInFullBurst: true },
            });
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 281 · Moran（B1 · AR · Defender · TETRA）
  // CDN: use_burst_skill=Step1, change_burst_step=Step2
  // SSR 收藏品：Peony Hairpin（id 201701）— 只建模 SSR 版本
  //   favoriteitem 技能默认 lv10；collection 技能（Gaze of Courage / Grounding Pillar）在任意物品等级均为 lv4
  // ══════════════════════════════════════════════════════════════════════════
  281: {
    skill1: {
      groupId: 22811,
      triggers: [
        // S1 T1（被动）：DEF ▲ X%/每损失 1% HP — [TODO] 未建模（需 HP 受伤追踪）
        //
        // S1 SSR Fervor（被动）：战斗开始 → 激活 Fervor 状态（用于 S2 与 Burst）
        {
          on: 'BATTLE_START',
          handler(state, caster) {
            if (caster.ssrFavSkills?.skill1) caster.skillState.moranFervorActive = true;
          },
        },
        // S1 T2：武器替换期间每 5 发普通攻击 → X% ATK 技能伤害（lv10=47.18%）
        {
          on: 'SHOT_COUNT',
          opts: { every: 5, counterKey: 'moranBurstS1Count' },
          handler(state, caster, ctx) {
            const switchActive = (caster.skillState?.weaponSwitchEndTick ?? 0) > 0
              && state.tick <= caster.skillState.weaponSwitchEndTick;
            if (!switchActive) return;
            const s1   = caster.ssrFavSkills?.skill1;
            const lv   = s1?._activeSkillLevel ?? 0;
            const mult = lv > 0
              ? parseFloat(s1.description_value_list?.[1]?.description_value?.[lv - 1] ?? '47.18') / 100
              : 0.4718;
            const sums = ctx.sums ?? getBuffSums(state, caster.id);
            fireSkillHit(state, caster, mult, sums, false, 'S1_burst_weapon_hit');
          },
        },
      ],
    },

    skill2: {
      groupId: 22812,
      triggers: [
        // [TODO] S2 T1：末弹 → 最高 ATK 3 名敌人嘲讽 4s（无敌人选择/嘲讽模型）
        // [TODO] S2 T2-4：HP 低于 91% 时分阶段提升 MaxHP（无 HP 受伤模型）
        //
        // S2 SSR Fervor：进入全爆裂时，Fervor 状态下 → 全员爆裂冷却 ▼X s（lv10=7.48s）
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            if (!caster.skillState.moranFervorActive) return;
            const s2  = caster.ssrFavSkills?.skill2;
            const lv  = s2?._activeSkillLevel ?? 0;
            const sec = lv > 0
              ? parseFloat(s2.description_value_list?.[9]?.description_value?.[lv - 1] ?? '7.48')
              : 7.48;
            const reductionTicks = Math.round(TICK_RATE * sec);
            for (const u of state.squad)
              u.burstSkillCooldownEndTick = Math.max(state.tick, u.burstSkillCooldownEndTick - reductionTicks);
            if (state.buffLog)
              state.buffLog.push({ type: 'cd_reduction', tick: state.tick,
                name: 'moran_s2_fervor_cdReduction', unitId: null, reductionTicks });
          },
        },
      ],
    },

    burst: {
      groupId: 12813,
      triggers: [
        // Burst（Fair and Square!）— 自身：
        //   武器替换 10s（hitMult lv10=14.7%）+ 无限弹药 10s
        //   生命偷取 X%（lv10=36.14%）10s
        //   S1 Fervor 效果：使用后自身爆裂冷却 ▼20s（param[3] 常量）
        // 全员（SSR）：ATK flat ▲ X% Moran ATK 10s（lv10=42.57%）
        // 全员（未建模）：承伤 ▼X% 10s；DEF ▲X% Moran DEF 10s（防御性，对 DPS 无影响）
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const burstSkill = caster.ssrFavSkills?.burst;
            const lv         = burstSkill?._activeSkillLevel ?? 0;
            const dvl        = burstSkill?.description_value_list ?? [];
            const hitMult = lv > 0 ? parseFloat(dvl[0]?.description_value?.[lv - 1] ?? '14.7')  / 100 : 0.147;
            const lsPct   = lv > 0 ? parseFloat(dvl[1]?.description_value?.[lv - 1] ?? '36.14') / 100 : 0.3614;
            const atkPct  = lv > 0 ? parseFloat(dvl[8]?.description_value?.[lv - 1] ?? '0')     / 100 : 0;
            const end10   = state.tick + TICK_RATE * 10;

            // 武器替换 + 无限弹药（直接写入 skillState，与 WEAPON_SWITCH effect 等价）
            caster.skillState.weaponSwitchHitMult       = hitMult;
            caster.skillState.weaponSwitchType          = null;
            caster.skillState.weaponSwitchEndTick       = end10;
            caster.skillState.weaponSwitchRoundsLeft    = 0;
            caster.skillState.weaponSwitchUnlimitedAmmo = true;

            // 生命偷取（自身）
            pushBuff(state, { name: 'moran_burst_lifeSteal', unitId: caster.id,
              lifeStealPct: lsPct, endTick: end10 });

            // 全员 ATK flat 加成（SSR 专属；无 SSR 时 atkPct=0 不推送）
            if (atkPct > 0)
              pushBuff(state, { name: 'moran_burst_atkFlat', unitId: null,
                atkFlat: Math.round(caster.stats.atk * atkPct), endTick: end10 });

            // S1 Fervor：爆裂使用后立即减少自身冷却 20s（param[3] 常量）
            const s1   = caster.ssrFavSkills?.skill1;
            const s1Lv = s1?._activeSkillLevel ?? 0;
            if (s1Lv > 0 && caster.skillState.moranFervorActive) {
              const fervorSec   = parseFloat(s1.description_value_list?.[3]?.description_value?.[s1Lv - 1] ?? '20');
              const fervorTicks = Math.round(TICK_RATE * fervorSec);
              caster.burstSkillCooldownEndTick = Math.max(state.tick, caster.burstSkillCooldownEndTick - fervorTicks);
              if (state.buffLog)
                state.buffLog.push({ type: 'cd_reduction', tick: state.tick,
                  name: 'moran_s1_fervor_cdReduction', unitId: caster.id, reductionTicks: fervorTicks });
            }
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 330 · Crown（B2 · MG）
  // ══════════════════════════════════════════════════════════════════════════
  330: {
    skill1: {
      groupId: 23301,
      triggers: [
        // S1（One for All）：进入全爆裂 → 按本轮爆裂施放状态分组 15s
        //   施放者：ATK flat ▲64.51% Crown ATK + Reload Speed ▲44.35%
        //   未施放者：DEF flat ▲37.44% Crown DEF + Reload Speed ▲44.35%
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            const ids    = state.burstCastersThisRotation;
            const endTick = state.tick + TICK_RATE * 15;
            for (const u of state.squad) {
              if (ids.has(u.id)) {
                pushBuff(state, { name: 'crown_skill1_atkFlat',  unitId: u.id, atkFlat: Math.round(caster.stats.atk * 0.6451), endTick });
              } else {
                pushBuff(state, { name: 'crown_skill1_defFlat',  unitId: u.id, defFlat: Math.round(caster.stats.def * 0.3744), endTick });
              }
              pushBuff(state, { name: 'crown_skill1_reloadSpd', unitId: u.id, reloadSpeedPct: 0.4435, endTick });
            }
          },
        },
      ],
    },

    skill2: {
      groupId: 23302,
      triggers: [
        // S2（Guardian / Relax）：每 43 发 +1 层（上限 20）
        // 满 20 层：Crown 自身回复 5.23% HP；全员 Attack Damage ▲20.99% 7s
        {
          on: 'SHOT_COUNT',
          opts: { every: 43, counterKey: 'crownShotCount' },
          handler(state, caster) {
            caster.skillState.crownRelaxStacks = (caster.skillState.crownRelaxStacks ?? 0) + 1;
            if (caster.skillState.crownRelaxStacks < 20) return;
            caster.skillState.crownRelaxStacks = 0;
            applyHeal(state, caster, Math.round(caster.stats.hp * 0.0523));
            pushBuff(state, { name: 'crown_skill2_attackDmg', unitId: null,
              attackDamagePct: 0.2099, endTick: state.tick + TICK_RATE * 7 });
          },
        },
        // S2 HEAL_RECEIVED：Crown 自身受到治疗时 → 全员 Attack Damage ▲20.99% 7s
        // 与满层触发共用 buff name；pushBuff 刷新语义保证不叠加
        {
          on: 'HEAL_RECEIVED',
          handler(state, caster, ctx) {
            if (ctx.unit?.id !== caster.id) return;
            pushBuff(state, { name: 'crown_skill2_attackDmg', unitId: null,
              attackDamagePct: 0.2099, endTick: state.tick + TICK_RATE * 7 });
          },
        },
      ],
    },

    burst: {
      groupId: 13303,
      triggers: [
        // Burst（Last Kingdom）：
        //   全员 Attack Damage ▲36.24% 15s
        //   全员护盾 10.45% Crown HP 15s（刷新取 max(旧, 新)）
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            pushBuff(state, { name: 'crown_burst_attackDmg', unitId: null,
              attackDamagePct: 0.3624, endTick: state.tick + TICK_RATE * 15 });
            const shieldAmt = Math.round(caster.stats.hp * 0.1045);
            const shieldEnd = state.tick + TICK_RATE * 15;
            for (const u of state.squad) {
              if (u.shieldHp > 0) {
                u.shieldHp      = Math.max(u.shieldHp, shieldAmt);
                u.shieldEndTick = Math.max(u.shieldEndTick, shieldEnd);
              } else {
                u.shieldHp = shieldAmt; u.shieldEndTick = shieldEnd;
              }
            }
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 352 · Helm（B3 · SR）
  // ══════════════════════════════════════════════════════════════════════════
  352: {
    skill1: {
      groupId: 23521,
      triggers: [
        // S1（Frontline Command）：末弹 → 全员 Crit Rate ▲X% 5s（SSR fav 数值）
        {
          on: 'LAST_BULLET',
          handler(state, caster) {
            const helmS1 = caster.ssrFavSkills?.skill1;
            const s1Lv   = helmS1?._activeSkillLevel ?? 0;
            const crVals = helmS1?.description_value_list?.[0]?.description_value ?? [];
            const critBonus = s1Lv > 0 ? parseFloat(crVals[s1Lv - 1] ?? '14.64') / 100 : 0.1464;
            pushBuff(state, { name: 'helm_skill1_critRate', unitId: null,
              critRateBonus: critBonus, endTick: state.tick + TICK_RATE * 5 });
          },
        },
        // S1 SSR：全蓄力命中 → 全员 HP 回复（dvl[2]） + 全队共享爆裂槽增加（dvl[3]）
        {
          on: 'FULL_CHARGE',
          handler(state, caster) {
            const helmS1 = caster.ssrFavSkills?.skill1;
            const s1Lv   = helmS1?._activeSkillLevel ?? 0;
            if (s1Lv <= 0) return;
            const hpVals = helmS1.description_value_list?.[2]?.description_value ?? [];
            const bgVals = helmS1.description_value_list?.[3]?.description_value ?? [];
            const hpPct  = parseFloat(hpVals[s1Lv - 1] ?? '0') / 100;
            const bgPct  = parseFloat(bgVals[s1Lv - 1] ?? '0') / 100;
            if (hpPct > 0) {
              const hpGain = Math.round(caster.stats.hp * hpPct);
              // 全员治疗；HEAL_RECEIVED 触发由 battle.js 中 applyHeal 后调用 executeSkillTriggers 覆盖
              for (const u of state.squad) applyHeal(state, u, hpGain);
            }
            if (bgPct > 0)
              addBurstGauge(state, caster.name, 'helm_s1_gaugeBoost', Math.round(bgPct * BURST_GAUGE_MAX));
          },
        },
      ],
    },

    skill2: {
      groupId: 23522,
      triggers: [
        // S2（Fire Away）：进入全爆裂 → 全员 Attack Damage ▲X% 10s（SSR fav 数值）
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            const helmS2    = caster.ssrFavSkills?.skill2;
            const s2Lv      = helmS2?._activeSkillLevel ?? 0;
            const s2AtkVals = helmS2?.description_value_list?.[1]?.description_value ?? [];
            const atkDmgPct = s2Lv > 0 ? parseFloat(s2AtkVals[s2Lv - 1] ?? '27.87') / 100 : 0.2787;
            pushBuff(state, { name: 'helm_skill2_attackDmg', unitId: null,
              attackDamagePct: atkDmgPct, endTick: state.tick + TICK_RATE * 10 });
          },
        },
        // S2 SSR：全蓄力命中 → 额外技能伤害（dvl[3]） + Helm 爆裂槽增加
        {
          on: 'FULL_CHARGE',
          handler(state, caster, ctx) {
            const helmS2 = caster.ssrFavSkills?.skill2;
            const s2Lv   = helmS2?._activeSkillLevel ?? 0;
            if (s2Lv <= 0) return;
            const exVals = helmS2.description_value_list?.[3]?.description_value ?? [];
            const exMult = parseFloat(exVals[s2Lv - 1] ?? '0') / 100;
            if (exMult <= 0) return;
            const sums = ctx.sums ?? getBuffSums(state, caster.id);
            fireSkillHit(state, caster, exMult, sums, false);
            addBurstGauge(state, caster.name, 'helm_s2_skill', caster.burstEnergyPerShot);
          },
        },
      ],
    },

    burst: {
      groupId: 13523,
      triggers: [
        // Burst（Aegis Cannon）：SSR 伤害 + 生命偷取 10s + 蓄力伤害 buff for 10 round(s)
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const helmBurst = caster.ssrFavSkills?.burst;
            const bLv       = helmBurst?._activeSkillLevel ?? 0;
            const bDmgVals  = helmBurst?.description_value_list?.[0]?.description_value ?? [];
            const lsVals    = helmBurst?.description_value_list?.[1]?.description_value ?? [];
            const cdVals    = helmBurst?.description_value_list?.[3]?.description_value ?? [];
            const burstMult = bLv > 0 ? parseFloat(bDmgVals[bLv - 1] ?? '8236.8') / 100 : 82.368;
            const lsPct     = bLv > 0 ? parseFloat(lsVals[bLv - 1]   ?? '54.45')  / 100 : 0.5445;
            const cdPct     = bLv > 0 ? parseFloat(cdVals[bLv - 1]   ?? '158.4')  / 100 : 1.584;
            const sums      = getBuffSums(state, caster.id);
            fireSkillHit(state, caster, burstMult, sums, false);
            pushBuff(state, { name: 'helm_burst_heal', unitId: null,
              lifeStealPct: lsPct, endTick: state.tick + TICK_RATE * 10 });
            // round-based buff：for 10 round(s)，每次全蓄力自动消耗，无时间上限
            if (cdPct > 0)
              pushBuff(state, { name: 'helm_burst_chargeDmg', unitId: caster.id,
                chargeDamagePct: cdPct, endTick: Infinity, endRounds: 10 });
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 354 · Mast: Romantic Maid（B2 · MG）
  // ══════════════════════════════════════════════════════════════════════════
  354: {
    skill1: {
      groupId: 23541,
      triggers: [
        // S1（A Pirate's Heart）：进入爆裂阶段 1 → Drunken 层数 +1（上限 3）
        // 首层时推送全员永久 buff：Crit Rate ▲20.05% + ATK flat ▲35.02% Mast ATK
        {
          on: 'ENTER_BURST_I',
          handler(state, caster) {
            if (caster.skillState.mastDrunkenStacks >= 3) return;
            caster.skillState.mastDrunkenStacks++;
            if (caster.skillState.mastDrunkenStacks === 1) {
              pushBuff(state, { name: 'mast_s1_critRate', derivedFrom: 'mast_drunken',
                unitId: null, critRateBonus: 0.2005, endTick: Infinity });
              pushBuff(state, { name: 'mast_s1_atkFlat', derivedFrom: 'mast_drunken',
                unitId: null, atkFlat: Math.round(caster.stats.atk * 0.3502), endTick: Infinity });
            }
            const drunken = state.buffs.find(b => b.name === 'mast_drunken');
            if (drunken) {
              drunken.stackCount = caster.skillState.mastDrunkenStacks;
            } else {
              state.buffs.push({ name: 'mast_drunken', unitId: caster.id, isDebuff: true,
                stackCount: caster.skillState.mastDrunkenStacks, stackLimit: 3, endTick: Infinity });
            }
          },
        },
      ],
    },

    skill2: {
      groupId: 23542,
      triggers: [
        // S2（A Pirate's Spirit）：进入爆裂阶段 3 时（B3 施放前），Drunken ≥1 层时
        //   全员 Distributed Damage ▲15.03%×stacks + Reload Speed ▲15.04%×stacks 10s
        {
          on: 'ENTER_BURST_III',
          handler(state, caster) {
            const stacks = caster.skillState.mastDrunkenStacks;
            if (stacks <= 0) return;
            const end10 = state.tick + TICK_RATE * 10;
            pushBuff(state, { name: 'mast_s2_distributedDmg', unitId: null,
              distributedDamagePct: 0.1503 * stacks, endTick: end10 });
            pushBuff(state, { name: 'mast_s2_reloadSpd', unitId: null,
              reloadSpeedPct: 0.1504 * stacks, endTick: end10 });
          },
        },
        // S2 Hangover：全爆裂结束，stacks = 3 → 眩晕自身 10s + 层数归零 + S1 被动移除
        {
          on: 'FULL_BURST_END',
          handler(state, caster) {
            if (caster.skillState.mastDrunkenStacks < 3) return;
            caster.skillState.mastHangoverEndTick = state.tick + TICK_RATE * 10;
            caster.skillState.mastDrunkenStacks   = 0;
            state.buffs = state.buffs.filter(b => b.name !== 'mast_drunken' && b.derivedFrom !== 'mast_drunken');
          },
        },
      ],
    },

    burst: {
      groupId: 13543,
      triggers: [
        // Burst（A Pirate's Romance）：
        //   全员 Crit Dmg ▲40.04% + Attack Dmg ▲15.04% 10s（无条件）
        //   若 Drunken ≥1：全员 ATK flat ▲20.06%×stacks×Mast.atk 10s
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const end10 = state.tick + TICK_RATE * 10;
            pushBuff(state, { name: 'mast_burst_critDmg',   unitId: null, critDmgBonus:    0.4004, endTick: end10 });
            pushBuff(state, { name: 'mast_burst_attackDmg', unitId: null, attackDamagePct: 0.1504, endTick: end10 });
            const stacks = caster.skillState.mastDrunkenStacks;
            if (stacks > 0)
              pushBuff(state, { name: 'mast_burst_atkFlat', unitId: null,
                atkFlat: Math.round(caster.stats.atk * 0.2006 * stacks), endTick: end10 });
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 355 · Anchor: Innocent Maid（B2 · RL）
  // ══════════════════════════════════════════════════════════════════════════
  355: {
    skill1: {
      groupId: 23551,
      triggers: [
        // S1 Part 1（Starfish Omurice）："前效重复触发"，每次进入全爆裂：
        //   [TODO] 第 1 次+：HP 回复效能 ▲30.96% 5s（全员）— 待治疗系统实现
        //   第 2 次+：Distributed Damage ▲30.40% 10s（全员）
        //   第 3 次+：移除 1 层 Mast Drunken（防 Hangover；仅移除 isDebuff:true 且 stackLimit>1 的堆叠 buff）
        // 同一部队条件（Anchor + Mast 同队）在当前阵容中恒满足，注释保留
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            caster.skillState.anchorFbCount++;
            const cnt = caster.skillState.anchorFbCount;
            if (cnt >= 2) pushBuff(state, { name: 'anchor_s1_t2_distributedDmg', unitId: null,
              distributedDamagePct: 0.3040, endTick: state.tick + TICK_RATE * 10 });
            if (cnt >= 3) {
              const stackedBuff = state.buffs.find(b => b.isDebuff === true && (b.stackLimit ?? 0) > 1 && (b.stackCount ?? 0) > 0);
              if (stackedBuff) {
                stackedBuff.stackCount--;
                if (stackedBuff.name === 'mast_drunken') {
                  const mastUnit = state.squad.find(u => u.id === stackedBuff.unitId);
                  if (mastUnit) mastUnit.skillState.mastDrunkenStacks = stackedBuff.stackCount;
                }
                if (stackedBuff.stackCount === 0)
                  state.buffs = state.buffs.filter(b => b !== stackedBuff && b.derivedFrom !== stackedBuff.name);
              }
            }
          },
        },
        // S1 Part 2：进入全爆裂，同 squad 队员在阵时 → 自身 HP 回复 3.04%/s × 8s（8 次 HoT）
        // 条件读取 CHARACTER_TRAITS.squad 字段（CDN squad 字段）
        {
          on: 'ENTER_FULL_BURST',
          handler(state, caster) {
            const mySquad = getCharacterTraits(caster.id)?.squad;
            if (!mySquad) return;
            const hasSquadMate = state.squad.some(u =>
              u.id !== caster.id && getCharacterTraits(u.id)?.squad === mySquad);
            if (!hasSquadMate) return;
            const ticksPerSec = TICK_RATE;
            const amount = Math.round(caster.stats.hp * 0.0304);
            for (let i = 1; i <= 8; i++) {
              state.pendingHoTs.push({ fireTick: state.tick + i * ticksPerSec, targetId: caster.id, amount });
            }
          },
        },
      ],
    },

    skill2: {
      groupId: 23552,
      triggers: [
        // S2（Sea Anemone Pasta）："前效重复触发"，每次全爆裂结束：
        //   第 1 次+：Hit Rate ▲10.13% 10s（全员）
        //   第 2 次+：ATK flat ▲35.02% Anchor ATK 10s（全员）
        //   第 3 次+：Reload Speed ▲40.04% 15s（全员）
        {
          on: 'FULL_BURST_END',
          handler(state, caster) {
            const cnt  = caster.skillState.anchorFbCount;
            const end10 = state.tick + TICK_RATE * 10;
            const end15 = state.tick + TICK_RATE * 15;
            if (cnt >= 1) pushBuff(state, { name: 'anchor_s2_t1_hitRate',   unitId: null, hitRateBonus: 0.1013, endTick: end10 });
            if (cnt >= 2) pushBuff(state, { name: 'anchor_s2_t2_atkFlat',   unitId: null, atkFlat: Math.round(caster.stats.atk * 0.3502), endTick: end10 });
            if (cnt >= 3) pushBuff(state, { name: 'anchor_s2_t3_reloadSpd', unitId: null, reloadSpeedPct: 0.4004, endTick: end15 });
          },
        },
      ],
    },

    burst: {
      groupId: 13553,
      triggers: [
        // Burst（Seaside Stroll）：全员 ATK flat ▲30.09% Anchor ATK 10s
        //   + 全员立即 HP 回复 40.18% caster max HP
        //   [TODO: 过量治疗储存 60.19%×MaxHP 25s 未建模]
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            pushBuff(state, { name: 'anchor_burst_atkFlat', unitId: null,
              atkFlat: Math.round(caster.stats.atk * 0.3009), endTick: state.tick + TICK_RATE * 10 });
            const healAmt = Math.round(caster.stats.hp * 0.4018);
            for (const u of state.squad) applyHeal(state, u, healAmt);
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 511 · Cinderella（B3 · RL · Pilgrim · Electric）
  // ══════════════════════════════════════════════════════════════════════════
  511: {
    skill1: {
      groupId: 25111,
      triggers: [
        // S1 Part1（Flawless Glass）：进入爆裂阶段 3 → 自身 ATK flat ▲2.71% 最终 MaxHP 10s
        // 最终 MaxHP 包含所有来源的 maxHpPct 加成（含外部 buff）
        {
          on: 'ENTER_BURST_III',
          handler(state, caster) {
            const sums    = getBuffSums(state, caster.id);
            const finalHp = caster.stats.hp * (1 + sums.maxHpPct);
            const atkFlat = Math.round(finalHp * 0.0271);
            const endTick = state.tick + TICK_RATE * 10;
            const existing = state.buffs.find(b => b.name === 'cinderella_s1_atkFlat' && b.unitId === caster.id);
            if (existing) { existing.atkFlat = atkFlat; existing.endTick = endTick; }
            else pushBuff(state, { name: 'cinderella_s1_atkFlat', unitId: caster.id, atkFlat, endTick });
          },
        },
        // S1 Part2：全蓄力攻击 → 自身 Charge Speed ▲100%（自然装填到满后移除）
        {
          on: 'FULL_CHARGE',
          handler(state, caster) {
            pushBuff(state, { name: 'cinderella_s1_chargeSpd', unitId: caster.id,
              chargeSpeedPct: 1.0, endTick: Infinity });
          },
        },
        {
          on: 'RELOAD_END',
          handler(state, caster) {
            state.buffs = state.buffs.filter(b =>
              !(b.name === 'cinderella_s1_chargeSpd' && b.unitId === caster.id));
          },
        },
        // S1 Part3：全蓄力命中 → 136.6% ATK 附加技能伤害，同时附加对应充能
        {
          on: 'FULL_CHARGE',
          handler(state, caster, ctx) {
            if (state.enemyHp <= 0) return;
            const sums = ctx.sums ?? getBuffSums(state, caster.id);
            fireSkillHit(state, caster, 1.366, sums, false, 'S1_fc_bonus');
            addBurstGauge(state, caster.name, 'S1_fc_bonus', caster.burstEnergyPerShot ?? 0);
          },
        },
      ],
    },

    skill2: {
      groupId: 25112,
      triggers: [
        // S2（Dirt-Resistant Mirror）：战斗开始 + 进入爆裂阶段 3 → 创建诱饵替身（96% MaxHP，持续）
        {
          on: 'BATTLE_START',
          handler(state, caster) { caster.skillState.cinderellaDecoyActive = true; },
        },
        {
          on: 'ENTER_BURST_III',
          handler(state, caster) { caster.skillState.cinderellaDecoyActive = true; },
        },
        // 诱饵存在时每 3s Beautiful +1 层（上限 12），每层永久 MaxHP ▲1.6%
        // Beautiful 层数存于 cinderellaBeautyStacks；maxHpPct 写入 buff 使 getBuffSums 可聚合
        {
          on: 'INTERVAL',
          opts: { seconds: 3 },
          handler(state, caster) {
            if (!caster.skillState.cinderellaDecoyActive) return;
            if ((caster.skillState.cinderellaBeautyStacks ?? 0) >= 12) return;
            caster.skillState.cinderellaBeautyStacks = (caster.skillState.cinderellaBeautyStacks ?? 0) + 1;
            const stacks = caster.skillState.cinderellaBeautyStacks;
            const beautyBuff = state.buffs.find(b => b.name === 'cinderella_beautiful' && b.unitId === caster.id);
            if (beautyBuff) { beautyBuff.maxHpPct = stacks * 0.016; }
            else state.buffs.push({ name: 'cinderella_beautiful', unitId: caster.id,
              maxHpPct: stacks * 0.016, endTick: Infinity });
          },
        },
      ],
    },

    burst: {
      groupId: 15113,
      triggers: [
        // Burst（Glass Slippers. Full Contact.）：
        //   S3 Part1：10 × 1365.92% ATK 爆裂技能伤害（不享受全爆裂补正）
        //   S3 Part2：每次 Part1 命中后触发 Beautiful层数 × 28.9% 附加伤害（可享受全爆裂补正）
        //             使用 sums:null 以在 ENTER_FULL_BURST 之后重算 buff 汇总
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const sums   = getBuffSums(state, caster.id);
            const stacks = caster.skillState.cinderellaBeautyStacks ?? 0;
            for (let i = 0; i < 10 && state.enemyHp > 0; i++) {
              fireSkillHit(state, caster, 13.6592, sums, false, 'burst_seq',
                { burstSkillDamage: true });
              if (stacks > 0) {
                state.pendingFireInBurstHits.push({
                  caster, mult: stacks * 0.289, sums: null,
                  isCharged: false, label: 'burst_beautiful', opts: {},
                });
              }
            }
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 513 · Little Mermaid（B1 · SMG）
  // ══════════════════════════════════════════════════════════════════════════
  513: {
    skill1: {
      groupId: 25131,
      triggers: [
        // S1 T1 Bubble Order：进入全爆裂 → 全员 Attack Damage ▲4% 10s
        {
          on: 'ENTER_FULL_BURST',
          target: 'ALL_ALLIES',
          effects: [{ type: 'BUFF_GLOBAL', name: 'lm_skill1_attackDmg', stat: { attackDamagePct: 0.04 }, duration: 10 }],
        },
        // S1：全爆裂结束 → 全员爆裂冷却 ▼7.48s
        {
          on: 'FULL_BURST_END',
          effects: [{ type: 'REDUCE_BURST_CD', target: 'ALL_ALLIES', seconds: 7.48, label: 'lm_s1_cdReduction' }],
        },
        // S1：每 400 发全队弹药 → 共享爆裂槽 ▲37%
        {
          on: 'AMMO_MILESTONE',
          handler(state, caster, ctx) {
            if (!ctx.milestone400) return;
            addBurstGauge(state, caster.name, 'lm_s1_gaugeBoost', Math.round(0.37 * BURST_GAUGE_MAX));
          },
        },
      ],
    },

    skill2: {
      groupId: 25132,
      triggers: [
        // S2 Bubble：战斗开始 → 敌人承伤 ▲5.05%（持续）
        // 注：Boss 战中"敌人出现时"与"战斗开始时"视为同一时机，合并处理
        {
          on: 'BATTLE_START',
          handler(state, caster) {
            state.enemyDamageTakenPct += 0.0505;
          },
        },
        // S2 Explosive Bubble：累计 50 发（LM 自身）→ 状态标记切换（承伤值不变）
        {
          on: 'SHOT_COUNT',
          opts: { every: 50, counterKey: 'lmShotCount' },
          handler(state, caster) {
            if (!caster.skillState.lmExplosiveBubble) {
              caster.skillState.lmExplosiveBubble = true;
              // enemyDamageTakenPct 不变；仅内部标记切换（Bubble → Explosive Bubble）
            }
          },
        },
        // S2 Bubble Wave：全爆裂期间每 1 秒 → 4×63.36% ATK 技能伤害
        // HIDDEN 期间也触发（Bubble Wave 不需瞄准）
        {
          on: 'INTERVAL_IN_BURST',
          opts: { seconds: 1 },
          target: 'ENEMY',
          effects: [{ type: 'SKILL_DAMAGE', count: 4, mult: 0.6336, isCharged: false, label: 'S2_bubble_wave' }],
        },
        // S2 Barrage：每 500 发全队弹药 → 爆裂弹幕 10×85% ATK
        {
          on: 'AMMO_MILESTONE',
          handler(state, caster, ctx) {
            if (!ctx.milestone500) return;
            const sums = getBuffSums(state, caster.id);
            for (let h = 0; h < 10 && state.enemyHp > 0; h++) {
              fireSkillHit(state, caster, 0.85, sums, false, 'S2_barrage');
            }
          },
        },
      ],
    },

    burst: {
      groupId: 15133,
      triggers: [
        // Burst（Siren's Song）：
        //   全员 Attack Damage ▲10.13% 10s
        //   全员补弹 33.26% maxAmmo（补满时取消装填）
        //   自身 ATK flat ▲17.28% LM.atk 10s
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const end10 = state.tick + TICK_RATE * 10;
            pushBuff(state, { name: 'lm_burst_attackDmg', unitId: null, attackDamagePct: 0.1013, endTick: end10 });
            for (const u of state.squad) {
              const ammoBefore = u.ammoLeft;
              u.ammoLeft = Math.min(u.maxAmmo, u.ammoLeft + Math.floor(u.maxAmmo * 0.3326));
              if (u.ammoLeft >= u.maxAmmo && u.reloadTick > 0) u.reloadTick = 0;
              if (state.ammoLog && u.ammoLeft !== ammoBefore)
                state.ammoLog.push({ tick: state.tick, unitId: u.id, unitName: u.name,
                  delta: u.ammoLeft - ammoBefore, ammoAfter: u.ammoLeft, maxAmmo: u.maxAmmo, source: 'lm_burst_reload' });
            }
            pushBuff(state, { name: 'lm_burst_atkFlat', unitId: caster.id,
              atkFlat: Math.round(caster.stats.atk * 0.1728), endTick: end10 });
          },
        },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 470 · Red Hood（AllStep · SR · Attacker · PILGRIM · Iron）
  //
  // 核心机制：AllStep 爆裂，每次 BURST_SKILL_USE 循环 Step1→2→3
  //   S1 Glaring Eyes (group 24701)
  //     每次全蓄力 → 自身 Charge Speed ▲3.81%（最多 10 层，5s，层数归零前计时刷新）
  //     被动：超出 100% 的蓄力速度 × 240% → Charge Damage（连续，由 updateRhCsConversion 维护）
  //   S2 Wild Tooth (group 24702)
  //     [TODO] 战斗开始：自身 Pierce 持续（穿透机制待敌人设置系统后实现）
  //     Beast Cage 期间：全员 DEF ▲50.68% RH.DEF 10s（TODO: DEF 不影响 DPS）
  //     The Last Howl 期间：自身 HP 回复（TODO: 无 DPS 影响）
  //     施放 Red Wolf 时：自身 ATK ▲71.42% 10s
  //   Burst Red Wolf (group 14703, CD=40s)
  //     Step1 Beast Cage:     全员 ATK flat ▲77.55% RH.ATK 10s
  //                           自身 CD ▼40s（每战一次，rhCdRedUsed1）
  //     Step2 The Last Howl:  自身 Attract 10s（TODO）+ HP 回复增强（TODO）
  //                           自身 CD ▼40s（每战一次，rhCdRedUsed2）
  //     Step3 Red Wolf:       S2 ATK ▲71.42% 10s + Charge Speed ▲100.8% 10s
  //                           武器切换（51.46% ATK · 250% FC · 10s · 无限弹）
  // ══════════════════════════════════════════════════════════════════════════
  470: {
    skill1: {
      groupId: 24701,
      triggers: [
        // S1 Part1（Glaring Eyes）：每次全蓄力 → 自身 Charge Speed ▲3.81%（10层 · 5s）
        // 每新增一层刷新计时；叠层过期后归零重新计数。
        {
          on: 'FULL_CHARGE',
          handler(state, caster) {
            const existing = state.buffs.find(b => b.name === 'rh_s1_chargeSpd' && b.unitId === caster.id);
            const prevStacks = existing ? caster.skillState.rhCsStacks : 0;
            const newStacks  = Math.min(10, prevStacks + 1);
            caster.skillState.rhCsStacks = newStacks;
            const end5 = state.tick + TICK_RATE * 5;
            if (existing) {
              existing.chargeSpeedPct = newStacks * 0.0381;
              existing.endTick = end5;
            } else {
              state.buffs.push({ name: 'rh_s1_chargeSpd', unitId: caster.id,
                chargeSpeedPct: newStacks * 0.0381, endTick: end5 });
            }
            // S1 Part2：更新超量 CS → Charge Damage 转化（与叠层同生命周期）
            updateRhCsConversion(state, caster, end5);
          },
        },
      ],
    },

    skill2: {
      groupId: 24702,
      triggers: [],
      // S2 Part1（Wild Tooth）：战斗开始 → 自身持续 Pierce（TODO: 穿透机制）
      // S2 Part2（Beast Cage）：全员 DEF ▲50.68% RH.DEF 10s（TODO: DEF 不影响 DPS）
      // S2 Part3（The Last Howl）：自身攻击伤害→HP 回复 23.04% 10s（TODO: 无 DPS 影响）
      // S2 Part4（Red Wolf）：自身 ATK ▲71.42% 10s — inline 于 Burst Step3 handler
    },

    burst: {
      groupId: 14703,
      triggers: [
        // AllStep 爆裂：按 rhBurstStep 分发三阶段效果，每次使用后循环推进。
        {
          on: 'BURST_SKILL_USE',
          handler(state, caster) {
            const step  = caster.skillState.rhBurstStep;
            const end10 = state.tick + TICK_RATE * 10;

            if (step === 1) {
              // ─── Beast Cage ───────────────────────────────────────────
              // 全员 ATK flat ▲77.55% RH.ATK 10s
              pushBuff(state, { name: 'rh_burst_bc_atkFlat', unitId: null,
                atkFlat: Math.round(caster.stats.atk * 0.7755), endTick: end10 });
              // 自身 CD ▼40s（每战一次）
              if (!caster.skillState.rhCdRedUsed1) {
                caster.skillState.rhCdRedUsed1 = true;
                caster.burstSkillCooldownEndTick = Math.max(state.tick,
                  caster.burstSkillCooldownEndTick - TICK_RATE * 40);
                if (state.buffLog)
                  state.buffLog.push({ type: 'cd_reduction', tick: state.tick,
                    name: 'rh_bc_cdReduction', unitId: caster.id, reductionTicks: TICK_RATE * 40 });
              }
              // [TODO] S2 Part2：全员 DEF ▲50.68% RH.DEF 10s（DEF 不影响 DPS）

            } else if (step === 2) {
              // ─── The Last Howl ────────────────────────────────────────
              // [TODO] 自身 Attract 10s + HP Recovery Potency ▲62.4% 10s
              // 自身 CD ▼40s（每战一次）
              if (!caster.skillState.rhCdRedUsed2) {
                caster.skillState.rhCdRedUsed2 = true;
                caster.burstSkillCooldownEndTick = Math.max(state.tick,
                  caster.burstSkillCooldownEndTick - TICK_RATE * 40);
                if (state.buffLog)
                  state.buffLog.push({ type: 'cd_reduction', tick: state.tick,
                    name: 'rh_lh_cdReduction', unitId: caster.id, reductionTicks: TICK_RATE * 40 });
              }

            } else {
              // ─── Red Wolf（Step3）────────────────────────────────────
              // S2 Part4：自身 ATK ▲71.42% 10s
              pushBuff(state, { name: 'rh_s2_rw_atkPct', unitId: caster.id,
                atkPct: 0.7142, endTick: end10 });
              // 自身 Charge Speed ▲100.8% 10s
              pushBuff(state, { name: 'rh_burst_rw_chargeSpd', unitId: caster.id,
                chargeSpeedPct: 1.008, endTick: end10 });
              // 武器切换：Damage 51.46% final ATK · FC 250% · 10s · 无限弹
              caster.skillState.weaponSwitchHitMult          = 0.5146;
              caster.skillState.weaponSwitchType             = 'SR';
              caster.skillState.weaponSwitchEndTick          = end10;
              caster.skillState.weaponSwitchChargeTimeTicks  = 0;  // 沿用基础 SR 蓄力时长（受 CS buff 缩减）
              caster.skillState.weaponSwitchFullChargeDamage = 25000; // 250% FC
              caster.skillState.weaponSwitchUnlimitedAmmo    = true;
              // 立即开始蓄力（全爆裂期间首发尽快打出）
              caster.chargeTick = state.tick;
              // 更新 CS 转化 buff（Red Wolf CS buff 现已生效）
              updateRhCsConversion(state, caster, end10);
            }

            // 阶段循环：1→2→3→1
            caster.skillState.rhBurstStep = (step % 3) + 1;
          },
        },
        // Red Wolf 结束后：清理 weaponSwitch 标志 + 重算 CS 转化（Red Wolf CS 已过期）
        {
          on: 'FULL_BURST_END',
          handler(state, caster) {
            // 若 weapon switch 仍在超时范围内则不清理（理论上 10s 内爆裂必已结束）
            if ((caster.skillState.weaponSwitchEndTick ?? 0) <= state.tick) {
              caster.skillState.weaponSwitchEndTick = 0;
            }
            // 重算转化（Red Wolf CS buff 可能已过期）
            updateRhCsConversion(state, caster, state.tick + TICK_RATE * 5);
          },
        },
      ],
    },
  },
};
