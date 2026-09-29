import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Rosanna  (resource_id: 280)
// SSR 珍藏品: Signet Ring（id: 202001）
// 所有三个技能槽均被 SSR 珍藏品替换（skill_change_slot=1/2/3），仅建模 SSR 版（见 docs/ssr-collectible-rules.md）。
//
// Concealment（隐匿）：「受到直接攻击时解除」— 模拟器不建模敌方攻击，按持续时间自然到期处理。
// 隐匿状态用无数值的自身 buff 'Concealment' 表示，供爆裂技能的附加伤害判定。

const CONCEALMENT = 'Concealment';

function pushConcealment(state, caster, seconds, logCtx) {
  pushBuff(state, { name: CONCEALMENT, unitId: caster.id,
    endTick: state.tick + TICK_RATE * seconds }, logCtx);
}

function isConcealed(state, caster) {
  return state.buffs.some(b => b.name === CONCEALMENT && b.unitId === caster.id && b.endTick > state.tick);
}

export default {

  // ── On the Lam（S1）
  // SSR group_id: 122801（skill_change_slot=1）
  // ■ Activates after landing {p00} normal attacks. Affects self.
  //   Concealment: Prevents being targeted by single-target attacks for {p01} sec. This effect is removed upon taking a direct hit.
  //   Critical Rate ▲ {p02}% for {p03} sec.
  // ■ Activates after performing {p04} normal attacks. Affects the {p05} enemy unit(s) with the highest final ATK.
  //   Removes {p06} buff(s). Activates once per battle.
  // ■ Activates when the stage target appears. Affects self.
  //   Elemental Advantage Attack Damage ▲ {p07}% continuously.
  // p00 hits (const):           [120,...]
  // p01 sec (const):            [10,...]
  // p02 Critical Rate ▲%:       [8.98 … 19.34]
  // p03 sec (const):            [3,...]
  // p04 shots (const):          [10,...]
  // p05 targets (const):        [2,...]
  // p06 buffs removed:          [1 … 5]   — 敌方 buff 不建模
  // p07 Elem Adv Attack Dmg ▲%: [11 … 20]
  skill1: {
    groupId: 122801,
    triggers: [
      // P1：每命中 120 次 → Concealment 10s + 暴击率 ▲ p02% 3s
      {
        on: 'SHOT_COUNT',
        opts: { every: 120, counterKey: 'rosannaS1HitCount' },
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;
          // L1 为 ■ 触发条件行，效果行从 L2 起
          pushConcealment(state, caster, getSkillValue(s1, 1, lv), { ...state._logCtx, lineIdx: 1 });
          pushBuff(state, { name: 'On the Lam P1', unitId: caster.id,
            critRatePct: getSkillValue(s1, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(s1, 3, lv) },
            { ...state._logCtx, lineIdx: 2 });
        },
      },
      // P2：驱散敌方 buff — 敌方 buff 系统未建模，占位
      {},
      // P3：stage target 出现时 → 自身优越代码伤害 ▲ p07%，永久
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          if (!state.isStageTarget) return false;
          const s1 = caster.ssrFavSkills.skill1;
          pushBuff(state, { name: 'On the Lam P3', unitId: caster.id,
            elementAdvantagePct: getSkillValue(s1, 7, s1._activeSkillLevel) / 100,
            endTick: Infinity });
        },
      },
    ],
  },

  // ── Capo dei Capi（S2）
  // SSR group_id: 122802（skill_change_slot=2）
  // ■ Activates at the start of battle. Affects self.
  //   Concealment: Prevents being targeted by single-target attacks for {p00} sec. This effect is removed upon taking a direct hit.
  // ■ Activates when a Nikke is incapacitated. Affects self.
  //   Frenzy: ATK ▲ {p01}%. Stacks up to {p02} times and lasts for {p03} sec.
  //   Fills Burst Gauge by {p04}%.
  // ■ Activates when a Nikke is incapacitated. Prioritizes Attacker-type enemies. Affects {p09} unit(s).
  //   Deals {p10}% of final ATK as damage.
  // ■ Activates after landing {p05} normal attacks on the stage target. Affects self.
  //   Frenzy: ATK ▲ {p06}%. Stacks up to {p07} times and lasts for {p08} sec.
  // p00 sec (const):        [5,...]
  // p01 Frenzy ATK ▲%:      [12.83 … 22.61]
  // p02 max stacks (const): [10,...]
  // p03 sec (const):        [30,...]
  // p04 Burst Gauge %:      [20.54 … 36.54]
  // p05 hits (const):       [500,...]
  // p06 Frenzy ATK ▲%:      [12.83 … 22.61]  （与 p01 为同一个 Frenzy buff）
  // p07 max stacks (const): [10,...]
  // p08 sec (const):        [30,...]
  // p09 targets (const):    [1,...]
  // p10 damage %:           [200 … 400]
  // P2/P3（Nikke 被击倒）：模拟器不建模单位阵亡，占位。
  skill2: {
    groupId: 122802,
    triggers: [
      // P1：战斗开始 → Concealment 5s
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const s2 = caster.ssrFavSkills.skill2;
          pushConcealment(state, caster, getSkillValue(s2, 0, s2._activeSkillLevel), state._logCtx);
        },
      },
      {},  // P2：Nikke 被击倒 — 不建模
      {},  // P3：Nikke 被击倒 — 不建模
      // P4：每命中 stage target 500 次 → Frenzy ATK ▲ p06%（最多 10 层，30s）
      {
        on: 'SHOT_COUNT',
        opts: { every: 500, counterKey: 'rosannaS2StageHitCount' },
        handler(state, caster) {
          if (!state.isStageTarget) return;
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          pushBuff(state, { name: 'Frenzy', unitId: caster.id,
            atkPct: getSkillValue(s2, 6, lv) / 100,
            stackLimit: getSkillValue(s2, 7, lv),
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 8, lv) });
        },
      },
    ],
  },

  // ── Vendetta（Burst）
  // SSR group_id: 112803（skill_change_slot=3）
  // ■ Prioritizes Attacker-type enemies. Affects {p00} enemy unit(s).
  //   Assalto: Deals {p01}% of final ATK as damage.
  // ■ Activates when the skill user is in the Concealment state. Affects the target(s) hit by Assalto.
  //   Deals {p02}% of final ATK as additional damage.
  // ■ Activates if the target that was hit by Assalto is a Water Code stage target. Affects the target.
  //   Damage Taken ▲ {p04}% for {p05} sec.
  // p00 targets (const):     [2,...]   — Boss 战单体，只命中 1 次
  // p01 Assalto damage %:    [720.72 … 1310.4]
  // p02 additional damage %: [308.88 … 561.6]
  // p03 （空）
  // p04 Damage Taken ▲%:     [14.5 … 29]
  // p05 sec (const):         [30,...]
  burst: {
    groupId: 112803,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const burst = caster.ssrFavSkills.burst;
          const lv    = burst._activeSkillLevel;
          if (state.enemyHp <= 0) return;

          // P1：Assalto
          fireSkillHit(state, caster, getSkillValue(burst, 1, lv) / 100,
            getBuffSums(state, caster.id), 'Burst P1');

          // P2：隐匿状态 → 附加伤害
          if (isConcealed(state, caster) && state.enemyHp > 0) {
            fireSkillHit(state, caster, getSkillValue(burst, 2, lv) / 100,
              getBuffSums(state, caster.id), 'Burst P2');
          }

          // P3：水冷代码 stage target → 承伤 ▲ p04% 30s
          if (state.isStageTarget && state.enemyElement === 'Water') {
            pushBuff(state, { name: 'Vendetta P3', unitId: ENEMY_UNIT_ID, isDebuff: true,
              enemyDamageTakenPct: getSkillValue(burst, 4, lv) / 100,
              endTick: state.tick + TICK_RATE * getSkillValue(burst, 5, lv) },
              { ...state._logCtx, partIdx: 2 });
          }
        },
      },
    ],
  },
};
