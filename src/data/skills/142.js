import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Frima  (resource_id: 142)
// SSR 珍藏品: Beloved Pillow（id: 200301）
// 所有三个技能槽均被 SSR 珍藏品替换（skill_change_slot=1/2/3），仅建模 SSR 版（见 docs/ssr-collectible-rules.md）。
//
// 武器：Sniper Rifle（UP 型，蓄力 1s，弹匣 6，FC 250%）。爆裂阶段 Step1，CD 20s。

const SLEEPY  = 'Sleepy';
const WAKE_UP = 'Wake Up';

// 敌方身上 Sleepy 当前层数（未生效为 0）
function sleepyStacks(state) {
  const b = state.buffs.find(b => b.name === SLEEPY && b.unitId === ENEMY_UNIT_ID && b.endTick > state.tick);
  return b ? (b.stacks ?? 1) : 0;
}

// 自身是否处于 Wake Up 状态
function isWakeUp(state, caster) {
  return state.buffs.some(b => b.name === WAKE_UP && b.unitId === caster.id && b.endTick > state.tick);
}

export default {

  // ── ... I Want to Sleep（S1）
  // SSR group_id: 121421（skill_change_slot=1）
  // ■ Activates when hitting a target with Full Charge.
  //   Sleepy: DEF ▼ {p00}%, stacks up to {p01} time(s) for {p02} sec.
  // ■ Activates when hitting the target with Full Charge for {p03} time(s). Affects self when Sleepy is fully stacked.
  //   Wake Up: Normal attacks deal true damage for {p04} sec.
  // p00: [2.53,2.7,2.86,3.02,3.18,3.35,3.51,3.67,3.84,4]
  // p01: [5,...]
  // p02: [10,...]
  // p03: [6,...]
  // p04: [10,...]
  skill1: {
    groupId: 121421,
    triggers: [
      // P1：全蓄力命中 → 目标 Sleepy（DEF ▼ p00%，最多 p01 层，p02 秒，叠层刷新持续时间）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;
          pushBuff(state, { name: SLEEPY, unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDefDownPct: getSkillValue(s1, 0, lv) / 100,
            stackLimit: getSkillValue(s1, 1, lv),
            endTick: state.tick + TICK_RATE * getSkillValue(s1, 2, lv) });
        },
      },
      // P2：每累计 p03 次全蓄力命中，且 Sleepy 满层 → 自身 Wake Up（普通攻击造成真实伤害，p04 秒）。
      //     P1 先于 P2 结算，第 p03 发命中时 Sleepy 层数已含本发。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;
          caster.skillState.frimaFcHitCount = (caster.skillState.frimaFcHitCount ?? 0) + 1;
          if (caster.skillState.frimaFcHitCount % getSkillValue(s1, 3, lv) !== 0) return false;
          if (sleepyStacks(state) < getSkillValue(s1, 1, lv)) return false;
          pushBuff(state, { name: WAKE_UP, unitId: caster.id, normalAttackTrueDamage: true,
            endTick: state.tick + TICK_RATE * getSkillValue(s1, 4, lv) });
        },
      },
    ],
  },

  // ── ... Ah（S2）
  // SSR group_id: 121422（skill_change_slot=2）
  // ■ Activates when attacking with Full Charge. Affects all allies.
  //   Max HP ▲ {p00}% for {p01} sec.
  // ■ Activates when attacking with Full Charge. Affects all allies when in Wake Up status.
  //   True Damage ▲ {p02}% for {p03} sec.
  // p00: [3.6,3.88,4.15,4.43,4.71,4.98,5.26,5.54,5.82,6.09]
  // p01: [4,...]
  // p02: [21.17,21.95,22.72,23.5,24.28,25.05,25.83,26.6,27.38,28.16]
  // p03: [5,...]
  skill2: {
    groupId: 121422,
    triggers: [
      // P1：全蓄力攻击 → 全体友军 Max HP ▲ p00%（p01 秒，不叠加，刷新持续时间）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          pushBuff(state, { name: '... Ah (Max HP)', unitId: null,
            maxHpPct: getSkillValue(s2, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 1, lv) });
        },
      },
      // P2：全蓄力攻击且自身处于 Wake Up → 全体友军真实伤害 ▲ p02%（p03 秒）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (!isWakeUp(state, caster)) return false;
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          pushBuff(state, { name: '... Ah (True Damage)', unitId: null,
            trueDamagePct: getSkillValue(s2, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 3, lv) });
        },
      },
    ],
  },

  // ── ... Annoying（Burst）
  // SSR group_id: 111423（skill_change_slot=3）
  // ■ Affects {p00} enemy unit(s) with the highest final DEF.
  //   Deals {p01}% of final ATK as damage.
  //   DEF ▼ {p02}% for {p03} sec.
  // ■ Affects all allies.
  //   Max HP ▲ {p04}% for {p05} sec.
  // ■ Activiates when in Wake Up status. Affects all allies.
  //   True Damage ▲ {p06}% for {p07} sec.
  // p00: [10,...]     — Boss 战单体，仅命中 1 次
  // p01: [60.07,64.69,69.31,73.93,78.56,83.18,87.8,92.42,97.04,101.66]
  // p02: [5.83,6.27,6.72,7.17,7.62,8.07,8.52,8.97,9.41,9.86]
  // p03: [10,...]
  // p04: [17.88,19.25,20.63,22,23.38,24.76,26.13,27.51,28.88,30.26]
  // p05: [4,...]
  // p06: [36.44,37.94,39.44,40.95,42.45,43.96,45.46,46.96,48.47,49.97]
  // p07: [10,...]
  //
  // B1 施放，不涉及 B3 全爆裂加成规则。
  burst: {
    groupId: 111423,
    triggers: [
      // P1：伤害 + DEF ▼
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const b  = caster.ssrFavSkills.burst;
          const lv = b._activeSkillLevel;
          if (state.enemyHp > 0)
            fireSkillHit(state, caster, getSkillValue(b, 1, lv) / 100, getBuffSums(state, caster.id), 'Burst');
          pushBuff(state, { name: '... Annoying (DEF Down)', unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDefDownPct: getSkillValue(b, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(b, 3, lv) });
        },
      },
      // P2：全体友军 Max HP ▲ p04%（p05 秒）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const b  = caster.ssrFavSkills.burst;
          const lv = b._activeSkillLevel;
          pushBuff(state, { name: '... Annoying (Max HP)', unitId: null,
            maxHpPct: getSkillValue(b, 4, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(b, 5, lv) });
        },
      },
      // P3：自身处于 Wake Up → 全体友军真实伤害 ▲ p06%（p07 秒）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (!isWakeUp(state, caster)) return false;
          const b  = caster.ssrFavSkills.burst;
          const lv = b._activeSkillLevel;
          pushBuff(state, { name: '... Annoying (True Damage)', unitId: null,
            trueDamagePct: getSkillValue(b, 6, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(b, 7, lv) });
        },
      },
    ],
  },
};
