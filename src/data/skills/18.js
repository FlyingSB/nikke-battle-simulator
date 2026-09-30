import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Neon: Vision Eye  (resource_id: 18)
export default {

  // ── Healthy Body
  // ■ Activates when attacked while not in Healthy Body status. Affects self.
  // Invulnerable for {description_value_03} sec. Activates {description_value_04} time(s) per battle.
  // Gains debuff immunity to ∞ debuffs for {description_value_05} sec. Activates {description_value_06} time(s) per battle.
  // Healthy Body: Potency of HP restored ▲ {description_value_01}% for {description_value_02} sec.
  // ■ Activates when landing a Full Charge attack. Affects the enemy if the enemy is the stage target.
  // Firepower Explosion:
  // Effect: Deals {description_value_07}% of final ATK as additional damage.
  // Additional effect of Super Firepower status: Deals {description_value_08}% of final ATK as additional damage.
  // p01: [6.06, 6.53, 7, 7.46, 7.93, 8.4, 8.86, 9.33, 9.8, 10.26]
  // p02: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20]
  // p03: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p04: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p05: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p06: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p07: [258.81, 278.71, 298.62, 318.53, 338.44, 358.34, 378.25, 398.16, 418.07, 437.98]
  // p08: [155.28, 167.23, 179.17, 191.12, 203.06, 215.01, 226.95, 238.9, 250.84, 262.79]
  skill1: {
    groupId: 20181,
    triggers: [
      // [TODO] S1 P1（Healthy Body）：受到攻击且无 Healthy Body → 自身无敌 3s + 免疫 debuff 3s（5次/战）
      //   + Healthy Body: HP 回复效力 ▲10.26% 20s — 防御性技能，暂不建模
      {},
      // S1 P2（Firepower Explosion）：全蓄力命中舞台目标 → 额外 437.98% final ATK
      //   Super Firepower 状态中追加 262.79% final ATK
      {
        on: 'FULL_CHARGE',
        handler(state, caster, ctx) {
          if (!state.isStageTarget) return;
          if (state.enemyHp <= 0) return;
          const sums     = ctx.sums ?? getBuffSums(state, caster.id);
          const baseMult = getSkillValue(caster.rawSkill1, 6, caster.skillLevels[0]) / 100;
          fireSkillHit(state, caster, baseMult, sums, 'S1 P2 Firepower Explosion');
          addBurstGauge(state, caster.name, 'S1 P2 Firepower Explosion', caster.targetBurstEnergyPerShot);
          const isSF = (caster.skillState.nveSuperFirepowerEndTick ?? 0) > state.tick;
          if (isSF) {
            const sfMult = getSkillValue(caster.rawSkill1, 7, caster.skillLevels[0]) / 100;
            fireSkillHit(state, caster, sfMult, sums, 'S1 P2 Super Firepower Explosion');
            addBurstGauge(state, caster.name, 'S1 P2 Super Firepower Explosion', caster.targetBurstEnergyPerShot);
          }
        },
      },
    ],
  },

  // ── Firepower Charge
  // ■ Activates at the start of battle. Affects self.
  // Increases the Firepower Gauge's charge by {description_value_08}.
  // ■ Activates when performing a normal attack while in Firepower Charge status. Affects self.
  // Increases the Firepower Gauge's charge by 2.
  // ■ Activates when Firepower Charge ends. Affects self.
  // Increases the Firepower Gauge's charge by {description_value_09}.
  // ■ Activates when Full Burst ends while Firepower Gauge is active. Affects self.
  // Burst Gauge filling speed ▲ {description_value_02}% x Firepower Gauge charge amount for {description_value_03} sec.
  // ■ Activates when entering Full Burst. Affects self.
  // Maximum Firepower: ATK ▲ {description_value_04}% for {description_value_05} sec.
  // Additional effect for Super Firepower: ATK ▲ {description_value_06}% for {description_value_07} sec.
  // p02: [2.96, 3.19, 3.42, 3.65, 3.87, 4.1, 4.33, 4.56, 4.79, 5]
  // p03: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p04: [47.29, 50.93, 54.57, 58.21, 61.85, 65.49, 69.12, 72.76, 76.4, 80.04]
  // p05: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p06: [20.71, 22.31, 23.9, 25.49, 27.09, 28.68, 30.27, 31.87, 33.46, 35.05]
  // p07: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p08: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
  // p09: [45, 45, 45, 45, 45, 45, 45, 45, 45, 45]
  skill2: {
    groupId: 20182,
    triggers: [
      // S2 Part1：战斗开始 → 火力槽 = 100
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          caster.skillState.nveGauge = getSkillValue(caster.rawSkill2, 7, caster.skillLevels[1]);
        },
      },

      // S2 Part2+3：每次普通攻击时检查 Firepower Charge 状态
      //   - Firepower Charge 期间：每发 +2 槽
      //   - Firepower Charge 刚结束（本发是结束后第一发）：+45 槽
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'nveShotCount' },
        handler(state, caster) {
          const fcEnd = caster.skillState.nveFirepowerChargeEndTick ?? 0;
          if (fcEnd > 0 && state.tick > fcEnd) {
            // Firepower Charge 已过期，补 +45（执行一次后清零）
            const gaugeOnEnd = getSkillValue(caster.rawSkill2, 8, caster.skillLevels[1]);
            caster.skillState.nveGauge = (caster.skillState.nveGauge ?? 0) + gaugeOnEnd;
            caster.skillState.nveFirepowerChargeEndTick = 0;
          } else if (fcEnd > 0 && state.tick <= fcEnd) {
            // Firepower Charge 期间：每发 +2
            caster.skillState.nveGauge = (caster.skillState.nveGauge ?? 0) + 2;
          }
        },
      },

      // tdefIdx=2：■段2(Firepower Charge ends)由上方 SHOT_COUNT 内部逻辑处理，此处占位
      {},

      // S2 Part4：全爆裂结束且火力槽 > 0 → 每发充能 +flat 5s
      //   flat_increment = burstEnergyPerShot × [S2 p02]% × 槽量
      //   flat 加法，与基础充能叠加后整体乘 FC 倍率（不是百分比乘法）
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const gauge = caster.skillState.nveGauge ?? 0;
          if (gauge <= 0) return false;
          const rate          = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
          const duration      = getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]);
          const flatIncrement = Math.round(caster.burstEnergyPerShot * rate * gauge);
          pushBuff(state, { name: 'Firepower Charge P4', unitId: caster.id,
            burstGaugeFlat: flatIncrement, endTick: state.tick + TICK_RATE * duration });
        },
      },

      // S2 Part5：进入全爆裂
      //   L3（Maximum Firepower Effect）：ATK ▲p04% p05s
      //   L4（Super Firepower 状态追加）：ATK ▲p06% p07s
      //   （原文 L2 为 "Maximum Firepower:" 标题行，故 lineIdx 为 2 / 3）
      //   （Burst 的 BURST_SKILL_USE 先于 ENTER_FULL_BURST 触发，Super Firepower 状态已生效）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Maximum Firepower', unitId: caster.id,
            atkPct: getSkillValue(caster.rawSkill2, 3, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 4, lv) },
            { ...state._logCtx, lineIdx: 2 });

          const isSF = (caster.skillState.nveSuperFirepowerEndTick ?? 0) > state.tick;
          if (!isSF) return;
          pushBuff(state, { name: 'Maximum Super Firepower', unitId: caster.id,
            atkPct: getSkillValue(caster.rawSkill2, 5, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 6, lv) },
            { ...state._logCtx, lineIdx: 3 });
        },
      },
    ],
  },

  // ── Super Firepower
  // ■ Activates when the Firepower Gauge's charge is lower than 100. Affects self.
  // Firepower Charge: Charges the Firepower Gauge for {description_value_02} sec. This effect cannot be removed.
  // Increases the Firepower Gauge's charge by 1.
  // ■ Activates when the Firepower Gauge's charge is at 100. Affects self.
  // Super Firepower: Attack Damage ▲ {description_value_04}% for {description_value_05} sec.
  // Decreases the Firepower Gauge's charge by 100.
  // ■ Affects self.
  // Explosion Radius ▲ {description_value_06}% for {description_value_07} sec.
  // Attack Damage ▲ {description_value_10}% for {description_value_11} sec.
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p04: [34.56, 35.72, 36.89, 38.05, 39.22, 40.38, 41.54, 42.71, 43.87, 45.03]
  // p05: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p06: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200]
  // p07: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p10: [22.94, 32.64, 42.33, 52.03, 61.73, 71.42, 81.12, 90.82, 100.51, 110.21]
  // p11: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 10183,
    triggers: [
      // Burst（Super Firepower）：
      //   火力槽 ≥ 100 → Super Firepower（Attack Damage ▲45.03% 10s）+ 槽 -100
      //   火力槽 < 100  → Firepower Charge（10s 期间每发 +2）+ 槽 +1
      //   常驻：Attack Damage ▲110.21% 10s（Explosion Radius ▲200% 未建模）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const end10 = state.tick + TICK_RATE * 10;
          const gauge = caster.skillState.nveGauge ?? 0;

          if (gauge >= 100) {
            caster.skillState.nveGauge                 = gauge - 100;
            caster.skillState.nveSuperFirepowerEndTick = end10;
            const sfAtkDmgPct = getSkillValue(caster.rawBurst, 3, caster.skillLevels[2]) / 100;
            // 触发器位于 triggers[0]，默认 logCtx 为 P1；显式指定 P2 L2 供日志 tooltip 高亮
            pushBuff(state, { name: 'Super Firepower P2 L2', unitId: caster.id,
              attackDamagePct: sfAtkDmgPct, endTick: end10 },
              { ...state._logCtx, partIdx: 1, lineIdx: 1 });
          } else {
            caster.skillState.nveSuperFirepowerEndTick  = 0;
            const fcDuration = getSkillValue(caster.rawBurst, 1, caster.skillLevels[2]);
            caster.skillState.nveFirepowerChargeEndTick = state.tick + TICK_RATE * fcDuration;
            caster.skillState.nveGauge = gauge + 1;
          }

          // [TODO: P3 L2 Explosion Radius ▲p06% p07s — 引擎尚无爆炸半径机制，未建模]
          // P3 L3：常驻 Attack Damage buff
          const alwaysAtkDmgPct = getSkillValue(caster.rawBurst, 9, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'Super Firepower P3 L3', unitId: caster.id,
            attackDamagePct: alwaysAtkDmgPct, endTick: end10 },
            { ...state._logCtx, partIdx: 2, lineIdx: 2 });
        },
      },
    ],
  },
};
