import { pushBuff, applyHeal, getBuffSums, getHpRatio, TICK_RATE, ALL_ALLIES } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Soline: Frost Ticket  (resource_id: 74)

const TICKET          = 'Ticket';
const FIRST_TRAIN     = 'First Train Discount';
const MAX_TICKETS     = 2;

// 向全体友军各发放 1 张票：每名队员独立持有可叠层 buff（层数 = 票数，上限 2），
// 每层最大体力 ▲ 施术者最大体力 × p00%。按队员拆分是因为 S2 只消耗被治疗目标的票。
function issueTicket(state, caster) {
  const lv        = caster.skillLevels[0];
  const maxHpFlat = Math.round(caster.stats.hp * getSkillValue(caster.rawSkill1, 0, lv) / 100);
  pushBuff(state, { name: TICKET, unitIds: state.squad.map(u => u.id), maxHpFlat,
    stackLimit: MAX_TICKETS, endTick: Infinity });
}

function findTicket(state, unitId) {
  return state.buffs.find(b => b.name === TICKET && b.unitId === unitId && (b.stacks ?? 1) > 0);
}

// 消耗目标 1 张票；归零时移除 buff，下次发票时重新以 1 层推入
function consumeTicket(state, ticket) {
  ticket.stacks = (ticket.stacks ?? 1) - 1;
  if (ticket.stacks <= 0) state.buffs = state.buffs.filter(b => b !== ticket);
}

function isFirstTrainActive(state) {
  return state.buffs.some(b => b.name === FIRST_TRAIN && b.endTick > state.tick);
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
          issueTicket(state, caster);
        },
      },
      // Part1：Soline 使用爆裂技能 → 再发放 1 张票（每名队员最多 2 张）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          issueTicket(state, caster);
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
        handler(state) {
          state.buffs = state.buffs.filter(b => b.name !== FIRST_TRAIN);
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
      // Part1：任意队员 HP 变化（下降）后低于 p00=15% 且持票 → 对其治疗
      //   由 HP_CHANGED 驱动：只响应 HP 下降（治疗后仍低于阈值不会连锁再触发）
      {
        on: 'HP_CHANGED',
        handler(state, caster, ctx) {
          const target = ctx.unit;
          if (!target || !(ctx.newHp < ctx.prevHp)) return false;
          const lv        = caster.skillLevels[1];
          const threshold = getSkillValue(caster.rawSkill2, 0, lv) / 100;
          if (getHpRatio(state, target) >= threshold || !findTicket(state, target.id)) return false;

          const healPct = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const sums    = getBuffSums(state, caster.id);
          const maxHp   = caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
          const healAmt = Math.round(maxHp * healPct);

          applyHeal(state, target, healAmt, null, caster);

          // First Train Discount 激活期间不消耗票；否则消耗被治疗目标 1 张票
          if (!isFirstTrainActive(state)) consumeTicket(state, findTicket(state, target.id));
        },
      },
      // Part2：战斗开始 → 全体友军获得 First Train Discount（p03 秒内 S2 不消耗票）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const sec = getSkillValue(caster.rawSkill2, 3, caster.skillLevels[1]);
          pushBuff(state, { name: FIRST_TRAIN, unitId: null, endTick: state.tick + Math.round(TICK_RATE * sec) });
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

          applyHeal(state, ALL_ALLIES, healAmt, null, caster);
        },
      },
    ],
  },
};
