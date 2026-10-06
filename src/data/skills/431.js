import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Volume  (resource_id: 431)
export default {

  // ── Freestyle
  // ■ Activates when killing an enemy. Affects self.
  // ATK ▲ {description_value_01}% for {description_value_02} sec.
  // p01 ATK▲%: [6.93, 7.56, 8.18, 8.82, 9.44, 10.08, 10.71, 11.34, 11.97, 12.6]
  // p02 duration (const): [5, ...]
  // [TODO] Volume S1：击杀触发——引擎无 KILL_ENEMY 事件，暂不实现。
  skill1: {
    groupId: 24311,
    triggers: [],
  },

  // ── Drop the Beat
  // ■ Activates when entering Full Burst. Affects all allies.
  // Effect changes according to the number of activation times. Previous effects trigger repeatedly:
  // Once: Cooldown of Burst Skill ▼ {description_value_01} sec.
  // Twice: Cooldown of Burst Skill ▼ {description_value_02} sec.
  // Three times: Cooldown of Burst Skill ▼ {description_value_03} sec.
  // ■ Activates when using Burst Skill. Affects all allies.
  // Effect changes according to the number of activation times. Previous effects trigger repeatedly:
  // Once: Critical Damage ▲ {description_value_04}% for {description_value_05} sec.
  // Twice: Critical Damage ▲ {description_value_06}% for {description_value_07} sec.
  // Three times: Critical Damage ▲ {description_value_08}% for {description_value_09} sec.
  // p01 CD reduction 1st (const): [2.34, ...]
  // p02 CD reduction 2nd (const): [2.70, ...]
  // p03 CD reduction 3rd (const): [3.17, ...]
  // p04 CritDmg 1st:   [1.68, 2.69, 3.7, 4.71, 5.72, 6.73, 7.74, 8.75, 9.76, 10.77]
  // p05 duration (const): [5, ...]
  // p06 CritDmg 2nd:   [3.36, 4.37, 5.38, 6.39, 7.4, 8.41, 9.42, 10.44, 11.45, 12.46]
  // p07 duration (const): [5, ...]
  // p08 CritDmg 3rd:   [5.05, 6.09, 7.13, 8.17, 9.21, 10.25, 11.29, 12.33, 13.37, 14.42]
  // p09 duration (const): [5, ...]
  skill2: {
    groupId: 24312,
    triggers: [
      {
        on: 'PROGRAM_INIT',
        handler(state, caster) {
          caster.skillState.volumeFbCount       = 0;
          caster.skillState.volumeBurstUseCount = 0;
        },
      },
      // S2 Part 1："前效重复触发"，进入全爆裂时全员累进减少爆裂冷却：
      //   1st ▼2.34s; 2nd +▼2.70s; 3rd+ +▼3.17s
      // 注：属■段0，但因 PROGRAM_INIT 占用 tdefIdx=0，用 partOverride 对齐到 P1
      {
        on: 'ENTER_FULL_BURST',
        partOverride: 0,
        handler(state, caster) {
          caster.skillState.volumeFbCount++;
          const cnt = caster.skillState.volumeFbCount;
          let sec = 0;
          if (cnt >= 1) sec += 2.34;
          if (cnt >= 2) sec += 2.70;
          if (cnt >= 3) sec += 3.17;
          const reductionTicks = Math.round(TICK_RATE * sec);
          for (const u of state.squad) {
            u.burstCdRemaining = Math.max(0, u.burstCdRemaining - reductionTicks);
          }
          if (state.buffLog && reductionTicks > 0)
            state.buffLog.push({ type: 'cd_reduction', tick: state.tick, name: 'Drop the Beat (Burst CD)', unitId: null, reductionTicks });
        },
      },
      // S2 Part 2："前效重复触发"，每次使用爆裂技能时（累计计数）：
      //   第 1 次+：全员 CritDmg ▲[p04]% 5s
      //   第 2 次+：全员 CritDmg ▲[p06]% 5s
      //   第 3 次+：全员 CritDmg ▲[p08]% 5s
      // 注：属■段1，但因 PROGRAM_INIT+■段0 占用 tdefIdx=0,1，用 partOverride 对齐到 P2
      {
        on: 'BURST_SKILL_USE',
        partOverride: 1,
        handler(state, caster) {
          const cnt         = ++caster.skillState.volumeBurstUseCount;
          const end5        = state.tick + TICK_RATE * 5;
          const critDmg1   = getSkillValue(caster.rawSkill2, 3, caster.skillLevels[1]) / 100;
          const critDmg2   = getSkillValue(caster.rawSkill2, 5, caster.skillLevels[1]) / 100;
          const critDmg3   = getSkillValue(caster.rawSkill2, 7, caster.skillLevels[1]) / 100;
          if (cnt >= 1) pushBuff(state, { name: 'Drop the Beat (Crit Damage 1)', unitId: null, critDamagePct: critDmg1, endTick: end5 });
          if (cnt >= 2) pushBuff(state, { name: 'Drop the Beat (Crit Damage 2)', unitId: null, critDamagePct: critDmg2, endTick: end5 });
          if (cnt >= 3) pushBuff(state, { name: 'Drop the Beat (Crit Damage 3)', unitId: null, critDamagePct: critDmg3, endTick: end5 });
        },
      },
    ],
  },

  // ── Turn up the volume!
  // ■ Affects all allies.
  // Critical Rate ▲ {description_value_01}% for {description_value_02} sec.
  // p01 CritRate▲%: [17.54, 19.14, 20.73, 22.33, 23.92, 25.52, 27.11, 28.71, 30.3, 31.9]
  // p02 duration (const): [5, ...]
  burst: {
    groupId: 14313,
    triggers: [
      // Burst（Turn up the volume!）：全员 Crit Rate ▲[p00]% 5s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const critRatePct = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'Turn up the volume!', unitId: null,
            critRatePct: critRatePct, endTick: state.tick + TICK_RATE * 5 });
        },
      },
    ],
  },
};
