import { pushBuff, applyHeal, applyShield,
         TICK_RATE, ALL_ALLIES } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Crown  (resource_id: 330)
export default {

  // ── One for All
  // ■ Activates at the start of Full Burst. Affects all allies who previously cast their Burst Skills.
  // ATK ▲ {description_value_01}% of caster's ATK for {description_value_02} sec.
  // Reloading Speed ▲ {description_value_03}% for {description_value_04} sec.
  // ■ Affects all allies who did not previously cast their Burst Skills.
  // DEF ▲ {description_value_05}% of caster's DEF for {description_value_06} sec.
  // Reloading Speed ▲ {description_value_07}% for {description_value_08} sec.
  // p01: [40.32, 43, 45.69, 48.38, 51.07, 53.76, 56.44, 59.13, 61.82, 64.51]
  // p02: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15]
  // p03: [27.72, 29.56, 31.41, 33.26, 35.11, 36.96, 38.8, 40.65, 42.5, 44.35]
  // p04: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15]
  // p05: [23.4, 24.96, 26.52, 28.08, 29.64, 31.2, 32.76, 34.32, 35.88, 37.44]
  // p06: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15]
  // p07: [27.72, 29.56, 31.41, 33.26, 35.11, 36.96, 38.8, 40.65, 42.5, 44.35]
  // p08: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15]
  skill1: {
    groupId: 23301,
    triggers: [
      // P1：爆裂施放者 → ATK flat ▲ + Reload Speed ▲
      {
        on: 'ENTER_FULL_BURST',
        target: 'BURST_CASTERS',
        effects: [
          { type: 'BUFF', name: 'One for All P1', duration: 15,
            stat: (caster) => ({
              atkFlat:        Math.round(caster.stats.atk * getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100),
              reloadSpeedPct: getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100,
            }) },
        ],
      },
      // P2：爆裂未施放者 → DEF flat ▲ + Reload Speed ▲
      {
        on: 'ENTER_FULL_BURST',
        target: 'NON_BURST_CASTERS',
        effects: [
          { type: 'BUFF', name: 'One for All P2', duration: 15,
            stat: (caster) => ({
              defFlat:        Math.round(caster.stats.def * getSkillValue(caster.rawSkill1, 4, caster.skillLevels[0]) / 100),
              reloadSpeedPct: getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100,
            }) },
        ],
      },
    ],
  },

  // ── Royal Attire
  // ■ Activates after {description_value_01} normal attack(s). Affects self.
  // Relax: Potency of HP restored ▲ {description_value_02}% continuously, stacks up to {description_value_03} time(s).
  // ■ Activates when Relax is fully stacked. Affects self after the stacks are removed.
  // Invulnerable for {description_value_04} sec.
  // Attract: Taunt all enemies for {description_value_05} sec.
  // Recovers {description_value_06}% of the caster's final Max HP as HP.
  // ■ Activates when recovery takes effect. Affects all allies.
  // Attack Damage ▲ {description_value_07}% for {description_value_08} sec.
  // p01: [65, 62, 59, 56, 53, 51, 49, 47, 45, 43]
  // p02: [2.54, 2.71, 2.88, 3.05, 3.22, 3.38, 3.55, 3.72, 3.89, 4.06]
  // p03: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20]
  // p04: [2.57, 2.84, 3.11, 3.38, 3.65, 3.92, 4.19, 4.46, 4.73, 5]
  // p05: [2.57, 2.84, 3.11, 3.38, 3.65, 3.92, 4.19, 4.46, 4.73, 5]
  // p06: [3.27, 3.49, 3.7, 3.92, 4.14, 4.36, 4.58, 4.8, 5.01, 5.23]
  // p07: [13.12, 13.99, 14.87, 15.74, 16.62, 17.49, 18.37, 19.24, 20.12, 20.99]
  // p08: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7]
  skill2: {
    groupId: 23302,
    triggers: [
      // S2 P1（Relax）：每 43 发 +1 层（上限 20），满层清除后触发治疗
      // 满层时直接 pushBuff（partIdx:2）保证日志顺序：heal(1) 先于 buff(2)
      // HEAL_RECEIVED（tdefIdx=2）仍负责其他来源治疗触发
      {
        on: 'SHOT_COUNT',
        opts: { every: 43, counterKey: 'crownShotCount' },
        handler(state, caster) {
          pushBuff(state, { name: 'Relax', unitId: caster.id, endTick: Infinity, stackLimit: 20 }, false);
          const relax = state.buffs.find(b => b.name === 'Relax' && b.unitId === caster.id);
          if (!relax || relax.stacks < 20) return;
          state.buffs = state.buffs.filter(b => !(b.name === 'Relax' && b.unitId === caster.id));
          const healPct      = getSkillValue(caster.rawSkill2, 5, caster.skillLevels[1]) / 100;
          const attackDmgPct = getSkillValue(caster.rawSkill2, 6, caster.skillLevels[1]) / 100;
          applyHeal(state, caster, Math.round(caster.stats.hp * healPct), { ...state._logCtx, partIdx: 1 });
        },
      },
      // tdefIdx=1：■段1(Relax满层 Invulnerable/Taunt)防御性效果未建模，占位
      {},
      // S2 P3（HEAL_RECEIVED）：Crown 自身受到任意治疗时 → 全员 Attack Damage ▲[p07]% 7s
      {
        on: 'HEAL_RECEIVED',
        conditions: [{ type: 'HEALED_UNIT_IS_SELF' }],
        handler(state, caster) {
          const attackDmgPct = getSkillValue(caster.rawSkill2, 6, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Royal Attire P3', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 7 });
        },
      },
    ],
  },

  // ── Last Kingdom
  // ■ Affects all allies.
  // Attack Damage ▲ {description_value_01}% for {description_value_02} sec.
  // Creates a Shield equal to {description_value_03}% of the caster's final Max HP for {description_value_04} sec.
  // p01: [22.65, 24.16, 25.67, 27.18, 28.69, 30.2, 31.71, 33.22, 34.73, 36.24]
  // p02: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15]
  // p03: [6.53, 6.96, 7.4, 7.84, 8.27, 8.71, 9.14, 9.58, 10.01, 10.45]
  // p04: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15]
  burst: {
    groupId: 13303,
    triggers: [
      // Burst（Last Kingdom）：
      //   全员 Attack Damage ▲36.24% 15s
      //   全员护盾 10.45% Crown HP 15s（刷新取 max(旧, 新)）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const attackDmgPct = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const shieldPct    = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'Last Kingdom', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 15 },
          { ...state._logCtx, lineIdx: 1 });
          const shieldAmt = Math.round(caster.stats.hp * shieldPct);
          const shieldEnd = state.tick + TICK_RATE * 15;
          applyShield(state, ALL_ALLIES, shieldAmt, shieldEnd,
          { ...state._logCtx, lineIdx: 2 });
        },
      },
    ],
  },
};
