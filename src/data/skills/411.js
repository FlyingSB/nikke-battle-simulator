import { pushBuff, applyHeal, getBuffSums, recalcMaxAmmo, TICK_RATE, ALL_ALLIES } from '../../engine/battle-utils.js';
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

function adjacentAllies(state, caster) {
  const idx = state.squad.indexOf(caster);
  return [state.squad[idx - 1], state.squad[idx + 1]].filter(Boolean);
}

function peaceOfMindUnits(state) {
  return state.squad.filter(u => state.buffs.some(b => b.name === PEACE_OF_MIND && b.unitId === u.id));
}

// 「增加可叠加 buff 的层数」：目标单位身上所有未满层的可叠加 buff 层数 +count。
// 仅作用于指定给该单位的 buff（unitId === unit.id）；全队共享的 buff（unitId=null）若加层会同时
// 惠及非目标单位，故不处理。
function increaseStackableBuffs(state, unit, count) {
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
  // p04 Incoming Healing ▲%:    [2.36 … 4]   — 受治疗量加成不建模（对输出无影响）
  // p05 max stacks (const):     [5,...]
  // p06 Max HP ▲%:              [8.87 … 15.01]
  // p07 sec (const):            [2,...]
  skill1: {
    groupId: 124111,
    triggers: [
      // P1：战斗开始 → 自身与相邻友军进入 Peace of Mind（永久）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          for (const u of [caster, ...adjacentAllies(state, caster)]) {
            pushBuff(state, { name: PEACE_OF_MIND, unitId: u.id, endTick: Infinity });
          }
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
          for (const u of peaceOfMindUnits(state)) applyHeal(state, u, amount);
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
          for (const u of peaceOfMindUnits(state)) {
            pushBuff(state, { name: 'Petunia P3', unitId: u.id, maxHpFlat, endTick });
          }
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
      // P1：相邻友军 HP ≤ 90% — 模拟器不建模敌方伤害，占位
      {},
      // P2：相邻友军达到最大 HP → 全员真实伤害 ▲ p03% 10s
      // 「达到最大 HP」以 Peace of Mind 每秒治疗为触发契机：S1 INTERVAL 先于本触发器执行
      // （同 tick 内 skill1 → skill2 顺序），治疗后任一相邻友军满血即触发。
      {
        on: 'INTERVAL',
        opts: { seconds: 1 },
        handler(state, caster) {
          const reached = adjacentAllies(state, caster).some(u => u.unitHp >= u.stats.hp);
          if (!reached) return;
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          pushBuff(state, { name: 'Iris P2', unitId: null,
            trueDamagePct: getSkillValue(s2, 3, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 4, lv) });
        },
      },
      // P3：Flora 获得护盾 → Peace of Mind 友军 ATK ▲ p05% Flora ATK 10s
      {
        on: 'APPLY_SHIELD',
        handler(state, caster) {
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(s2, 5, lv) / 100);
          const endTick = state.tick + TICK_RATE * getSkillValue(s2, 6, lv);
          for (const u of peaceOfMindUnits(state)) {
            pushBuff(state, { name: 'Iris P3', unitId: u.id, atkFlat, endTick });
          }
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
            { lineIdx: 0 });
          pushBuff(state, { name: 'Secret Garden L2', unitId: null,
            trueDamagePct: getSkillValue(burst, 1, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(burst, 2, lv) },
            { ...state._logCtx, lineIdx: 1 });
          pushBuff(state, { name: 'Secret Garden L3', unitId: null,
            atkFlat: Math.round(caster.stats.atk * getSkillValue(burst, 3, lv) / 100),
            endTick: state.tick + TICK_RATE * getSkillValue(burst, 4, lv) },
            { ...state._logCtx, lineIdx: 2 });
        },
      },
    ],
  },
};
