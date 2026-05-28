import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Passionate Maid（S1）
  // ■ 命中目标时每 {p00=30} 发弹丸触发，影响准心附近最近的2个敌人。
  //   造成最终 ATK × {p01}% 的伤害。（单 Boss 场景等效为 1 次命中）
  //   溢出保留：单次射击弹丸数可变（unit.shotCount），用累积计数器严格按弹丸数触发。
  //
  // group_id: 23131
  // p00 触发弹丸数 (const): [30]
  // p01 伤害%: [119.86, 129.08, 138.30, 147.52, 156.74, 165.96, 175.18, 184.40, 193.62, 202.84]
  // p02 目标数 (const): [2]
  skill1: {
    groupId: 23131,
    triggers: [
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'pum_s1_pelletDummy' },
        handler(state, caster) {
          caster.skillState.pum_s1_pellets = (caster.skillState.pum_s1_pellets ?? 0) + (caster.shotCount ?? 1);
          while (caster.skillState.pum_s1_pellets >= 30) {
            caster.skillState.pum_s1_pellets -= 30;
            if (state.enemyHp <= 0) return;
            const lv   = caster.skillLevels[0];
            const mult = getSkillValue(caster.rawSkill1, 1, lv) / 100;
            const sums = getBuffSums(state, caster.id);
            fireSkillHit(state, caster, mult, sums, false, 'S1');
          }
        },
      },
    ],
  },

  // ── Loving Maid（S2）
  // ■ 单次普通攻击命中超过 {p00=5} 发弹丸时触发，影响自身。
  //   装弹速度 ▲ {p01}%，持续 {p02=2} 秒。
  //   （unit.shotCount 为当前弹丸数，可被其他技能修改；>5 时必然触发）
  // ■ 全爆裂期间累计命中 {p03=30} 发弹丸时触发，影响自身。
  //   装填 {p04=1} 发子弹。
  //   ATK ▲ {p05}%，最多叠加 {p06=5} 层，每层独立持续 {p07=2} 秒。
  //   溢出保留：若单次射击弹丸数 > 30，可在同一射击内多次触发。
  //
  // group_id: 23132
  // p00 触发弹丸阈值 (const, >5): [5]
  // p01 装弹速度▲%: [12.33, 13.28, 14.23, 15.18, 16.13, 17.08, 18.03, 18.98, 19.93, 20.88]
  // p02 装弹速度持续时间 (const): [2]
  // p03 全爆裂触发弹丸数 (const): [30]
  // p04 补弹数 (const): [1]
  // p05 ATK▲%/层: [6.63, 7.14, 7.65, 8.16, 8.67, 9.18, 9.69, 10.20, 10.71, 11.22]
  // p06 ATK 层数上限 (const): [5]
  // p07 ATK 持续时间 (const): [2]
  skill2: {
    groupId: 23132,
    triggers: [
      // S2 Part1：单次射击命中弹丸数 > 5 → 装弹速度 ▲ p01% 2s（刷新）
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'pum_s2_part1Dummy' },
        handler(state, caster) {
          if ((caster.shotCount ?? 1) <= 5) return;
          const lv           = caster.skillLevels[1];
          const reloadSpdPct = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const end2         = state.tick + TICK_RATE * 2;
          pushBuff(state, { name: 'pum_s2_reloadSpd', unitId: caster.id,
            reloadSpeedPct: reloadSpdPct, endTick: end2 });
        },
      },
      // S2 Part2：全爆裂期间累计命中 30 发弹丸 → 补弹1发 + ATK▲（最多5层）2s
      // 用5个命名槽位追踪各层独立到期；找最先过期的槽放入新层，5层满时不再叠加。
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'pum_s2_part2Dummy' },
        handler(state, caster) {
          if (!state.fullBurstActive) return;
          caster.skillState.pum_s2_burstPellets = (caster.skillState.pum_s2_burstPellets ?? 0) + (caster.shotCount ?? 1);
          const lv = caster.skillLevels[1];
          while (caster.skillState.pum_s2_burstPellets >= 30) {
            caster.skillState.pum_s2_burstPellets -= 30;
            const now = state.tick;

            // 补弹1发
            const ammoBefore = caster.ammoLeft;
            caster.ammoLeft  = Math.min(caster.maxAmmo, caster.ammoLeft + 1);
            if (state.ammoLog && caster.ammoLeft !== ammoBefore)
              state.ammoLog.push({ tick: now, unitId: caster.id, unitName: caster.name,
                delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft,
                maxAmmo: caster.maxAmmo, source: 'pum_s2_burst_reload' });

            // ATK ▲ p05%（最多5层，每层独立持续2s）
            const atkPct = getSkillValue(caster.rawSkill2, 5, lv) / 100;
            const end2   = now + TICK_RATE * 2;
            for (let i = 0; i < 5; i++) {
              const slotName = `pum_s2_atk_${i}`;
              const slot = state.buffs.find(b => b.name === slotName && b.unitId === caster.id);
              if (!slot) {
                state.buffs.push({ name: slotName, unitId: caster.id, atkPct, endTick: end2 });
                break;
              }
              if (slot.endTick <= now) {
                slot.endTick = end2;
                slot.atkPct  = atkPct;
                break;
              }
            }
          }
        },
      },
      // 全爆裂结束 → 重置弹丸计数器（ATK 各层自然到期）
      {
        on: 'FULL_BURST_END',
        logTargets: null,
        handler(state, caster) {
          caster.skillState.pum_s2_burstPellets = 0;
        },
      },
    ],
  },

  // ── Your Bashful Maid!（Burst）
  // ■ 影响自身。
  //   攻击伤害 ▲ {p00}%，持续 {p01=10} 秒。
  //   暴击伤害 ▲ {p02}%，持续 {p03=10} 秒。
  // ■ 影响所有敌人。
  //   造成最终 ATK × {p04}% 的爆裂技能伤害。
  //
  // group_id: 13133
  // p00 攻击伤害▲%: [6.24, 6.72, 7.20, 7.68, 8.16, 8.64, 9.12, 9.60, 10.08, 10.56]
  // p01 攻击伤害持续时间 (const): [10]
  // p02 暴击伤害▲%: [52.10, 56.11, 60.12, 64.12, 68.13, 72.14, 76.15, 80.16, 84.16, 88.17]
  // p03 暴击伤害持续时间 (const): [10]
  // p04 爆裂伤害%: [630.30, 678.78, 727.27, 775.75, 824.24, 872.72, 921.21, 969.69, 1018.18, 1066.66]
  burst: {
    groupId: 13133,
    triggers: [
      // Burst P1：自身 Attack Damage ▲ p00% + Crit Damage ▲ p02% 10s
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'SELF',
        handler(state, caster) {
          const lv         = caster.skillLevels[2];
          const end10      = state.tick + TICK_RATE * 10;
          const atkDmgPct  = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const critDmgPct = getSkillValue(caster.rawBurst, 2, lv) / 100;
          pushBuff(state, { name: 'pum_burst_atkDmg',  unitId: caster.id, attackDamagePct: atkDmgPct,  endTick: end10 });
          pushBuff(state, { name: 'pum_burst_critDmg', unitId: caster.id, critDmgBonus:    critDmgPct, endTick: end10 });
        },
      },
      // Burst P2：对所有敌人造成爆裂技能伤害 p04%
      {
        on: 'BURST_SKILL_USE',
        logTargets: null,
        handler(state, caster) {
          if (state.enemyHp <= 0) return false;
          const lv        = caster.skillLevels[2];
          const burstMult = getSkillValue(caster.rawBurst, 4, lv) / 100;
          const sums      = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, burstMult, sums, false, 'Burst');
        },
      },
    ],
  },
};
