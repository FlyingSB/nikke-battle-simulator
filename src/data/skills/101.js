import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Overcharge
  // ■ Activates at the beginning of Full Burst. Affects all allies.
  // Hit Rate ▲ {p01}% for {p02} sec. ATK ▲ {p03}% for {p04} sec.
  // [SSR] Hit Rate 升至 {SSR p01}%；SG 友军额外 ATK ▲ {SSR p05}% + Max Ammo ▲ {SSR p07}%
  //
  // 基础 group_id: 21011
  // SSR   group_id: 121011 (skill_change_slot=1, Villain Figurine 200801)
  //
  // 基础 p01/p03 (lv10=11.85%) · p02/p04: [10,...]
  // SSR p01 (lv10=20.09%) · p03 (lv10=11.85%) · p05 (lv10=63.88%) · p07 (lv10=50.14%)
  skill1: {
    groupId: 21011,
    triggers: [
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const end10 = state.tick + TICK_RATE * 10;
          const favS1 = caster.ssrFavSkills?.skill1;
          const favLv = favS1?._activeSkillLevel ?? 0;

          if (favS1 && favLv > 0) {
            // SSR：Hit Rate ▲[p01]% 全队（Hit Rate 不影响 DPS，仅记录）
            const hrPct     = getSkillValue(favS1, 0, favLv) / 100;
            pushBuff(state, { name: 'drake_s1_hitRate',  unitId: null, hitRatePct: hrPct, endTick: end10 });
            // SSR：ATK ▲[p03]% 全队
            const atkAllPct = getSkillValue(favS1, 2, favLv) / 100;
            pushBuff(state, { name: 'drake_s1_atk_all',  unitId: null, atkPct: atkAllPct, endTick: end10 });
            // SSR：SG 友军 ATK ▲[p05]% + Max Ammo ▲[p07]%
            const atkSgPct  = getSkillValue(favS1, 4, favLv) / 100;
            const ammoPct   = getSkillValue(favS1, 6, favLv) / 100;
            pushBuff(state, { name: 'drake_s1_atk_sg',  unitId: null, atkPct: atkSgPct,   weaponFilter: 'SG', endTick: end10 });
            pushBuff(state, { name: 'drake_s1_ammo_sg', unitId: null, maxAmmoPct: ammoPct, weaponFilter: 'SG', endTick: end10 });
          } else {
            const s1Lv   = caster.skillLevels[0];
            const hrPct  = getSkillValue(caster.rawSkill1, 0, s1Lv) / 100;
            const atkPct = getSkillValue(caster.rawSkill1, 2, s1Lv) / 100;
            pushBuff(state, { name: 'drake_s1_hitRate',  unitId: null, hitRatePct: hrPct, endTick: end10 });
            pushBuff(state, { name: 'drake_s1_atk_all',  unitId: null, atkPct, endTick: end10 });
          }
        },
      },
    ],
  },

  // ── Thunderbolt
  // ■ Activates after {p01} attack(s). Affects {p02} enemy unit(s) with the lowest remaining HP.
  // Deals {p03}% of final ATK as damage.
  // [SSR] + ■ Activates after {p04} attack(s). Affects {p05} enemy unit(s) with lowest HP.
  //           Deals {p06}% of final ATK as damage.
  //
  // 基础 group_id: 21012 — p01=10, p02=3, p03 (lv10=98.55%)
  // SSR   group_id: 121012 — 同基础 + p04=5, p05=1, p06 (lv10=201.6%)
  skill2: {
    groupId: 21012,
    triggers: [
      // 每 10 发 → 最低 HP 3 敌方各受 [p03]% ATK 技能伤害
      {
        on: 'SHOT_COUNT',
        opts: { every: 10, counterKey: 'drakeS2_10' },
        handler(state, caster) {
          const favS2  = caster.ssrFavSkills?.skill2;
          const favLv  = favS2?._activeSkillLevel ?? 0;
          const raw    = (favS2 && favLv > 0) ? favS2 : caster.rawSkill2;
          const lv     = (favS2 && favLv > 0) ? favLv : caster.skillLevels[1];
          const dmgPct = getSkillValue(raw, 2, lv) / 100;
          // 游戏打 3 个不同目标，模拟器只有单敌，只计 1 次命中
          const sums   = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, dmgPct, sums, false, 'drake_s2_10shot');
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
          fireSkillHit(state, caster, dmgPct, sums, false, 'drake_s2_5shot');
        },
      },
    ],
  },

  // ── Drake Special
  // ■ Affects enemies within attack range. Deals {p01}% of final ATK as damage.
  // ■ Affects self. Max Ammunition Capacity ▲ {p02}% for {p03} sec.
  // [SSR] 伤害升至 {SSR p01}% + 自身 Attack Damage ▲ {SSR p04}% for 10 sec.
  //
  // 基础 group_id: 11013 — p01 (lv10=1254%) · p02 (lv10=72.18%) · p03: [10,...]
  // SSR   group_id: 111013 — p01 (lv10=3009.6%) · p02 (lv10=72.18%) · p04 (lv10=31.68%)
  burst: {
    groupId: 11013,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const favBurst = caster.ssrFavSkills?.burst;
          const favLv    = favBurst?._activeSkillLevel ?? 0;
          const useSSR   = favBurst && favLv > 0;
          const end10    = state.tick + TICK_RATE * 10;
          const sums     = getBuffSums(state, caster.id);

          if (useSSR) {
            // SSR：范围伤害 [SSR p01]%（lv10=3009.6%）
            const dmgPct    = getSkillValue(favBurst, 0, favLv) / 100;
            fireSkillHit(state, caster, dmgPct, sums, false, 'drake_burst', { burstSkillDamage: true });
            // 自身 Max Ammo ▲[SSR p02]%（lv10=72.18%）
            const ammoPct   = getSkillValue(favBurst, 1, favLv) / 100;
            pushBuff(state, { name: 'drake_burst_ammo',   unitId: caster.id, maxAmmoPct: ammoPct, endTick: end10 });
            // 自身 Attack Damage ▲[SSR p04]%（lv10=31.68%）
            const atkDmgPct = getSkillValue(favBurst, 3, favLv) / 100;
            pushBuff(state, { name: 'drake_burst_atkDmg', unitId: caster.id, attackDamagePct: atkDmgPct, endTick: end10 });
          } else {
            const bLv    = caster.skillLevels[2];
            // 基础：范围伤害 [p01]%（lv10=1254%）
            const dmgPct  = getSkillValue(caster.rawBurst, 0, bLv) / 100;
            fireSkillHit(state, caster, dmgPct, sums, false, 'drake_burst', { burstSkillDamage: true });
            // 自身 Max Ammo ▲[p02]%（lv10=72.18%）
            const ammoPct = getSkillValue(caster.rawBurst, 1, bLv) / 100;
            pushBuff(state, { name: 'drake_burst_ammo', unitId: caster.id, maxAmmoPct: ammoPct, endTick: end10 });
          }
        },
      },
    ],
  },
};
