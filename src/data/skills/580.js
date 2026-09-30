import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Phantom  (resource_id: 580)
// SSR 珍藏品: Precious Masks（id: 201801）
// 所有三个技能槽均被 SSR 珍藏品替换（skill_change_slot=1/2/3），仅建模 SSR 版（见 docs/ssr-collectible-rules.md）。
//
// 核心循环（Boss 战单体 = stage target）：
//   ① 命中未处于 Calling Card 的敌人 → 施加 Calling Card（5s）+ Thief's Dagger 1 层
//   ② 命中处于 Calling Card 的敌人 → 攻击伤害 ▲（1 round）：本发技能伤害结算后生成，
//      由下一发普攻享受并消耗；爆裂技能伤害可享受但不消耗
//   ③ 每命中 stage target 30 次 → Thief's Dagger 1 层
//   ④ Thief's Dagger 满 3 层 → S2：Calling Card 目标附加伤害并移除 Calling Card、
//      分散伤害 ▲ 叠 1 层、清空 Dagger 层数并对全体敌人造成分散伤害
//   Calling Card 被移除后，下一发命中重新进入 ①。

const CALLING_CARD = 'Calling Card';
const THIEF_DAGGER = "Thief's Dagger";
const VISION_DIST  = "Thief's Vision P2";
const CALLING_CARD_P4 = "Thief's Calling Card P4";

function callingCardActive(state, caster) {
  return (caster.skillState.phantomCallingCardEndTick ?? 0) > state.tick;
}

// 移除敌人身上的 Calling Card（逻辑状态 + 日志用 debuff 标记）
function removeCallingCard(state, caster) {
  caster.skillState.phantomCallingCardEndTick = 0;
  state.buffs = state.buffs.filter(b => !(b.name === CALLING_CARD && b.unitId === ENEMY_UNIT_ID));
}

// Thief's Dagger 叠 1 层；满层时触发 S2 P1~P3
function addThiefDagger(state, caster, logCtx) {
  const s1 = caster.ssrFavSkills.skill1;
  const lv = s1._activeSkillLevel;
  const maxStacks = getSkillValue(s1, 3, lv);
  pushBuff(state, { name: THIEF_DAGGER, unitId: caster.id,
    hitRatePct: getSkillValue(s1, 2, lv) / 100,
    stackLimit: maxStacks,
    endTick: state.tick + TICK_RATE * getSkillValue(s1, 4, lv) }, logCtx);

  const dagger = state.buffs.find(b => b.name === THIEF_DAGGER && b.unitId === caster.id);
  if (dagger && dagger.stacks >= maxStacks) onDaggerMaxStacks(state, caster);
}

// S2 P1~P3：Thief's Dagger 达到最大层数
function onDaggerMaxStacks(state, caster) {
  const s2    = caster.ssrFavSkills.skill2;
  const lv    = s2._activeSkillLevel;
  const s2Ctx = { ...state._logCtx, skillLabel: s2.name_localkey, slot: 'S2', lineIdx: null };
  const prevCtx = state._logCtx;

  // P1：Calling Card 目标 → 附加伤害 p00% 最终 ATK，并移除 Calling Card
  if (callingCardActive(state, caster) && state.enemyHp > 0) {
    state._logCtx = { ...s2Ctx, partIdx: 0 };
    fireSkillHit(state, caster, getSkillValue(s2, 0, lv) / 100,
      getBuffSums(state, caster.id), 'S2 P1');
    removeCallingCard(state, caster);
  }

  // P2：自身分散伤害 ▲ p01%，永久，最多 p02 层（使用爆裂技能时清除，见 burst）
  pushBuff(state, { name: VISION_DIST, unitId: caster.id,
    distributedDamagePct: getSkillValue(s2, 1, lv) / 100,
    stackLimit: getSkillValue(s2, 2, lv), endTick: Infinity }, { ...s2Ctx, partIdx: 1 });

  // P3：清空 Thief's Dagger 层数 → 全体敌人 p03% 最终 ATK 分散伤害
  state.buffs = state.buffs.filter(b => !(b.name === THIEF_DAGGER && b.unitId === caster.id));
  if (state.enemyHp > 0) {
    state._logCtx = { ...s2Ctx, partIdx: 2 };
    fireSkillHit(state, caster, getSkillValue(s2, 3, lv) / 100,
      getBuffSums(state, caster.id), 'S2 P3', { isDistributed: true });
  }
  state._logCtx = prevCtx;
}

