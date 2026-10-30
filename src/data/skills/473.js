import { pushBuff, fireSkillHit, getBuffSums, applyHeal, getFinalMaxHp, isInIntoTheFray, ALL_ALLIES, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Rapunzel: Sanctuary  (resource_id: 473)

// 「Affects self and all allies in the Into the Fray state」的目标单位 id 列表
function selfAndIntoTheFrayAllies(state, caster) {
  return state.squad.filter(u => u.id === caster.id || isInIntoTheFray(state, u)).map(u => u.id);
}

export default {

  // ── Divine Light
  // ■ Activates when performing a Full Charge attack. Affects all allies.
  //   Restores HP equal to {p01}% of the skill user's final max HP.
  // ■ Activates when entering Full Burst. Affects self and all allies in the Into the Fray state.
  //   Attack Damage ▲ {p02}% for {p03} sec.
  // ■ Activates when using Nanoparticle Injection. Affects self.
  //   Cooldown of Burst Skill ▲ {p04} sec. This effect cannot be removed.
  //   Nanoparticle Consumption: DEF ▲ {p05}%. This effect is continuous and cannot be removed. Effect persists after revival.
  // ■ Activates only when at Full Charge during a Full Charge attack. Affects self.
  //   Gains immunity to effects that increase charge speed. This effect is continuous.
  //   Gains immunity to effects that decrease charge speed. This effect is continuous.
  //
  // group_id: 24731
  // p01: [2.3 … 3.9]         （全员治疗 %施法者最终最大 HP）
  // p02: [16.22 … 27.45]     （攻击伤害 ▲%）
  // p03: [10, ...]
  // p04: [40, ...]           （爆裂冷却 ▲ 秒；Nanoparticle Injection 复活相关，不建模）
  // p05: [5.91 … 10]         （DEF ▲%；同上，不建模）
  //
  // 简化说明：模拟不含友军阵亡，爆裂的 Nanoparticle Injection（复活）永不发动 → P3 不建模。
  skill1: {
    groupId: 24731,
    triggers: [
      // P1：全蓄力攻击 → 全员回复施法者最终最大 HP × p01%
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const pct = getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100;
          applyHeal(state, ALL_ALLIES, Math.round(getFinalMaxHp(state, caster) * pct), null, caster);
        },
      },
      // P2：进入全爆裂 → 自身与处于 Into the Fray 的友军 攻击伤害 ▲ p02% p03 秒
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv  = caster.skillLevels[0];
          const pct = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          const dur = getSkillValue(caster.rawSkill1, 2, lv);
          pushBuff(state, { name: 'Divine Light (Attack Damage)', unitIds: selfAndIntoTheFrayAllies(state, caster),
            attackDamagePct: pct, endTick: state.tick + Math.round(TICK_RATE * dur) });
        },
      },
      // P3：Nanoparticle Injection（复活）相关，不建模，占位保持段号对齐
      {},
      // P4：满蓄力的全蓄力攻击 → 永久免疫技能/buff 来源的蓄力速度增减（同 Liberalio / Snow White: Heavy Arms 处理）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          caster.immuneSkillChargeSpeed = true;
        },
      },
    ],
  },

  // ── Celestial Haven
  // ■ Activates when Full Charge is maintained for {p01} or more seconds while this unit is not in the Goddess Blessing state. Affects self.
  //   Creates a shared shield with HP equal to {p02}% of the skill user's final max HP that protects all allies from damage.
  //   This shield is removed when charging ends.
  // ■ Activates when Full Charge is maintained for {p01} or more seconds while this unit is not in the Goddess Blessing state. Affects all allies.
  //   Goddess Blessing: DEF ▲ {p03}% of the skill user's DEF for {p04} sec.
  // ■ Activates when entering Full Burst. Affects self and all allies in the Into the Fray state.
  //   ATK ▲ {p05}% of the skill user's ATK for {p06} sec.
  // ■ Activates when performing a Full Charge attack. Affects the enemy nearest to the crosshair.
  //   Deals {p07}% of final ATK as additional damage.
  //
  // group_id: 24732
  // p01: [1, ...]            （满蓄力保持秒）
  // p02: [4.36 … 7.39]       （共享护盾 %最终最大 HP）
  // p03: [24.96 … 42.24]     （Goddess Blessing DEF ▲ %施法者 DEF）
  // p04: [10, ...]
  // p05: [17.23 … 29.17]     （ATK ▲ %施法者 ATK）
  // p06: [10, ...]
  // p07: [130.41 … 220.7]    （附加伤害 %ATK）
  //
  // 简化说明：自动战斗满蓄力即发射，不存在「保持满蓄力 p01 秒」→ P1 共享护盾 / P2 Goddess Blessing 不建模
  //          （均为防御向，不影响输出）。
  skill2: {
    groupId: 24732,
    triggers: [
      // P1 / P2：满蓄力保持触发，不建模，占位保持段号对齐
      {},
      {},
      // P3：进入全爆裂 → 自身与处于 Into the Fray 的友军 ATK ▲ 施法者 ATK × p05% p06 秒
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv  = caster.skillLevels[1];
          const pct = getSkillValue(caster.rawSkill2, 4, lv) / 100;
          const dur = getSkillValue(caster.rawSkill2, 5, lv);
          pushBuff(state, { name: 'Celestial Haven (ATK)', unitIds: selfAndIntoTheFrayAllies(state, caster),
            atkFlat: Math.round(caster.stats.atk * pct), endTick: state.tick + Math.round(TICK_RATE * dur) });
        },
      },
      // P4：全蓄力攻击 → 准星最近敌人 p07% 附加伤害（技能内唯一伤害 → 标签 'S2'）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          const mult = getSkillValue(caster.rawSkill2, 6, caster.skillLevels[1]) / 100;
          fireSkillHit(state, caster, mult, getBuffSums(state, caster.id), 'S2');
        },
      },
    ],
  },

  // ── Garden of Arcadia
  // ■ Activates when this unit is not in the Nanoparticle Consumption state.
  //   Effects vary according to the number of incapacitated allies. Only one set of effects is applied.
  //   Activates if {p08} or more allies are incapacitated. Affects all incapacitated allies.
  //     Nanoparticle Injection: Revives with {p01}% HP. Activates once per battle.
  //     ATK ▲ {p02}% of the skill user's ATK for {p03} sec. Activates once per battle.
  //     DEF ▲ {p04}% of the skill user's DEF for {p05} sec. Activates once per battle.
  //   Activates if {p09} or fewer allies are incapacitated. Affects all allies.
  //     ATK ▲ {p06}% of the skill user's ATK for {p07} sec.
  // ■ Activates when this unit is in the Nanoparticle Consumption state. Affects all allies.
  //   ATK ▲ {p06}% of the skill user's ATK for {p07} sec.
  //
  // group_id: 14733
  // p01: [56.72 … 96]        （复活 HP%）
  // p02: [59.9 … 101.37]     （复活者 ATK ▲ %施法者 ATK）
  // p03: [10, ...]
  // p04: [131.04 … 221.76]   （复活者 DEF ▲ %施法者 DEF）
  // p05: [10, ...]
  // p06: [20.59 … 34.84]     （全员 ATK ▲ %施法者 ATK）
  // p07: [10, ...]
  // p08: [3, ...]            （阵亡数阈值 ≥）
  // p09: [2, ...]            （阵亡数阈值 ≤）
  //
  // 简化说明：模拟不含友军阵亡 → 恒走「阵亡 ≤ p09」分支：全员 ATK ▲ p06%（与 P2 效果相同）。
  burst: {
    groupId: 14733,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const pct = getSkillValue(caster.rawBurst, 5, lv) / 100;
          const dur = getSkillValue(caster.rawBurst, 6, lv);
          pushBuff(state, { name: 'Garden of Arcadia (ATK)', unitId: null,
            atkFlat: Math.round(caster.stats.atk * pct), endTick: state.tick + Math.round(TICK_RATE * dur) });
        },
      },
    ],
  },
};
