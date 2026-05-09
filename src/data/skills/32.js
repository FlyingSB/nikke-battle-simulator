import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Health Up!
  // ■ Activates after landing {p01} normal attack(s). Affects all allies.
  // Hit Rate ▲ {p02}% for {p03} sec.
  // ■ Activates after landing {p04} normal attack(s). Affects all allies with a Submachine Gun.
  // Hit Rate ▲ {p05}% for {p06} sec.
  // [SSR] ■ Activates after landing {p07} normal attack(s). Affects self.
  // ATK ▲ {p08}% for {p09} sec.
  //
  // 基础技能 group_id: 20321
  // SSR 升级 group_id: 120321  (skill_change_slot=1)
  //
  // p01: [30,...] p02 (lv10=5.44%) p03: [5,...] p04: [30,...] p05 (lv10=3.79%) p06: [5,...]
  // SSR p07: [30,...] p08 (lv10=50.06%) p09: [5,...]
  skill1: {
    groupId: 20321,
    triggers: [
      // S1：每 30 发 → 全员 Hit Rate ▲[p02]% 5s；SMG 友军 Hit Rate ▲[p05]% 5s
      // Hit Rate 不影响 DPS，buff 仅作记录
      // [SSR] 同触发 → 自身 ATK ▲[SSR p08]% 5s（lv10=50.06%）
      {
        on: 'SHOT_COUNT',
        opts: { every: 30, counterKey: 'mirandaS1ShotCount' },
        handler(state, caster) {
          const s1Lv = caster.skillLevels[0];
          const end5 = state.tick + TICK_RATE * 5;
          const hr1  = getSkillValue(caster.rawSkill1, 1, s1Lv) / 100;
          const hr2  = getSkillValue(caster.rawSkill1, 4, s1Lv) / 100;
          pushBuff(state, { name: 'miranda_s1_hitRate_all', unitId: null,
            hitRatePct: hr1, endTick: end5 });
          pushBuff(state, { name: 'miranda_s1_hitRate_smg', unitId: null,
            hitRatePct: hr2, endTick: end5, weaponFilter: 'SMG' });

          const favS1 = caster.ssrFavSkills?.skill1;
          const favLv = favS1?._activeSkillLevel ?? 0;
          if (!favS1 || favLv <= 0) return;
          const atkPct = getSkillValue(favS1, 7, favLv) / 100;
          pushBuff(state, { name: 'miranda_s1_ssr_atkPct', unitId: caster.id,
            atkPct, endTick: end5 });
        },
      },
    ],
  },

  // ── Wake Up!
  // ■ Activates when entering Full Burst. Affects all allies.
  // Critical Damage ▲ {p01}% for {p02} sec.
  // [SSR] ■ Activates when entering Full Burst. Affects self.
  // Critical Rate ▲ {p03}% for {p04} sec.
  // Attack Damage ▲ {p05}% for {p06} sec.
  // [SSR] ■ Activates when entering Full Burst. Affects 1 ally unit with the highest final ATK
  //         (except caster). Critical Rate ▲ {p08}% for {p09} round(s).
  //
  // 基础技能 group_id: 20322
  // SSR 升级 group_id: 120322  (skill_change_slot=2)
  //
  // p01 (lv10=32.99%) p02: [10,...]
  // SSR p03 (lv10=30.1%) p05 (lv10=23.7%) p08 (lv10=85.42%)
  skill2: {
    groupId: 20322,
    triggers: [
      // S2：进入全爆裂 → 全员 Crit Damage ▲[p01]% 10s（lv10=32.99%）
      // [SSR] 自身 Crit Rate ▲[SSR p03]% + Attack Damage ▲[SSR p05]% 10s
      // [SSR] 最高 ATK 友军（除自身）Crit Rate ▲[SSR p08]% 1 round
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const s2Lv       = caster.skillLevels[1];
          const end10      = state.tick + TICK_RATE * 10;
          const critDmgPct = getSkillValue(caster.rawSkill2, 0, s2Lv) / 100;
          pushBuff(state, { name: 'miranda_s2_critDmg', unitId: null,
            critDmgBonus: critDmgPct, endTick: end10 });

          const favS2 = caster.ssrFavSkills?.skill2;
          const favLv = favS2?._activeSkillLevel ?? 0;
          if (!favS2 || favLv <= 0) return;

          const critRateSelf  = getSkillValue(favS2, 2, favLv) / 100;
          const attackDmgSelf = getSkillValue(favS2, 4, favLv) / 100;
          pushBuff(state, { name: 'miranda_s2_ssr_self_critRate', unitId: caster.id,
            critRateBonus: critRateSelf, endTick: end10 });
          pushBuff(state, { name: 'miranda_s2_ssr_self_attackDmg', unitId: caster.id,
            attackDamagePct: attackDmgSelf, endTick: end10 });

          // 最高 ATK 友军（除自身）Crit Rate ▲ 持续 1 round
          // 无限弹角色（Moran/Nayuta burst 中）不消耗 roundsLeft，直到无限弹结束后首次实弹命中才消耗
          const topAlly = state.squad
            .filter(u => u.id !== caster.id)
            .sort((a, b) => b.stats.atk - a.stats.atk)[0];
          if (topAlly) {
            const crBonus = getSkillValue(favS2, 7, favLv) / 100;
            pushBuff(state, { name: 'miranda_s2_ssr_ally_critRate', unitId: topAlly.id,
              critRateBonus: crBonus, roundsLeft: 1, endTick: Infinity });
          }
        },
      },
    ],
  },

  // ── Powering Up!
  // ■ Affects {p01} ally unit(s) with the highest final ATK (except caster;
  //   including the caster if there are not enough allies).
  // ATK ▲ {p02}% for {p03} sec.
  // Critical Damage ▲ {p04}% for {p05} sec.
  //
  // 基础技能 group_id: 10323 — p01=1
  // SSR 升级 group_id: 112901 (skill_change_slot=3) — p01=2
  //
  // p02 (lv10=40.4%) p03: [10,...] p04 (lv10=56.23%) p05: [10,...]
  burst: {
    groupId: 10323,
    triggers: [
      // Burst：最高 ATK 友军（除自身，不足时补自身）ATK ▲[p02]% + Crit Damage ▲[p04]% 10s
      // [SSR] 目标扩至 2 名
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const bLv    = caster.skillLevels[2];
          const end10  = state.tick + TICK_RATE * 10;
          const atkPct = getSkillValue(caster.rawBurst, 1, bLv) / 100;
          const cdPct  = getSkillValue(caster.rawBurst, 3, bLv) / 100;

          const count   = caster.ssrFavSkills?.burst ? 2 : 1;
          const targets = state.squad
            .filter(u => u.id !== caster.id)
            .sort((a, b) => b.stats.atk - a.stats.atk)
            .slice(0, count);
          if (targets.length < count) targets.push(caster);

          for (const t of targets) {
            pushBuff(state, { name: 'miranda_burst_atkPct',  unitId: t.id, atkPct,            endTick: end10 });
            pushBuff(state, { name: 'miranda_burst_critDmg', unitId: t.id, critDmgBonus: cdPct, endTick: end10 });
          }
        },
      },
    ],
  },
};
