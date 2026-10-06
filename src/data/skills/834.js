import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Rei (Tentative Name)  (resource_id: 834)

export default {

  // ── Annihilation Support
  // ■ 每 18 发普通攻击后激活。目标处于 Anti A.T. Field 状态时生效。
  //   造成 {p01}% 最终 ATK 的额外伤害。
  //   Anti A.T. Field 叠层 ▲ {p02=10}（借用 squad 中 Asuka 的 p07 per-stack 值）。
  // ■ 自身处于 Attack State 状态时，每 {p03=7} 发普通攻击后激活。影响目标。
  //   造成 {p04}% 最终 ATK 的额外伤害。
  // ■ 进入全爆裂时激活。影响所有处于 Annihilation State 状态的友军。
  //   Annihilation State 附加效果影响目标数 ▲ {p05=1}，持续 {p06=9} 秒（未建模）。
  //   Annihilation State 附加效果攻击范围 ▲ {p07=500}%，持续 {p08=9} 秒（未建模）。
  //   ATK ▲ {p09}%（施放者 ATK），持续 {p10=9} 秒。
  //
  // group_id: 28341
  // p01 额外伤害%: [349.01, 375.86, 402.71, 429.55, 456.4, 483.25, 510.1, 536.94, 563.79, 590.64]
  // p04 额外伤害%: [169.22, 182.23, 195.25, 208.27, 221.28, 234.3, 247.32, 260.33, 273.35, 286.37]
  // p09 ATK▲%（基于施放者 ATK）: [10.4, 11.2, 12, 12.8, 13.6, 14.4, 15.2, 16, 16.8, 17.6]
  skill1: {
    groupId: 28341,
    triggers: [
      // P1：每 18 发普攻 → 若 Anti A.T. Field buff 有效 → 额外伤害 + ATF 叠层 +10
      {
        on: 'SHOT_COUNT',
        opts: { every: 18, counterKey: 'reiS1P1Count' },
        handler(state, caster) {
          const atfBuff = state.buffs.find(b =>
            b.name === 'Anti A.T. Field' && b.unitId === ENEMY_UNIT_ID && b.endTick > state.tick);
          if (!atfBuff) return false;
          const lv     = caster.skillLevels[0];
          const sums   = getBuffSums(state, caster.id);
          const dmgPct = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          fireSkillHit(state, caster, dmgPct, sums, 'S1 P1');
          // ATF 叠层 +10（上限 30）：借用现有 buff 的 per-stack 值，直接修改 stacks
          const add = Math.min(10, 30 - (atfBuff.stacks ?? 1));
          if (add > 0) {
            atfBuff.stacks = (atfBuff.stacks ?? 1) + add;
            atfBuff.endTick = Math.max(atfBuff.endTick, state.tick + TICK_RATE * 30);
          }
        },
      },
      // P2：每 7 发普攻（全局计数）→ 若自身处于 Attack State → 额外伤害
      {
        on: 'SHOT_COUNT',
        opts: { every: 7, counterKey: 'reiS1P2Count' },
        handler(state, caster) {
          const attackStateActive = state.buffs.some(b =>
            b.name === 'Attack State' && b.unitId === caster.id && b.endTick > state.tick);
          if (!attackStateActive) return false;
          const lv     = caster.skillLevels[0];
          const sums   = getBuffSums(state, caster.id);
          const dmgPct = getSkillValue(caster.rawSkill1, 4, lv) / 100;
          fireSkillHit(state, caster, dmgPct, sums, 'S1 P2');
        },
      },
      // P3：进入全爆裂 → 处于 Annihilation State 的友军获得 ATK flat ▲ 9s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv      = caster.skillLevels[0];
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(caster.rawSkill1, 9, lv) / 100);
          const endTick = state.tick + TICK_RATE * 9;
          const unitIds = state.squad.filter(unit => state.buffs.some(b =>
            b.name === 'Annihilation State' && b.unitId === unit.id && b.endTick > state.tick)).map(u => u.id);
          if (unitIds.length === 0) return false;
          // S1 唯一的效果段（P1/P2 为伤害）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Annihilation Support', unitIds, atkFlat, endTick },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },

  // ── Maintenance and Resupply
  // ■ 进入全爆裂时激活。影响所有已释放爆裂技能的 MG 友军。
  //   MG 过热速度 ▲ {p00=100}%，持续 {p01=13} 秒。
  // ■ 进入全爆裂时激活。影响全体友军。
  //   ATK ▲ {p02}%（施放者 ATK），持续 {p03=10} 秒。
  //
  // group_id: 28342
  // p02 ATK▲%（基于施放者 ATK）: [6.86, 7.39, 7.92, 8.44, 8.97, 9.5, 10.03, 10.56, 11.08, 11.61]
  skill2: {
    groupId: 28342,
    triggers: [
      // P1：进入全爆裂 → 本轮使用爆裂技能的 MG 友军 MG 过热速度 ▲p00%（=100%），持续 p01s（=13s）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv             = caster.skillLevels[1];
          const mgHeatSpeedPct = getSkillValue(caster.rawSkill2, 0, lv) / 100;
          const endTick        = state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 1, lv);
          const unitIds = state.squad.filter(unit =>
            unit.mgRofChangePerShot != null && state.burstCastersThisRotation?.has(unit.id)).map(u => u.id);
          if (unitIds.length === 0) return false;
          pushBuff(state, { name: 'Maintenance and Resupply (MG Heat)', unitIds,
            mgHeatSpeedPct, endTick }, { ...state._logCtx, partIdx: 0 });
        },
      },
      // P2：进入全爆裂 → 全队 ATK flat ▲（p02% × caster ATK），持续 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv      = caster.skillLevels[1];
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(caster.rawSkill2, 2, lv) / 100);
          pushBuff(state, { name: 'Maintenance and Resupply (ATK)', unitId: null,
            atkFlat, endTick: state.tick + TICK_RATE * 10 },
            { ...state._logCtx, partIdx: 1 });
        },
      },
    ],
  },

  // ── Attack State
  // ■ 影响自身。
  //   Attack State: 攻击伤害 ▲ {p00}%，持续 {p01=10} 秒。
  //   ATK ▲ {p02}%（施放者 ATK），持续 {p03=10} 秒。
  // ■ 影响所有敌人。
  //   造成 {p04}% 最终 ATK 的爆裂技能伤害。
  //
  // group_id: 18343
  // p00 攻击伤害▲%: [21.21, 22.84, 24.48, 26.11, 27.74, 29.37, 31, 32.64, 34.27, 35.9]
  // p02 ATK▲%（基于施放者 ATK）: [37.44, 40.32, 43.2, 46.08, 48.96, 51.84, 54.72, 57.6, 60.48, 63.36]
  // p04 爆裂技能伤害%: [654.54, 691.84, 729.13, 766.43, 803.72, 841.02, 878.32, 915.61, 952.91, 990.2]
  burst: {
    groupId: 18343,
    triggers: [
      // P1：自身 Attack State buff（攻击伤害 ▲ p00% + ATK flat ▲ p02% × caster ATK），持续 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv        = caster.skillLevels[2];
          const end10     = state.tick + TICK_RATE * 10;
          const atkDmgPct = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const atkFlat   = Math.round(caster.stats.atk * getSkillValue(caster.rawBurst, 2, lv) / 100);
          pushBuff(state, { name: 'Attack State', unitId: caster.id,
            attackDamagePct: atkDmgPct, atkFlat, endTick: end10 });
        },
      },
      // P2：对所有敌人造成 p04% 最终 ATK 爆裂技能伤害
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (state.enemyHp <= 0) return false;
          const lv      = caster.skillLevels[2];
          const sums    = getBuffSums(state, caster.id);
          const hitMult = getSkillValue(caster.rawBurst, 4, lv) / 100;
          fireSkillHit(state, caster, hitMult, sums, 'Burst');
        },
      },
    ],
  },
};
