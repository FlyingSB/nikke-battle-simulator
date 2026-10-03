import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Dorothy: Serendipity  (resource_id: 234)
export default {

  // ── Flash
  // ■ Activates when hitting the target with {p01=80} pellets. Affects self.
  //   Gains Pierce for {p02=3} round(s).
  //   Hit Rate ▲ {p03}% for {p02=3} round(s).
  //   Attack damage ▲ {p04}% for {p02=3} round(s).
  //   Pellet count is fixed at 1 for {p02=3} round(s).
  // ■ Activates when hitting the target with {p05=160} pellets. Affects self.
  //   Expands Pierce range by {p06=200}% for {p07=3} round(s).
  //
  // group_id: 22341
  // p00: [80, ...] (Part1 命中弹丸数阈值, const)
  // p01: [3, ...] (持续轮数, const)
  // p02: [78.54, 80.72, 82.9, 85.08, 87.26, 89.44, 91.62, 93.8, 95.98, 98.18] (Hit Rate%)
  // p03: [43.2, 46.4, 49.6, 52.8, 56, 59.2, 62.4, 65.6, 68.8, 72] (Attack damage%)
  // p04: [160, ...] (Part2 弹头触发阈值 → 每 16 发触发，const)
  // p05: [200, ...] (Pierce range expand%，不影响伤害计算，const)
  // p06: [3, ...] (Part2 持续轮数, const)
  //
  // 实现说明：
  //   - 触发条件按【命中目标的弹丸数】累计，而非射击次数：每发射击累加 ctx.pellets
  //     （引擎按射击时 buff 计算：基础 10 发；Burst 期间 +3/+5；本技能 3 轮内固定为 1）。
  //     弹丸只在实际命中后计数（onShotFired 于命中结算之后调用；引擎假设射出即全部命中目标）。
  //   - "Pellet count fixed at 1" → buff 字段 pelletFixed: 1（影响后续计数与爆裂充能，不影响单发伤害系数）。
  //   - "Expands Pierce range" 不影响伤害计算，Part2 略。
  skill1: {
    groupId: 22341,
    triggers: [
      // Part1：累计命中 80 发弹丸（溢出保留）→ Pierce + Attack damage ▲ p03% + Hit Rate ▲ p02% + 弹丸数固定为 1，均 3 轮
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'dorothy234S1P1Dummy' },
        handler(state, caster, ctx) {
          const st = caster.skillState;
          st.dorothy234S1P1Pellets = (st.dorothy234S1P1Pellets ?? 0) + (ctx.pellets ?? 1);
          if (st.dorothy234S1P1Pellets < 80) return;
          st.dorothy234S1P1Pellets -= 80;
          const atk = getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]) / 100;
          const hr  = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'Flash P1', unitId: caster.id, pierce: true, attackDamagePct: atk, hitRatePct: hr,
            pelletFixed: 1, endRounds: 3 });
        },
      },

      // [TODO] Part2：每 16 发（160 弹头）→ Pierce range ▲200% × 3 轮（不影响伤害计算）
    ],
  },

  // ── Radiant Wings
  // ■ Activates when entering battle. Affects self.
  //   Pierce damage ▲ {p01}% continuously.
  // ■ Activates only during Full Burst. Affects self.
  //   ATK ▲ {p02}% continuously.
  //   Hit Rate ▲ {p03}% continuously.
  //
  // group_id: 22342
  // p00: [31.68, 34.28, 36.88, 39.48, 42.08, 44.68, 47.28, 49.88, 52.48, 55.08] (Pierce damage%)
  // p01: [45, 48.36, 51.72, 55.08, 58.44, 61.8, 65.16, 68.52, 71.88, 75.24] (ATK%)
  // p02: [23.4, 25.32, 27.24, 29.16, 31.08, 33, 34.92, 36.84, 38.76, 40.68] (Hit Rate%)
  //
  // Pierce damage ▲ 仅在 Flash P1（Pierce）生效期间（S1 激活后 3 发）产生收益。
  // Hit Rate ▲ 进入 buff 系统，经 sums.hitRatePct 收缩散布圆，提升核心命中率（见 accuracy.js coreHitChance）。
  skill2: {
    groupId: 22342,
    triggers: [
      // Part1：战斗开始 → 自身 Pierce damage ▲ p00% 永久
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const pct = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Radiant Wings P1', unitId: caster.id,
            pierceDamagePct: pct, endTick: Infinity });
        },
      },

      // Part2：进入全爆裂 → 自身 ATK ▲ p01% + Hit Rate ▲ p02%（全爆裂 10s 内）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const atkPct = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
          const hrPct  = getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]) / 100;
          const end10  = state.tick + TICK_RATE * 10;
          pushBuff(state, { name: 'Radiant Wings P2', unitId: caster.id, atkPct, hitRatePct: hrPct, endTick: end10 });
        },
      },
    ],
  },

  // ── False Salvation
  // ■ Affects self.
  //   Attack speed ▲ {p01}% for {p02=15} sec.
  //   ATK ▲ {p03}% for {p04=15} sec.
  //   Number of pellets ▲ {p05} for {p06=15} sec.
  //
  // group_id: 12343
  // p00: [36.72, 39.86, 43, 46.14, 49.28, 52.43, 55.57, 58.71, 61.86, 65] (Attack speed%)
  // p01: [15, ...] (持续时间, const)
  // p02: [51.08, 55.19, 59.31, 63.42, 67.54, 71.65, 75.77, 79.88, 84, 88.12] (ATK%)
  // p03: [15, ...] (持续时间, const)
  // p04: [3, 3, 3, 3, 3, 3, 3, 3, 3, 5] (弹头增量；lv10=5)
  // p05: [15, ...] (持续时间, const)
  //
  // Attack speed ▲：通过 buff 系统传入，battle.js ROF 累加器读取。
  // 弹丸数 ▲ → buff 字段 pelletFlat：不改单发伤害系数，但影响 S1 弹丸计数与爆裂充能。
  burst: {
    groupId: 12343,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const atkSpdPct  = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const atkPct     = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          const pelletFlat = getSkillValue(caster.rawBurst, 4, caster.skillLevels[2]);
          const end15      = state.tick + TICK_RATE * 15;
          pushBuff(state, { name: 'False Salvation P1', unitId: caster.id, atkSpeedPct: atkSpdPct, atkPct, pelletFlat, endTick: end15 });
        },
      },
    ],
  },
};
