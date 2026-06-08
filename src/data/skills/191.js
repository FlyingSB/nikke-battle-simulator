import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Alice  (resource_id: 191)
export default {

  // ── Energizing Carrot
  // ■ Activates when entering Full Burst. Affects {description_value_01} ally unit(s) with the highest final ATK.
  // Charge Speed ▲ {description_value_02}% of caster's Charge Speed for {description_value_03} sec.
  // Charge Damage ▲ {description_value_04}% for {description_value_05} sec.
  // p01: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
  // p02: [6.89, 7.42, 7.95, 8.48, 9.02, 9.55, 10.08, 10.61, 11.14, 11.67]
  // p03: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p04: [4.13, 4.45, 4.77, 5.09, 5.41, 5.73, 6.04, 6.36, 6.68, 7]
  // p05: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  skill1: {
    groupId: 21911,
    triggers: [
      // S1（Energizing Carrot）：进入全爆裂 → 全队 ATK 最高 [S1 param0] 名友军：
      //   Charge Speed ▲[S1 param1]% Alice 蓄力时间（flat 减少）10s
      //   Charge Damage ▲[S1 param3]% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const sorted          = [...state.squad].sort((a, b) => b.stats.atk - a.stats.atk);
          const targets         = sorted.slice(0, 2);
          const end10           = state.tick + TICK_RATE * 10;
          // Charge Speed：[S1 param1]% 蓄力时间减少（flat ticks）
          const csPct           = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100;
          const chargeReduction = Math.round(caster.chargeTimeTicks * csPct);
          const chargeDmgPct    = getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]) / 100;
          for (const u of targets) {
            pushBuff(state, { name: 'Energizing Carrot', unitId: u.id,
              chargeTimeReductionTicks: chargeReduction, chargeDamagePct: chargeDmgPct, endTick: end10 });
          }
        },
      },
    ],
  },

  // ── Healthy Carrot
  // ■ Affects self. Activates when above {description_value_01}% HP.
  // Gain continuous Pierce.
  // ■ Affects self. Activates when HP falls below {description_value_02}%.
  // Continuously recover HP by {description_value_03}% of attack damage.
  // p01: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80]
  // p02: [80, 80, 80, 80, 80, 80, 80, 80, 80, 80]
  // p03: [2.45, 3.08, 3.71, 4.34, 4.97, 5.6, 6.23, 6.86, 7.49, 8.12]
  skill2: {
    groupId: 21912,
    triggers: [
      // S2 Part1（Healthy Carrot）：HP > 80% → 自身持续 Pierce
      // 模拟中队员 HP 始终为 100%，故战斗开始即激活。
      // [TODO] 实现 HP 实时检测：HP > 80% 时激活/移除 pierce buff
      // [TODO] S2 Part2：HP < 80% → 攻击时回复 8.12% ATK 量 HP（生命偷取）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          pushBuff(state, { name: 'Healthy Carrot', unitId: caster.id, pierce: true, endTick: Infinity });
        },
      },
    ],
  },

  // ── Wonderland
  // ■ Affects self.
  // Charge Speed ▲ {description_value_01}% for {description_value_02} sec.
  // ATK ▲ {description_value_03}% for {description_value_04} sec.
  // p01: [54.84, 57.65, 60.46, 63.28, 66.09, 68.9, 71.71, 74.53, 77.34, 80.15]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [14.62, 19.12, 23.62, 28.12, 32.62, 37.12, 41.62, 46.12, 50.62, 55.12]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 11913,
    triggers: [
      // Burst（Wonderland）：自身 Charge Speed ▲[Burst param0]% + ATK ▲[Burst param2]% 10s
      // 同时记录 aliceWonderlandEndTick：若期间实际蓄力周期 ≤ 15 ticks，
      // 启用快速攻击模式（40次/10s，由 battle.js 判定）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const end10      = state.tick + TICK_RATE * 10;
          const chargeSpd  = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const atkPct     = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'Wonderland', unitId: caster.id,
            chargeSpeedPct: chargeSpd, atkPct, endTick: end10 });
          caster.skillState.aliceWonderlandEndTick = end10;
        },
      },
    ],
  },
};
