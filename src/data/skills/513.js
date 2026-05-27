import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Bubble Order
  // ■ Activates only when in Focusing status. Affects all allies.
  // Focuses fire continuously.
  // ■ Activates when Full Burst ends. Affects all allies.
  // Cooldown of Burst Skill ▼ {description_value_01} sec.
  // ■ [P1: Activates only when in Focusing status — not modeled in simulator]
  // ■ Activates when entering Full Burst. Affects all allies.
  // Attack Damage ▲ {description_value_02}% for {description_value_03} sec.
  // ■ Activates each time the total ammo expended by allies reaches {description_value_04}. Affects all allies.
  // Fills Burst Gauge by {description_value_05}%.
  // p01: [5.34, 5.58, 5.82, 6.05, 6.29, 6.53, 6.77, 7, 7.24, 7.48]
  // p02: [2.5, 2.66, 2.83, 3, 3.17, 3.33, 3.5, 3.67, 3.83, 4]
  // p03: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p04: [400, 400, 400, 400, 400, 400, 400, 400, 400, 400]
  // p05: [23.12, 24.66, 26.2, 27.75, 29.29, 30.83, 32.37, 33.91, 35.46, 37]
  skill1: {
    groupId: 25131,
    partOffset: 1,  // P1（Focusing status）不在模拟器中建模，从 P2 开始编号
    triggers: [
      // S1 P2：全爆裂结束 → 全员爆裂冷却 ▼[S1 param0]s
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const cdSec          = getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]);
          const reductionTicks = Math.round(TICK_RATE * cdSec);
          for (const u of state.squad)
            u.burstCdRemaining = Math.max(0, u.burstCdRemaining - reductionTicks);
          if (state.buffLog)
            state.buffLog.push({ type: 'cd_reduction', tick: state.tick, name: 'lm_s1_cdReduction', unitId: null, reductionTicks });
        },
      },
      // S1 P3：进入全爆裂 → 全员 Attack Damage ▲[S1 param1]% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const attackDmgPct = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'lm_skill1_attackDmg', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // S1 P4：每 400 发全队弹药 → 共享爆裂槽 ▲[S1 param4]%
      {
        on: 'AMMO_MILESTONE',
        handler(state, caster, ctx) {
          if (!ctx.milestone400) return;
          const gaugePct = getSkillValue(caster.rawSkill1, 4, caster.skillLevels[0]) / 100;
          addBurstGauge(state, caster.name, 'lm_s1_gaugeBoost', Math.round(gaugePct * BURST_GAUGE_MAX));
        },
      },
    ],
  },

  // ── Bubble Wave
  // ■ Activates when the enemy appears. Affects the target.
  // Bubble: Damage Taken ▲ {description_value_01}% continuously.
  // ■ Activates after landing {description_value_02} normal attack(s). Affects the target if the target is in Bubble status.
  // Explosive Bubble: Damage Taken ▲ {description_value_01}% continuously.
  // Stuns for {description_value_03} sec.
  // Removes Bubble.
  // ■ Activates every {description_value_04} sec only during Full Burst. Affects random enemy unit(s).
  // Deals {description_value_05}% of final ATK as damage. Attacks sequentially for {description_value_06} time(s).
  // ■ Activates each time the total ammo expended by allies reaches {description_value_07}. Affects random enemy unit(s).
  // Bubble Barrage: Deals {description_value_08}% of final ATK as damage. Attacks sequentially for {description_value_09} time(s).
  // p01: [3.16, 3.37, 3.58, 3.79, 4, 4.21, 4.42, 4.63, 4.84, 5.05]
  // p02: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50]
  // p03: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p04: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p05: [39.6, 42.24, 44.88, 47.52, 50.16, 52.8, 55.44, 58.08, 60.72, 63.36]
  // p06: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4]
  // p07: [500, 500, 500, 500, 500, 500, 500, 500, 500, 500]
  // p08: [53.12, 56.66, 60.21, 63.75, 67.29, 70.83, 74.37, 77.92, 81.46, 85]
  // p09: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  skill2: {
    groupId: 25132,
    triggers: [
      // S2 Bubble：战斗开始 → 敌人承伤 ▲[S2 param0]%（持续）
      // 注：Boss 战中"敌人出现时"与"战斗开始时"视为同一时机，合并处理
      {
        on: 'BATTLE_START',
        target: 'ENEMY',
        handler(state, caster) {
          const damageTakenPct = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          state.enemyDamageTakenPct += damageTakenPct;
        },
      },
      // S2 Explosive Bubble：累计 50 发（LM 自身）→ 状态标记切换（承伤值不变）
      {
        on: 'SHOT_COUNT',
        opts: { every: 50, counterKey: 'lmShotCount' },
        handler(state, caster) {
          if (!caster.skillState.lmExplosiveBubble) {
            caster.skillState.lmExplosiveBubble = true;
            // enemyDamageTakenPct 不变；仅内部标记切换（Bubble → Explosive Bubble）
          }
        },
      },
      // S2 Bubble Wave：全爆裂期间每 1 秒 → 4×[S2 param4]% ATK 技能伤害
      // HIDDEN 期间也触发（Bubble Wave 不需瞄准）
      {
        on: 'INTERVAL_IN_BURST',
        opts: { seconds: 1 },
        logTargets: null,  // 伤害已由 fireSkillHit 写入日志，无需额外 skill_trigger 条目
        handler(state, caster, ctx) {
          const mult = getSkillValue(caster.rawSkill2, 4, caster.skillLevels[1]) / 100;
          const sums = ctx.sums ?? getBuffSums(state, caster.id);
          for (let h = 0; h < 4 && state.enemyHp > 0; h++) {
            fireSkillHit(state, caster, mult, sums, false, 'S2_bubble_wave');
          }
        },
      },
      // S2 Barrage：每 500 发全队弹药 → 爆裂弹幕 10×[S2 param7]% ATK
      {
        on: 'AMMO_MILESTONE',
        handler(state, caster, ctx) {
          if (!ctx.milestone500) return;
          const sums    = getBuffSums(state, caster.id);
          const barrageMult = getSkillValue(caster.rawSkill2, 7, caster.skillLevels[1]) / 100;
          for (let h = 0; h < 10 && state.enemyHp > 0; h++) {
            fireSkillHit(state, caster, barrageMult, sums, false, 'S2_barrage');
          }
        },
      },
    ],
  },

  // ── Siren's Song
  // ■ Affects all allies.
  // Attack damage ▲ {description_value_01}% for {description_value_02} sec.
  // Reloads {description_value_03}% magazine(s).
  // ■ Affects self.
  // ATK ▲ {description_value_04}% of caster's ATK for {description_value_05} sec.
  // p01: [6.33, 6.75, 7.18, 7.6, 8.02, 8.44, 8.87, 9.29, 9.71, 10.13]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [20.79, 22.17, 23.56, 24.94, 26.33, 27.72, 29.1, 30.49, 31.87, 33.26]
  // p04: [10.8, 11.52, 12.24, 12.96, 13.68, 14.4, 15.12, 15.84, 16.56, 17.28]
  // p05: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 15133,
    triggers: [
      // Burst（Siren's Song）：
      //   全员 Attack Damage ▲10.13% 10s
      //   全员补弹 33.26% maxAmmo（补满时取消装填）
      //   自身 ATK flat ▲17.28% LM.atk 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const end10         = state.tick + TICK_RATE * 10;
          const attackDmgPct  = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const ammoReloadPct = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          const atkFlatPct    = getSkillValue(caster.rawBurst, 3, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'lm_burst_attackDmg', unitId: null, attackDamagePct: attackDmgPct, endTick: end10 });
          for (const u of state.squad) {
            const ammoBefore = u.ammoLeft;
            u.ammoLeft = Math.min(u.maxAmmo, u.ammoLeft + Math.floor(u.maxAmmo * ammoReloadPct));
            if (u.ammoLeft >= u.maxAmmo && u.reloadTick > 0) u.reloadTick = 0;
            if (state.ammoLog && u.ammoLeft !== ammoBefore)
              state.ammoLog.push({ tick: state.tick, unitId: u.id, unitName: u.name,
                delta: u.ammoLeft - ammoBefore, ammoAfter: u.ammoLeft, maxAmmo: u.maxAmmo, source: 'lm_burst_reload' });
          }
          pushBuff(state, { name: 'lm_burst_atkFlat', unitId: caster.id,
            atkFlat: Math.round(caster.stats.atk * atkFlatPct), endTick: end10 });
        },
      },
    ],
  },
};
