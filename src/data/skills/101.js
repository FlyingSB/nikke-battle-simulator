import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Drake  (resource_id: 101)
export default {

  // ── Overcharge
  // base group_id: 21011 / SSR group_id: 121011 (skill_change_slot=1, Villain Figurine 200801)
  // ■ [SSR] Activates at the beginning of Full Burst. Affects all allies.
  //   Hit Rate ▲ {p01}% for {p02=10} sec. ATK ▲ {p03}% for {p04=10} sec.
  // ■ [SSR] Affects all allies with a Shotgun.
  //   ATK ▲ {p05}% for {p06=10} sec. Max Ammunition Capacity ▲ {p07}% for {p08=10} sec.
  //
  // SSR p01 HR all (lv10=20.09%): [11.85, 12.77, 13.68, 14.60, 15.51, 16.43, 17.34, 18.26, 19.17, 20.09]
  // SSR p03 ATK all (lv10=11.85%): [7.00, 7.54, 8.08, 8.61, 9.15, 9.69, 10.22, 10.76, 11.30, 11.85]
  // SSR p05 ATK SG (lv10=63.88%): [37.67, 40.56, 43.45, 46.35, 49.24, 52.13, 55.03, 57.92, 60.81, 63.88]
  // SSR p07 MaxAmmo SG (lv10=50.14%): [29.60, 31.88, 34.16, 36.44, 38.72, 41.00, 43.28, 45.57, 47.85, 50.14]
  skill1: {
    groupId: 21011,
    // P1 / P2 拆为两个 trigger：日志的 P 序号取自 trigger 下标
    triggers: [
      // P1：进入全爆裂 → 全队 Hit Rate ▲[p01]% + ATK ▲[p03]% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          // [TODO 基础技能] 进入全爆裂 → 全员HitRate▲p01% + ATK▲p03% 10s（base group_id 21011）
          const favS1 = caster.ssrFavSkills?.skill1;
          if (!favS1) return false;
          const favLv = favS1._activeSkillLevel ?? 10;
          const end10 = state.tick + TICK_RATE * 10;
          const hrPct     = getSkillValue(favS1, 0, favLv) / 100;
          const atkAllPct = getSkillValue(favS1, 2, favLv) / 100;
          pushBuff(state, { name: 'Overcharge P1', unitId: null, hitRatePct: hrPct, atkPct: atkAllPct, endTick: end10 });
        },
      },
      // P2：进入全爆裂 → SG 友军 ATK ▲[p05]% + Max Ammo ▲[p07]% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const favS1 = caster.ssrFavSkills?.skill1;
          if (!favS1) return false;
          const favLv = favS1._activeSkillLevel ?? 10;
          const end10 = state.tick + TICK_RATE * 10;
          const atkSgPct  = getSkillValue(favS1, 4, favLv) / 100;
          const ammoPct   = getSkillValue(favS1, 6, favLv) / 100;
          pushBuff(state, { name: 'Overcharge P2', unitId: null, atkPct: atkSgPct, maxAmmoPct: ammoPct, weaponFilter: 'SG', endTick: end10 });
        },
      },
    ],
  },

  // ── Thunderbolt
  // base group_id: 21012 / SSR group_id: 121012 (skill_change_slot=2)
  // ■ [SSR] Activates after {p01=10} attack(s). Affects {p02=3} enemy unit(s) with the lowest remaining HP.
  //   Deals {p03}% of final ATK as damage.
  // ■ [SSR] Activates after {p04=5} attack(s). Affects {p05=1} enemy unit(s) with lowest HP.
  //   Deals {p06}% of final ATK as damage.
  //
  // SSR p03 dmg 10-shot (lv10=98.55%): [58.15, 62.62, 67.09, 71.57, 76.04, 80.51, 84.98, 89.46, 93.93, 98.55]
  // SSR p06 dmg 5-shot (lv10=201.6%): [119.00, 128.13, 137.26, 146.39, 155.52, 164.65, 173.78, 182.91, 192.04, 201.60]
  skill2: {
    groupId: 21012,
    triggers: [
      // [SSR] 每 10 发 → 最低 HP 3 敌方各受 [p03]% ATK 技能伤害
      {
        on: 'SHOT_COUNT',
        opts: { every: 10, counterKey: 'drakeS2_10' },
        handler(state, caster) {
          // [TODO 基础技能] 每10发 → 最低HP 3敌方各受p03% ATK伤害（base group_id 21012）
          const favS2 = caster.ssrFavSkills?.skill2;
          const favLv = favS2?._activeSkillLevel ?? 0;
          if (!favS2 || favLv <= 0) return;
          const dmgPct = getSkillValue(favS2, 2, favLv) / 100;
          // 游戏打 3 个不同目标，模拟器只有单敌，只计 1 次命中
          const sums   = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, dmgPct, sums, 'S2 P1');
        },
      },
      // [SSR] 每 5 发 → 最低 HP 1 敌方受 [p06]% ATK 技能伤害
      {
        on: 'SHOT_COUNT',
        opts: { every: 5, counterKey: 'drakeS2_5' },
        handler(state, caster) {
          const favS2 = caster.ssrFavSkills?.skill2;
          const favLv = favS2?._activeSkillLevel ?? 0;
          if (!favS2 || favLv <= 0) return;
          const dmgPct = getSkillValue(favS2, 5, favLv) / 100;
          const sums   = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, dmgPct, sums, 'S2 P2');
        },
      },
    ],
  },

  // ── Drake Special
  // base group_id: 11013 / SSR group_id: 111013 (skill_change_slot=3)
  // ■ [SSR] Affects enemies within attack range.
  //   Deals {p01}% of final ATK as damage.
  // ■ [SSR] Affects self.
  //   Max Ammunition Capacity ▲ {p02}% for {p03=10} sec.
  //   Attack Damage ▲ {p04}% for {p05=10} sec.
  //
  // SSR p01 Burst dmg (lv10=3009.6%): [1775.00, 1911.97, 2048.95, 2185.92, 2322.89, 2459.86, 2596.84, 2733.81, 2870.78, 3009.60]
  // SSR p02 MaxAmmo self (lv10=72.18%): [42.60, 45.88, 49.16, 52.45, 55.73, 59.01, 62.29, 65.57, 68.86, 72.18]
  // SSR p04 AttackDmg self (lv10=31.68%): [18.69, 20.12, 21.55, 22.98, 24.42, 25.85, 27.28, 28.71, 30.14, 31.68]
  burst: {
    groupId: 11013,
    triggers: [
      // Burst P1（SSR）：范围伤害 p01%
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const favBurst = caster.ssrFavSkills?.burst;
          const favLv    = favBurst?._activeSkillLevel ?? 0;
          if (!favBurst || favLv <= 0) return false;
          const sums   = getBuffSums(state, caster.id);
          const dmgPct = getSkillValue(favBurst, 0, favLv) / 100;
          fireSkillHit(state, caster, dmgPct, sums, 'Burst');
        },
      },
      // Burst P2（SSR）：自身 Max Ammo ▲ + Attack Damage ▲ 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const favBurst = caster.ssrFavSkills?.burst;
          const favLv    = favBurst?._activeSkillLevel ?? 0;
          if (!favBurst || favLv <= 0) return false;
          const end10     = state.tick + TICK_RATE * 10;
          const ammoPct   = getSkillValue(favBurst, 1, favLv) / 100;
          const atkDmgPct = getSkillValue(favBurst, 3, favLv) / 100;
          pushBuff(state, { name: 'Drake Special', unitId: caster.id, maxAmmoPct: ammoPct, attackDamagePct: atkDmgPct, endTick: end10 });
        },
      },
    ],
  },
};
