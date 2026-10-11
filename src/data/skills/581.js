import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Arcana  (resource_id: 581)
//
// 武器：Rocket Launcher（UP 型）。爆裂阶段 Step2，CD 40s。
//
// Wheel of Fortune（命运之轮）由爆裂技能施加给电击代码友军，持续 p01=10s（自 B2 施放起）。
// 全爆裂默认 10s，从 B2 施放到全爆裂结束至少 0.4（B2→B3）+ 0.1（B3→全爆裂）+ 10 = 10.5s，WoF 通常已过期；
// 只有全爆裂被缩短（如 Isabel 爆裂 Full Burst Time ▼ 5 sec）时「if self is in Wheel of Fortune status」
// 才成立。这是技能原文的字面结果，按原样建模。

const WHEEL_OF_FORTUNE = 'Wheel of Fortune';

function inWheelOfFortune(state, caster) {
  return state.buffs.some(b => b.name === WHEEL_OF_FORTUNE && b.unitId === caster.id && b.endTick > state.tick);
}

// 「Burst 3 Electric Code allies who previously cast their Burst Skill」：
// 本轮施放过爆裂技能的电击代码 B3 友军（Step3 / StepFull）
function electricB3Casters(state) {
  return state.squad.filter(u => u.element === 'Electric'
    && (u.burstStep === 'Step3' || u.burstStep === 'StepFull')
    && state.burstCastersThisRotation?.has(u.id));
}

