import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Scarlet: Black Shadow  (resource_id: 225)
export default {

  // ── Fleetly Fading: Breakthrough
  // ■ Activates when attacking with Full Charge.
  // Effect changes according to the number of attack(s). Effect of each phase does not stack.
  // Three times: Affects {description_value_01} enemy unit(s) with the lowest final DEF.
  // Deals {description_value_02}% of final ATK as damage.
  // Six times: Affects enemies within attack range.
  // Deals {description_value_03}% of final ATK as Distributed Damage.
  // Nine times: Affects all enemies.
  // Deals {description_value_04}% of final ATK as Distributed Damage.
  // p01: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p02: [218.46, 225.63, 232.81, 239.98, 247.16, 254.32, 261.5, 268.68, 275.85, 283.03]
  // p03: [371.28, 392.79, 414.32, 435.85, 457.37, 478.89, 500.42, 521.94, 543.47, 565]
  // p04: [441.23, 486.43, 531.63, 576.83, 622.03, 667.23, 712.43, 757.63, 802.83, 848.03]
  skill1: {
    groupId: 22251,
    triggers: [
      {
        on: 'PROGRAM_INIT',
        handler(state, caster) {
          caster.skillState.sbsBurstChargeModeEndTick = 0;
          caster.skillState.sbsChargeCount            = 0;
        },
      },
      // S1（Fleetly Fading: Breakthrough）：统一 9 步计数器，溢出保留
      // 普通模式每发 +1；Burst 模式每发 +3
      // 阈值 3/6/9：283.03% / 565% / 848.03% ATK
      // 第 6/9 步（普通）/ 第 2/3 步（Burst）为 Distributed Damage 命中
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'sbsRawCount' },
        handler(state, caster, ctx) {
          const inBurstMode = state.tick < caster.skillState.sbsBurstChargeModeEndTick;
          const delta = inBurstMode ? 3 : 1;
          const prev  = caster.skillState.sbsChargeCount ?? 0;
          const next  = prev + delta;
          caster.skillState.sbsChargeCount = next >= 9 ? next - 9 : next;
          const sums       = ctx.sums ?? getBuffSums(state, caster.id);
          const dmgMults   = [
            getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100,
            getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100,
            getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]) / 100,
          ];
          const thresholds = [3, 6, 9];
          // 三段命中名称：描述只给出攻击次数（Three/Six/Nine times），非名称，按阶段自定义为 I / II / III
          const labels     = ['S1 Breakthrough I', 'S1 Breakthrough II', 'S1 Breakthrough III'];
          for (let i = 0; i < thresholds.length; i++) {
            const t = thresholds[i];
            if (prev < t && next >= t) {
              fireSkillHit(state, caster, dmgMults[i], sums, labels[i], { isDistributed: i >= 1 });
            }
          }
        },
      },
    ],
  },

  // ── Fleetly Fading: Asura
  // ■ Activates when entering Full Burst. Affects self.
  // Max Ammunition Capacity ▲ {description_value_01}% for {description_value_02} sec.
  // Reload {description_value_03}% of the magazine(s).
  // p01: [40, 42.22, 44.44, 46.66, 48.88, 51.1, 53.32, 55.54, 57.76, 60]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [30, 30, 30, 60, 60, 60, 100, 100, 100, 100]
  skill2: {
    groupId: 22252,
    triggers: [
      // S2（Fleetly Fading: Asura）：进入全爆裂 → 弹匣 ×(1+[S2 param0]%) 10s + 立即补满
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const mult       = 1 + getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          const seconds    = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]);
          const ammoBefore = caster.ammoLeft;
          // maxAmmoPct = mult - 1（扩充）；pushBuff 触发 recalcMaxAmmo（§5.1.3 仅截断，不强制装填）
          pushBuff(state, { name: 'Fleetly Fading: Asura', unitId: caster.id,
            maxAmmoPct: mult - 1, endTick: state.tick + TICK_RATE * seconds });
          if (state.ammoLog)
            state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
              delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft, maxAmmo: caster.maxAmmo,
              source: 'sbs_s2_maxAmmo' });
        },
      },
    ],
  },

  // ── Fleetly Fading: Strike
  // ■ Affects self.
  // Changes Full Charge attack count required for Skill 1 to 1 time/2 times/3 times for {description_value_01} sec.
  // ATK ▲ {description_value_02}% for {description_value_03} sec.
  // Charge Damage ▲ {description_value_04}% for {description_value_05} sec.
  // p01: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p02: [17.28, 28.15, 39.02, 49.89, 60.76, 71.64, 82.51, 93.38, 104.25, 115.12]
  // p03: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p04: [96.41, 104.54, 112.68, 120.81, 128.95, 137.09, 145.22, 153.36, 161.49, 169.63]
  // p05: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 12254,
    triggers: [
      // Burst：自身 ATK ▲115.12% + Charge Damage ▲169.63% 10s
      //        激活 S1 Burst 充能模式（每发 +3 步）10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const end10       = state.tick + TICK_RATE * 10;
          const atkPct      = getSkillValue(caster.rawBurst, 1, caster.skillLevels[2]) / 100;
          const chargeDmgPct = getSkillValue(caster.rawBurst, 3, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'Fleetly Fading: Strike', unitId: caster.id, atkPct, chargeDamagePct: chargeDmgPct, endTick: end10 });
          caster.skillState.sbsBurstChargeModeEndTick = end10;
        },
      },
    ],
  },
};
