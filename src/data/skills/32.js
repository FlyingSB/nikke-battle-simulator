import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX, getFinalAtk } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Miranda  (resource_id: 32)
export default {

  // ── Health Up!
  // base group_id: 20321 / SSR group_id: 120321 (skill_change_slot=1)
  // ■ [SSR] Activates after landing {p01=30} normal attack(s). Affects all allies.
  //   Hit Rate ▲ {p02}% for {p03=5} sec.
  // ■ [SSR] Activates after landing {p04=30} normal attack(s). Affects all allies with a Submachine Gun.
  //   Hit Rate ▲ {p05}% for {p06=5} sec.
  // ■ [SSR] Activates after landing {p07=30} normal attack(s). Affects self.
  //   ATK ▲ {p08}% for {p09=5} sec.
  //
  // SSR p02 HR all (lv10=5.44%): [3.31, 3.53, 3.75, 3.97, 4.19, 4.41, 4.63, 4.86, 5.08, 5.44]
  // SSR p05 HR SMG (lv10=3.79%): [2.09, 2.26, 2.43, 2.61, 2.79, 2.97, 3.15, 3.33, 3.51, 3.79]
  // SSR p08 ATK self (lv10=50.06%): [29.58, 31.88, 34.18, 36.47, 38.77, 41.07, 43.37, 45.66, 47.96, 50.06]
  skill1: {
    groupId: 20321,
    triggers: [
      {
        on: 'SHOT_COUNT',
        opts: { every: 30, counterKey: 'mirandaS1ShotCount' },
        handler(state, caster) {
          // [TODO 基础技能] 每30发 → 全员HitRate▲p02% 5s；SMG友军HitRate▲p05% 5s；base group_id 20321（HR不影响DPS）
          const favS1 = caster.ssrFavSkills?.skill1;
          if (!favS1) return;
          const lv   = favS1._activeSkillLevel ?? 10;
          const end5 = state.tick + TICK_RATE * 5;

          const hr1 = getSkillValue(favS1, 1, lv) / 100;
          const hr2 = getSkillValue(favS1, 4, lv) / 100;
          pushBuff(state, { name: 'Health Up! P1 (Hit Rate)', unitId: null,
            hitRatePct: hr1, endTick: end5 }, { ...state._logCtx, partIdx: 0 });
          pushBuff(state, { name: 'Health Up! P2 (Hit Rate)', unitId: null,
            hitRatePct: hr2, endTick: end5, weaponFilter: 'SMG' }, { ...state._logCtx, partIdx: 1 });

          const atkPct = getSkillValue(favS1, 7, lv) / 100;
          pushBuff(state, { name: 'Health Up! (ATK)', unitId: caster.id,
            atkPct, endTick: end5 }, { ...state._logCtx, partIdx: 2 });
        },
      },
    ],
  },

  // ── Wake Up!
  // base group_id: 20322 / SSR group_id: 120322 (skill_change_slot=2)
  // ■ [SSR] Activates when entering Full Burst. Affects all allies.
  //   Critical Damage ▲ {p01}% for {p02=10} sec.
  // ■ [SSR] Activates when entering Full Burst. Affects self.
  //   Critical Rate ▲ {p03}% for {p04=10} sec.
  //   Attack Damage ▲ {p05}% for {p06=10} sec.
  // ■ [SSR] Activates when entering Full Burst. Affects 1 ally unit with the highest final ATK
  //         (except caster). Critical Rate ▲ {p08}% for {p09=1} round(s).
  //
  // SSR p01 CritDmg all (lv10=32.99%): [19.49, 21.00, 22.50, 24.00, 25.51, 27.01, 28.51, 30.01, 31.51, 32.99]
  // SSR p03 CritRate self (lv10=30.1%): [17.79, 19.14, 20.48, 21.83, 23.17, 24.52, 25.86, 27.21, 28.55, 30.10]
  // SSR p05 AttackDmg self (lv10=23.7%): [14.00, 15.07, 16.14, 17.21, 18.28, 19.35, 20.43, 21.50, 22.57, 23.70]
  // SSR p08 CritRate ally (lv10=85.42%): [50.48, 54.35, 58.23, 62.10, 65.98, 69.85, 73.73, 77.61, 81.48, 85.42]
  skill2: {
    groupId: 20322,
    triggers: [
      {
        on: 'ENTER_FULL_BURST',
        priority: 100,  // 最后结算：P3 依赖其他角色的 ATK buff 已推完才能准确选出最高 ATK 友军
        handler(state, caster) {
          // [TODO 基础技能] 进入全爆裂 → 全员CritDmg▲p01% 10s（base group_id 20322）
          const favS2 = caster.ssrFavSkills?.skill2;
          if (!favS2) return false;
          const lv    = favS2._activeSkillLevel ?? 10;
          const end10 = state.tick + TICK_RATE * 10;

          const critDamagePct = getSkillValue(favS2, 0, lv) / 100;
          pushBuff(state, { name: 'Wake Up! (Crit Damage)', unitId: null,
            critDamagePct: critDamagePct, endTick: end10 }, { ...state._logCtx, partIdx: 0 });

          const critRateSelf  = getSkillValue(favS2, 2, lv) / 100;
          const attackDmgSelf = getSkillValue(favS2, 4, lv) / 100;
          pushBuff(state, { name: 'Wake Up! (Attack Damage)', unitId: caster.id,
            critRatePct: critRateSelf, attackDamagePct: attackDmgSelf, endTick: end10 }, 
            { ...state._logCtx, partIdx: 1 });

          // 最高 ATK 友军（除自身）Crit Rate ▲ 持续 1 round
          // 无限弹角色（Moran/Nayuta burst 中）不消耗 roundsLeft，直到无限弹结束后首次实弹命中才消耗
          const effectiveAtk = u => {
            const s = getBuffSums(state, u.id);
            return u.stats.atk * (1 + s.atkPct) + s.atkFlat;
          };
          const topAlly = state.squad
            .filter(u => u.id !== caster.id)
            .sort((a, b) => effectiveAtk(b) - effectiveAtk(a))[0];
          if (topAlly) {
            const crBonus = getSkillValue(favS2, 7, lv) / 100;
            pushBuff(state, { name: 'Wake Up! (Crit Rate)', unitId: topAlly.id,
              critRatePct: crBonus, roundsLeft: 1, endTick: Infinity }, 
              { ...state._logCtx, partIdx: 2 });
          }
        },
      },
    ],
  },

  // ── Powering Up!
  // base group_id: 10323 / SSR group_id: 110323 (skill_change_slot=3)
  // ■ [SSR] Affects {p01=2} ally unit(s) with the highest final ATK (except caster;
  //         including the caster if there are not enough allies).
  //   ATK ▲ {p02}% for {p03=10} sec.
  //   Critical Damage ▲ {p04}% for {p05=10} sec.
  //
  // SSR p02 ATK% (lv10=40.4%): [23.87, 25.70, 27.52, 29.35, 31.17, 33.00, 34.83, 36.65, 38.48, 40.40]
  // SSR p04 CritDmg% (lv10=56.23%): [33.22, 35.78, 38.34, 40.90, 43.46, 46.02, 48.58, 51.14, 53.70, 56.23]
  //
  // 注：base group_id 10323 的 ATK% 在 index 2、CritDmg% 在 index 4，与 SSR 索引不同
  burst: {
    groupId: 10323,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          // [TODO 基础技能] 最高ATK友军(除自身)×1 ATK▲p02%(idx=2) + CritDmg▲p04%(idx=4) 10s（base group_id 10323）
          const favBurst = caster.ssrFavSkills?.burst;
          if (!favBurst) return false;
          const lv    = favBurst._activeSkillLevel ?? 10;
          const end10 = state.tick + TICK_RATE * 10;

          // SSR：index 1 = ATK%，index 3 = CritDmg%（base 的 2/4 不同，base 为 TODO）
          const atkPct = getSkillValue(favBurst, 1, lv) / 100;
          const cdPct  = getSkillValue(favBurst, 3, lv) / 100;

          const targets = state.squad
            .filter(u => u.id !== caster.id)
            .sort((a, b) => getFinalAtk(state, b) - getFinalAtk(state, a))  // "highest final ATK"
            .slice(0, 2);
          if (targets.length < 2) targets.push(caster);

          pushBuff(state, { name: 'Powering Up!', unitIds: targets.map(t => t.id),
            atkPct, critDamagePct: cdPct, endTick: end10 });
        },
      },
    ],
  },
};