export default {

  // ── Thief's Calling Card（S1）
  // SSR group_id: 125801（skill_change_slot=1）
  // ■ Activates when landing a normal attack on a Rapture that is not in the Calling Card state. Affects the target.
  //   Calling Card: DEF ▼ {p00}% for {p01} sec.
  // ■ Activates when landing a normal attack on a Rapture that is not in the Calling Card state. Affects self.
  //   Thief's Dagger: Hit Rate ▲ {p02}%. Stacks up to {p03} times and lasts for {p04} sec.
  // ■ Activates after landing {p05} normal attacks on the stage target. Affects self.
  //   Thief's Dagger: Hit Rate ▲ {p06}%. Stacks up to {p07} times and lasts for {p08} sec.
  // ■ Activates when landing a normal attack on a target that is in the Calling Card state. Affects self.
  //   Attack Damage ▲ {p09}% for {p10} round(s).
  // p00 DEF ▼%:             [19.02 … 32.19]  — enemyDefDownPct，经 getEffectiveEnemyDef 作用于敌方 DEF
  // p01 sec (const):        [5,...]
  // p02 Hit Rate ▲%:        [15.22 … 25.75]
  // p03 max stacks (const): [3,...]
  // p04 sec (const):        [5,...]
  // p05 hits (const):       [30,...]
  // p06 Hit Rate ▲%:        [15.22 … 25.75]  （与 p02 为同一个 Thief's Dagger buff）
  // p07 max stacks (const): [3,...]
  // p08 sec (const):        [5,...]
  // p09 Attack Damage ▲%:   [44.41 … 75.17]
  // p10 rounds (const):     [1,...]
  skill1: {
    groupId: 125801,
    triggers: [
      // P1+P2：每次普攻命中未处于 Calling Card 的目标；同时负责消耗已有的 P4
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'phantomS1HitCount' },
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;

          // P4 触发条件按命中瞬间的目标状态判定；新 P4 在本发所有技能伤害结算后才生成（见末尾 P4 触发器）
          const hitCallingCard = callingCardActive(state, caster);
          caster.skillState.phantomP4Pending = hitCallingCard;

          // 已有的 P4 被本发普攻消耗：先于同发触发的 S2 P1 / P3 技能伤害移除，使其不享受该增益
          state.buffs = state.buffs.filter(b => !(b.name === CALLING_CARD_P4 && b.unitId === caster.id));

          if (hitCallingCard) return;

          // P1：施加 Calling Card —— 敌方 DEF ▼ p00%（S2 满层时随 Calling Card 一并移除）
          const endTick = state.tick + TICK_RATE * getSkillValue(s1, 1, lv);
          caster.skillState.phantomCallingCardEndTick = endTick;
          pushBuff(state, { name: CALLING_CARD, unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDefDownPct: getSkillValue(s1, 0, lv) / 100, endTick },
            { ...state._logCtx, partIdx: 0 });
          // P2：Thief's Dagger 叠 1 层
          addThiefDagger(state, caster, { ...state._logCtx, partIdx: 1 });
        },
      },
      // P3：每命中 stage target 30 次 → Thief's Dagger 叠 1 层
      {
        on: 'SHOT_COUNT',
        opts: { every: 30, counterKey: 'phantomS1StageHitCount' },
        partOverride: 2,
        handler(state, caster) {
          if (!state.isStageTarget) return;
          addThiefDagger(state, caster, state._logCtx);
        },
      },
      // P4：命中 Calling Card 目标 → 攻击伤害 ▲（1 round）
      // 必须排在 P1~P3 之后：本发触发的 S2 P1 / P3 结算完毕后才生成，供下一发普攻享受并消耗；
      // 期间与普攻无关的技能伤害（爆裂技能 P1）可享受且不消耗（同 Miranda S2 P3 的回合制规则）。
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'phantomS1P4Count' },
        partOverride: 3,
        handler(state, caster) {
          if (!caster.skillState.phantomP4Pending) return;
          caster.skillState.phantomP4Pending = false;
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;
          // 下一发实弹命中时由引擎扣减回合；首个触发器亦会显式移除（先于同发技能伤害结算）。
          pushBuff(state, { name: CALLING_CARD_P4, unitId: caster.id,
            attackDamagePct: getSkillValue(s1, 9, lv) / 100,
            endRounds: getSkillValue(s1, 10, lv) });
        },
      },
    ],
  },

  // ── Thief's Vision（S2）
  // SSR group_id: 125802（skill_change_slot=2）
  // ■ Activates when Thief's Dagger is at max stacks. Affects targets in the Calling Card state.
  //   Deals {p00}% of final ATK as additional damage. Removes Calling Card.
  // ■ Activates when Thief's Dagger is at max stacks. Affects self.
  //   Distributed Damage ▲ {p01}% continuously. Stacks up to {p02} times. Stacks are removed when using Burst Skill.
  // ■ Activates when Thief's Dagger is at max stacks. Removes stacks and affects all enemies.
  //   Deals {p03}% of final ATK as distributed damage.
  // ■ Activates after performing {p04} normal attacks. Affects self.
  //   ATK ▲ {p05}% for {p06} sec.
  //   Distributed Damage ▲ {p07}% for {p08} sec.
  // p00 additional damage %:   [49.82 … 84.33]
  // p01 Distributed Damage ▲%: [7.61 … 12.86]
  // p02 max stacks (const):    [3,...]
  // p03 distributed damage %:  [125 … 250]
  // p04 shots (const):         [10,...]
  // p05 ATK ▲%:                [50.32 … 85.12]
  // p06 sec (const):           [5,...]
  // p07 Distributed Damage ▲%: [18.87 … 31.92]
  // p08 sec (const):           [10,...]
  // P1~P3 的满层事件由 S1 产生，经 addThiefDagger → onDaggerMaxStacks 结算。
  skill2: {
    groupId: 125802,
    triggers: [
      {},  // P1：见 onDaggerMaxStacks
      {},  // P2：见 onDaggerMaxStacks
      {},  // P3：见 onDaggerMaxStacks
      // P4：每 10 次普攻 → 自身 ATK ▲ p05% 5s + 分散伤害 ▲ p07% 10s
      {
        on: 'SHOT_COUNT',
        opts: { every: 10, counterKey: 'phantomS2ShotCount' },
        handler(state, caster) {
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          // L1 为 ■ 触发条件行，效果行从 L2 起
          pushBuff(state, { name: "Thief's Vision P4 L2", unitId: caster.id,
            atkPct: getSkillValue(s2, 5, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 6, lv) },
            { ...state._logCtx, lineIdx: 1 });
          pushBuff(state, { name: "Thief's Vision P4 L3", unitId: caster.id,
            distributedDamagePct: getSkillValue(s2, 7, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 8, lv) },
            { ...state._logCtx, lineIdx: 2 });
        },
      },
    ],
  },

  // ── Secret Trick: Rampage of Thieves（Burst）
  // SSR group_id: 115803（skill_change_slot=3）
  // ■ Affects all enemies.
  //   Deals {p00}% of final ATK as distributed damage.
  // ■ Affects the enemy if the enemy is a Fire Code stage target.
  //   Damage Taken ▲ {p03}% for {p04} sec.
  // ■ Affects self.
  //   Max Ammunition Capacity ▲ {p01}% for {p02} sec.
  // p00 distributed damage %: [861.12 … 1457.28]
  // p01 Max Ammo ▲%:          [27.5 … 50]
  // p02 sec (const):          [10,...]
  // p03 Damage Taken ▲%:      [9 … 18]
  // p04 sec (const):          [30,...]
  burst: {
    groupId: 115803,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const burst = caster.ssrFavSkills.burst;
          const lv    = burst._activeSkillLevel;

          // P1：全体敌人分散伤害
          if (state.enemyHp > 0) {
            fireSkillHit(state, caster, getSkillValue(burst, 0, lv) / 100,
              getBuffSums(state, caster.id), 'Burst P1', { isDistributed: true });
          }

          // S2 P2：使用爆裂技能时清除分散伤害 ▲ 叠层（先结算本次爆裂伤害，再清除）
          state.buffs = state.buffs.filter(b => !(b.name === VISION_DIST && b.unitId === caster.id));

          // P2：燃烧代码 stage target → 承伤 ▲ p03% 30s
          if (state.isStageTarget && state.enemyElement === 'Fire') {
            pushBuff(state, { name: 'Secret Trick: Rampage of Thieves P2', unitId: ENEMY_UNIT_ID,
              isDebuff: true, enemyDamageTakenPct: getSkillValue(burst, 3, lv) / 100,
              endTick: state.tick + TICK_RATE * getSkillValue(burst, 4, lv) },
              { ...state._logCtx, partIdx: 1 });
          }

          // P3：自身最大弹匣 ▲ p01% 10s
          pushBuff(state, { name: 'Secret Trick: Rampage of Thieves P3', unitId: caster.id,
            maxAmmoPct: getSkillValue(burst, 1, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(burst, 2, lv) },
            { ...state._logCtx, partIdx: 2 });
        },
      },
    ],
  },
};
