import { pushBuff, applyHeal, applyShield, getBuffSums, getFinalMaxHp, getAdjacentAllies, markMaxHpChange, recalcMaxAmmo, TICK_RATE, ALL_ALLIES } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Flora  (resource_id: 411)
// SSR 珍藏品: Planter We Made Together（id: 201901）
// 所有三个技能槽均被 SSR 珍藏品替换（skill_change_slot=1/2/3），仅建模 SSR 版（见 docs/ssr-collectible-rules.md）。
//
// 相邻友军 = state.squad 中 Flora 左右相邻的槽位（与 272.js Rouge 约定一致）。
// Peace of Mind：用无数值的 buff 'Peace of Mind' 标记处于该状态的单位（Flora 自身 + 相邻友军）。

const PEACE_OF_MIND = 'Peace of Mind';

// Flora 的最终最大 HP（含 maxHpPct / maxHpFlat buff），用于「skill user's final max HP」
function casterFinalMaxHp(state, caster) {
  const sums = getBuffSums(state, caster.id);
  return caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
}

// 按站位判定（空位占位置，隔着空位不相邻）
function adjacentAllies(state, caster) {
  return getAdjacentAllies(state, caster);
}

function peaceOfMindUnits(state) {
  return state.squad.filter(u => state.buffs.some(b => b.name === PEACE_OF_MIND && b.unitId === u.id));
}

// 「增加可叠加 buff 的层数」：目标单位身上所有未满层的可叠加 buff 层数 +count。
// 仅作用于指定给该单位的 buff（unitId === unit.id）；全队共享的 buff（unitId=null）若加层会同时
// 惠及非目标单位，故不处理。
function increaseStackableBuffs(state, unit, count) {
  // 加层可能提升 Max HP（如 Ticket）→ 先记录 HP / MaxHP，供 HP_CHANGED 计算比例变化（无变化则不派发）
  markMaxHpChange(state, [unit]);
  let changed = false;
  for (const b of state.buffs) {
    if (b.unitId !== unit.id || b.isDebuff) continue;
    if (b.endTick !== Infinity && b.endTick <= state.tick) continue;
    const limit = b.stackLimit ?? 1;
    const stacks = b.stacks ?? 1;
    if (limit <= 1 || stacks >= limit) continue;
    b.stacks = Math.min(limit, stacks + count);
    changed = true;
  }
  if (changed) recalcMaxAmmo(state, unit);
  return changed;
}

function isAtMaxHp(state, unit) {
  return unit.unitHp !== undefined && unit.unitHp >= getFinalMaxHp(state, unit);
}

// Iris P2：全员真实伤害 ▲ p03%，p04 秒
function pushIrisTrueDamage(state, caster) {
  const s2 = caster.ssrFavSkills.skill2;
  const lv = s2._activeSkillLevel;
  pushBuff(state, { name: 'Iris (True Damage)', unitId: null,
    trueDamagePct: getSkillValue(s2, 3, lv) / 100,
    endTick: state.tick + TICK_RATE * getSkillValue(s2, 4, lv) });
}

