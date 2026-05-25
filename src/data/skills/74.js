import { pushBuff, applyHeal, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// 根据当前 ticket 数量刷新全队最大体力 buff。
// pushBuff 仅更新 endTick，不更新 buff 值，故直接修改 state.buffs。
function refreshTicketMaxHp(state, caster) {
  const count          = caster.skillState.sfTicketCount ?? 0;
  const lv             = caster.skillLevels[0];
  const pctPerTicket   = getSkillValue(caster.rawSkill1, 0, lv) / 100;
  const flat           = Math.round(caster.stats.hp * pctPerTicket * count);

  for (const u of state.squad) {
    const existing = state.buffs.find(b => b.name === 'sft_s1_maxHp' && b.unitId === u.id);
    if (existing) {
      existing.maxHpFlat = flat;
    } else {
      state.buffs.push({ name: 'sft_s1_maxHp', unitId: u.id, maxHpFlat: flat, endTick: Infinity });
    }
  }
}

export default {

  // ── I'll Check Your Ticket!
  // ■ 战斗开始时及使用爆裂技能时激活，影响所有友军。
  //   发放 1 张票（最多累积 2 张，效果持续）。
  //   票效果：最大体力 ▲ 票数 × {p00}% of 施术者最大体力。
  // ■ 进入全爆裂时激活，影响所有友军。
  //   爆裂技能冷却时间 ▼ {p02} 秒。
  // ■ 进入全爆裂时激活，影响所有友军。
  //   移除 First Train Discount。
  //
  // group_id: 20741
  // p00 MaxHP▲% per ticket (of caster MaxHP): [5.91, 6.36, 6.82, 7.27, 7.73, 8.18, 8.64, 9.09, 9.55, 10]
  // p01 最大票数 (const): [2]
  // p02 爆裂CD缩减 sec: [5.34, 5.58, 5.82, 6.05, 6.29, 6.53, 6.77, 7, 7.24, 7.48]
  skill1: {
    groupId: 20741,
    triggers: [
      // Part1：战斗开始 → 发放第 1 张票，应用 MaxHP buff
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          caster.skillState.sfTicketCount = 1;
          refreshTicketMaxHp(state, caster);
        },
      },
      // Part1：Soline 使用爆裂技能 → 再发放 1 张票（最多 2 张）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const count = caster.skillState.sfTicketCount ?? 0;
          if (count < 2) {
            caster.skillState.sfTicketCount = count + 1;
            refreshTicketMaxHp(state, caster);
          }
        },
      },
      // Part2：进入全爆裂 → 全队爆裂技能冷却缩减
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv      = caster.skillLevels[0];
          const cdTicks = Math.round(getSkillValue(caster.rawSkill1, 2, lv) * TICK_RATE);
          for (const u of state.squad) {
            u.burstCdRemaining = Math.max(0, u.burstCdRemaining - cdTicks);
          }
        },
      },
      // Part3：进入全爆裂 → 移除 First Train Discount
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          caster.skillState.sfFirstTrainDiscountEndTick = 0;
        },
      },
    ],
  },

  // ── I'll Help You Board the Train!
  // ■ 队伍中任意成员体力低于 {p00=15}% 时激活，若有票则影响该目标。
  //   恢复施术者最终最大体力的 {p01}% 作为体力。
  //   票数 ▼ 1（First Train Discount 激活期间不消耗）。
  // ■ 战斗开始时激活，影响所有友军。
  //   First Train Discount 持续 {p03=6} 秒。
  //   效果：S2 治疗不消耗票。
  //
  // group_id: 20742
  // p00 HP触发阈值% (const): [15]
  // p01 治疗% of caster MaxHP: [7.25, 7.8, 8.36, 8.92, 9.48, 10.03, 10.59, 11.15, 11.71, 12.27]
  // p02 消耗票数 (const): [1]
  // p03 First Train Discount 持续时间 (const): [6]
  skill2: {
    groupId: 20742,
    triggers: [
      // Part2：战斗开始 → 激活 First Train Discount（6 秒内 S2 不消耗票）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          caster.skillState.sfFirstTrainDiscountEndTick = state.tick + TICK_RATE * 6;
        },
      },
      // Part1：每秒检查 → 若有友军 HP < 15% 且有票，对其治疗（HP 比例最低的优先）
      {
        on: 'INTERVAL',
        opts: { seconds: 1 },
        handler(state, caster) {
          const tickets = caster.skillState.sfTicketCount ?? 0;
          if (tickets <= 0) return;

          const threshold = 0.15;
          const eligible  = state.squad
            .filter(u => u.unitHp / u.stats.hp < threshold)
            .sort((a, b) => (a.unitHp / a.stats.hp) - (b.unitHp / b.stats.hp));
          if (eligible.length === 0) return;

          const lv      = caster.skillLevels[1];
          const healPct = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const sums    = getBuffSums(state, caster.id);
          const maxHp   = caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
          const healAmt = Math.round(maxHp * healPct);

          applyHeal(state, eligible[0], healAmt);

          // First Train Discount 激活期间不消耗票
          const discountActive = (caster.skillState.sfFirstTrainDiscountEndTick ?? 0) > state.tick;
          if (!discountActive) {
            caster.skillState.sfTicketCount = tickets - 1;
            refreshTicketMaxHp(state, caster);
          }
        },
      },
    ],
  },

  // ── I'll Get You There Safely!
  // ■ 影响所有友军。
  //   恢复施术者最终最大体力的 {p00}% 作为体力。
  //
  // group_id: 10743
  // p00 治疗% of caster MaxHP: [19.06, 20.53, 22, 23.46, 24.93, 26.4, 27.86, 29.33, 30.8, 32.26]
  burst: {
    groupId: 10743,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv      = caster.skillLevels[2];
          const healPct = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const sums    = getBuffSums(state, caster.id);
          const maxHp   = caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
          const healAmt = Math.round(maxHp * healPct);

          for (const u of state.squad) applyHeal(state, u, healAmt);
        },
      },
    ],
  },
};
