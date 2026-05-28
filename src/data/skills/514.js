import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Heat Emission 相关 buff 名称常量，用于解除时批量清理
const HE_BUFF_NAMES = ['grave_s1_reloadPenalty', 'grave_s1_burstSpeed', 'grave_s1_pierceDmg'];

function clearHeatEmission(state) {
  state.buffs = state.buffs.filter(b => !HE_BUFF_NAMES.includes(b.name));
}

export default {

  // ── Heat Emission
  // ■ Activates when Prediction status ends. Affects self.
  //   Removes {p00=100}% of bullets.
  //   Heat Emission: Reload Ratio ▼ {p01=50}%. Removes Heat Emission under certain conditions.
  // ■ Activates only when in Heat Emission status. Affects self.
  //   Recovers {p02=2}% of caster's final Max HP every 1 sec continuously.
  //   [HP 回复不建模 — 不影响 DPS 输出]
  // ■ Activates only when in Heat Emission status. Affects all allies.
  //   Burst Gauge filling speed ▲ {p03}% continuously.
  //   Pierce Damage ▲ {p04}% continuously.
  //
  // group_id: 25141
  // p00 bullets removed (const): [100, ...]
  // p01 Reload Ratio▼% (const): [50, ...]
  // p02 HP recovery %/sec (const): [2, ...]  — 不建模
  // p03 Burst Gauge fill speed▲%: [23.02, 24.79, 26.56, 28.33, 30.1, 31.87, 33.64, 35.42, 37.19, 38.96]
  // p04 Pierce Damage▲%: [28.6, 30.8, 33, 35.2, 37.4, 39.6, 41.8, 44, 46.2, 48.4]
  //
  // 触发时机：Prediction 状态（爆裂后 10s）结束时激活 Heat Emission。
  // INTERVAL 每秒检查 grave_predictionEndTick；Heat Emission 三种解除条件：
  //   a. 普通攻击命中（SHOT_COUNT）  b. 弹匣填满（RELOAD_END）  c. 爆裂技能发动（BURST_SKILL_USE）
  skill1: {
    groupId: 25141,
    triggers: [
      // Prediction 到期 → 激活 Heat Emission
      {
        on: 'INTERVAL',
        logTargets: 'SELF',
        opts: { seconds: 1 },
        handler(state, caster) {
          const predEnd = caster.skillState.grave_predictionEndTick ?? 0;
          if (!predEnd || state.tick < predEnd) return false;

          caster.skillState.grave_predictionEndTick = 0;
          caster.skillState.grave_predShotCount     = 0;

          const lv = caster.skillLevels[0];

          // 弹匣清空（"Removes 100% of bullets"）→ 触发装填
          const ammoBefore = caster.ammoLeft;
          caster.ammoLeft  = 0;
          if (state.ammoLog && ammoBefore > 0)
            state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
              delta: -ammoBefore, ammoAfter: 0, maxAmmo: caster.maxAmmo,
              source: 'grave_s1_heat_emission' });

          // Heat Emission：Reload Ratio ▼ 50%（持续，解除时由 clearHeatEmission 一并移除）
          const reloadPenalty = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          state.buffs = state.buffs.filter(b => b.name !== 'grave_s1_reloadPenalty');
          state.buffs.push({ name: 'grave_s1_reloadPenalty', unitId: caster.id,
            reloadSpeedPct: -reloadPenalty, endTick: Infinity });

          // 全员：Burst Gauge 填充速度 ▲ p03%
          // 提升值 = Grave 自己的 targetBurstEnergyPerShot × p03%（对所有人的 flat 值）
          const bgSpeedPct  = getSkillValue(caster.rawSkill1, 3, lv) / 100;
          const burstFlat   = Math.round(caster.targetBurstEnergyPerShot * bgSpeedPct);
          state.buffs = state.buffs.filter(b => b.name !== 'grave_s1_burstSpeed');
          state.buffs.push({ name: 'grave_s1_burstSpeed', unitId: null,
            burstGaugeFlat: burstFlat, endTick: Infinity });

          // 全员：Pierce Damage ▲ p04%（持续）
          const piercePct = getSkillValue(caster.rawSkill1, 4, lv) / 100;
          state.buffs = state.buffs.filter(b => b.name !== 'grave_s1_pierceDmg');
          state.buffs.push({ name: 'grave_s1_pierceDmg', unitId: null,
            pierceDamagePct: piercePct, endTick: Infinity });
        },
      },
      // Heat Emission 解除条件 a：普通攻击命中
      {
        on: 'SHOT_COUNT',
        logTargets: null,
        opts: { every: 1, counterKey: 'grave_s1_heShot' },
        handler(state, caster) {
          if (!state.buffs.some(b => b.name === 'grave_s1_reloadPenalty' && b.unitId === caster.id)) return;
          clearHeatEmission(state);
        },
      },
      // Heat Emission 解除条件 b：弹匣填满（RELOAD_END）
      {
        on: 'RELOAD_END',
        logTargets: null,
        handler(state, caster) {
          clearHeatEmission(state);
        },
      },
    ],
  },

  // ── Overheat
  // ■ Activates after landing {p00=15} normal attack(s). Affects self.
  //   Overheat I: ATK ▲ {p01}%. Removed upon reloading to max ammunition.
  // ■ Activates when normal attack hits after Prediction status takes effect. Affects self.
  //   Changes according to the number of hits. Previous effects trigger repeatedly.
  //   {p02=30} time(s): when in Prediction and Overheat I status.
  //   Overheat II: ATK ▲ {p03}% continuously.
  //   {p04=60} time(s): when in Prediction and Overheat II status.
  //   Overheat III: Attack Damage ▲ {p05}% continuously.
  //
  // group_id: 25142
  // p00 shot count (const): [15, ...]
  // p01 Overheat I ATK▲%: [9.15, 9.85, 10.56, 11.26, 11.96, 12.67, 13.37, 14.07, 14.78, 15.48]
  // p02 Overheat II trigger count (const): [30, ...]
  // p03 Overheat II ATK▲%: [12.21, 13.14, 14.09, 15.03, 15.97, 16.9, 17.84, 18.79, 19.72, 20.66]
  // p04 Overheat III trigger count (const): [60, ...]
  // p05 Overheat III Attack Damage▲%: [18.2, 19.6, 21, 22.4, 23.8, 25.2, 26.6, 28, 29.4, 30.8]
  skill2: {
    groupId: 25142,
    triggers: [
      // 每发射击 → 追踪普通攻击计数与 Prediction 期间命中数
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'grave_s2_dummy' },
        handler(state, caster) {
          const lv = caster.skillLevels[1];

          // Overheat I：每 15 发激活（装弹至满弹后清除）
          caster.skillState.grave_s2_shot15 = (caster.skillState.grave_s2_shot15 ?? 0) + 1;
          if (caster.skillState.grave_s2_shot15 >= 15) {
            caster.skillState.grave_s2_shot15 -= 15;
            const atkPct = getSkillValue(caster.rawSkill2, 1, lv) / 100;
            pushBuff(state, { name: 'grave_s2_overheatI', unitId: caster.id, atkPct, endTick: Infinity });
          }

          // Prediction 期间命中计数（Overheat II / III）
          const predEnd = caster.skillState.grave_predictionEndTick ?? 0;
          if (!predEnd || state.tick >= predEnd) return;

          caster.skillState.grave_predShotCount = (caster.skillState.grave_predShotCount ?? 0) + 1;
          const predCount = caster.skillState.grave_predShotCount;

          // Overheat II：Prediction 期间第 30 发，且 Overheat I 已激活
          if (predCount === 30 &&
              state.buffs.some(b => b.name === 'grave_s2_overheatI' && b.unitId === caster.id)) {
            const atkPct2 = getSkillValue(caster.rawSkill2, 3, lv) / 100;
            pushBuff(state, { name: 'grave_s2_overheatII', unitId: caster.id, atkPct: atkPct2, endTick: Infinity });
          }

          // Overheat III：Prediction 期间第 60 发，且 Overheat II 已激活
          if (predCount === 60 &&
              state.buffs.some(b => b.name === 'grave_s2_overheatII' && b.unitId === caster.id)) {
            const adPct = getSkillValue(caster.rawSkill2, 5, lv) / 100;
            pushBuff(state, { name: 'grave_s2_overheatIII', unitId: caster.id, attackDamagePct: adPct, endTick: Infinity });
          }
        },
      },
      // Overheat I 清除：装弹至满弹时移除（"Removed upon reloading to max ammunition"）
      // 注：无限弹药期间弹药不消耗，不会触发 RELOAD_END，故 Overheat I 在 Prediction 期间自然保留
      {
        on: 'RELOAD_END',
        logTargets: null,
        handler(state, caster) {
          caster.skillState.grave_s2_shot15 = 0;
          state.buffs = state.buffs.filter(
            b => !(b.name === 'grave_s2_overheatI' && b.unitId === caster.id));
        },
      },
    ],
  },

  // ── Plot Spoiler
  // ■ Affects self.
  //   Prediction:
  //   Current HP ▼ {p00=1}% every 1 sec, lasts for 10 sec.   [HP 扣减不建模]
  //   Grants unlimited ammunition for 10 sec.
  //   Gain Pierce for 10 sec.
  //   Pierce Damage ▲ {p01}% for 10 sec.
  //   Critical Rate ▲ {p05}% for 10 sec.
  // ■ Affects all allies.
  //   Attack Damage ▲ {p02}% for 10 sec.
  //   Pierce Damage ▲ {p03}% for 10 sec.
  //   Max Ammunition Capacity ▲ {p04=3} round(s) for 10 sec.
  //
  // group_id: 15143
  // p00 HP drain %/sec (const): [1, ...]  — 不建模
  // p01 Self Pierce Damage▲%: [31.2, 33.6, 36, 38.4, 40.8, 43.2, 45.6, 48, 50.4, 52.8]
  // p02 All Attack Damage▲%: [28.48, 30.67, 32.86, 35.05, 37.25, 39.44, 41.63, 43.82, 46.01, 48.2]
  // p03 All Pierce Damage▲%: [23.63, 25.44, 27.26, 29.08, 30.9, 32.72, 34.53, 36.35, 38.17, 39.98]
  // p04 Max Ammo ▲ rounds (const): [3, ...]
  // p05 Self Crit Rate▲%: [53.24, 56.79, 60.34, 63.89, 67.44, 70.99, 74.54, 78.09, 81.64, 85.19]
  burst: {
    groupId: 15143,
    triggers: [
      // Burst P1（自身）：Prediction 激活 + 无限弹药 + Pierce + 自身 Pierce Damage + Crit Rate 10s
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'SELF',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const end = state.tick + TICK_RATE * 10;

          clearHeatEmission(state);

          caster.skillState.grave_predictionEndTick = end;
          caster.skillState.grave_predShotCount     = 0;
          caster.skillState.unlimitedAmmoEndTick    = end;
          caster.skillState.pierceEndTick           = end;

          const selfPiercePct = getSkillValue(caster.rawBurst, 1, lv) / 100;
          pushBuff(state, { name: 'grave_burst_selfPierce', unitId: caster.id,
            pierceDamagePct: selfPiercePct, endTick: end });

          const critRatePct = getSkillValue(caster.rawBurst, 5, lv) / 100;
          pushBuff(state, { name: 'grave_burst_critRate', unitId: caster.id,
            critRateBonus: critRatePct, endTick: end });
        },
      },
      // Burst P2（全员）：Attack Damage + Pierce Damage + Max Ammo ▲ 10s
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const end = state.tick + TICK_RATE * 10;

          const atkDmgPct = getSkillValue(caster.rawBurst, 2, lv) / 100;
          pushBuff(state, { name: 'grave_burst_atkDmg', unitId: null,
            attackDamagePct: atkDmgPct, endTick: end });

          const allPiercePct = getSkillValue(caster.rawBurst, 3, lv) / 100;
          pushBuff(state, { name: 'grave_burst_allPierce', unitId: null,
            pierceDamagePct: allPiercePct, endTick: end });

          pushBuff(state, { name: 'grave_burst_maxAmmo', unitId: null,
            maxAmmoFlat: 3, endTick: end });
        },
      },
    ],
  },
};
