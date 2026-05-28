import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── EX Magazine（S1）
  // base group_id: 21701 / SSR group_id: 121701 (skill_change_slot=1)
  // ■ [SSR] Activates when entering Full Burst. Affects all allies.
  //   ATK ▲ {p00}% for {p01=10} sec.
  //   Reloading Speed ▲ {p02}% for {p03=10} sec.
  //   Max Ammunition Capacity ▼ {p04=50.66}% for {p05=10} sec.
  //   Attack Damage ▲ {p06}% for {p07=10} sec.
  //
  // SSR p00 ATK%: [18.77, 19.30, 19.84, 20.38, 20.92, 21.46, 22.00, 22.54, 23.08, 23.61]
  // SSR p02 Reloading Speed%: [22.88, 26.02, 29.16, 32.30, 35.45, 38.59, 41.73, 44.88, 48.02, 51.16]
  // SSR p04 Max Ammo ▼% (const): [50.66]
  // SSR p06 Attack Damage%: [11.91, 12.82, 13.74, 14.66, 15.57, 16.49, 17.41, 18.32, 19.24, 20.16]
  skill1: {
    groupId: 121701,
    triggers: [
      {
        on: 'ENTER_FULL_BURST',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          // [TODO 基础技能] 进入全爆裂 → 全员ATK▲p00% + Reload▲p02% + MaxAmmo▼p04% 10s（base group_id 21701）
          const favS1 = caster.ssrFavSkills?.skill1;
          if (!favS1) return false;
          const lv      = favS1._activeSkillLevel ?? 10;
          const endTick = state.tick + TICK_RATE * 10;

          const atkPct       = getSkillValue(favS1, 0, lv) / 100;
          const reloadSpdPct = getSkillValue(favS1, 2, lv) / 100;
          const maxAmmoDec   = getSkillValue(favS1, 4, lv) / 100;  // const 50.66%
          const atkDmgPct    = getSkillValue(favS1, 6, lv) / 100;

          pushBuff(state, { name: 'pv_s1_atk',    unitId: null, atkPct, endTick });
          pushBuff(state, { name: 'pv_s1_reload',  unitId: null, reloadSpeedPct: reloadSpdPct, endTick });
          pushBuff(state, { name: 'pv_s1_atkDmg',  unitId: null, attackDamagePct: atkDmgPct, endTick });

          // Max Ammunition Capacity ▼ p04%（全员；pushBuff 负责记录 buff 持续时间与到期截弹，
          // tempMaxAmmoMult 供 battle.js 装填路径计算有效弹容，二者需同步刷新）
          const ammoMult = 1 - maxAmmoDec;
          pushBuff(state, { name: 'pv_s1_maxAmmo', unitId: null, maxAmmoPct: -maxAmmoDec, endTick });
          for (const t of state.squad) {
            t.tempMaxAmmoMult    = ammoMult;
            t.tempMaxAmmoEndTick = endTick;
            const newMax = Math.max(1, t.baseAmmo + Math.round(t.baseAmmo * (ammoMult - 1)))
                         + (t.stats.bonusAmmo ?? 0) + (t.favAmmoBonus ?? 0);
            if (t.ammoLeft > newMax) t.ammoLeft = newMax;
          }
        },
      },
    ],
  },

  // ── LD Assault（S2）
  // base group_id: 21702 / SSR group_id: 121702 (skill_change_slot=2)
  // ■ [SSR] Activates when the last bullet hits the target. Affects the target.
  //   Deals {p00}% of final ATK as additional damage.
  // ■ [SSR] Activates when the last bullet hits a target in Designated Target status.
  //   Deals {p01}% of final ATK as additional damage.
  //   Damage Taken ▲ {p02}% for {p03=10} sec.
  //
  // SSR p00: [151.37, 163.02, 174.66, 186.30, 197.95, 209.59, 221.24, 232.88, 244.53, 256.17]
  // SSR p01 (Designated Target): [996.86, 1073.55, 1150.23, 1226.91, 1303.59, 1380.27, 1456.96, 1533.64, 1610.32, 1687.00]
  // SSR p02 Damage Taken ▲%: [5.92, 6.37, 6.83, 7.28, 7.74, 8.20, 8.65, 9.11, 9.56, 10.01]
  skill2: {
    groupId: 121702,
    triggers: [
      // S2 P1（SSR）：末弹 → 追加伤害 p00% + 敌人承伤 ▲ p02% 10s
      {
        on: 'LAST_BULLET',
        logTargets: null,
        handler(state, caster) {
          const favS2 = caster.ssrFavSkills?.skill2;
          if (!favS2) return false;
          const lv   = favS2._activeSkillLevel ?? 10;
          const sums = getBuffSums(state, caster.id);
          const dmgPct = getSkillValue(favS2, 0, lv) / 100;
          fireSkillHit(state, caster, dmgPct, sums, false, 'S2 P1');
          const dtPct   = getSkillValue(favS2, 2, lv) / 100;
          const endTick = state.tick + TICK_RATE * 10;
          state.enemyDamageTakenPct += dtPct;
          pushBuff(state, { name: 'pv_s2_dmgTaken', unitId: null, enemyDamageTakenPct: dtPct, endTick });
        },
      },
      // S2 P2（SSR）：Designated Target 状态下额外追加伤害 p01%
      {
        on: 'LAST_BULLET',
        logTargets: null,
        handler(state, caster) {
          const favS2 = caster.ssrFavSkills?.skill2;
          if (!favS2) return false;
          if (!((state.pvDesignatedTargetEndTick ?? 0) > state.tick)) return false;
          const lv        = favS2._activeSkillLevel ?? 10;
          const sums      = getBuffSums(state, caster.id);
          const desDmgPct = getSkillValue(favS2, 1, lv) / 100;
          fireSkillHit(state, caster, desDmgPct, sums, false, 'S2 P2');
        },
      },
    ],
  },

  // ── AK Missile（Burst）
  // base group_id: 11703 / SSR group_id: 111703 (skill_change_slot=3)
  // ■ [SSR] Affects all enemies.
  //   Deals {p00}% of final ATK as Burst Skill damage.
  //   Designated Target: ATK ▼ {p02}% for {p03=10} sec.  [ATK ▼ 不建模]
  // ■ [SSR] Affects self.
  //   Elemental Advantage Attack Damage ▲ {p04}% for {p05=10} sec.
  //
  // SSR p00 Burst%: [831.79, 895.77, 959.76, 1023.74, 1087.72, 1151.71, 1215.69, 1279.68, 1343.66, 1407.64]
  // SSR p02 ATK ▼% (not modeled — 敌方攻击与 DPS 计算无关): [2.96, 3.19, 3.42, 3.65, 3.88, 4.11, 4.33, 4.56, 4.79, 5.02]
  // SSR p04 Elemental Advantage ATK Damage%: [76.82, 82.73, 88.64, 94.55, 100.46, 106.37, 112.28, 118.19, 124.10, 130.00]
  burst: {
    groupId: 111703,
    triggers: [
      // Burst P1（SSR）：对所有敌人造成爆裂技能伤害 p00%
      {
        on: 'BURST_SKILL_USE',
        logTargets: null,
        handler(state, caster) {
          const favBurst = caster.ssrFavSkills?.burst;
          if (!favBurst) return false;
          const lv     = favBurst._activeSkillLevel ?? 10;
          const sums   = getBuffSums(state, caster.id);
          const dmgPct = getSkillValue(favBurst, 0, lv) / 100;
          fireSkillHit(state, caster, dmgPct, sums, false, 'Burst');
        },
      },
      // Burst P2（SSR）：自身 Elemental Advantage ATK Damage ▲ p04% 10s + 标记 Designated Target
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'SELF',
        handler(state, caster) {
          const favBurst = caster.ssrFavSkills?.burst;
          if (!favBurst) return false;
          const lv        = favBurst._activeSkillLevel ?? 10;
          const endTick   = state.tick + TICK_RATE * 10;
          const elemADPct = getSkillValue(favBurst, 4, lv) / 100;
          pushBuff(state, { name: 'pv_burst_elemAD', unitId: caster.id,
            elementAdvantageBonus: elemADPct, endTick });
          state.pvDesignatedTargetEndTick = endTick;
        },
      },
    ],
  },
};
