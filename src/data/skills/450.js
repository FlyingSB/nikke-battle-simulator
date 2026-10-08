import { pushBuff, applyHeal, applyCoverHeal, getHpRatio, TICK_RATE, getFinalMaxHp } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Naga  (resource_id: 450)
export default {

  // ── Guardian of Friendship
  // ■ Activates after {p00=12} normal attack(s). Affects all allies.
  //   Restores {p01}% of Cover HP.  （触发 COVER_HEAL 团队事件；掩体 HP 数值不建模）
  // ■ Activates when applying Shield（自身获盾时）. Affects all allies.
  //   Damage dealt when attacking core ▲ {p02}% for {p03=10} sec.
  //
  // group_id: 24501
  // p00 (shot threshold, const): [12, ...]
  // p01 (Cover HP restore%, 不建模): [8.61, 9.27, 9.93, 10.6, 11.26, 11.92, 12.59, 13.25, 13.91, 14.57]
  // p02 (Core Damage ▲%): [50.33, 54.2, 58.07, 61.94, 65.82, 69.69, 73.56, 77.43, 81.3, 85.17]
  // p03 (duration, const): [10, ...]
  skill1: {
    groupId: 24501,
    triggers: [
      // Part1：每 12 发 → 修复全员掩体 HP p01%（触发 COVER_HEAL 团队事件）
      {
        on: 'SHOT_COUNT',
        opts: { every: 12, counterKey: 'naga_s1p1' },
        handler(state) { applyCoverHeal(state); },
      },
      // Part2：自身获盾时 → 全员 Core Damage ▲ p02% 持续 10s
      {
        on: 'APPLY_SHIELD',
        handler(state, caster) {
          const lv         = caster.skillLevels[0];
          const coreDmgPct = getSkillValue(caster.rawSkill1, 2, lv) / 100;
          pushBuff(state, { name: 'Guardian of Friendship', unitId: null,
            coreDamagePct: coreDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },

  // ── Support of Friendship
  // ■ Activates after {p00=5} normal attack(s). Affects {p01=2} ally unit(s) with the highest ATK.
  //   Damage dealt when attacking core ▲ {p02}% for {p03=5} sec.
  // ■ Activates after {p04=5} normal attack(s). Affects {p05=2} ally unit(s) with the lowest HP%.
  //   Recovers {p06}% of the caster's final Max HP as HP.
  //
  // group_id: 24502
  // p00 (shot threshold, const): [5, ...]
  // p01 (target count, const): [2, ...]
  // p02 (Core Damage ▲%): [26.37, 27.89, 29.42, 30.94, 32.46, 33.98, 35.5, 37.02, 38.55, 40.07]
  // p03 (duration, const): [5, ...]
  // p04 (shot threshold, const): [5, ...]
  // p05 (target count, const): [2, ...]
  // p06 (HP heal% of caster MaxHP): [5.58, 6.03, 6.47, 6.92, 7.36, 7.8, 8.25, 8.69, 9.14, 9.58]
  skill2: {
    groupId: 24502,
    triggers: [
      // Part1：每 5 发 → ATK 最高的 2 名友军 Core Damage ▲ p02% 持续 5s
      {
        on: 'SHOT_COUNT',
        opts: { every: 5, counterKey: 'naga_s2p1' },
        handler(state, caster) {
          const lv         = caster.skillLevels[1];
          const coreDmgPct = getSkillValue(caster.rawSkill2, 2, lv) / 100;
          const endTick    = state.tick + TICK_RATE * 5;
          const sorted     = [...state.squad].sort((a, b) => b.stats.atk - a.stats.atk);
          pushBuff(state, { name: 'Support of Friendship', unitIds: sorted.slice(0, 2).map(t => t.id),
            coreDamagePct: coreDmgPct, endTick });
        },
      },
      // Part2：每 5 发 → HP% 最低的 2 名友军 HP 回复 p06% caster MaxHP
      {
        on: 'SHOT_COUNT',
        opts: { every: 5, counterKey: 'naga_s2p2' },
        handler(state, caster) {
          const lv     = caster.skillLevels[1];
          const healPct = getSkillValue(caster.rawSkill2, 6, lv) / 100;
          const amount  = Math.round(getFinalMaxHp(state, caster) * healPct);  // "caster's final Max HP"
          // 稳定排序：HP% 相同时按站位从左到右
          const sorted  = [...state.squad].sort(
            (a, b) => getHpRatio(state, a) - getHpRatio(state, b),
          );
          for (const t of sorted.slice(0, 2)) {
            applyHeal(state, t, amount, null, caster);
          }
        },
      },
    ],
  },

  // ── As Long As We're With Friends
  // ■ Affects self.
  //   Gain Pierce for {p00=10} sec.
  // ■ Affects all allies.
  //   ATK ▲ {p01}% of caster's ATK for {p02=10} sec.
  // ■ Activates when using Burst Skill while self has an active Shield. Affects all allies.
  //   ATK ▲ {p03}% of caster's ATK for {p04=10} sec.
  //
  // group_id: 14503
  // p00 (Pierce duration, const): [10, ...]
  // p01 (ATK% of caster ATK): [9.56, 10.29, 11.03, 11.76, 12.5, 13.24, 13.97, 14.71, 15.44, 16.18]
  // p02 (duration, const): [10, ...]
  // p03 (ATK% of caster ATK, 持有护盾条件): [17.16, 18.7, 20.24, 21.78, 23.32, 24.86, 26.4, 27.94, 29.48, 31.02]
  // p04 (duration, const): [10, ...]
  burst: {
    groupId: 14503,
    triggers: [
      // Burst P1：自身获得穿透 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          pushBuff(state, { name: 'As Long As We\'re With Friends (Pierce)', unitId: caster.id,
            pierce: true, endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // Burst P2：全员 ATK flat ▲（p01% Naga ATK）10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv     = caster.skillLevels[2];
          const atkPct = getSkillValue(caster.rawBurst, 1, lv) / 100;
          pushBuff(state, { name: 'As Long As We\'re With Friends P2 (ATK)', unitId: null,
            atkFlat: Math.round(caster.stats.atk * atkPct), endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // Part3：施放爆裂技能时自身有生效护盾 → 全员 ATK flat ▲（p03% Naga ATK）10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (!(caster.shieldHp > 0 && caster.shieldEndTick > state.tick)) return false;
          const lv     = caster.skillLevels[2];
          const atkPct = getSkillValue(caster.rawBurst, 3, lv) / 100;
          pushBuff(state, { name: 'As Long As We\'re With Friends P3 (ATK)', unitId: null,
            atkFlat: Math.round(caster.stats.atk * atkPct), endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },
};
