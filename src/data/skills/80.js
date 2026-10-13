import { pushBuff, applyHeal, applyOverhealStorage, applySharedShield, fireSkillHit, getBuffSums, getFinalMaxHp,
         TICK_RATE, ALL_ALLIES, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { ACTIVE_SKILL_COOLDOWN_SEC } from '../active-skill-cooldowns.js';

// Character: Centi  (resource_id: 80)
// SSR 珍藏品: Metal Pendant（id: 201601）
// 所有三个技能槽均被 SSR 珍藏品替换（skill_change_slot=1/2/3），仅建模 SSR 版（见 docs/ssr-collectible-rules.md）。
// 技能文本为 2026-06-11 珍藏品技能调整后的版本（本地静态数据已同步自 CDN）。
//
// S2 为主动技能（CharacterSkill 表），CDN 不提供冷却时间，人工填写：9s（prydwen.gg / nikke.gg 角色页）。
// 与 220 / 832 约定一致：战斗开始先进入冷却，首次施放于 t+9s（扣除 S1 P1 的缩减）。
// S1 P1「Cooldown of Skill 2 ▼ p00%」= 剩余冷却减少「总冷却 × p00%」（9s × 9.16% ≈ 0.82s，与攻略实测一致）。
const S2_COOLDOWN_SEC   = ACTIVE_SKILL_COOLDOWN_SEC[80].skill2;  // 9s
const S2_COOLDOWN_TICKS = S2_COOLDOWN_SEC * TICK_RATE;

const STOCKPILE = 'Stockpile';

// 向战斗日志推入一条无 buff 的技能触发记录（如冷却缩减）
function emitSkillEvent(state, ctx, target) {
  if (!ctx) return;
  state.pendingSkillEvents?.push({
    type: 'skill_trigger', tick: state.tick, _seq: state._logSeq++,
    unitName: ctx.unitName, skillLabel: ctx.skillLabel, slot: ctx.slot,
    partIdx: ctx.partIdx, trigger: ctx.trigger ?? '', lineIdx: ctx.lineIdx ?? null,
    target, gaugeAfter: state.burstGauge,
  });
}

// S1 P2：S2 施放时 → 全体钢铁代码友军 属性克制攻击伤害 ▲ p01%，最多 p03 层，p02 秒
function onFieldDiscussionCast(state, caster, trigger) {
  const s1 = caster.ssrFavSkills.skill1;
  const lv = s1._activeSkillLevel;
  const unitIds = state.squad.filter(u => u.element === 'Iron').map(u => u.id);
  pushBuff(state, { name: 'Maintain Fortification (Elem Adv Damage)', unitIds,
    elementAdvantagePct: getSkillValue(s1, 1, lv) / 100,
    stackLimit: getSkillValue(s1, 3, lv),
    endTick: state.tick + TICK_RATE * getSkillValue(s1, 2, lv) },
    { unitName: caster.name, skillLabel: s1.name_localkey ?? 'S1', slot: 'S1',
      partIdx: 1, lineIdx: null, trigger });
}

// S2：Field Discussion 施放（冷却就绪时由 INTERVAL 轮询触发）
function castFieldDiscussion(state, caster) {
  const s2 = caster.ssrFavSkills.skill2;
  const lv = s2._activeSkillLevel;
  const trigger = state._logCtx?.trigger ?? 'INTERVAL';
  const s2Ctx = { unitName: caster.name, skillLabel: s2.name_localkey ?? 'S2', slot: 'S2',
    partIdx: 0, lineIdx: null, trigger };

  // P1：共享护盾（shared shield）= p00% 施法者最终最大 HP，p01 秒
  // 共享护盾是全队共用的单一护盾池，不是给各单位「施加护盾」：
  // 不写入 unit.shieldHp、不派发 APPLY_SHIELD（Naga S1 P2「when applying Shield」不应被触发）。
  const prevCtx = state._logCtx;
  state._logCtx = s2Ctx;
  applySharedShield(state,
    Math.round(getFinalMaxHp(state, caster) * getSkillValue(s2, 0, lv) / 100),
    state.tick + TICK_RATE * getSkillValue(s2, 1, lv));
  state._logCtx = prevCtx;

  // P2：全员 ATK ▲ p02% 施法者 ATK（固定值），最多 p03 层，p04 秒
  pushBuff(state, { name: 'Field Discussion (ATK)', unitId: null,
    atkFlat: Math.round(caster.stats.atk * getSkillValue(s2, 2, lv) / 100),
    stackLimit: getSkillValue(s2, 3, lv),
    endTick: state.tick + TICK_RATE * getSkillValue(s2, 4, lv) },
    { ...s2Ctx, partIdx: 1 });

  // 重新进入冷却
  caster.skillState.centiS2ReadyTick = state.tick + S2_COOLDOWN_TICKS;

  // S1 P2 随 S2 施放触发
  onFieldDiscussionCast(state, caster, trigger);
}

export default {

  // ── Maintain Fortification（S1）
  // SSR group_id: 120801（skill_change_slot=1）
  // ■ Activates when landing a Full Charge attack. Affects self.
  //   Cooldown of Skill 2 ▼ {p00}%.
  // ■ Activates when Skill 2 activates. Affects all Iron Code allies.
  //   Elemental Advantage Attack Damage ▲ {p01}%. Stacks up to {p03} times and lasts for {p02} sec.
  // ■ Activates at the start of battle. Affects all allies.
  //   Stockpile: Stores excess incoming healing, up to {p05}% of the skill user's max HP. Lasts for {p06} sec.
  //   Restores HP equal to {p07}% of the skill user's final max HP.
  // ■ Activates when an ally's HP (including this unit's) drops to {p08}% or below while this unit is in the
  //   Stockpile state. Affects all allies.
  //   Restores HP equal to {p04}% of the skill user's final max HP.
  // p00 S2 Cooldown ▼%:                [4.58,5.09,5.6,6.11,6.62,7.12,7.63,8.14,8.65,9.16]
  // p01 Elem Adv Attack Damage ▲%:     [3.13,3.41,3.7,3.98,4.27,4.56,4.84,5.12,5.41,5.69]
  // p02 sec (const):                   [10,...]
  // p03 max stacks (const):            [10,...]
  // p04 P4 heal % final max HP:        [3.5,3.88,4.27,4.66,5.04,5.44,5.83,6.22,6.6,7]
  // p05 Stockpile cap % max HP:        [3.5,3.88,4.27,4.66,5.04,5.44,5.83,6.22,6.6,7]   — 溢出治疗储存上限（施法者基础 MaxHP）
  // p06 Stockpile sec (const):         [5,...]
  // p07 P3 heal % final max HP:        [3.5,3.88,4.27,4.66,5.04,5.44,5.83,6.22,6.6,7]
  // p08 HP threshold % (const):        [100,...]
  skill1: {
    groupId: 120801,
    triggers: [
      // P1：全蓄力命中 → S2 剩余冷却 ▼ 总冷却 × p00%
      {
        on: 'FULL_CHARGE',
        handler(state, caster, ctx) {
          const s1 = caster.ssrFavSkills.skill1;
          const reduction = Math.round(S2_COOLDOWN_TICKS * getSkillValue(s1, 0, s1._activeSkillLevel) / 100);
          const ready = caster.skillState.centiS2ReadyTick ?? S2_COOLDOWN_TICKS;
          caster.skillState.centiS2ReadyTick = Math.max(state.tick, ready - reduction);
          emitSkillEvent(state, ctx?.logCtx ?? state._logCtx, caster.name);
        },
      },
      // P2：S2 施放时 → 钢铁代码友军属性克制攻击伤害 ▲（见 onFieldDiscussionCast，随 S2 施放触发）
      {},
      // P3：战斗开始 → 全员进入 Stockpile（p06 秒：溢出治疗储存，上限 p05% 施法者基础 MaxHP；
      //     同时推入同名标记 buff 供 P4 判定）+ 回复 p07% 施法者最终最大 HP
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const s1  = caster.ssrFavSkills.skill1;
          const lv  = s1._activeSkillLevel;
          const end = state.tick + TICK_RATE * getSkillValue(s1, 6, lv);
          pushBuff(state, { name: STOCKPILE, unitId: null, endTick: end }, { ...state._logCtx, lineIdx: 1 });
          applyOverhealStorage(state, ALL_ALLIES,
            caster.stats.hp * getSkillValue(s1, 5, lv) / 100, end, false);   // "skill user's max HP"（非 final）
          applyHeal(state, ALL_ALLIES,
            Math.round(getFinalMaxHp(state, caster) * getSkillValue(s1, 7, lv) / 100),
            { lineIdx: 2 }, caster);
        },
      },
      // P4：Stockpile 期间任意友军（含自身）HP 下降至 p08=100% 以下 → 全员回复 p04% 施法者最终最大 HP
      //     由 HP_CHANGED 驱动，只响应 HP 比例下降（自损或 Max HP ▲；回复本身不会连锁触发）
      {
        on: 'HP_CHANGED',
        handler(state, caster, ctx) {
          if (!ctx.unit || !(ctx.newRatio < ctx.prevRatio)) return false;
          if (!state.buffs.some(b => b.name === STOCKPILE && b.endTick > state.tick)) return false;
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;
          if (ctx.newRatio > getSkillValue(s1, 8, lv) / 100) return false;
          applyHeal(state, ALL_ALLIES,
            Math.round(getFinalMaxHp(state, caster) * getSkillValue(s1, 4, lv) / 100), null, caster);
        },
      },
    ],
  },

  // ── Field Discussion（S2，主动技能，冷却 9s，战斗开始先进入冷却）
  // SSR group_id: 110802（skill_change_slot=2）
  // ■ Affects self.
  //   Creates a shared shield with HP equal to {p00}% of the skill user's final max HP that protects all allies
  //   from damage. Lasts for {p01} sec.
  // ■ Affects all allies.
  //   ATK ▲ {p02}% of the skill user's ATK. Stacks up to {p03} times and lasts for {p04} sec.
  // p00 shield % final max HP:   [3.5,3.88,4.27,4.66,5.04,5.44,5.83,6.22,6.6,7]
  // p01 shield sec (const):      [5,...]
  // p02 ATK ▲% of caster ATK:    [2.53,2.76,2.99,3.22,3.45,3.68,3.92,4.14,4.37,4.6]
  // p03 max stacks (const):      [10,...]
  // p04 sec (const):             [8,...]
  skill2: {
    groupId: 110802,
    triggers: [
      // 冷却初值：战斗开始即进入 9s 冷却
      {
        on: 'PROGRAM_INIT',
        handler(state, caster) {
          caster.skillState.centiS2ReadyTick = state.tick + S2_COOLDOWN_TICKS;
        },
      },
      // 冷却可被 S1 P1 动态缩减，无法用固定周期的 INTERVAL 表达：按 tick 轮询就绪时刻后施放
      {
        on: 'INTERVAL',
        opts: { seconds: 1 / TICK_RATE },
        handler(state, caster) {
          if (state.tick < (caster.skillState.centiS2ReadyTick ?? S2_COOLDOWN_TICKS)) return;
          castFieldDiscussion(state, caster);
        },
      },
    ],
  },

  // ── Start Construction（Burst）
  // SSR group_id: 110803（skill_change_slot=3）
  // ■ Affects the {p00} enemy unit(s) with the lowest remaining HP.
  //   Deals {p01}% of final ATK as damage.
  //   DEF ▼ {p02}% for {p03} sec.
  // ■ Affects all allies.
  //   Restores HP equal to {p04}% of the skill user's final max HP.
  // p00 targets (const):         [5,...]   — Boss 战单体，仅命中 1 次
  // p01 damage % final ATK:      [72.73,80.81,88.89,96.97,105.06,113.14,121.22,129.3,137.38,145.46]
  // p02 DEF ▼%:                  [7.27,8.08,8.88,9.69,10.5,11.31,12.12,12.93,13.73,14.54]
  // p03 sec (const):             [10,...]
  // p04 heal % final max HP:     [17.84,19.21,20.59,21.96,23.33,24.71,26.08,27.45,28.82,30.2]
  burst: {
    groupId: 110803,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const burst = caster.ssrFavSkills.burst;
          const lv    = burst._activeSkillLevel;

          // P1：技能伤害 + 敌方 DEF ▼ p02%（p03 秒）
          if (state.enemyHp > 0) {
            fireSkillHit(state, caster, getSkillValue(burst, 1, lv) / 100,
              getBuffSums(state, caster.id), 'Burst');
          }
          pushBuff(state, { name: 'Start Construction (DEF Down)', unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDefDownPct: getSkillValue(burst, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(burst, 3, lv) },
            { ...state._logCtx, partIdx: 0, lineIdx: 2 });

          // P2：全员回复 p04% 施法者最终最大 HP
          applyHeal(state, ALL_ALLIES,
            Math.round(getFinalMaxHp(state, caster) * getSkillValue(burst, 4, lv) / 100),
            { partIdx: 1, lineIdx: null }, caster);
        },
      },
    ],
  },
};
