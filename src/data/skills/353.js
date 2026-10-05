import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Helm: Aquamarine  (resource_id: 353)
export default {

  // ── Admire Accompaniment
  // ■ Activates after landing {p00=30} normal attack(s). Affects the target(s).
  //   Deals {p01}% of final ATK as additional damage.
  // ■ Activates when entering Full Burst. Affects all allies.
  //   Effect changes according to the number of activation times. Previous effects trigger repeatedly:
  //   Once: Cooldown of Burst Skill ▼ {p02=1.82} sec.
  //   Twice: Cooldown of Burst Skill ▼ {p03=2.2} sec.
  //   Three times: Cooldown of Burst Skill ▼ {p04=2.6} sec.
  //
  // group_id: 23531
  // p00 攻击次数阈值 (const): [30]
  // p01 伤害%: [38.76, 49.05, 59.34, 69.61, 79.92, 90.19, 100.48, 110.76, 121.05, 131.34]
  // p02 CDR 第1次 (const): [1.82]
  // p03 CDR 第2次 (const): [2.2]
  // p04 CDR 第3次 (const): [2.6]
  skill1: {
    groupId: 23531,
    triggers: [
      // Part1：每 30 发 → 对当前目标额外攻击一次
      {
        on: 'SHOT_COUNT',
        opts: { every: 30, counterKey: 'helm353S1Shots' },
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          const lv   = caster.skillLevels[0];
          const mult = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, mult, sums, 'S1', {
            burstEnergy: caster.targetBurstEnergyPerShot, burstEnergySource: 'helm353_s1_extraHit' });
        },
      },
      // Part2：进入全爆裂 → 全员 CDR（累积制，Previous effects trigger repeatedly）
      // 1次: 1.82s / 2次: 1.82+2.2=4.02s / 3次+: 1.82+2.2+2.6=6.62s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv    = caster.skillLevels[0];
          const count = (caster.skillState.helm353S1Activations ?? 0) + 1;
          caster.skillState.helm353S1Activations = count;

          let cdSec = getSkillValue(caster.rawSkill1, 2, lv); // 1.82（第1次固定触发）
          if (count >= 2) cdSec += getSkillValue(caster.rawSkill1, 3, lv); // +2.2
          if (count >= 3) cdSec += getSkillValue(caster.rawSkill1, 4, lv); // +2.6

          const cdTicks = Math.round(cdSec * TICK_RATE);
          for (const u of state.squad) {
            u.burstCdRemaining = Math.max(0, u.burstCdRemaining - cdTicks);
          }
        },
      },
    ],
  },

  // ── Aegis Cannon Suppression Fire（主动技能，冷却 4s，战斗开始先进入冷却）
  // ■ Affects 1 enemy unit(s) randomly.
  //   Deals {p01}% of final ATK as damage.
  // ■ Activates when attacking an Electric Code target. Affects the target.
  //   Damage Taken ▲ {p02}%, stacks up to {p03=5} times and lasts for {p04=5} sec.
  //
  // group_id: 13532
  // p00 目标数 (const): [1]
  // p01 伤害%: [62.38, 67.2, 71.98, 76.79, 81.59, 86.39, 91.18, 95.98, 100.8, 105.58]
  // p02 Damage Taken▲%: [3.33, 3.6, 3.84, 4.11, 4.35, 4.62, 4.86, 5.13, 5.4, 5.64]
  // p03 最大叠层 (const): [5]
  // p04 持续时间 (const): [5]
  skill2: {
    groupId: 13532,
    triggers: [
      // Part1：每 4s 自动触发（首次于 t+4s，等效战斗开始进入 4s 冷却）→ 对 1 随机敌人造成伤害
      // Part2：S2 攻击命中 Electric Code 目标时叠加 Damage Taken▲
      {
        on: 'INTERVAL',
        opts: { seconds: 4 },
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          const lv   = caster.skillLevels[1];
          const mult = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, mult, sums, 'S2', {
            burstEnergy: caster.targetBurstEnergyPerShot, burstEnergySource: 'helm353_s2_suppFire' });
          if (state.enemyElement === 'Electric') {
            const dtPct     = getSkillValue(caster.rawSkill2, 2, lv) / 100;
            const maxStacks = getSkillValue(caster.rawSkill2, 3, lv);
            const dur       = getSkillValue(caster.rawSkill2, 4, lv);
            pushBuff(state, { name: 'Aegis Cannon Suppression Fire', unitId: '__enemy__', isDebuff: true,
              enemyDamageTakenPct: dtPct, stackLimit: maxStacks,
              endTick: state.tick + TICK_RATE * dur }, { ...state._logCtx, partIdx: 1 });
          }
        },
      },
    ],
  },

  // ── Aegis Cannon Overload
  // ■ Affects all enemies.
  //   Deals {p00}% of final ATK as Burst Skill damage.
  // ■ Activates when attacking an Electric Code target. Affects the target.
  //   Deals {p01}% of final ATK as additional damage.
  //
  // group_id: 13533
  // p00 Burst Skill 伤害%: [97.39, 104.89, 112.38, 119.88, 127.36, 134.86, 142.35, 149.85, 157.33, 164.83]
  // p01 Electric Code 额外伤害%: [97.39, 104.89, 112.38, 119.88, 127.36, 134.86, 142.35, 149.85, 157.33, 164.83]
  burst: {
    groupId: 13533,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (state.enemyHp <= 0) return false;
          const lv        = caster.skillLevels[2];
          const burstMult = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const sums      = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, burstMult, sums, 'Burst P1');
          if (state.enemyElement === 'Electric') {
            const bonusMult = getSkillValue(caster.rawBurst, 1, lv) / 100;
            fireSkillHit(state, caster, bonusMult, sums, 'Burst P2');
          }
        },
      },
    ],
  },
};
