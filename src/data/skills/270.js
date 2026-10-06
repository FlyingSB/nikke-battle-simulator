import { pushBuff, applyShield, pushHoT, TICK_RATE, ALL_ALLIES, getFinalMaxHp } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Blanc  (resource_id: 270)
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
  // [TODO] 盾的实际效果覆盖全队伤害承受，此处仅建模 Blanc 本人获盾（数值正确）；
  //        "protects all allies from damage" 未实现。
  skill1: {
    groupId: 22701,
    triggers: [
      {
        on: 'SHOT_COUNT',
        opts: { every: 120, counterKey: 'blancS1ShotCount' },
        handler(state, caster) {
          const pct = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100;
          applyShield(state, caster, Math.round(getFinalMaxHp(state, caster) * pct), state.tick + TICK_RATE * 5);  // "caster's final Max HP"
        },
      },
    ],
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
  // 队员存活条件在模拟器中恒成立，Part2 无条件触发。
  skill2: {
    groupId: 22702,
    triggers: [
      // Part1：全爆裂结束 → 全员 HoT（p01% MaxHP/s × 5s）
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const pct    = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          const amount = Math.round(getFinalMaxHp(state, caster) * pct);  // "caster's final Max HP"
          pushHoT(state, ALL_ALLIES, amount, 5);
        },
      },

      // Part2：全爆裂结束且同小队友军存活 → 自身爆裂 CD ▼40.76s
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const hasSquadAlly = state.squad.some(
            u => u.id !== caster.id && u.squad === caster.squad && u.unitHp > 0,
          );
          if (!hasSquadAlly) return false;
          const reductionTicks = Math.round(40.76 * TICK_RATE);
          caster.burstCdRemaining = Math.max(0, caster.burstCdRemaining - reductionTicks);
        },
      },
    ],
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
  // Indomitability 为防御效果，不建模。Max HP ▲ 通过 maxHpPct buff 实现。
  // Damage Taken debuff 通过 buff 的 endTick 机制管理：battle.js 过期循环读取
  // b.enemyDamageTakenPct 并从 state.enemyDamageTakenPct 中减去，精度至单 tick。
  // 刷新时（buff 仍活跃）pushBuff 仅延长 endTick，不重复累加 enemyDamageTakenPct。
  burst: {
    groupId: 12703,
    triggers: [
      // Part1：全员 HoT（p01% MaxHP/s × 8s）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const pct    = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const amount = Math.round(getFinalMaxHp(state, caster) * pct);  // "caster's final Max HP"
          pushHoT(state, ALL_ALLIES, amount, 8);
        },
      },

      // Part2：HP% 最低的 1 名友军（不含自身）→ Max HP ▲ p05% for 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const pct    = getSkillValue(caster.rawBurst, 4, caster.skillLevels[2]) / 100;
          const end    = state.tick + TICK_RATE * 10;
          const target = [...state.squad]
            .filter(u => u.id !== caster.id)
            .sort((a, b) => (a.unitHp / a.stats.hp) - (b.unitHp / b.stats.hp))[0];
          if (!target) return;
          pushBuff(state, { name: 'Showtime (Max HP)', unitId: target.id, maxHpPct: pct, endTick: end });
        },
      },

      // Part3：Damage Taken ▲ p07% for 10 sec
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const pct = getSkillValue(caster.rawBurst, 6, caster.skillLevels[2]) / 100;
          const end = state.tick + TICK_RATE * 10;
          pushBuff(state, { name: 'Showtime (Damage Taken)', unitId: '__enemy__', isDebuff: true,
            enemyDamageTakenPct: pct, endTick: end });
        },
      },
    ],
  },
};