export default {

  // ── Awakened Destiny（S1）
  // ■ Activates when Full Burst ends. Affects all Burst {p00} Electric Code allies who previously cast their
  //   Burst Skill if self is in Wheel of Fortune status.
  //   The Magician: Cooldown of Skill 2 ▼ {p01}% for {p02} sec.
  //   Attack damage ▲ {p03}% for {p04} sec.
  // ■ Activates when Full Burst ends. Affects all allies.
  //   ATK ▲ {p05}% of caster's ATK for {p06} sec.
  // p00: [3,...]
  // p01: [75,...]
  // p02: [15,...]
  // p03: [106.36,114.54,122.73,130.91,139.09,147.27,155.45,163.64,171.82,180]
  // p04: [15,...]
  // p05: [2.95,3.18,3.41,3.64,3.86,4.09,4.32,4.55,4.77,5]
  // p06: [10,...]
  skill1: {
    triggers: [
      // P1：WoF 状态下全爆裂结束 → 电击 B3 施放者 The Magician（S2 冷却 ▼ p01% + 攻击伤害 ▲ p03%，同为 15s，合并为一条）
      //     S2 冷却缩减由 skill2CooldownReductionPct 表示，仅对使用 active-skill-shared.js 的主动 S2 生效（如 Isabel）
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          if (!inWheelOfFortune(state, caster)) return false;
          const unitIds = electricB3Casters(state).map(u => u.id);
          if (unitIds.length === 0) return false;
          const lv  = caster.skillLevels[0];
          const raw = caster.rawSkill1;
          pushBuff(state, { name: 'The Magician', unitIds,
            skill2CooldownReductionPct: getSkillValue(raw, 1, lv) / 100,
            attackDamagePct: getSkillValue(raw, 3, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 2, lv) });
        },
      },
      // P2：全爆裂结束 → 全体 ATK ▲ p05% 施法者 ATK（p06 秒）
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const lv  = caster.skillLevels[0];
          const raw = caster.rawSkill1;
          pushBuff(state, { name: 'Awakened Destiny (ATK)', unitId: null,
            atkFlat: Math.round(caster.stats.atk * getSkillValue(raw, 5, lv) / 100),
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 6, lv) });
        },
      },
    ],
  },

  // ── Cycle of Destiny（S2）
  // ■ Activates when Full Burst ends. Affects all Burst {p00} Electric Code allies who previously cast their
  //   Burst Skill if self is in Wheel of Fortune status.
  //   Strength: ATK ▲ {p01}% of caster's ATK for {p02} sec.
  // ■ Activates when Full Burst ends. Affects all allies if self is in Wheel of Fortune status.
  //   Death: Cooldown of Burst Skill ▼ {p03} sec.
  //   ATK ▲ {p04}% of caster's ATK for {p05} sec.
  // ■ Activates when Full Burst ends. Affects all allies.
  //   Attack damage ▲ {p06}% for {p07} sec.
  // p00: [3,...]
  // p01: [106.36,114.54,122.73,130.91,139.09,147.27,155.45,163.64,171.82,180]
  // p02: [15,...]
  // p03: [3,3.33,3.66,3.99,4.32,4.65,4.98,5.31,5.64,6]
  // p04: [29.54,31.81,34.09,36.36,38.63,40.91,43.18,45.45,47.72,50]
  // p05: [5,...]
  // p06: [4.43,4.77,5.11,5.45,5.79,6.13,6.48,6.82,7.16,7.5]
  // p07: [10,...]
  skill2: {
    triggers: [
      // P1：WoF 状态下全爆裂结束 → 电击 B3 施放者 Strength：ATK ▲ p01% 施法者 ATK（p02 秒）
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          if (!inWheelOfFortune(state, caster)) return false;
          const unitIds = electricB3Casters(state).map(u => u.id);
          if (unitIds.length === 0) return false;
          const lv  = caster.skillLevels[1];
          const raw = caster.rawSkill2;
          pushBuff(state, { name: 'Strength', unitIds,
            atkFlat: Math.round(caster.stats.atk * getSkillValue(raw, 1, lv) / 100),
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 2, lv) });
        },
      },
      // P2：WoF 状态下全爆裂结束 → 全体 Death：爆裂冷却 ▼ p03 秒 + ATK ▲ p04% 施法者 ATK（p05 秒）
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          if (!inWheelOfFortune(state, caster)) return false;
          const lv  = caster.skillLevels[1];
          const raw = caster.rawSkill2;
          const reductionTicks = Math.round(TICK_RATE * getSkillValue(raw, 3, lv));
          for (const u of state.squad) u.burstCdRemaining = Math.max(0, u.burstCdRemaining - reductionTicks);
          if (state.buffLog)
            state.buffLog.push({ type: 'cd_reduction', tick: state.tick,
              name: 'Death (Burst CD)', unitId: null, reductionTicks });
          pushBuff(state, { name: 'Death', unitId: null,
            atkFlat: Math.round(caster.stats.atk * getSkillValue(raw, 4, lv) / 100),
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 5, lv) });
        },
      },
      // P3：全爆裂结束 → 全体攻击伤害 ▲ p06%（p07 秒）
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const lv  = caster.skillLevels[1];
          const raw = caster.rawSkill2;
          pushBuff(state, { name: 'Cycle of Destiny (Attack Damage)', unitId: null,
            attackDamagePct: getSkillValue(raw, 6, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 7, lv) });
        },
      },
    ],
  },

  // ── Shackles of Destiny（Burst）
  // ■ Affects all Electric Code allies.
  //   Wheel of Fortune: Attack damage ▲ {p00}% for {p01} sec.
  // ■ Affects all enemies.
  //   Deals {p02}% of final ATK as Burst Skill damage.
  //   Judgement: Damage taken ▲ {p03}% for {p04} sec.
  // p00: [5.91,6.36,6.82,7.27,7.73,8.18,8.64,9.09,9.55,10]
  // p01: [10,...]
  // p02: [150,166.67,183.34,200.01,216.68,233.35,250.02,266.69,283.36,300]
  // p03: [5.91,6.36,6.82,7.27,7.73,8.18,8.64,9.09,9.55,10]
  // p04: [10,...]
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const raw = caster.rawBurst;
          // P1：电击代码友军 Wheel of Fortune（含自身）
          const unitIds = state.squad.filter(u => u.element === 'Electric').map(u => u.id);
          pushBuff(state, { name: WHEEL_OF_FORTUNE, unitIds,
            attackDamagePct: getSkillValue(raw, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 1, lv) },
            { ...state._logCtx, partIdx: 0 });
          // P2：全体敌人爆裂技能伤害（B2 施放，不涉及全爆裂规则），之后施加 Judgement（敌人承伤 ▲）
          if (state.enemyHp > 0)
            fireSkillHit(state, caster, getSkillValue(raw, 2, lv) / 100, getBuffSums(state, caster.id), 'Burst');
          pushBuff(state, { name: 'Judgement', unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDamageTakenPct: getSkillValue(raw, 3, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 4, lv) },
            { ...state._logCtx, partIdx: 1 });
        },
      },
    ],
  },
};
