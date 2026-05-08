import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Frontline Command
  // ■ Activates when the last bullet hits the target. Affects all allies.
  // Critical Rate of normal attacks ▲ {description_value_01}% for {description_value_02} sec.
  // ■ Activates when attacking with Full Charge. Affects all allies.
  // Recovers {description_value_03}% of caster's final Max HP.
  // Fills Burst Gauge by {description_value_04}%.
  // p01: [8.65, 9.31, 9.98, 10.64, 11.31, 11.98, 12.64, 13.31, 13.97, 14.64]
  // p02: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p03: [0.34, 0.37, 0.4, 0.42, 0.45, 0.48, 0.51, 0.53, 0.56, 0.59]
  // p04: [8.46, 9.11, 9.76, 10.41, 11.06, 11.71, 12.36, 13.01, 13.66, 14.31]
  skill1: {
    groupId: 23521,
    triggers: [
      // S1（Frontline Command）：末弹 → 全员 Crit Rate ▲X% 5s（SSR fav 数值）
      {
        on: 'LAST_BULLET',
        handler(state, caster) {
          const helmS1 = caster.ssrFavSkills?.skill1;
          const s1Lv   = helmS1?._activeSkillLevel ?? 0;
          if (!helmS1 || s1Lv <= 0) return;
          const critBonus = getSkillValue(helmS1, 0, s1Lv) / 100;
          pushBuff(state, { name: 'helm_skill1_critRate', unitId: null,
            critRateBonus: critBonus, endTick: state.tick + TICK_RATE * 5 });
        },
      },
      // S1 SSR：全蓄力命中 → 全员 HP 回复（dvl[2]） + 全队共享爆裂槽增加（dvl[3]）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const helmS1 = caster.ssrFavSkills?.skill1;
          const s1Lv   = helmS1?._activeSkillLevel ?? 0;
          if (s1Lv <= 0) return;
          const hpVals = helmS1.description_value_list?.[2]?.description_value ?? [];
          const bgVals = helmS1.description_value_list?.[3]?.description_value ?? [];
          const hpPct  = parseFloat(hpVals[s1Lv - 1] ?? '0') / 100;
          const bgPct  = parseFloat(bgVals[s1Lv - 1] ?? '0') / 100;
          if (hpPct > 0) {
            const hpGain = Math.round(caster.stats.hp * hpPct);
            // 全员治疗；HEAL_RECEIVED 触发由 battle.js 中 applyHeal 后调用 executeSkillTriggers 覆盖
            for (const u of state.squad) applyHeal(state, u, hpGain);
          }
          if (bgPct > 0)
            addBurstGauge(state, caster.name, 'helm_s1_gaugeBoost', Math.round(bgPct * BURST_GAUGE_MAX));
        },
      },
    ],
  },

  // ── Fire Away
  // ■ Affects all allies.
  // Damage to Interruption Parts ▲ {description_value_01}% continuously.
  // ■ Activates when entering Full Burst. Affects all allies.
  // Attack Damage ▲ {description_value_02}% for {description_value_03} sec.
  // ■ Activates when hitting a target with Full Charge. Affects the target.
  // Deals {description_value_04}% of final ATK as additional damage.
  // p01: [1.82, 1.96, 2.1, 2.24, 2.38, 2.52, 2.66, 2.8, 2.94, 3.08]
  // p02: [16.47, 17.74, 19, 20.27, 21.54, 22.8, 24.07, 25.34, 26.61, 27.87]
  // p03: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p04: [105.76, 113.89, 122.03, 130.16, 138.3, 146.44, 154.57, 162.71, 170.84, 178.98]
  skill2: {
    groupId: 23522,
    triggers: [
      // S2（Fire Away）：进入全爆裂 → 全员 Attack Damage ▲X% 10s（SSR fav 数值）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const helmS2    = caster.ssrFavSkills?.skill2;
          const s2Lv      = helmS2?._activeSkillLevel ?? 0;
          if (!helmS2 || s2Lv <= 0) return;
          const atkDmgPct = getSkillValue(helmS2, 1, s2Lv) / 100;
          pushBuff(state, { name: 'helm_skill2_attackDmg', unitId: null,
            attackDamagePct: atkDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // S2 SSR：全蓄力命中 → 额外技能伤害（dvl[3]） + Helm 爆裂槽增加
      {
        on: 'FULL_CHARGE',
        handler(state, caster, ctx) {
          const helmS2 = caster.ssrFavSkills?.skill2;
          const s2Lv   = helmS2?._activeSkillLevel ?? 0;
          if (s2Lv <= 0) return;
          const exVals = helmS2.description_value_list?.[3]?.description_value ?? [];
          const exMult = parseFloat(exVals[s2Lv - 1] ?? '0') / 100;
          if (exMult <= 0) return;
          const sums = ctx.sums ?? getBuffSums(state, caster.id);
          fireSkillHit(state, caster, exMult, sums, false);
          addBurstGauge(state, caster.name, 'helm_s2_skill', caster.targetBurstEnergyPerShot);
        },
      },
    ],
  },

  // ── Aegis Cannon
  // ■ Affects the enemy with the highest final ATK.
  // Deals {description_value_01}% of final ATK as Burst Skill damage.
  // ■ Affects all allies.
  // Recovers {description_value_02}% of attack damage as HP for {description_value_03} sec.
  // ■ Affects self.
  // Charge Damage Multiplier ▲ {description_value_04}% for {description_value_05} round(s).
  // p01: [4867.2, 5241.6, 5616, 5990.4, 6364.8, 6739.2, 7113.6, 7488, 7862.4, 8236.8]
  // p02: [32.17, 34.65, 37.12, 39.6, 42.07, 44.55, 47.02, 49.5, 51.97, 54.45]
  // p03: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p04: [93.6, 100.8, 108, 115.2, 122.4, 129.6, 136.8, 144, 151.2, 158.4]
  // p05: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 13523,
    triggers: [
      // Burst（Aegis Cannon）：SSR 伤害 + 生命偷取 10s + 蓄力伤害 buff for 10 round(s)
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const helmBurst = caster.ssrFavSkills?.burst;
          const bLv       = helmBurst?._activeSkillLevel ?? 0;
          if (!helmBurst || bLv <= 0) return;
          const burstMult = getSkillValue(helmBurst, 0, bLv) / 100;
          const lsPct     = getSkillValue(helmBurst, 1, bLv) / 100;
          const cdPct     = getSkillValue(helmBurst, 3, bLv) / 100;
          const sums      = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, burstMult, sums, false);
          pushBuff(state, { name: 'helm_burst_heal', unitId: null,
            lifeStealPct: lsPct, endTick: state.tick + TICK_RATE * 10 });
          // round-based buff：for 10 round(s)，每次全蓄力自动消耗，无时间上限
          if (cdPct > 0)
            pushBuff(state, { name: 'helm_burst_chargeDmg', unitId: caster.id,
              chargeDamagePct: cdPct, endTick: Infinity, endRounds: 10 });
        },
      },
    ],
  },
};