export default {

  // ── Petunia（S1）
  // SSR group_id: 124111（skill_change_slot=1）
  // ■ Activates at the start of battle as long as this unit is alive. Affects self and both adjacent allies.
  //   Peace of Mind: Restores HP equal to {p00}% of the skill user's final max HP every second continuously.
  //   Incoming Healing ▲ {p04}% continuously. Stacks up to {p05} times.
  // ■ Activates after performing {p02} normal attacks. Affects all Electric Code allies.
  //   Increases the stack count of stackable buffs by {p03}.
  // ■ Activates when entering Burst Stage 2. Affects all allies in the Peace of Mind state.
  //   Max HP ▲ {p06}% of the skill user's max HP (without restoring HP) for {p07} sec.
  // p00 heal %/sec (const):     [1,...]
  // p01 （未使用）               [1,...]
  // p02 shots (const):          [100,...]
  // p03 stack increase (const): [1,...]
  // p04 Incoming Healing ▲%:    [2.36 … 4]   — 每层受治疗量 ▲（Peace of Mind buff 的 incomingHealPct，
  //                                             可被 P2「可叠加 buff 层数 +1」加层，上限 p05）
  // p05 max stacks (const):     [5,...]
  // p06 Max HP ▲%:              [8.87 … 15.01]
  // p07 sec (const):            [2,...]
  skill1: {
    groupId: 124111,
    triggers: [
      // P1：战斗开始 → 自身与相邻友军进入 Peace of Mind（永久）：受治疗量 ▲ p04%/层，上限 p05 层
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;
          const unitIds = [caster, ...adjacentAllies(state, caster)].map(u => u.id);
          pushBuff(state, { name: PEACE_OF_MIND, unitIds,
            incomingHealPct: getSkillValue(s1, 4, lv) / 100,
            stackLimit: getSkillValue(s1, 5, lv), endTick: Infinity });
        },
      },
      // P1：Peace of Mind 每秒回复 p00% Flora 最终最大 HP
      // 每秒 3 次治疗不写入战斗日志（避免刷屏），但仍经 pendingHealReceived 分派 HEAL_RECEIVED。
      {
        on: 'INTERVAL',
        opts: { seconds: 1 },
        partOverride: 0,
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          const amount = Math.round(casterFinalMaxHp(state, caster)
            * getSkillValue(s1, 0, s1._activeSkillLevel) / 100);
          const prevCtx = state._logCtx;
          state._logCtx = null;
          for (const u of peaceOfMindUnits(state)) applyHeal(state, u, amount, null, caster);
          state._logCtx = prevCtx;
        },
      },
      // P2：每 100 次普攻 → 全体电击代码友军可叠加 buff 层数 +p03
      {
        on: 'SHOT_COUNT',
        opts: { every: 100, counterKey: 'floraS1ShotCount' },
        partOverride: 1,
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          const count = getSkillValue(s1, 3, s1._activeSkillLevel);
          for (const ally of state.squad.filter(u => u.element === 'Electric')) {
            if (!increaseStackableBuffs(state, ally, count)) continue;
            state.pendingSkillEvents?.push({
              type: 'skill_trigger', tick: state.tick, _seq: state._logSeq++,
              unitName: caster.name, skillLabel: state._logCtx.skillLabel, slot: 'S1',
              partIdx: 1, trigger: 'SHOT_COUNT', lineIdx: null,
              target: ally.name, gaugeAfter: state.burstGauge,
            });
          }
        },
      },
      // P3：进入爆裂阶段 2 → Peace of Mind 友军 Max HP ▲ p06% Flora 最大 HP（不回复）2s
      {
        on: 'ENTER_BURST_II',
        partOverride: 2,
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;
          const maxHpFlat = Math.round(caster.stats.hp * getSkillValue(s1, 6, lv) / 100);
          const endTick   = state.tick + TICK_RATE * getSkillValue(s1, 7, lv);
          pushBuff(state, { name: 'Petunia (Max HP)', unitIds: peaceOfMindUnits(state).map(u => u.id),
            maxHpFlat, endTick });
        },
      },
    ],
  },

  // ── Iris（S2）
  // SSR group_id: 124112（skill_change_slot=2）
  // ■ Activates when the HP of an adjacent ally drops to {p00}% or below while the ally is still alive. Affects all allies.
  //   Creates a shield with HP equal to {p01}% of the skill user's final max HP that lasts for {p02} sec.
  // ■ Activates when either adjacent ally reaches max HP. Affects all allies.
  //   True Damage ▲ {p03}% for {p04} sec.
  // ■ Activates when a shield is placed in front of this unit. Affects all allies in the Peace of Mind state.
  //   ATK ▲ {p05}% of the skill user's ATK for {p06} sec.
  // p00 HP threshold % (const): [90,...]
  // p01 shield %:               [6.04 … 10.22]
  // p02 sec (const):            [10,...]
  // p03 True Damage ▲%:         [18.3 … 30.97]
  // p04 sec (const):            [10,...]
  // p05 ATK ▲% of caster ATK:   [26.66 … 45.12]
  // p06 sec (const):            [10,...]
  skill2: {
    groupId: 124112,
    triggers: [
      // P1：相邻友军 HP 比例下降至 ≤ p00=90% → 全员护盾 p01% Flora 最终 MaxHP，p02 秒
      //     由 HP_CHANGED 驱动，只响应 HP 比例下降：自损类效果，或 Max HP ▲ 使比例下降
      //     （实测：Trina S2 P1 给相邻的 Scarlet 加 Max HP 后触发；游戏内约有 ≤0.1s 检测延迟，未建模）
      {
        on: 'HP_CHANGED',
        handler(state, caster, ctx) {
          if (!ctx.unit || !(ctx.newRatio < ctx.prevRatio)) return false;
          if (!adjacentAllies(state, caster).includes(ctx.unit)) return false;
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          if (ctx.newRatio > getSkillValue(s2, 0, lv) / 100) return false;
          applyShield(state, ALL_ALLIES,
            Math.round(casterFinalMaxHp(state, caster) * getSkillValue(s2, 1, lv) / 100),
            state.tick + TICK_RATE * getSkillValue(s2, 2, lv));
        },
      },
      // P2：相邻友军达到最大 HP → 全员真实伤害 ▲ p03% 10s
      //     满 HP 检查只在两个时机进行：
      //       ① 进入战斗时检查一次（BATTLE_START）；
      //       ② 此后仅在相邻友军的当前 HP 发生变化时检查（HP_CHANGED 且 newHp !== prevHp；
      //          只有 Max HP 变化、当前 HP 未变不算）。
      //     相邻友军始终满 HP 时，治疗不改变 HP → 不触发。
      //     开战检查按站位顺序结算：站在 Flora 左侧的单位的开战效果先生效（实测 Trina 在左时，
      //     Scarlet 先被加 Max HP 变为不满，P2 不触发）。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          if (!adjacentAllies(state, caster).some(u => isAtMaxHp(state, u))) return false;
          pushIrisTrueDamage(state, caster);
        },
      },
      {
        on: 'HP_CHANGED',
        partOverride: 1,
        handler(state, caster, ctx) {
          const u = ctx.unit;
          if (!u || ctx.newHp === ctx.prevHp) return false;
          if (!adjacentAllies(state, caster).includes(u)) return false;
          if (!isAtMaxHp(state, u)) return false;
          pushIrisTrueDamage(state, caster);
        },
      },
      // P3：Flora 获得护盾 → Peace of Mind 友军 ATK ▲ p05% Flora ATK 10s
      {
        on: 'APPLY_SHIELD',
        partOverride: 2,
        handler(state, caster) {
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(s2, 5, lv) / 100);
          const endTick = state.tick + TICK_RATE * getSkillValue(s2, 6, lv);
          pushBuff(state, { name: 'Iris (ATK)', unitIds: peaceOfMindUnits(state).map(u => u.id),
            atkFlat, endTick });
        },
      },
    ],
  },

  // ── Secret Garden（Burst）
  // SSR group_id: 114113（skill_change_slot=3）
  // ■ Affects all allies.
  //   Restores HP equal to {p00}% of the skill user's final max HP.
  //   True Damage ▲ {p01}% for {p02} sec.
  //   ATK ▲ {p03}% of the skill user's ATK for {p04} sec.
  // p00 heal %:               [6.17 … 10.45]
  // p01 True Damage ▲%:       [25.05 … 42.39]
  // p02 sec (const):          [10,...]
  // p03 ATK ▲% of caster ATK: [50.73 … 85.86]
  // p04 sec (const):          [10,...]
  burst: {
    groupId: 114113,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const burst = caster.ssrFavSkills.burst;
          const lv    = burst._activeSkillLevel;

          applyHeal(state, ALL_ALLIES,
            Math.round(casterFinalMaxHp(state, caster) * getSkillValue(burst, 0, lv) / 100),
            { lineIdx: 1 }, caster);
          pushBuff(state, { name: 'Secret Garden (True Damage)', unitId: null,
            trueDamagePct: getSkillValue(burst, 1, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(burst, 2, lv) },
            { ...state._logCtx, lineIdx: 2 });
          pushBuff(state, { name: 'Secret Garden (ATK)', unitId: null,
            atkFlat: Math.round(caster.stats.atk * getSkillValue(burst, 3, lv) / 100),
            endTick: state.tick + TICK_RATE * getSkillValue(burst, 4, lv) },
            { ...state._logCtx, lineIdx: 3 });
        },
      },
    ],
  },
};
