import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE, getFinalAtk } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Soda: Twinkling Bunny  (resource_id: 314)
// Golden Chip 暴击伤害 buff 直接更新（pushBuff 同名只刷新 endTick，不更新数值）
function updateGoldenChipCritDmg(state, caster) {
  const stacks = caster.skillState.soda_goldenChipStacks ?? 0;
  const lv     = caster.skillLevels[0];
  const pct    = getSkillValue(caster.rawSkill1, 2, lv) / 100;
  const existing = state.buffs.find(b => b.name === 'Golden Chip' && b.unitId === caster.id);
  if (existing) {
    existing.critDamagePct = pct * stacks;
    existing.multiplier    = stacks;
  } else if (stacks > 0) {
    state.buffs.push({ name: 'Golden Chip', unitId: caster.id,
      critDamagePct: pct * stacks, multiplier: stacks, endTick: Infinity });
  }
}

export default {

  // ── Lucky Golden Chip
  // ■ 战斗开始时激活，影响自身。
  //   Golden Chip 层数 ▲ {p00}。
  // ■ 全爆裂期间投出 {p01=3} 次普通攻击后激活，影响自身。
  //   Golden Chip：暴击伤害 ▲ {p02}%（持续），层数上限 {p03=50} 层。
  // ■ 全爆裂期间投出 {p01=3} 次普通攻击后激活，影响自身及 {p06=1} 名最终 ATK 最高的友军（施放者除外）。
  //   攻击伤害 ▲ {p04}%，持续 {p05=2} 秒。
  //
  // group_id: 23141
  // p00 初始 Golden Chip 层数: [40, 40, 40, 45, 45, 45, 50, 50, 50, 50]
  // p01 触发所需普通攻击次数 (const): [3]
  // p02 暴击伤害▲%/层: [1.24, 1.25, 1.25, 1.26, 1.27, 1.28, 1.29, 1.30, 1.31, 1.32]
  // p03 暴击伤害层数上限 (const): [50]
  // p04 攻击伤害▲%: [7.42, 7.77, 8.11, 8.45, 8.80, 9.14, 9.48, 9.82, 10.17, 10.51]
  // p05 攻击伤害持续时间 (const): [2]
  // p06 友军数量 (const): [1]
  skill1: {
    groupId: 23141,
    triggers: [
      // S1 Part1: 战斗开始 → Golden Chip 层数初始化（同时建立暴击伤害 buff）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          const initStacks = getSkillValue(caster.rawSkill1, 0, lv);
          caster.skillState.soda_goldenChipStacks = initStacks;
          updateGoldenChipCritDmg(state, caster);
        },
      },
      // S1 Part2 + Part3: 全爆裂期间每 3 次普通攻击
      //   → Golden Chip 暴击伤害 ▲ p02%（层数 +1，上限 50）
      //   → 自身 + ATK 最高友军 攻击伤害 ▲ p04% 2s
      {
        on: 'SHOT_COUNT',
        opts: { every: 3, counterKey: 'soda_s1_shotCounter' },
        conditions: [{ type: 'IN_FULL_BURST' }],
        handler(state, caster) {
          const lv = caster.skillLevels[0];

          // Part2: Golden Chip 层数 +1（上限 50）
          const curStacks = caster.skillState.soda_goldenChipStacks ?? 0;
          if (curStacks < 50) {
            caster.skillState.soda_goldenChipStacks = curStacks + 1;
            updateGoldenChipCritDmg(state, caster);
          }

          // Part3: 攻击伤害 ▲ p04% 2s，影响自身 + ATK 最高的 1 名友军（施放者除外）
          const attackDmgPct = getSkillValue(caster.rawSkill1, 4, lv) / 100;
          const end2         = state.tick + TICK_RATE * 2;

          const allies  = state.squad.filter(u => u.id !== caster.id)
            .sort((a, b) => getFinalAtk(state, b) - getFinalAtk(state, a));  // "highest final ATK"
          const unitIds = [caster.id, ...allies.slice(0, 1).map(u => u.id)];
          pushBuff(state, { name: 'Lucky Golden Chip (Attack Damage)', unitIds,
            attackDamagePct: attackDmgPct, endTick: end2 }, { ...state._logCtx, partIdx: 2 });
        },
      },
    ],
  },

  // ── Beginner's Rewards
  // ■ 进入爆裂阶段 3 时激活，影响全体友军。根据 Golden Chip 层数触发附加效果（低阶效果重复触发）：
  //   阶段 1：Golden Chip ≥ {p00=10} 层。
  //     Time Extension I：全爆裂时间 ▲ {p01=2} 秒（全爆裂期间有效）。
  //   阶段 2：Golden Chip ≥ {p02=20} 层。
  //     Time Extension II：全爆裂时间 ▲ {p03=3} 秒（全爆裂期间有效）。
  // ■ 全爆裂期间普通攻击时激活，影响最近的 {p04=1} 名敌人。根据 Time Extension 状态触发附加效果（低阶重复触发）：
  //   阶段 1：处于 Time Extension I 状态时。
  //     对敌人造成最终 ATK × {p05}% 的伤害。
  //   阶段 2：处于 Time Extension II 状态时。
  //     对敌人造成最终 ATK × {p06}% 的伤害（Stage 1 同时触发）。
  //
  // group_id: 23142
  // p00 Time Extension I 阈值 (const): [10]
  // p01 Time Extension I 延长时间 (const): [2]
  // p02 Time Extension II 阈值 (const): [20]
  // p03 Time Extension II 延长时间 (const): [3]
  // p04 敌人目标数量 (const): [1]
  // p05 Stage 1 伤害%: [27.63, 30.35, 33.06, 35.77, 38.48, 41.19, 43.91, 46.62, 49.33, 52.04]
  // p06 Stage 2 伤害%: [45.97, 50.31, 54.64, 58.98, 63.32, 67.66, 72.00, 76.34, 80.68, 85.02]
  skill2: {
    groupId: 23142,
    triggers: [
      // S2 Part1: 进入 B3 → 根据 Golden Chip 层数延长全爆裂时间并设置 Time Extension 状态
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const stacks = caster.skillState.soda_goldenChipStacks ?? 0;

          // 低阶效果重复触发：≥10 层 +2s，≥20 层再 +3s
          if (stacks >= 10) {
            state.fullBurstTick += TICK_RATE * 2;
            caster.skillState.soda_timeExtI = true;
          }
          if (stacks >= 20) {
            state.fullBurstTick += TICK_RATE * 3;
            caster.skillState.soda_timeExtII = true;
          }
        },
      },
      // S2 Part2: 全爆裂期间每次普通攻击 → 根据 Time Extension 状态对最近敌人造成伤害
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'soda_s2_shotCounter' },
        conditions: [{ type: 'IN_FULL_BURST' }],
        handler(state, caster) {
          if (!caster.skillState.soda_timeExtI && !caster.skillState.soda_timeExtII) return;
          if (state.enemyHp <= 0) return;

          const lv   = caster.skillLevels[1];
          const sums = getBuffSums(state, caster.id);
          let mult   = 0;

          // Stage 1（低阶触发）
          if (caster.skillState.soda_timeExtI) {
            mult += getSkillValue(caster.rawSkill2, 5, lv) / 100;
          }
          // Stage 2（低阶重复触发 Stage 1）
          if (caster.skillState.soda_timeExtII) {
            mult += getSkillValue(caster.rawSkill2, 5, lv) / 100;  // Stage 1 重复
            mult += getSkillValue(caster.rawSkill2, 6, lv) / 100;  // Stage 2
          }

          if (mult > 0) {
            fireSkillHit(state, caster, mult, sums, 'S2');
          }
        },
      },
      // S2 清理: 全爆裂结束 → 重置 Time Extension 状态
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          caster.skillState.soda_timeExtI  = false;
          caster.skillState.soda_timeExtII = false;
        },
      },
    ],
  },

  // ── Onward, Soda!
  // ■ 使用爆裂技能时激活。根据 Golden Chip 层数触发附加效果（低阶重复触发）。效果生效后 Golden Chip 层数 ▼ {p00=17}。
  //   阶段 1：影响所有敌人。
  //     造成最终 ATK × {p01}% 的爆裂技能伤害。
  //   阶段 2：Golden Chip ≥ {p02=20} 层时激活，影响自身。
  //     命中率 ▲ {p03}%，持续 {p04=15} 秒。（命中率当前未建模，buff 记录但不影响伤害计算）
  //   阶段 3：Golden Chip ≥ {p05=30} 层时激活，影响自身。
  //     ATK ▲ {p06}%，持续 {p07=15} 秒。
  //
  // group_id: 13143
  // p00 消耗层数 (const): [17]
  // p01 爆裂伤害%: [484.84, 500.83, 516.81, 532.80, 548.78, 564.76, 580.75, 596.73, 612.72, 628.70]
  // p02 Stage 2 阈值 (const): [20]
  // p03 命中率▲%: [12.64, 15.56, 18.48, 21.40, 24.32, 27.24, 30.16, 33.08, 36.00, 38.91]
  // p04 命中率持续时间 (const): [15]
  // p05 Stage 3 阈值 (const): [30]
  // p06 ATK▲%: [30.23, 34.12, 38.01, 41.90, 45.79, 49.68, 53.58, 57.47, 61.36, 65.25]
  // p07 ATK 持续时间 (const): [15]
  burst: {
    groupId: 13143,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv     = caster.skillLevels[2];
          const stacks = caster.skillState.soda_goldenChipStacks ?? 0;
          const end15  = state.tick + TICK_RATE * 15;

          // Stage 2（≥20 层）: 先提升命中率（命中率当前不影响伤害计算）
          if (stacks >= 20) {
            const hitRatePct = getSkillValue(caster.rawBurst, 3, lv) / 100;
            pushBuff(state, { name: 'Onward, Soda! (Hit Rate)', unitId: caster.id,
              hitRatePct: hitRatePct, endTick: end15 });
          }

          // Stage 3（≥30 层）: 先提升 ATK（让 Stage 1 伤害能纳入此加成）
          if (stacks >= 30) {
            const atkPct = getSkillValue(caster.rawBurst, 6, lv) / 100;
            pushBuff(state, { name: 'Onward, Soda! (ATK)', unitId: caster.id,
              atkPct, endTick: end15 });
          }

          // Stage 1（始终触发）: 全体爆裂技能伤害（默认结算，不受全爆裂 +50% 补正影响）
          if (state.enemyHp > 0) {
            const burstMult = getSkillValue(caster.rawBurst, 1, lv) / 100;
            const sums      = getBuffSums(state, caster.id);
            fireSkillHit(state, caster, burstMult, sums, 'Burst');
          }

          // 效果生效后消耗 17 层（不低于 0）
          const consumed = getSkillValue(caster.rawBurst, 0, lv);
          caster.skillState.soda_goldenChipStacks = Math.max(0, stacks - consumed);
          updateGoldenChipCritDmg(state, caster);
        },
      },
    ],
  },
};
