import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Hypocrisy
  // ■ Activates at the start of battle. Affects self.
  // Unchanging Heart: Gain Indomitability for {description_value_01} sec. Activates {description_value_02} time(s) during battle.
  // ■ Activates when Memory Absorption takes effect. Affects all allies.
  // Damage dealt when attacking core ▲ {description_value_03}% for {description_value_04} sec.
  // ATK ▲ {description_value_05}% of caster's ATK for {description_value_06} sec.
  // Equally shares HP recovery for {description_value_04} sec.
  // ■ Activates when Memory Absorption takes effect. Affects self.
  // Recovers {description_value_08}% of caster's final Max HP as HP.
  // ■ Activates when attacking with Full Charge while in Memory Incineration status. Affects all enemies.
  // Deals {description_value_07}% of final ATK as damage.
  // ■ Affects the enemy if the enemy is the stage target.
  // Deals {description_value_10}% of final ATK as additional damage.
  // p01: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9]
  // p02: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p03: [15.72, 16.77, 17.82, 18.86, 19.91, 20.96, 22.01, 23.06, 24.11, 25.15]
  // p04: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p05: [17.82, 19.19, 20.56, 21.93, 23.3, 24.67, 26.04, 27.42, 28.79, 30.16]
  // p06: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p07: [88.46, 95.27, 102.08, 108.88, 115.69, 122.49, 129.3, 136.1, 142.91, 150]
  // p08: [14.77, 15.91, 17.05, 18.18, 19.32, 20.46, 21.6, 22.73, 23.87, 25]
  // p10: [221.86, 238.93, 256, 273.06, 290.13, 307.2, 324.26, 341.33, 358.4, 380.46]
  skill1: {
    groupId: 22231,
    triggers: [
      // S1 Part1: Indomitability — 战斗开始 9s HP 不低于 1（1次/战）
      {
        on: 'BATTLE_START',
        logTargets: 'SELF',
        handler(state, caster) {
          caster.skillState.nayutaIndomitabilityEndTick = state.tick + TICK_RATE * 9;
        },
      },
      // S1 Part3: Memory Incineration 期间全蓄力攻击 → 全体 p07% + 舞台目标额外 p10%
      {
        on: 'FULL_CHARGE',
        logTargets: null,
        handler(state, caster, ctx) {
          if ((caster.skillState.weaponSwitchEndTick ?? 0) <= 0 ||
              state.tick > caster.skillState.weaponSwitchEndTick) return;
          const sums    = ctx.sums ?? getBuffSums(state, caster.id);
          const allMult = getSkillValue(caster.rawSkill1, 6, caster.skillLevels[0]) / 100;
          if (state.enemyHp > 0) fireSkillHit(state, caster, allMult, sums, false, 'S1');
          if (state.isStageTarget && state.enemyHp > 0) {
            const stageMult = getSkillValue(caster.rawSkill1, 9, caster.skillLevels[0]) / 100;
            fireSkillHit(state, caster, stageMult, sums, false, 'S1 Boss');
          }
        },
      },
    ],
  },

  // ── Impermanence
  // ■ Activates every {description_value_01} sec. Affects self.
  // Memory Absorption: Hit Rate ▲ {description_value_09}%, stacks up to {description_value_02} time(s) and immune to stack count increase or decrease effects continuously. This effect cannot be dispelled.
  // ■ Activates when Memory Absorption takes effect. Affects self.
  // Additional effects triggered according to the stack count of Memory Absorption. Previous effects trigger repeatedly.
  // Stage 1: If Memory Absorption exceeds {description_value_05} stack(s).
  // ATK ▲ {description_value_06}% continuously.
  // Stage 2: If Memory Absorption exceeds {description_value_07} stack(s).
  // Attack Damage ▲ {description_value_08}% continuously.
  // Stage 3: If Memory Absorption exceeds {description_value_03} stack(s).
  // Damage dealt when attacking core ▲ {description_value_04}% continuously.
  // p01: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p02: [30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  // p03: [30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  // p04: [12.44, 13.39, 14.35, 15.31, 16.27, 17.22, 18.18, 19.14, 20.09, 21.05]
  // p05: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
  // p06: [8.98, 9.67, 10.36, 11.05, 11.75, 12.44, 13.13, 13.82, 14.51, 15.2]
  // p07: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p08: [11.98, 12.9, 13.82, 14.74, 15.66, 16.58, 17.51, 18.43, 19.35, 20.27]
  // p09: [0.83, 0.89, 0.96, 1.02, 1.08, 1.15, 1.21, 1.28, 1.34, 1.4]
  skill2: {
    groupId: 22232,
    triggers: [
      {
        on: 'BATTLE_START',
        logTargets: null,
        handler(state, caster) {
          caster.skillState.nayutaMemAbsStacks = 0;
        },
      },
      // S2 Impermanence — Memory Absorption 每 3s 触发（首次 t=3s）
      // 同步执行 S1 Part2 ally buffs（每次生效均刷新，含满层后）
      {
        on: 'INTERVAL',
        partOverride: 0,
        opts: { seconds: 3 },
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          // S1 Part2：每次 Memory Absorption 生效 → 全员 5s buff + 自身治疗
          const end5        = state.tick + TICK_RATE * 5;
          const coreDmgPct  = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          const atkFlatPct  = getSkillValue(caster.rawSkill1, 4, caster.skillLevels[0]) / 100;
          const healPct     = getSkillValue(caster.rawSkill1, 7, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'nayuta_s1_coreDmg', unitId: null,
            coreDamagePct: coreDmgPct, endTick: end5 });
          pushBuff(state, { name: 'nayuta_s1_atkFlat', unitId: null,
            atkFlat: Math.round(caster.stats.atk * atkFlatPct), endTick: end5 });
          applyHeal(state, caster, Math.round(caster.stats.hp * healPct));

          // 层数上限 30；满层后 S1 Part2 仍每 3s 刷新
          if (caster.skillState.nayutaMemAbsStacks >= 30) return;
          caster.skillState.nayutaMemAbsStacks++;
          const s = caster.skillState.nayutaMemAbsStacks;

          // Hit Rate 累计值：直接写入已有 buff，因 pushBuff 不更新现有 buff 的数值字段
          const hrPerStack = getSkillValue(caster.rawSkill2, 8, caster.skillLevels[1]) / 100;
          const hrBuff = state.buffs.find(
            b => b.name === 'nayuta_s2_hitRate' && b.unitId === caster.id);
          if (hrBuff) {
            hrBuff.hitRateBonus = s * hrPerStack;
          } else {
            state.buffs.push({ name: 'nayuta_s2_hitRate', unitId: caster.id,
              hitRateBonus: s * hrPerStack, endTick: Infinity });
          }

          // Stage 1: s=2（≥2 层）→ 自身 ATK ▲[S2 param5]%（永久，仅首次推送）
          if (s === 2) {
            const stage1AtkPct = getSkillValue(caster.rawSkill2, 5, caster.skillLevels[1]) / 100;
            pushBuff(state, { name: 'nayuta_s2_stage1_atkPct', unitId: caster.id,
              atkPct: stage1AtkPct, endTick: Infinity });
          }

          // Stage 2: s=10（≥10 层）→ 自身 Attack Damage ▲[S2 param7]%（永久）
          if (s === 10) {
            const stage2AtkDmgPct = getSkillValue(caster.rawSkill2, 7, caster.skillLevels[1]) / 100;
            pushBuff(state, { name: 'nayuta_s2_stage2_attackDmg', unitId: caster.id,
              attackDamagePct: stage2AtkDmgPct, endTick: Infinity });
          }

          // Stage 3: s=30（=30 层）→ 自身 Core Damage ▲[S2 param3]%（永久）
          if (s === 30) {
            const stage3CoreDmgPct = getSkillValue(caster.rawSkill2, 3, caster.skillLevels[1]) / 100;
            pushBuff(state, { name: 'nayuta_s2_stage3_coreDmg', unitId: caster.id,
              coreDamagePct: stage3CoreDmgPct, endTick: Infinity });
          }
        },
      },
    ],
  },

  // ── Asceticism
  // ■ Affects all allies.
  // Attack Damage ▲ {description_value_01}% for {description_value_02} sec.
  // ■ Affects all enemies.
  // Deals {description_value_05}% of final ATK as Burst Skill damage.
  // ■ Affects self.
  // Memory Incineration: Changes the weapon in use:
  // Charge time: Fixed at 1.8 sec
  // Damage: {description_value_03}% of final ATK
  // Full Charge Damage: 250% of Damage
  // Duration: {description_value_04} sec
  // Additional Effect:
  // Unlimited ammunition for {description_value_06} sec.
  // p01: [20.94, 22.55, 24.17, 25.78, 27.39, 29, 30.61, 32.22, 33.83, 35.45]
  // p02: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15]
  // p03: [163.62, 176.21, 188.8, 201.38, 213.97, 226.56, 239.14, 251.73, 264.32, 275.18]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [381.33, 410.66, 440, 469.33, 498.66, 528, 557.33, 586.66, 616, 645.33]
  // p06: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 12233,
    triggers: [
      // Burst（Asceticism）：
      //   1. 全员 Attack Damage ▲35.45% 15s（先推送，Nayuta 直击受益）
      //   2. 645.33% ATK 直击（Burst Skill Damage）
      //   3. Memory Incineration 10s：武器切换为蓄力武器（1.8s/FC，275.18%×250%）
      //      + S1 Part3 由 FULL_CHARGE 触发器追加 530.46%
      // Burst P1（全员）：Attack Damage ▲ 15s
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const attackDmgPct = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'nayuta_burst_attackDmg', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 15 });
        },
      },
      // Burst P2（敌人）：爆裂技能伤害（ATK Dmg buff 已在 P1 生效）
      {
        on: 'BURST_SKILL_USE',
        logTargets: null,
        handler(state, caster) {
          if (state.enemyHp <= 0) return false;
          const sums         = getBuffSums(state, caster.id);
          const burstHitMult = getSkillValue(caster.rawBurst, 4, caster.skillLevels[2]) / 100;
          fireSkillHit(state, caster, burstHitMult, sums, false, 'Burst');
        },
      },
      // Burst P3（自身）：Memory Incineration 武器切换（1.8s/FC，275.18% × 250%）10s
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'SELF',
        handler(state, caster) {
          const chargeTimeTicks     = Math.round(1.8 * TICK_RATE);
          const weaponSwitchHitMult = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          caster.skillState.weaponSwitchHitMult          = weaponSwitchHitMult;
          caster.skillState.weaponSwitchType             = 'SR';
          caster.skillState.weaponSwitchEndTick          = state.tick + TICK_RATE * 10;
          caster.skillState.weaponSwitchChargeTimeTicks  = chargeTimeTicks;
          caster.skillState.weaponSwitchFullChargeDamage = 25000;
          caster.skillState.weaponSwitchUnlimitedAmmo    = true;
          caster.chargeTick = state.tick + chargeTimeTicks;
        },
      },
    ],
  },
};
