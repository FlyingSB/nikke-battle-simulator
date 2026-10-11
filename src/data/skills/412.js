import { pushBuff, applyHeal, pushHoT, getHpRatio, getFinalMaxHp,
         TICK_RATE, ALL_ALLIES } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Trina  (resource_id: 412)
//
// 武器：Rocket Launcher（UP 型）。爆裂阶段 Step2，CD 20s。
//
// 「allies with rifles」仅指突击步枪（AR），不含狙击枪（SR）（用户确认，2026-10-11）。

function isElectricRifle(u) {
  return u.element === 'Electric' && u.weaponType === 'AR';
}

// 部队中最左侧的 n 名电击代码步枪队友（state.squad 顺序即站位）
function leftmostElectricRifles(state, n) {
  return state.squad.filter(isElectricRifle).slice(0, n);
}

// S1 P2/P3：HP 比例最低的 n 名队友中，HP 低于阈值者回复施法者最终最大 HP 的 pct%（稳定排序，同值按站位）
function healLowestBelow(state, caster, n, thresholdPct, healPct, partIdx) {
  const lowest  = [...state.squad].sort((a, b) => getHpRatio(state, a) - getHpRatio(state, b)).slice(0, n);
  const targets = lowest.filter(u => getHpRatio(state, u) < thresholdPct / 100);
  const amount  = Math.round(getFinalMaxHp(state, caster) * healPct / 100);
  for (const u of targets) applyHeal(state, u, amount, { partIdx }, caster);
}

