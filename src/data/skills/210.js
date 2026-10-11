import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Exia  (resource_id: 210)
// SSR 珍藏品: Gamekid Evolution（id: 200201）
// 所有三个技能槽均被 SSR 珍藏品替换（skill_change_slot=1/2/3），仅建模 SSR 版（见 docs/ssr-collectible-rules.md）。
//
// 武器：Sniper Rifle（UP 型，蓄力 1s，弹匣 6，FC 250%）。爆裂阶段 Step1，CD 20s。

const HACKING_CODE = 'Collect Hacking Code';

function hackingCodeStacks(state, caster) {
  const b = state.buffs.find(b => b.name === HACKING_CODE && b.unitId === caster.id && b.endTick > state.tick);
  return b ? (b.stacks ?? 1) : 0;
}

export default {

  // ── Invasion（S1）
  // SSR group_id: 122101（skill_change_slot=1）
  // ■ Activates when the last bullet hits the target. Affects the target if the caster is in Collect Hacking Code.
  //   ATK ▼ {p00}% for {p01} sec.
  //   DEF ▼ {p02}% for {p03} sec.
  // ■ Activates at the start of Full Burst Time. Affects self.
  //   Fixed to increase Reloading Speed by {p04}% for {p05} sec.
  // p00: [7.57,8.26,8.95,9.63,10.32,11.01,11.7,12.39,13.08,13.77]   — 敌方 ATK ▼：无敌方攻击模型，未建模
  // p01: [5,...]
  // p02: [7.57,8.26,8.95,9.63,10.32,11.01,11.7,12.39,13.08,13.77]
  // p03: [5,...]
  // p04: [95,...]
  // p05: [10,...]
  skill1: {
    groupId: 122101,
    triggers: [
      // P1：末弹命中且自身处于 Collect Hacking Code → 目标 DEF ▼ p02%（p03 秒）
      {
        on: 'LAST_BULLET',
        handler(state, caster) {
          if (hackingCodeStacks(state, caster) <= 0) return false;
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;
          pushBuff(state, { name: 'Invasion (DEF Down)', unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDefDownPct: getSkillValue(s1, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(s1, 3, lv) },
            { ...state._logCtx, lineIdx: 2 });
        },
      },
      // P2：进入全爆裂 → 换弹速度固定为 +p04%（p05 秒，屏蔽其他换弹速度效果）。
      //     固定换弹速度不是 buff 字段，另推一条无数值的同名记录供日志显示。
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const s1  = caster.ssrFavSkills.skill1;
          const lv  = s1._activeSkillLevel;
          const end = state.tick + TICK_RATE * getSkillValue(s1, 5, lv);
          caster.skillState.fixedReloadSpeedPct     = getSkillValue(s1, 4, lv) / 100;
          caster.skillState.fixedReloadSpeedEndTick = end;
          pushBuff(state, { name: 'Invasion (Reload Speed)', unitId: caster.id, endTick: end });
        },
      },
    ],
  },

  // ── Secret Code（S2）
  // SSR group_id: 122102（skill_change_slot=2）
  // ■ Activates when landing an attack with Full Charge. Affects self.
  //   Collect Hacking Code: ATK ▲ {p00}%, stacks up to {p01} time(s) for {p02} sec.
  // ■ When the last round of ammunition hits, affects all Electric Code ally unit(s) if the caster is in
  //   Collect Hacking Code.
  //   ATK ▲ {p03}% of caster's ATK, stacks up to {p04} time(s) for {p05} sec.
  // p00: [9.24,11.32,13.41,15.49,17.58,19.66,21.74,23.83,25.91,28]
  // p01: [5,...]
  // p02: [5,...]
  // p03: [1.05,1.58,2.11,2.64,3.16,3.69,4.22,4.75,5.28,5.8]
  // p04: [5,...]
  // p05: [15,...]
  skill2: {
    groupId: 122102,
    triggers: [
      // P1：全蓄力命中 → Collect Hacking Code（ATK ▲ p00%，最多 p01 层，p02 秒）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          pushBuff(state, { name: HACKING_CODE, unitId: caster.id,
            atkPct: getSkillValue(s2, 0, lv) / 100,
            stackLimit: getSkillValue(s2, 1, lv),
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 2, lv) });
        },
      },
      // P2：末弹命中且处于 Collect Hacking Code → 电击代码友军 ATK ▲ p03% 施法者 ATK（最多 p04 层，p05 秒）
      {
        on: 'LAST_BULLET',
        handler(state, caster) {
          if (hackingCodeStacks(state, caster) <= 0) return false;
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          const unitIds = state.squad.filter(u => u.element === 'Electric').map(u => u.id);
          if (unitIds.length === 0) return false;
          pushBuff(state, { name: 'Secret Code (ATK)', unitIds,
            atkFlat: Math.round(caster.stats.atk * getSkillValue(s2, 3, lv) / 100),
            stackLimit: getSkillValue(s2, 4, lv),
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 5, lv) });
        },
      },
    ],
  },

  // ── Partisan Protocol（Burst）
  // SSR group_id: 112103（skill_change_slot=3）
  // ■ Affects {p00} enemy unit(s) with the highest final DEF.
  //   Deals {p01}% of final ATK as damage.
  //   DEF ▼ {p02}% for {p03} sec.
  // ■ Activates when Collect Hacking Code is fully stacked. Affects the same target(s).
  //   Deals {p04}% of final ATK as additional damage.
  //   Damage Taken ▲ {p05}% for {p06} sec.
  // p00: [10,...]     — Boss 战单体，仅命中 1 次
  // p01: [67.27,73.39,79.51,85.62,91.74,97.86,103.97,110.09,116.21,122.32]
  // p02: [1.49,1.63,1.76,1.9,2.03,2.17,2.31,2.44,2.58,2.71]
  // p03: [5,...]
  // p04: [67.27,73.39,79.51,85.62,91.74,97.86,103.97,110.09,116.21,122.32]
  // p05: [9.36,10.32,11.28,12.25,13.21,14.18,15.14,16.11,17.07,18.04]
  // p06: [10,...]
  //
  // B1 施放，不涉及 B3 全爆裂加成规则。
  burst: {
    groupId: 112103,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const b  = caster.ssrFavSkills.burst;
          const lv = b._activeSkillLevel;
          // P1：伤害 + DEF ▼
          if (state.enemyHp > 0)
            fireSkillHit(state, caster, getSkillValue(b, 1, lv) / 100, getBuffSums(state, caster.id), 'Burst P1');
          pushBuff(state, { name: 'Partisan Protocol (DEF Down)', unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDefDownPct: getSkillValue(b, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(b, 3, lv) },
            { ...state._logCtx, partIdx: 0 });
          // P2：Collect Hacking Code 满层（S2 p01 层）→ 追加伤害 + 承伤 ▲
          const s2 = caster.ssrFavSkills.skill2;
          if (hackingCodeStacks(state, caster) < getSkillValue(s2, 1, s2._activeSkillLevel)) return;
          if (state.enemyHp > 0)
            fireSkillHit(state, caster, getSkillValue(b, 4, lv) / 100, getBuffSums(state, caster.id), 'Burst P2');
          pushBuff(state, { name: 'Partisan Protocol (Damage Taken)', unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDamageTakenPct: getSkillValue(b, 5, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(b, 6, lv) },
            { ...state._logCtx, partIdx: 1 });
        },
      },
    ],
  },
};
