import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Marciana: Marine Study  (resource_id: 322)
export default {

  // ── Emergency Whistle
  // ■ Activates when entering Full Burst after this unit uses her Burst Skill. Affects the {p01} enemy unit(s) with the highest final Max HP.
  // Flagged Target Designation
  // Effect 1: Deals {p02}% of final ATK as additional damage.
  // Effect 2: Activates when the target is alive. Flagged Target: ATK ▼ {p03}% for {p04} sec.
  // ■ Activates when an enemy is neutralized if the target is in the Flagged Target state. Affects {p01} random enemy unit(s).
  // （同上：p02% 附加伤害 + Flagged Target ATK ▼ p03% p04 秒）
  // ■ Activates when landing {p08} normal attacks against a target in the High-Risk Target state. Affects the target.
  // Deals {p09}% of final ATK as additional damage.
  // p01: [1,...]                （目标数，单 Boss 恒 1）
  // p02: [2239.1 … 3789.25]     （Flagged 附加伤害 %ATK）
  // p03: [6.24 … 10.56]         （敌方 ATK ▼%，防御向 → 不建模）
  // p04: [10,...]               （ATK ▼ 持续秒数）
  // p08: [20,...]               （High-Risk 目标普攻触发阈值）
  // p09: [96.82 … 152.68]       （High-Risk 附加伤害 %ATK）
  //
  // High-Risk Target 状态由本角色 Burst 对「Electric Code 敌人」施加（见 burst）。
  // 默认敌人为 Iron，不会被注入 D.M.T.R. Code，故仅当敌人为 Electric 时进入 High-Risk。
  skill1: {
    groupId: 23221,
    triggers: [
      // S1 Part1：本轮本单位施放爆裂后进入全爆裂 → 对最高 MaxHP 敌人（单 Boss）造成 p02% ATK 附加伤害。
      //   Effect2 敌方 ATK ▼ 为防御向，DPS 模拟不建模。
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          if (!state.burstCastersThisRotation?.has(caster.id)) return;
          if (state.enemyHp <= 0) return;
          const mult = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, mult, sums, 'S1');
        },
      },

      // S1 Part2：敌人被消灭时对存活 Flagged 目标重新指定 → 单 Boss 战中敌人被消灭即战斗结束，无后续目标，不建模。

      // S1 Part3：对处于 High-Risk Target 状态的目标每命中 20 次普攻 → 造成 p09% ATK 附加伤害。
      //   High-Risk 仅在 Burst 后、且敌人为 Electric（被注入 D.M.T.R. Code）时激活，见 burst。
      {
        on: 'SHOT_COUNT',
        opts: { every: 20, counterKey: 'mmsS1P3' },
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          const end = caster.skillState.mms_highRiskEndTick ?? 0;
          if (state.tick >= end) return;
          const mult = getSkillValue(caster.rawSkill1, 8, caster.skillLevels[0]) / 100;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, mult, sums, 'S1 P3');
        },
      },
    ],
  },

  // ── Penguin Emergency Dispatch
  // ■ Activates at the start of battle. Affects self.
  // Whistle: ATK ▲ {p01}% continuously. Stacks up to {p02} times. Whistle stacks ▲ {p03}.
  // ■ Activates every time there are {p04} or fewer Raptures present for a period of {p05} sec. Affects self.
  // Whistle: ATK ▲ {p01}% continuously. Stacks up to {p02} times.
  // ■ Activates every time there are {p06} or more Raptures present for a period of {p07} sec.
  // Penguin Emergency Dispatch：消耗 Whistle 层数攻击（≥6 Raptures 时）。Effect1 全体敌人 {p08}% ATK 附加伤害；Effect2 自身 Whistle ▼ {p09}。
  // ■ Only activates when a Rapture appears or is neutralized while there are {p10} or fewer Raptures. Affects self.
  // Elemental Advantage Attack Damage ▲ {p11}% continuously.
  // p01: [19.34 … 32.73]   （每层 Whistle ATK ▲%）
  // p02: [5,...]           （Whistle 层数上限）
  // p03: [4,...]           （开局 Whistle 初始层数）
  // p04: [3,...]           （Raptures ≤3 阈值）
  // p05: [5,...]           （周期秒数）
  // p06: [6,...] / p07:[1] / p08:[126.67 … 214.36] / p09:[1]  （≥6 Raptures 分支）
  // p10: [5,...]           （Raptures ≤5 阈值）
  // p11: [12.06 … 20.41]   （属性优势攻击伤害 ▲%）
  //
  // 单 Boss 战：Rapture 数恒为 1（≤3、≤5 条件恒真；≥6 条件恒假）。
  //   → Whistle 每 5 秒 +1 层（开局 4 层，5 秒后满 5 层）。
  //   → 属性优势攻击伤害 ▲ 在开局（Boss 出现，≤5）永久生效。
  //   → ≥6 Raptures 的 Penguin Emergency Dispatch 附加伤害分支永不触发，不建模。
  skill2: {
    groupId: 23222,
    triggers: [
      // S2 Part1：战斗开始 → Whistle 获得 p03=4 初始层，每层 ATK ▲ p01%，上限 p02=5。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const atkPct     = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          const maxStacks  = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]);
          const initStacks = getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]);
          pushBuff(state, { name: 'Whistle', unitId: caster.id,
            atkPct, stacks: initStacks, stackLimit: maxStacks, endTick: Infinity });
        },
      },

      // S2 Part2：≤3 Raptures（单 Boss 恒真）每 p05=5 秒 → Whistle +1 层（上限 p02=5）。
      {
        on: 'INTERVAL',
        opts: { seconds: 5 },
        handler(state, caster) {
          const atkPct    = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          const maxStacks = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]);
          pushBuff(state, { name: 'Whistle', unitId: caster.id,
            atkPct, stackLimit: maxStacks, endTick: Infinity });
        },
      },

      // S2 Part4：Boss 出现（≤5 Raptures）→ 属性优势攻击伤害 ▲ p11% 永久。
      //   （默认敌人 Iron 时 elementAdvantagePct 收益为 0；faithful 建模，敌人为 Electric 时生效。）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const elemAdvPct = getSkillValue(caster.rawSkill2, 10, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Penguin Emergency Dispatch', unitId: caster.id,
            elementAdvantagePct: elemAdvPct, endTick: Infinity });
        },
      },
    ],
  },

  // ── Penguin Spiral
  // ■ Affects self.
  // Elemental Advantage Attack Damage ▲ {p01}% for {p02} sec.
  // Attack Damage ▲ {p03}% for {p04} sec.
  // ■ Affects all Electric Code enemies.
  // High-Risk Target: DEF ▼ {p05}% for {p06} sec.
  // p01: [18.3 … 30.97]   （属性优势攻击伤害 ▲%，10s）
  // p02: [10,...]
  // p03: [16.22 … 27.45]  （攻击伤害 ▲%，10s）
  // p04: [10,...]
  // p05: [6.24 … 10.56]   （敌方 DEF ▼%，High-Risk）
  // p06: [20,...]         （High-Risk 持续秒数）
  //
  // 敌方 DEF ▼ 无法通过 buff 系统建模（enemyDef 由 enemyDefActions 脚本驱动），不建模。
  // 但 High-Risk Target 状态会被记录（供 S1 Part3 判定），仅当敌人为 Electric Code（即 Electric 属性）时生效。
  burst: {
    groupId: 13223,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const end10      = state.tick + TICK_RATE * 10;
          const elemAdvPct = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const atkDmgPct  = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'Penguin Spiral', unitId: caster.id,
            elementAdvantagePct: elemAdvPct, attackDamagePct: atkDmgPct, endTick: end10 });

          // High-Risk Target：仅对 Electric Code 敌人（Electric 属性）激活，持续 p06=20s。
          //   DEF ▼ 本身不建模；此状态用于 S1 Part3 的 High-Risk 附加伤害判定。
          if (state.enemyElement === 'Electric') {
            const durSec = getSkillValue(caster.rawBurst, 5, caster.skillLevels[2]);
            caster.skillState.mms_highRiskEndTick = state.tick + TICK_RATE * durSec;
          }
        },
      },
    ],
  },
};