export default {

  // ── Nature's Grace（S1）
  // ■ Activates after Full Burst ends. Affects all allies.
  //   Continuously recovers {p00}% of caster's final Max HP every 1 sec for {p01} sec.
  // ■ Activates when attacking with Full Charge. Affects the target(s) if the HP of {p03} ally unit(s) with
  //   the lowest HP percentage is lower than {p02}%.
  //   Recovers {p04}% of caster's final Max HP as HP.
  // ■ Activates when attacking with Full Charge. Affects the target(s) if the HP of {p06} ally unit(s) with
  //   the lowest HP percentage is lower than {p05}%.
  //   Recovers {p07}% of caster's final Max HP as HP.
  // p00: [2.4,2.58,2.77,2.95,3.14,3.32,3.51,3.69,3.88,4.06]
  // p01: [5,...]
  // p02: [30,...]   p03: [2,...]
  // p04: [1.2,1.29,1.38,1.48,1.57,1.66,1.75,1.85,1.94,2.03]
  // p05: [50,...]   p06: [2,...]
  // p07: [1.03,1.09,1.15,1.21,1.27,1.33,1.39,1.45,1.51,1.57]
  skill1: {
    triggers: [
      // P1：全爆裂结束 → 全体每秒回复 p00% 施法者最终最大 HP，持续 p01 秒
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          pushHoT(state, ALL_ALLIES,
            Math.round(getFinalMaxHp(state, caster) * getSkillValue(caster.rawSkill1, 0, lv) / 100),
            getSkillValue(caster.rawSkill1, 1, lv), null, caster);
        },
      },
      // P2：全蓄力攻击 → HP 最低 p03 名中低于 p02% 者回复 p04%
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          const r  = caster.rawSkill1;
          healLowestBelow(state, caster, getSkillValue(r, 3, lv), getSkillValue(r, 2, lv), getSkillValue(r, 4, lv), 1);
        },
      },
      // P3：全蓄力攻击 → HP 最低 p06 名中低于 p05% 者回复 p07%
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          const r  = caster.rawSkill1;
          healLowestBelow(state, caster, getSkillValue(r, 6, lv), getSkillValue(r, 5, lv), getSkillValue(r, 7, lv), 2);
        },
      },
    ],
  },

  // ── Peaceful Tree（S2）
  // ■ Activates at the start of battle, only if self is alive. Affects all Electric Code allies with rifles.
  //   Max HP ▲ {p00}% of the caster's Max HP without restoring HP constantly.
  // ■ Activates at the start of battle. Affects {p05} Electric Code ally unit(s) with rifles on the leftmost
  //   side of the squad.
  //   Invulnerable for {p06} sec.
  // ■ Activates when using Burst Skill. Affects {p05} Electric Code ally unit(s) with rifles on the leftmost
  //   side of the squad.
  //   Attack Damage ▲ {p01}% for {p02} sec.
  //   Reloading Speed ▲ {p03}% for {p04} sec.
  // p00: [26.57,28.62,30.66,32.71,34.75,36.8,38.84,40.89,42.93,44.98]
  // p01: [55.64,59.92,64.2,68.48,72.76,77.04,81.32,85.6,89.87,94.15]
  // p02: [10,...]
  // p03: [30.03,32.34,34.65,36.96,39.27,41.58,43.89,46.2,48.51,50.82]
  // p04: [10,...]
  // p05: [1,...]
  // p06: [2,...]
  skill2: {
    triggers: [
      // P1：战斗开始 → 电击代码步枪队友 Max HP ▲ p00% 施法者 Max HP（固定值，不回复 HP，持续）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const unitIds = state.squad.filter(isElectricRifle).map(u => u.id);
          if (unitIds.length === 0) return false;
          pushBuff(state, { name: 'Peaceful Tree (Max HP)', unitIds, noRestore: true,
            maxHpFlat: Math.round(caster.stats.hp * getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100),
            endTick: Infinity });
        },
      },
      // P2：战斗开始 → 最左侧电击步枪队友无敌 p06 秒（敌方伤害未建模，未建模）
      {},
      // P3：使用爆裂技能 → 最左侧 p05 名电击步枪队友 攻击伤害 ▲ p01% + 换弹速度 ▲ p03%（同为 10s，合并为一条）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[1];
          const raw = caster.rawSkill2;
          const unitIds = leftmostElectricRifles(state, getSkillValue(raw, 5, lv)).map(u => u.id);
          if (unitIds.length === 0) return false;
          pushBuff(state, { name: 'Peaceful Tree P3', unitIds,
            attackDamagePct: getSkillValue(raw, 1, lv) / 100,
            reloadSpeedPct:  getSkillValue(raw, 3, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 2, lv) });
        },
      },
    ],
  },

  // ── Mother Forest（Burst）
  // ■ Affects all allies.
  //   Max HP ▲ {p00}% of the caster's Max HP without restoring HP for {p01} sec.
  //   Attack Damage ▲ {p07}% for {p08} sec.
  // ■ Activates when enemy count aside from Nikkes is 1. Affects all allies.
  //   Spread Roots: Burst Skill damage of skills with "Affects all enemies" ▲ {p02}% for {p03} sec.
  // ■ Activates when enemy count aside from Nikkes is more than 2. Affects all allies.
  //   Changes Spread Roots to Wilted Roots.
  //   Wilted Roots: Burst Skill damage of skills with "Affects all enemies" ▲ {p09}% for {p03} sec.
  // ■ Affects all Electric Code allies with rifles.
  //   Hit Rate ▲ {p04}% for {p05} sec.
  //   Max Ammunition Capacity ▲ {p06} round(s) for {p05} sec.
  // p00: [11.9,12.82,13.73,14.65,15.56,16.48,17.4,18.31,19.23,20.14]
  // p01: [10,...]
  // p02: [257.4,277.2,297,316.8,336.6,356.4,376.2,396,415.8,435.6]
  // p03: [5,...]
  // p04: [26.76,28.82,30.88,32.94,35,37.06,39.12,41.18,43.24,45.3]
  // p05: [10,...]
  // p06: [10,11,12,13,14,15,16,17,18,20]
  // p07: [12.35,13.3,14.25,15.2,16.15,17.1,18.05,19,19.95,20.9]
  // p08: [10,...]
  // p09: [38.09,41.02,43.95,46.88,49.81,52.74,55.67,58.6,61.53,64.46]
  //
  // Spread Roots 由 buff 字段 allEnemiesBurstDamagePct 表示，引擎只对「Affects all enemies」段的爆裂技能
  // 伤害命中计入（battle-utils.isAllEnemiesBurstHit）。Boss 战敌人数恒为 1 → 只建模 Spread Roots，
  // P3（Wilted Roots，敌人 > 2）不触发。
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const raw = caster.rawBurst;
          // P1：Max HP ▲（不回复 HP）+ 攻击伤害 ▲（同为全体 10s，合并为一条）
          pushBuff(state, { name: 'Mother Forest P1', unitId: null, noRestore: true,
            maxHpFlat: Math.round(caster.stats.hp * getSkillValue(raw, 0, lv) / 100),
            attackDamagePct: getSkillValue(raw, 7, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 1, lv) },
            { ...state._logCtx, partIdx: 0 });
          // P2：Spread Roots
          pushBuff(state, { name: 'Spread Roots', unitId: null,
            allEnemiesBurstDamagePct: getSkillValue(raw, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 3, lv) },
            { ...state._logCtx, partIdx: 1 });
          // P4：电击代码步枪队友 命中率 ▲ + 最大装弹数 ▲ N 发（同为 p05 秒，合并为一条）
          const unitIds = state.squad.filter(isElectricRifle).map(u => u.id);
          if (unitIds.length > 0) {
            pushBuff(state, { name: 'Mother Forest P4', unitIds,
              hitRatePct:  getSkillValue(raw, 4, lv) / 100,
              maxAmmoFlat: getSkillValue(raw, 6, lv),
              endTick: state.tick + TICK_RATE * getSkillValue(raw, 5, lv) },
              { ...state._logCtx, partIdx: 3 });
          }
        },
      },
    ],
  },
};
