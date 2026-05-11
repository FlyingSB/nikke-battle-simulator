import { TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Lucky Guard
  // ■ Activates after {p01=120} normal attack(s). Affects all allies.
  //   Creates a Shield equal to {p02}% of the caster's final Max HP, which protects all allies
  //   from damage. Lasts for {p03=5} sec.
  //
  // group_id: 22701
  // p01: [120, ...] (shot trigger, const)
  // p02: [6.97, 7.51, 8.04, 8.58, 9.12, 9.65, 10.19, 10.73, 11.26, 11.8] (Shield% of MaxHP)
  // p03: [5, ...] (Shield duration, const)
  //
  // Shield 为纯防御效果，不影响 DPS，不建模。
  // [TODO] S1 Lucky Guard — Shield
  skill1: {
    groupId: 22701,
    triggers: [],
  },

  // ── Rabbit Twins W
  // ■ Activates after Full Burst ends. Affects all allies.
  //   Constantly recovers {p01}% of caster's final Max HP every 1 sec for {p02=5} sec.
  // ■ Activates when Full Burst ends with an ally from the same squad still on the battlefield.
  //   Affects self. Cooldown of Burst Skill ▼ {p03=40.76} sec.
  //
  // group_id: 22702
  // p01: [1.78, 1.99, 2.20, 2.41, 2.62, 2.84, 3.05, 3.26, 3.47, 3.68] (HP recovery%/sec)
  // p02: [5, ...] (recovery duration, const)
  // p03: [40.76, ...] (CD reduction, const)
  //
  // HP 回复与 CD 减少为防御 / 轮换辅助效果，不影响单次战斗的 DPS，不建模。
  // [TODO] S2 Rabbit Twins W — HP recovery + Burst CD reduction
  skill2: {
    groupId: 22702,
    triggers: [],
  },

  // ── Showtime
  // ■ Affects all allies.
  //   Constantly recovers {p01}% of caster's final Max HP every 1 sec for {p02=8} sec.
  // ■ Affects {p03=1} ally unit(s) with the lowest remaining HP (except caster).
  //   Gain Indomitability for {p04=10} sec.
  //   Max HP ▲ {p05}% for {p06=10} sec.
  // ■ Affects all enemies.
  //   Damage Taken ▲ {p07}% for {p08=10} sec.
  //
  // group_id: 12703
  // p01: [2.05, 2.25, 2.45, 2.65, 2.85, 3.04, 3.24, 3.44, 3.64, 3.84] (HP recovery%/sec)
  // p02: [8, ...] (recovery duration, const)
  // p03: [1, ...] (ally count, const)
  // p04: [10, ...] (Indomitability duration, const)
  // p05: [18.72, 20.16, 21.6, 23.04, 24.48, 25.92, 27.36, 28.8, 30.24, 31.68] (Max HP%)
  // p06: [10, ...] (Max HP duration, const)
  // p07: [20.08, 22.21, 24.34, 26.48, 28.61, 30.74, 32.87, 35.0, 37.13, 39.26] (Damage Taken%)
  // p08: [10, ...] (Damage Taken duration, const)
  //
  // HP 回复 / Indomitability / Max HP ▲ 为防御效果，不建模。
  // Damage Taken ▲ 直接累加 state.enemyDamageTakenPct；INTERVAL 每秒轮询到期后减去。
  burst: {
    groupId: 12703,
    triggers: [
      // Burst 施放：Damage Taken ▲ p07% for 10 sec
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const bLv = caster.skillLevels[2];
          const pct = getSkillValue(caster.rawBurst, 6, bLv) / 100;
          const end = state.tick + TICK_RATE * 10;

          // 若上次 debuff 仍有效，先减去旧值再施加新值（刷新处理）
          const prevPct = caster.skillState.blancDamageTakenPct ?? 0;
          if (prevPct > 0 && state.tick < (caster.skillState.blancDamageTakenEndTick ?? 0)) {
            state.enemyDamageTakenPct -= prevPct;
          }

          state.enemyDamageTakenPct                 += pct;
          caster.skillState.blancDamageTakenPct      = pct;
          caster.skillState.blancDamageTakenEndTick  = end;
        },
      },

      // 每秒轮询：Damage Taken debuff 到期后移除
      {
        on: 'INTERVAL',
        opts: { seconds: 1 },
        handler(state, caster) {
          const endTick = caster.skillState.blancDamageTakenEndTick ?? 0;
          if (endTick <= 0 || state.tick < endTick) return;
          const pct = caster.skillState.blancDamageTakenPct ?? 0;
          if (pct > 0) {
            state.enemyDamageTakenPct                 -= pct;
            caster.skillState.blancDamageTakenPct      = 0;
            caster.skillState.blancDamageTakenEndTick  = 0;
          }
        },
      },
    ],
  },
};
