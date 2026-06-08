import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Ada  (resource_id: 840)
export default {

  // ── Covert Support
  // ■ 进入全爆裂时激活，影响所有曾使用爆裂技能的 B3 友军（含自身）。
  //   ATK ▲ {p00}% of caster's ATK，持续 {p01=10} 秒。
  //   True Damage ▲ {p02}%，持续 {p03=10} 秒。（按攻击伤害建模）
  //   造成伤害的 {p04}% 回复为体力，持续 {p05=10} 秒。
  //
  // group_id: 28401
  // p00 ATK% (caster ATK flat): [35.46, 38.19, 40.92, 43.64, 46.37, 49.1, 51.83, 54.56, 57.28, 60]
  // p01 持续时间 (const): [10]
  // p02 True Damage▲%: [29.54, 31.82, 34.09, 36.36, 38.63, 40.91, 43.18, 45.45, 47.73, 50]
  // p03 持续时间 (const): [10]
  // p04 生命偷取%: [5.91, 6.36, 6.81, 7.27, 7.72, 8.18, 8.63, 9.09, 9.54, 10]
  // p05 持续时间 (const): [10]
  // p06 目标 burst 步骤 (const): [3]
  skill1: {
    groupId: 28401,
    triggers: [
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv          = caster.skillLevels[0];
          const end10       = state.tick + TICK_RATE * 10;
          const atkFlat     = Math.round(caster.stats.atk * getSkillValue(caster.rawSkill1, 0, lv) / 100);
          const trueDmgPct  = getSkillValue(caster.rawSkill1, 2, lv) / 100;
          const lsPct       = getSkillValue(caster.rawSkill1, 4, lv) / 100;

          const ids = state.burstCastersThisRotation;
          for (const u of state.squad) {
            if (u.burstStep !== 'Step3' || !ids.has(u.id)) continue;
            pushBuff(state, { name: 'Covert Support', unitId: u.id,
              atkFlat, trueDamagePct: trueDmgPct, lifeStealPct: lsPct, endTick: end10 });
          }
        },
      },
    ],
  },

  // ── Flash Grenade
  // ■ 全爆裂期间每 {p00=2} 秒激活，对瞄准点附近最近的敌人：
  //   闪光弹抛出：造成最终 ATK × {p01}% 的 True Damage（按技能伤害建模）。
  // ■ 使用爆裂技能时激活，影响自身：
  //   闪光弹抛出触发时间条件 ▼ {p02=1} 秒，持续 {p03=10} 秒。
  //   （实际间隔：正常 2s，激活后 10s 内缩短为 1s）
  //
  // group_id: 28402
  // p00 间隔秒数 (const): [2]
  // p01 True Damage%: [248.18, 267.27, 286.36, 305.45, 324.54, 343.63, 362.72, 381.82, 400.91, 420]
  // p02 间隔缩短量 (const): [1]
  // p03 加速持续时间 (const): [10]
  skill2: {
    groupId: 28402,
    triggers: [
      // ■0：全爆裂期间每秒轮询，按实际间隔（1s 或 2s）触发闪光弹
      {
        on: 'INTERVAL_IN_BURST',
        opts: { seconds: 1 },
        handler(state, caster) {
          const lastFire      = caster.skillState.ada_s2_lastFireTick;
          const accelerated   = (caster.skillState.ada_s2_accelEnd ?? 0) >= state.tick;
          const intervalTicks = accelerated ? TICK_RATE : TICK_RATE * 2;
          if (lastFire !== undefined && state.tick - lastFire < intervalTicks) return;

          caster.skillState.ada_s2_lastFireTick = state.tick;
          if (state.enemyHp <= 0) return;

          const lv   = caster.skillLevels[1];
          const mult = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, mult, sums, 'S2', { isTrueDamage: true });
        },
      },
      // ■1：使用爆裂技能时 → 记录加速截止 tick（10 秒内间隔 ▼1s）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          caster.skillState.ada_s2_accelEnd = state.tick + TICK_RATE * 10;
        },
      },
      // 全爆裂结束时重置上次触发记录
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          caster.skillState.ada_s2_lastFireTick = undefined;
        },
      },
    ],
  },

  // ── Secret Agent
  // ■ 使用爆裂技能时激活，影响自身：
  //   ATK ▲ {p00}%，持续 {p01=10} 秒。
  //   True Damage ▲ {p02}%，持续 {p03=10} 秒。（按攻击伤害建模）
  //   Special Modification：持续 {p04=1} 发。
  //     蓄力速度 ▼ {p05=300}%（chargeSpeedPct: -3.0，使该发蓄力时间约为 4 倍）。
  //     蓄力伤害 ▲ {p06}%。
  //
  // group_id: 18403
  // p00 ATK▲%: [23.63, 25.45, 27.27, 29.09, 30.91, 32.72, 34.54, 36.36, 38.18, 40]
  // p01 持续时间 (const): [10]
  // p02 True Damage▲%: [24.82, 26.73, 28.63, 30.54, 32.45, 34.36, 36.27, 38.18, 40.09, 42]
  // p03 持续时间 (const): [10]
  // p04 持续发数 (const): [1]
  // p05 蓄力速度降低% (const): [300]
  // p06 蓄力伤害▲%: [886.37, 954.23, 1022.09, 1089.95, 1157.81, 1225.67, 1293.53, 1361.39, 1429.19, 1500]
  burst: {
    groupId: 18403,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv    = caster.skillLevels[2];
          const end10 = state.tick + TICK_RATE * 10;

          pushBuff(state, { name: 'Secret Agent P1', unitId: caster.id,
            atkPct: getSkillValue(caster.rawBurst, 0, lv) / 100,
            attackDamagePct: getSkillValue(caster.rawBurst, 2, lv) / 100, endTick: end10 });

          // Special Modification：下一发（1 round）蓄力速度 ▼300%，蓄力伤害 ▲{p06}%
          const chargeDmgPct = getSkillValue(caster.rawBurst, 6, lv) / 100;
          // chargeSpeedPct: -3.0 → 蓄力时间 ≈ 4× 正常值（模拟降速 300%）
          pushBuff(state, { name: 'Secret Agent P2', unitId: caster.id,
            chargeDamagePct: chargeDmgPct, chargeSpeedPct: -3.0, endRounds: 1 });
        },
      },
    ],
  },
};
