import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Emergency-Crafted Bullets（SSR：Fire Starter 201101，skill_change_slot=1）
  // ■ Activates after {p00} normal attack(s). Affects self.
  //   Emergency-Crafted Bullets: Reload {p01}% of the magazine.
  // ■ Activates during Emergency-Crafted Bullets. Affects all allies.
  //   Temporary Modification: Max Ammunition Capacity ▲ {p02},
  //   stacks up to {p03=3} times, lasts {p04=5} sec.             [弹容量增量不建模]
  //   Critical Damage ▲ {p05}% for {p06=5} sec.
  //
  // SSR group_id: 121921
  // p00 shot threshold: [25,25,20,20,20,15,15,15,10,10]
  // p01 reload%: [3.13,3.37,3.62,3.86,4.1,4.34,4.58,4.82,5.06,5.31]
  // p02 ammo capacity ▲ per stack (not modeled): [1,1,1,1,1,2,2,2,2,2]
  // p03 max stacks (const): [3,...]
  // p04 duration (const): [5,...]
  // p05 Crit Damage ▲%: [2.96,3.21,3.47,3.72,3.97,4.23,4.48,4.73,4.99,5.24]
  // p06 duration (const): [5,...]
  //
  // S2（Modification Successful）效果在叠满时由本处 handler 驱动。
  // [TODO 基础技能]: 非 SSR 版 Tove 技能未建模
  skill1: {
    groupId: 121921,
    triggers: [
      {
        on: 'SHOT_COUNT',
        opts: { every: 1 },
        handler(state, caster) {
          const favS1 = caster.ssrFavSkills?.skill1;
          if (!favS1) return;
          const lv  = favS1._activeSkillLevel ?? 10;

          // 手动计数（threshold 随等级变化，不能用 opts.every 静态编码）
          const thr = getSkillValue(favS1, 0, lv);
          const ss  = caster.skillState;
          ss.tv_s1_shots = (ss.tv_s1_shots ?? 0) + 1;
          if (ss.tv_s1_shots < thr) return;
          ss.tv_s1_shots -= thr;

          // 自身补弹 p01% maxAmmo（若补满则取消装填计时）
          const reloadPct  = getSkillValue(favS1, 1, lv) / 100;
          const ammoBefore = caster.ammoLeft;
          caster.ammoLeft  = Math.min(caster.maxAmmo, caster.ammoLeft + Math.floor(caster.maxAmmo * reloadPct));
          if (caster.ammoLeft >= caster.maxAmmo && caster.reloadTick > 0) caster.reloadTick = 0;
          if (state.ammoLog && caster.ammoLeft !== ammoBefore)
            state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
              delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft,
              maxAmmo: caster.maxAmmo, source: 'tv_s1_reload' });

          const critDmgPct = getSkillValue(favS1, 5, lv) / 100;
          const stackIncr  = getSkillValue(favS1, 2, lv);   // 1 或 2
          const maxStacks  = getSkillValue(favS1, 3, lv);   // 3
          const dur        = getSkillValue(favS1, 4, lv);   // 5 sec
          const endTick    = state.tick + TICK_RATE * dur;

          // Crit Damage ▲ 全队（含自身）
          pushBuff(state, { name: 'tv_s1_critDmg', unitId: null, critDmgBonus: critDmgPct, endTick });

          // Temporary Modification 叠层：到期则重置
          if ((ss.tvTempModEndTick ?? 0) < state.tick) ss.tvTempModStacks = 0;
          const newStacks = Math.min(maxStacks, (ss.tvTempModStacks ?? 0) + stackIncr);
          ss.tvTempModStacks  = newStacks;
          ss.tvTempModEndTick = endTick;

          // S2 效果仅在叠满时激活
          if (newStacks < maxStacks) return;
          const favS2 = caster.ssrFavSkills?.skill2;
          if (!favS2) return;
          const lv2       = favS2._activeSkillLevel ?? 10;
          const crPct     = getSkillValue(favS2, 0, lv2) / 100;
          const atkSpdPct = getSkillValue(favS2, 1, lv2) / 100;

          // Crit Rate ▲ 全队（持续至 Temporary Modification 到期）
          pushBuff(state, { name: 'tv_s2_critRate', unitId: null, critRateBonus: crPct, endTick });

          // Attack Speed ▲ 霰弹枪友军（via buff 系统，支持多施法者叠加）
          for (const t of state.squad) {
            if (t.weaponType !== 'SG') continue;
            pushBuff(state, { name: `tv_s1_atkSpeed_${caster.id}_${t.id}`, unitId: t.id, atkSpeedPct: atkSpdPct, endTick });
          }
        },
      },
    ],
  },

  // ── Modification Successful（SSR：Fire Starter 201101，skill_change_slot=2）
  // ■ Only activates when Temporary Modification is fully stacked. Affects all allies.
  //   Critical Rate ▲ {p00}% continuously.
  // ■ Only activates when Temporary Modification is fully stacked. Affects all SG allies.
  //   Attack Speed ▲ {p01}% continuously.
  //
  // SSR group_id: 121922
  // p00 Crit Rate ▲%: [5.27,5.81,6.34,6.87,7.41,7.94,8.47,9.01,9.54,10.08]
  // p01 Attack Speed ▲%: [24.96,26.88,28.8,30.72,32.64,34.56,36.48,38.4,40.32,42.24]
  //
  // 效果由 S1 handler 在叠满时驱动；此槽位无独立触发。
  skill2: {
    groupId: 121922,
    triggers: [],
  },

  // ── Miracle of Makeshifts（SSR：Fire Starter 201101，skill_change_slot=3）
  // ■ Affects all allies.
  //   Miracle of Makeshifts: ATK ▲ {p00}% of caster's ATK.
  //   Mirrors the stack count of Temporary Modification for {p01=15} sec.
  // ■ Affects all shotgun-wielding allies.
  //   Miracle of Makeshifts: ATK ▲ {p02}% of caster's ATK.
  //   Mirrors the stack count of Temporary Modification for {p03=15} sec.
  //
  // SSR group_id: 111923
  // p00 ATK% of caster（全队，每层）: [1.37,1.47,1.58,1.68,1.79,1.9,2,2.11,2.21,2.32]
  // p01 duration (const): [15,...]
  // p02 ATK% of caster（SG 额外，每层）: [14.31,15.41,16.51,17.61,18.71,19.81,20.91,22.01,23.11,24.21]
  // p03 duration (const): [15,...]
  //
  // 全队 flat ATK = caster.atk × p00% × Temporary Modification 层数
  // SG 友军额外 flat ATK = caster.atk × p02% × 层数
  burst: {
    groupId: 111923,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const favBurst = caster.ssrFavSkills?.burst;
          if (!favBurst) return;
          const lv      = favBurst._activeSkillLevel ?? 10;
          const allPct  = getSkillValue(favBurst, 0, lv) / 100;
          const sgPct   = getSkillValue(favBurst, 2, lv) / 100;
          const endTick = state.tick + TICK_RATE * 15;

          const stacks = caster.skillState.tvTempModStacks ?? 0;
          if (stacks <= 0) return;

          const casterAtk  = caster.stats.atk;
          const allAtkFlat = casterAtk * allPct * stacks;

          // 全队 ATK ▲（flat，基于施法者 ATK）
          pushBuff(state, { name: 'tv_burst_atk', unitId: null, atkFlat: allAtkFlat, endTick });

          // SG 友军额外 ATK ▲
          for (const t of state.squad) {
            if (t.weaponType !== 'SG') continue;
            pushBuff(state, { name: 'tv_burst_atk_sg', unitId: t.id,
              atkFlat: casterAtk * sgPct * stacks, endTick });
          }
        },
      },
    ],
  },
};
