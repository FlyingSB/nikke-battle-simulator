import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Calm Depths
  // ■ Activates when entering Full Burst. Affects self.
  // ATK ▲ {description_value_01}% for {description_value_02} sec.
  // ■ Activates when landing Full Charge attacks on a target's core. Affects self.
  // Attack damage ▲ {description_value_03}% for {description_value_04} sec.
  // ■ Activates when landing a Full Charge attack. Affects the target.
  // Deals {description_value_05}% of final ATK as additional damage. Activates 5 times.
  // ■ Activates when entering Full Burst. Affects the {description_value_08} Burst 3 ally unit(s) with the lowest final ATK.
  // Charge Speed ▲ {description_value_06}% of caster's Charge Speed for {description_value_07} sec.
  // p01: [94.54, 101.82, 109.09, 116.36, 123.64, 130.91, 138.18, 145.46, 152.73, 160]
  // p02: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p03: [12.31, 13.26, 14.2, 15.15, 16.1, 17.04, 17.99, 18.94, 19.89, 20.83]
  // p04: [60, 60, 60, 60, 60, 60, 60, 60, 60, 60]
  // p05: [23.93, 25.77, 27.61, 29.46, 31.3, 33.14, 34.98, 36.82, 38.66, 40.5]
  // p06: [7.52, 8.1, 8.68, 9.26, 9.84, 10.42, 11, 11.58, 12.16, 12.74]
  // p07: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p08: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  skill1: {
    groupId: 22621,
    triggers: [
      // S1 T1（Calm Depths）：进入全爆裂 → 自身 ATK ▲[S1 param0]% 3s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const atkPct = getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'lib_s1_t1_atkPct', unitId: caster.id,
            atkPct, endTick: state.tick + TICK_RATE * 3 });
        },
      },
      // S1 T4：进入全爆裂 → ATK 最低的 B3 友军（排除 Lib 自身）蓄力速度减少 [S1 param5]% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const b3Units = state.squad.filter(u => u.burstStep === 'Step3');
          if (!b3Units.length) return;
          const target = b3Units.reduce((a, b) => a.stats.atk < b.stats.atk ? a : b);
          const chargeTimeReductionPct = getSkillValue(caster.rawSkill1, 5, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'lib_s1_t4_chargeSpd', unitId: target.id,
            chargeTimeReductionTicks: Math.round(caster.chargeTimeTicks * chargeTimeReductionPct),
            endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // S1 T2：全蓄力命中核心 → 自身 Attack Damage ▲[S1 param2]% 60s（刷新）
      {
        on: 'FULL_CHARGE',
        conditions: [{ type: 'IS_CORE_HIT' }],
        handler(state, caster) {
          const attackDmgPct = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'lib_s1_t2_attackDmg', unitId: caster.id,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 60 });
        },
      },
      // S1 T3：全蓄力命中 → 5×[S1 param4]% ATK 技能伤害 + 为 Lib 补充爆裂槽
      {
        on: 'FULL_CHARGE',
        handler(state, caster, ctx) {
          const sums    = ctx.sums ?? getBuffSums(state, caster.id);
          const skillMult = getSkillValue(caster.rawSkill1, 4, caster.skillLevels[0]) / 100;
          for (let h = 0; h < 5 && state.enemyHp > 0; h++) {
            fireSkillHit(state, caster, skillMult, sums, false, 'S1_t3_skill', { isCore: false });
            addBurstGauge(state, caster.name, 'lib_s1_t3_skill', caster.targetBurstEnergyPerShot);
          }
        },
      },
    ],
  },

  // ── Strange Currents
  // ■ Activates when landing a Full Charge attack against the stage target. Affects self.
  // Raging Current: Attack Damage ▲ {description_value_01}% continuously.
  // Removes Gentle Current.
  // ■ Activates when landing a Full Charge attack against a Rapture that is not the stage target. Affects self.
  // Gentle Current: Fixes charge time at {description_value_02} sec continuously.
  // Removes Raging Current.
  // ■ Activates at the start of battle. Affects self.
  // Gains immunity to Increase Charge Speed effects. This effect is continuous and cannot be removed.
  // Gains immunity to Decrease Charge Speed effects. This effect is continuous and cannot be removed.
  // p01: [136.5, 147, 157.5, 168, 178.5, 189, 199.5, 210, 220.5, 231]
  // p02: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  skill2: {
    groupId: 22622,
    triggers: [
      // S2（Strange Currents）：首次全蓄力命中 → Raging Current：自身 Attack Damage ▲[S2 param0]% 永久
      // "stage target" = Boss 战唯一目标，首发即激活
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (caster.skillState.libRagingCurrentActive) return;
          caster.skillState.libRagingCurrentActive = true;
          const attackDmgPct = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'lib_s2_ragingCurrent', unitId: caster.id,
            attackDamagePct: attackDmgPct, endTick: Infinity });
        },
      },
    ],
  },

  // ── Submerged World
  // ■ Affects self.
  // Attack Damage ▲ {description_value_01}% for {description_value_02} sec.
  // ■ Affects all enemies.
  // Deals {description_value_03}% of final ATK as additional damage.
  // p01: [29.54, 31.82, 34.09, 36.36, 38.64, 40.91, 43.18, 45.45, 47.73, 50]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [546.59, 588.63, 630.68, 672.72, 714.77, 756.82, 798.86, 840.91, 882.95, 925]
  burst: {
    groupId: 12623,
    triggers: [
      // Burst（Submerged World）：自身 Attack Damage ▲[Burst param0]% 10s
      //   + 延迟 0.97s 后 [Burst param2]% ATK 技能伤害（【已实测】非默认：受全爆裂补正，sums 在命中时重算获取 ENTER_FULL_BURST buff）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const attackDmgPct = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const burstMult    = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'lib_burst_attackDmg', unitId: caster.id,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 10 });
          state.pendingSkillHits.push({
            fireTick: state.tick + Math.round(0.97 * TICK_RATE),
            caster, mult: burstMult, isCharged: false, label: 'burst', opts: { affectedByFullBurst: true },
          });
        },
      },
    ],
  },
};
