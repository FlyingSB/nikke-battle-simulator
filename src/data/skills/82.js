import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Liter Boost
  // ■ Activates when entering Full Burst. Affects all allies.
  // Effect changes according to the number of activation times. Previous effects trigger repeatedly:
  // Once: Cooldown of Burst Skill ▼ {description_value_01} sec.
  // Twice: Cooldown of Burst Skill ▼ {description_value_02} sec.
  // Three times: Cooldown of Burst Skill ▼ {description_value_03} sec.
  // ■ Activates when using Burst Skill. Affects all allies.
  // Effect changes according to the number of activation times.  Previous effects trigger repeatedly:
  // Once: Max Ammunition Capacity ▲ {description_value_04}% for {description_value_05} sec.
  // Twice: Critical Damage ▲ {description_value_06}% for {description_value_07} sec.
  // Three times: ATK ▲ {description_value_08}% for {description_value_09} sec.
  // p01: [2.34, 2.34, 2.34, 2.34, 2.34, 2.34, 2.34, 2.34, 2.34, 2.34]
  // p02: [2.7, 2.7, 2.7, 2.7, 2.7, 2.7, 2.7, 2.7, 2.7, 2.7]
  // p03: [3.17, 3.17, 3.17, 3.17, 3.17, 3.17, 3.17, 3.17, 3.17, 3.17]
  // p04: [7.05, 11.29, 15.52, 19.76, 23.99, 28.23, 32.46, 36.7, 40.93, 45.17]
  // p05: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p06: [3.36, 4.37, 5.38, 6.39, 7.4, 8.41, 9.42, 10.44, 11.45, 12.46]
  // p07: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p08: [5.05, 6.09, 7.13, 8.17, 9.21, 10.25, 11.29, 12.33, 13.37, 14.42]
  // p09: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
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
      //   第 1 次+：全员临时弹匣容量 ▲[S1 param3]% 5s（下次装填时生效）
      //   第 2 次+：全员 Crit Damage ▲[S1 param5]% 5s
      //   第 3 次+：全员 ATK ▲[S1 param7]% 5s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const cnt         = ++caster.skillState.literBurstUseCount;
          const end5        = state.tick + TICK_RATE * 5;
          const maxAmmoPct  = getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]) / 100;
          const critDmgPct  = getSkillValue(caster.rawSkill1, 5, caster.skillLevels[0]) / 100;
          const atkPct      = getSkillValue(caster.rawSkill1, 7, caster.skillLevels[0]) / 100;
          const literBoostEndTick = end5;
          for (const u of state.squad) {
            const boostExtra = Math.floor(u.baseAmmo * maxAmmoPct);
            u.skillState.literAmmoBoostEndTick = literBoostEndTick;
            u.skillState.literAmmoBoostExtra   = boostExtra;
            if (state.ammoLog)
              state.ammoLog.push({ tick: state.tick, unitId: u.id, unitName: u.name,
                delta: 0, ammoAfter: u.ammoLeft, maxAmmo: u.maxAmmo + boostExtra,
                maxAmmoDelta: boostExtra, source: `liter_s1_t1_maxAmmo(+${(maxAmmoPct*100).toFixed(2)}%)` });
          }
          pushBuff(state, { name: 'liter_s1_t1_maxAmmo', unitId: null, maxAmmoPct, endTick: literBoostEndTick });
          if (cnt >= 2) pushBuff(state, { name: 'liter_s1_critDmg', unitId: null, critDmgBonus: critDmgPct, endTick: end5 });
          if (cnt >= 3) pushBuff(state, { name: 'liter_s1_atkPct',  unitId: null, atkPct,                  endTick: end5 });
        },
      },
    ],
  },

  // ── Volt Boost
  // ■ Affects {description_value_01} ally unit(s) with the lowest remaining cover HP.
  // Restores {description_value_02}% of Cover HP.
  // p01: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
  // p02: [28.87, 31.5, 34.12, 36.75, 39.37, 42, 44.62, 47.25, 49.87, 52.5]
  skill2: {
    groupId: 10822,
    // [TODO] Liter S2：恢复 2 名友军的掩体 HP。
    // 当前模拟器无受伤/掩体模型，不实现。
    triggers: [],
  },

  // ── Double Boost
  // ■ Affects all allies.
  // ATK ▲ {description_value_01}% for {description_value_02} sec.
  // p01: [36.3, 39.6, 42.9, 46.2, 49.5, 52.8, 56.1, 59.4, 62.7, 66]
  // p02: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  burst: {
    groupId: 10823,
    triggers: [
      // Burst（Double Boost）：全员 ATK ▲[Burst param0]% 5s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const atkPct = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'liter_burst_atkPct', unitId: null, atkPct,
            endTick: state.tick + TICK_RATE * 5 });
        },
      },
    ],
  },
};
