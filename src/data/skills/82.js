import { pushBuff, fireSkillHit, addBurstGauge, applyHeal, applyCoverHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { ACTIVE_SKILL_COOLDOWN_SEC } from '../active-skill-cooldowns.js';

// Character: Liter  (resource_id: 82)

// S2 Volt Boost 为主动技能，CDN 不提供冷却时间，人工填写：15s（见 active-skill-cooldowns.js）。
const S2_COOLDOWN_TICKS = ACTIVE_SKILL_COOLDOWN_SEC[82].skill2 * TICK_RATE;

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
            u.burstCdRemaining = Math.max(0, u.burstCdRemaining - reductionTicks);
          }
          if (state.buffLog && reductionTicks > 0)
            state.buffLog.push({ type: 'cd_reduction', tick: state.tick, name: 'Liter Boost (Burst CD)', unitId: null, reductionTicks });
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
          const critDamagePct  = getSkillValue(caster.rawSkill1, 5, caster.skillLevels[0]) / 100;
          const atkPct      = getSkillValue(caster.rawSkill1, 7, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'Liter Boost (Max Ammo)', unitId: null, maxAmmoPct, endTick: end5 });
          if (state.ammoLog) {
            for (const u of state.squad)
              state.ammoLog.push({ tick: state.tick, unitId: u.id, unitName: u.name,
                delta: 0, ammoAfter: u.ammoLeft, maxAmmo: u.maxAmmo,
                maxAmmoDelta: Math.round(u.baseAmmo * maxAmmoPct), source: `liter_s1_t1_maxAmmo(+${(maxAmmoPct*100).toFixed(2)}%)` });
          }
          if (cnt >= 2) pushBuff(state, { name: 'Liter Boost (Crit Damage)', unitId: null, critDamagePct: critDamagePct, endTick: end5 });
          if (cnt >= 3) pushBuff(state, { name: 'Liter Boost (ATK)', unitId: null, atkPct,                   endTick: end5 });
        },
      },
      // 内部初始化（末尾放置不占用描述段 index）
      {
        on: 'PROGRAM_INIT',
        handler(state, caster) {
          caster.skillState.literFbCount       = 0;
          caster.skillState.literBurstUseCount = 0;
        },
      },
    ],
  },

  // ── Volt Boost
  // ■ Affects {description_value_01} ally unit(s) with the lowest remaining cover HP.
  // Restores {description_value_02}% of Cover HP.
  // p01: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
  // p02: [28.87, 31.5, 34.12, 36.75, 39.37, 42, 44.62, 47.25, 49.87, 52.5]
  //
  // Volt Boost 为主动技能（CharacterSkill 表），冷却 15s；与 Centi S2 约定一致：战斗开始先进入冷却，
  // 就绪后由逐 tick 轮询施放。掩体 HP 数值不建模：各掩体视为同值，「最低掩体 HP 的 p00 名」按站位
  // 从左到右取 p00 名；仅触发 COVER_HEAL 团队事件（同 Naga S1 / Zwei S2）。
  skill2: {
    groupId: 10822,
    triggers: [
      {
        on: 'PROGRAM_INIT',
        handler(state, caster) {
          caster.skillState.literS2ReadyTick = state.tick + S2_COOLDOWN_TICKS;
        },
      },
      {
        on: 'INTERVAL',
        opts: { seconds: 1 / TICK_RATE },
        partOverride: 0,
        handler(state, caster) {
          if (state.tick < (caster.skillState.literS2ReadyTick ?? S2_COOLDOWN_TICKS)) return false;
          caster.skillState.literS2ReadyTick = state.tick + S2_COOLDOWN_TICKS;
          const count   = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]);
          const targets = state.squad.slice(0, count);   // 掩体 HP 同值 → 站位从左到右
          applyCoverHeal(state, null, targets);
        },
      },
    ],
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
          pushBuff(state, { name: 'Double Boost', unitId: null, atkPct,
            endTick: state.tick + TICK_RATE * 5 });
        },
      },
    ],
  },
};
