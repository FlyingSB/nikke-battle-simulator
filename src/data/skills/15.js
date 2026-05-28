import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Sparkling Boost
  // ■ Activates when entering Full Burst. Affects all Electric Code allies.
  // ATK ▲ {description_value_01}% of caster's ATK for {description_value_02} sec.
  // Reloading Speed ▲ {description_value_03}% for {description_value_04} sec.
  // p01: [32.68, 35.2, 37.71, 40.22, 42.74, 45.25, 47.77, 50.28, 52.8, 55.31]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [29.12, 31.36, 33.6, 35.84, 38.08, 40.32, 42.56, 44.8, 47.04, 49.28]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  skill1: {
    groupId: 20151,
    triggers: [
      // S1（Summer Wave）：进入全爆裂 → 队中 Electric Code 友军：
      //   ATK flat ▲[S1 param0]% Anis ATK + Reload Speed ▲[S1 param2]% 10s
      {
        on: 'ENTER_FULL_BURST',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const atkPct    = getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100;
          const reloadPct = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          const atkBonus  = Math.round(caster.stats.atk * atkPct);
          const end10     = state.tick + TICK_RATE * 10;
          for (const u of state.squad) {
            if (u.element !== 'Electric') continue;
            pushBuff(state, { name: 'anisss_s1_atkFlat',   unitId: u.id, atkFlat:        atkBonus,   endTick: end10 });
            pushBuff(state, { name: 'anisss_s1_reloadSpd', unitId: u.id, reloadSpeedPct: reloadPct,  endTick: end10 });
          }
        },
      },
    ],
  },
  // ── Sparkling Missile
  // ■ Activates when firing the last bullet. Affects {description_value_04} enemy unit(s) with the highest final ATK.
  // Deals {description_value_01}% of final ATK as damage.
  // ■ Activates when firing the last bullet. Affects self.
  // Damage to Interruption Parts ▲ {description_value_02}% for {description_value_03} sec.
  // p01: [225.97, 243.36, 260.74, 278.12, 295.5, 312.89, 330.27, 347.65, 365.04, 382.42]
  // p02: [4.08, 4.4, 4.71, 5.02, 5.34, 5.65, 5.97, 6.28, 6.6, 6.91]
  // p03: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p04: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
  skill2: {
    groupId: 20152,
    triggers: [
      // S2（Sparkling Missile）：末弹 → [S2 param0]% ATK 技能伤害
      //   自身 Damage to Interruption Parts ▲[S2 param1]% 10s（不计入伤害输出）
      // S2 P1：末弹 → 追加技能伤害
      {
        on: 'LAST_BULLET',
        logTargets: null,
        handler(state, caster) {
          const skillDmg = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          const sums     = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, skillDmg, sums, false, 'S2');
        },
      },
      // S2 P2：自身 Damage to Interruption Parts ▲ p01% 10s
      {
        on: 'LAST_BULLET',
        logTargets: 'SELF',
        handler(state, caster) {
          const partsDmg = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'anisss_s2_partsDmg', unitId: caster.id,
            interruptionPartsDamagePct: partsDmg, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },
  // ── Sparkling Wave
  // ■ Affects self.
  // Max Ammunition Capacity ▼ {description_value_01}% for {description_value_02} sec.
  // Reloading Speed ▲ {description_value_03}% for {description_value_04} sec.
  // Elemental Advantage Attack Damage ▲ {description_value_05}% for {description_value_06} sec.
  // p01: [43.68, 47.04, 50.4, 53.76, 57.12, 60.48, 63.84, 67.2, 70.56, 73.92]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [16.38, 17.64, 18.9, 20.16, 21.42, 22.68, 23.94, 25.2, 26.46, 27.72]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [24.96, 26.88, 28.8, 30.72, 32.64, 34.56, 36.48, 38.4, 40.32, 42.24]
  // p06: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 10153,
    triggers: [
      // Burst（Sparkling Wave）：
      //   Max Ammo ▼[Burst param0]% 10s + Reload Speed ▲[Burst param2]% 10s + Elem Adv ATK Dmg ▲[Burst param4]% 10s
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'SELF',
        handler(state, caster) {
          const end10       = state.tick + TICK_RATE * 10;
          // Max Ammo ▼X%：T33 per-effect round，mult = 1 - X/100
          const maxAmmoDecPct = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const reloadPct     = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          const elemAdvPct    = getSkillValue(caster.rawBurst, 4, caster.skillLevels[2]) / 100;
          const ammoMult      = 1 - maxAmmoDecPct;
          caster.tempMaxAmmoMult    = ammoMult;
          caster.tempMaxAmmoEndTick = end10;
          const reducedMax = Math.max(1, caster.baseAmmo + Math.round(caster.baseAmmo * (ammoMult - 1)))
                           + (caster.stats.bonusAmmo ?? 0) + caster.favAmmoBonus;
          caster.ammoLeft   = reducedMax;
          caster.reloadTick = 0;
          pushBuff(state, { name: 'anisss_burst_reloadSpd',  unitId: caster.id, reloadSpeedPct:        reloadPct,  endTick: end10 });
          pushBuff(state, { name: 'anisss_burst_elemAdvDmg', unitId: caster.id, elementAdvantageBonus: elemAdvPct, endTick: end10 });
        },
      },
    ],
  },
};
