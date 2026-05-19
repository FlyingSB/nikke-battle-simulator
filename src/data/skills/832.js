import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// S2 周期（游戏内实测 10s；战斗开始先进入冷却，首次触发于 t+10s）
const S2_INTERVAL_SEC = 10;

export default {

  // ── Precision Sniping
  // ■ 满蓄力命中时激活，影响全体友军。
  //   对护盾造成的伤害 ▲ {p00}% 持续 {p01=3} 秒。
  // ■ 命中目标核心时激活，影响全体友军。
  //   穿透伤害 ▲ {p02}% 持续 {p03=10} 秒。
  //
  // group_id: 28321
  // p00 Shield Damage▲%: [59.17, 63.72, 68.27, 72.81, 77.36, 81.9, 86.45, 91, 95.54, 100.09]
  // p01 duration (const): [3]
  // p02 Pierce Damage▲%: [24.25, 26.11, 27.97, 29.83, 31.69, 33.55, 35.41, 37.27, 39.13, 40.99]
  // p03 duration (const): [10]
  skill1: {
    groupId: 28321,
    triggers: [
      // S1 T1: 满蓄力命中 → 全员对护盾伤害 ▲ p00% 3s
      // [TODO] Damage dealt to Shield buff 系统暂未支持，跳过实现
      //
      // S1 T2: 命中核心 → 全员 Pierce Damage ▲ p02% 10s
      {
        on: 'CORE_HIT',
        handler(state, caster) {
          const lv  = caster.skillLevels[0];
          const pct = getSkillValue(caster.rawSkill1, 2, lv) / 100;
          pushBuff(state, { name: 'mari_s1_pierceDmg', unitId: null,
            pierceDamagePct: pct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },

  // ── Full Focus（主动技能，冷却 10s，战斗开始先进入冷却）
  // ■ 影响自身。
  //   获得穿透，持续 {p00=5} 秒。
  //   ATK ▲ {p03}% 持续 {p04=5} 秒。
  // ■ 影响全体友军。
  //   ATK ▲ {p01}%（施放者 ATK），持续 {p02=5} 秒。
  //
  // group_id: 18322
  // p00 Pierce duration (const): [5]
  // p01 All allies ATK▲% of caster ATK: [18.17, 19.57, 20.97, 22.37, 23.77, 25.17, 26.57, 27.98, 29.38, 30.78]
  // p02 allies duration (const): [5]
  // p03 self ATK▲%: [17.98, 19.4, 20.82, 22.25, 23.67, 25.09, 26.52, 27.94, 29.36, 30.78]
  // p04 self duration (const): [5]
  skill2: {
    groupId: 18322,
    triggers: [
      // S2：每 10s 自动触发（首次于 t+10s，等效战斗开始进入 10s 冷却）
      //   自身: 穿透 5s + ATK ▲ p03% 5s
      //   全员: ATK flat ▲ p01% × Mari.ATK 5s
      {
        on: 'INTERVAL',
        opts: { seconds: S2_INTERVAL_SEC },
        handler(state, caster) {
          const lv   = caster.skillLevels[1];
          const end5 = state.tick + TICK_RATE * 5;

          // 自身 Pierce 5s（时间制）
          caster.skillState.pierceEndTick = end5;

          // 自身 ATK ▲ p03% 5s
          const selfAtkPct = getSkillValue(caster.rawSkill2, 3, lv) / 100;
          pushBuff(state, { name: 'mari_s2_selfAtk', unitId: caster.id,
            atkPct: selfAtkPct, endTick: end5 });

          // 全员 ATK flat ▲ p01% × Mari.ATK 5s
          const allyAtkPct  = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const allyAtkFlat = Math.round(caster.stats.atk * allyAtkPct);
          pushBuff(state, { name: 'mari_s2_allyAtkFlat', unitId: null,
            atkFlat: allyAtkFlat, endTick: end5 });
        },
      },
    ],
  },

  // ── GPS Guided Missile
  // ■ 影响所有敌人。
  //   造成 {p00}% 最终 ATK 的爆裂技能伤害。
  // ■ 影响全体友军。
  //   攻击伤害 ▲ {p01}% 持续 {p02=10} 秒。
  //
  // group_id: 18323
  // p00 Burst Skill damage%: [363.63, 394.27, 424.9, 455.54, 486.18, 516.81, 547.45, 578.08, 608.72, 639.36]
  // p01 Attack damage▲%: [24.25, 26.11, 27.97, 29.83, 31.69, 33.55, 35.41, 37.27, 39.13, 40.99]
  // p02 duration (const): [10]
  burst: {
    groupId: 18323,
    triggers: [
      // Burst: p00% 爆裂技能伤害（默认结算）+ 全员攻击伤害 ▲ p01% 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv   = caster.skillLevels[2];
          const sums = getBuffSums(state, caster.id);

          if (state.enemyHp > 0) {
            const hitMult = getSkillValue(caster.rawBurst, 0, lv) / 100;
            fireSkillHit(state, caster, hitMult, sums, false, 'mari_burst_hit');
          }

          const attackDmgPct = getSkillValue(caster.rawBurst, 1, lv) / 100;
          pushBuff(state, { name: 'mari_burst_attackDmg', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },
};
