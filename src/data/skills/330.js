import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

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
      // S1（One for All）：进入全爆裂 → 按本轮爆裂施放状态分组 15s
      //   施放者：ATK flat ▲64.51% Crown ATK + Reload Speed ▲44.35%
      //   未施放者：DEF flat ▲37.44% Crown DEF + Reload Speed ▲44.35%
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const ids          = state.burstCastersThisRotation;
          const endTick      = state.tick + TICK_RATE * 15;
          const atkFlatPct   = getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100;
          const reloadSpdPct = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          const defFlatPct   = getSkillValue(caster.rawSkill1, 4, caster.skillLevels[0]) / 100;
          for (const u of state.squad) {
            if (ids.has(u.id)) {
              pushBuff(state, { name: 'crown_skill1_atkFlat',  unitId: u.id, atkFlat: Math.round(caster.stats.atk * atkFlatPct), endTick });
            } else {
              pushBuff(state, { name: 'crown_skill1_defFlat',  unitId: u.id, defFlat: Math.round(caster.stats.def * defFlatPct), endTick });
            }
            pushBuff(state, { name: 'crown_skill1_reloadSpd', unitId: u.id, reloadSpeedPct: reloadSpdPct, endTick });
          }
        },
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
      // S2（Guardian / Relax）：每 43 发 +1 层（上限 20）
      // 满 20 层：Crown 自身回复 5.23% HP；全员 Attack Damage ▲20.99% 7s
      {
        on: 'SHOT_COUNT',
        opts: { every: 43, counterKey: 'crownShotCount' },
        handler(state, caster) {
          caster.skillState.crownRelaxStacks = (caster.skillState.crownRelaxStacks ?? 0) + 1;
          if (caster.skillState.crownRelaxStacks < 20) return;
          caster.skillState.crownRelaxStacks = 0;
          const healPct      = getSkillValue(caster.rawSkill2, 5, caster.skillLevels[1]) / 100;
          const attackDmgPct = getSkillValue(caster.rawSkill2, 6, caster.skillLevels[1]) / 100;
          applyHeal(state, caster, Math.round(caster.stats.hp * healPct));
          pushBuff(state, { name: 'crown_skill2_attackDmg', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 7 });
        },
      },
      // S2 HEAL_RECEIVED：Crown 自身受到治疗时 → 全员 Attack Damage ▲[S2 param6]% 7s
      // 与满层触发共用 buff name；pushBuff 刷新语义保证不叠加
      {
        on: 'HEAL_RECEIVED',
        handler(state, caster, ctx) {
          if (ctx.unit?.id !== caster.id) return;
          const attackDmgPct = getSkillValue(caster.rawSkill2, 6, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'crown_skill2_attackDmg', unitId: null,
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
          pushBuff(state, { name: 'crown_burst_attackDmg', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 15 });
          const shieldAmt = Math.round(caster.stats.hp * shieldPct);
          const shieldEnd = state.tick + TICK_RATE * 15;
          for (const u of state.squad) {
            if (u.shieldHp > 0) {
              u.shieldHp      = Math.max(u.shieldHp, shieldAmt);
              u.shieldEndTick = Math.max(u.shieldEndTick, shieldEnd);
            } else {
              u.shieldHp = shieldAmt; u.shieldEndTick = shieldEnd;
            }
          }
        },
      },
    ],
  },
};
