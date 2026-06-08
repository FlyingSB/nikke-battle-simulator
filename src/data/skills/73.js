import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Brid: Silent Track  (resource_id: 73)
export default {

  // ── Ignition Sequence
  // ■ Activates when entering Full Burst. Affects all Wind Code enemies.
  //   <color=#00AEFF>Damage Taken ▲ {p00}% for {p01=10} sec.</color>
  // ■ Activates when entering Full Burst. Affects all enemies.
  //   <color=#00AEFF>Deals {p02}% of final ATK as damage.</color>
  //
  // group_id: 20731
  // p00 Damage Taken▲%: [8.93, 9.62, 10.31, 11, 11.69, 12.37, 13.06, 13.75, 14.44, 15.12]
  // p01 duration (const): [10, ...]
  // p02 skill damage%: [375.82, 404.73, 433.64, 462.54, 491.45, 520.36, 549.27, 578.18, 607.09, 636]
  //
  // 注：Wind Code 筛选在单 Boss 场景中等同于全体敌人，不额外过滤。
  skill1: {
    groupId: 20731,
    triggers: [
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv  = caster.skillLevels[0];
          const end = state.tick + TICK_RATE * 10;

          // Wind Code 敌人承伤 ▲ p00% 10s
          const dtPct      = getSkillValue(caster.rawSkill1, 0, lv) / 100;
          pushBuff(state, { name: 'Ignition Sequence', unitId: null,
            enemyDamageTakenPct: dtPct, endTick: end });

          // 全体敌人技能伤害 p02%
          const dmgPct = getSkillValue(caster.rawSkill1, 2, lv) / 100;
          const sums   = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, dmgPct, sums, 'S1');
        },
      },
    ],
  },

  // ── Journey Ahead
  // ■ Activates after {p00=10} normal attack(s). Affects {p01=1} Wind Code enemy unit(s) with lowest remaining HP.
  //   <color=#00AEFF>Damage Taken ▲ {p02}% for {p03=10} sec.</color>
  // ■ Activates after {p04=5} normal attack(s). Affects {p05=1} enemy unit(s) with lowest remaining HP.
  //   <color=#00AEFF>Deals {p06}% of final ATK as damage.</color>
  //
  // group_id: 20732
  // p00 shot interval (const): [10, ...]
  // p01 targets (const): [1, ...]
  // p02 Damage Taken▲%: [7.16, 7.71, 8.27, 8.82, 9.37, 9.92, 10.47, 11.02, 11.57, 12.12]
  // p03 duration (const): [10, ...]
  // p04 shot interval (const): [5, ...]
  // p05 targets (const): [1, ...]
  // p06 skill damage%: [398.86, 429.55, 460.23, 490.91, 521.59, 552.28, 582.96, 613.64, 644.32, 675]
  //
  // 注：两个效果触发计数独立追踪（counterKey 不同）。
  skill2: {
    groupId: 20732,
    triggers: [
      // 每 10 发 → Wind Code 敌人承伤 ▲ p02% 10s
      {
        on: 'SHOT_COUNT',
        opts: { every: 10, counterKey: 'brid_s2_windCount' },
        handler(state, caster) {
          const lv  = caster.skillLevels[1];
          const end = state.tick + TICK_RATE * 10;

          const dtPct      = getSkillValue(caster.rawSkill2, 2, lv) / 100;
          pushBuff(state, { name: 'Journey Ahead', unitId: '__enemy__', isDebuff: true,
            enemyDamageTakenPct: dtPct, endTick: end });
        },
      },
      // 每 5 发 → 对最低 HP 敌人造成 p06% 技能伤害（单 Boss 场景等同唯一目标）
      {
        on: 'SHOT_COUNT',
        opts: { every: 5, counterKey: 'brid_s2_dmgCount' },
        handler(state, caster) {
          const lv     = caster.skillLevels[1];
          const dmgPct = getSkillValue(caster.rawSkill2, 6, lv) / 100;
          const sums   = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, dmgPct, sums, 'S2');
        },
      },
    ],
  },

  // ── Full Throttle
  // ■ Affects all allies (except self).
  //   <color=#00AEFF>ATK ▲ {p00}% of caster's ATK for {p01=10} sec.</color>
  //
  // group_id: 10733
  // p00 ATK▲% of caster's ATK: [39.3, 42.33, 45.35, 48.37, 51.4, 54.42, 57.44, 60.47, 63.49, 66.52]
  // p01 duration (const): [10, ...]
  burst: {
    groupId: 10733,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv      = caster.skillLevels[2];
          const atkPct  = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const atkFlat = Math.round(caster.stats.atk * atkPct);
          const end     = state.tick + TICK_RATE * 10;
          for (const u of state.squad) {
            if (u.id === caster.id) continue;
            pushBuff(state, { name: 'Full Throttle', unitId: u.id, atkFlat, endTick: end });
          }
        },
      },
    ],
  },
};
