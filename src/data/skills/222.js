import { pushBuff, getBuffSums, getHpRatio, getFinalMaxHp, applyHpLoss, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Scarlet  (resource_id: 222)
// S2 Part2 激活条件：HP < 60%（首次低于阈值时永久生效，不重复叠加）
function checkAndApplyS2P2(state, caster) {
  if (caster.skillState.scS2CritApplied) return;
  if (getHpRatio(state, caster) >= 0.6) return;
  caster.skillState.scS2CritApplied = true;
  const lv    = caster.skillLevels[1];
  const cdPct = getSkillValue(caster.rawSkill2, 3, lv) / 100;
  // 可由 S1 handler 触发，日志显式归属到 S2；S2 唯一的效果段（P1 为伤害）→ 省略 P 后缀
  pushBuff(state, { name: 'Zatoichi', unitId: caster.id,
    critDamagePct: cdPct, endTick: Infinity },
    { ...state._logCtx, skillLabel: caster.rawSkill2?.name_localkey ?? 'S2', slot: 'S2', partIdx: null, lineIdx: null });
}

export default {

  // ── Blood for Blood
  // ■ Activates after landing {p00=10} normal attack(s). Affects self.
  //   ATK ▲ {p01}%, stacks up to {p03=5} time(s) and lasts for {p02=5} sec.
  //   Current HP ▼ {p04=4.01}%.
  //
  // group_id: 22221
  // p00 (shot threshold, const): [10, ...]
  // p01 ATK▲% per stack: [17.48, 18.11, 18.74, 19.37, 20, 20.63, 21.26, 21.89, 22.52, 23.15]
  // p02 duration (const): [5, ...]
  // p03 max stacks (const): [5, ...]
  // p04 current HP cost% (const): [4.01, ...]
  skill1: {
    groupId: 22221,
    triggers: [
      {
        on: 'SHOT_COUNT',
        opts: { every: 10, counterKey: 'sc_s1' },
        handler(state, caster) {
          const lv      = caster.skillLevels[0];
          const atkPct  = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          const endTick = state.tick + TICK_RATE * 5;

          // ATK ▲ 叠层（最多 p03 层），每次触发新增一层并刷新整体持续时间
          pushBuff(state, { name: 'Blood for Blood', unitId: caster.id,
            atkPct, stackLimit: getSkillValue(caster.rawSkill1, 3, lv), endTick });

          // 「Current HP ▼ p04%」：按当前 HP 的 p04% 扣减（HP 不低于 1；不单独写日志，与 ATK 叠层同段）
          // S2 P2 的阈值检测由 HP_CHANGED 事件驱动
          const hpCostPct = getSkillValue(caster.rawSkill1, 4, lv) / 100;
          applyHpLoss(state, caster, Math.round((caster.unitHp ?? getFinalMaxHp(state, caster)) * hpCostPct), false);
        },
      },
    ],
  },

  // ── Zatoichi
  // ■ There is a {p00=30}% chance of activating when attacked. Affects self.
  //   Deals {p01}% of final ATK as additional damage.
  //   [TODO: "when attacked" 事件在模拟器中不建模，此部分跳过]
  // ■ Activates when HP falls below {p02=60}%. Affects self.
  //   Critical Damage ▲ {p03}% continuously.
  //
  // group_id: 22222
  // p00 chance (const): [30, ...]
  // p01 additional damage% of final ATK: [86.39, 92.15, 97.91, 103.68, 109.44, 115.2, 120.96, 126.72, 132.48, 138.24]
  // p02 HP threshold (const): [60, ...]
  // p03 Critical Damage▲%: [4.13, 4.4, 4.68, 4.95, 5.23, 5.51, 5.78, 6.06, 6.33, 6.61]
  skill2: {
    groupId: 22222,
    triggers: [
      // Part2：自身 HP 变化（S1 自损等）→ 检测 HP < 60%（首次满足永久生效）
      {
        on: 'HP_CHANGED',
        handler(state, caster, ctx) {
          if (ctx.unit?.id !== caster.id) return false;
          checkAndApplyS2P2(state, caster);
        },
      },
    ],
  },

  // ── Scarlet Flash
  // ■ Affects self. Activates when HP falls below {p00=50}%.
  //   Critical Rate ▲ {p01}% for {p02=10} sec.
  // ■ Affects all enemies.
  //   Deals {p03}% of final ATK as Burst Skill damage.
  //
  // group_id: 12223
  // p00 HP threshold (const): [50, ...]
  // p01 Critical Rate▲%: [12.23, 13.05, 13.86, 14.68, 15.49, 16.31, 17.12, 17.94, 18.75, 19.57]
  // p02 duration (const): [10, ...]
  // p03 burst damage% of final ATK: [530.71, 566.1, 601.48, 636.86, 672.24, 707.62, 743, 778.38, 813.76, 849.15]
  burst: {
    groupId: 12223,
    triggers: [
      // Burst P1：HP < 50% → 自身 Crit Rate ▲[p01]% 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (getHpRatio(state, caster) >= 0.5) return false;
          const lv    = caster.skillLevels[2];
          const crPct = getSkillValue(caster.rawBurst, 1, lv) / 100;
          // 爆裂技能唯一的效果段（P2 为伤害）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Scarlet Flash', unitId: caster.id,
            critRatePct: crPct, endTick: state.tick + TICK_RATE * 10 },
            { ...state._logCtx, partIdx: null });
        },
      },
      // Burst P2：进入全爆裂后 1.38s 触发爆裂伤害（B3 施放后 1.43s，引擎统一后移 0.05s；sums 在 P1 crit buff 生效后捕获）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv        = caster.skillLevels[2];
          const burstMult = getSkillValue(caster.rawBurst, 3, lv) / 100;
          const sumsSnap  = getBuffSums(state, caster.id);
          state.pendingSkillHits.push({
            fireTick:  state.tick + Math.round(1.38 * TICK_RATE),
            caster,
            mult:      burstMult,
            sums:      sumsSnap,
            isCharged: false,
            label:     'Burst',
          });
        },
      },
    ],
  },
};
