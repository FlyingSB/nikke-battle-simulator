import { pushBuff, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Shock Wave
  // ■ Activates when performing Full Charge attacks. Affects 1 enemy unit nearest to the crosshair.
  //   Deals {p00}% of final ATK as sustained damage every 1 sec, stacks up to {p04=10} time(s) and lasts for {p01=5} sec.
  // ■ Activates when entering Full Burst. Affects self.
  //   ATK ▲ {p02}% of caster's ATK for {p03=10} sec.
  //
  // group_id: 28511
  // p00 sustained%/stack/sec: [40.45, 43.56, 46.67, 49.78, 52.9, 56.01, 59.12, 62.23, 65.34, 68.46]
  // p01 duration (const): [5, ...]
  // p02 ATK▲%: [28.08, 30.24, 32.4, 34.56, 36.72, 38.88, 41.04, 43.2, 45.36, 47.52]
  // p03 ATK duration (const): [10, ...]
  // p04 max stacks (const): [10, ...]
  skill1: {
    groupId: 28511,
    triggers: [
      // Part1: 全蓄力 → DoT 叠层（max 10，每次刷新 5s 计时器）
      {
        on: 'FULL_CHARGE',
        logTargets: 'ENEMY',
        handler(state, caster) {
          const lv           = caster.skillLevels[0];
          const multPerStack = getSkillValue(caster.rawSkill1, 0, lv) / 100;
          const endTick      = state.tick + TICK_RATE * 5;

          const dot = state.dots.find(d => d.dotName === 'rv_s1_dot' && d.casterId === caster.id);
          if (dot) {
            dot.stacks       = Math.min(10, dot.stacks + 1);
            dot.multPerStack = multPerStack;
            dot.endTick      = endTick;
          } else {
            state.dots.push({
              casterId:        caster.id,
              label:           'S1',
              dotName:         'rv_s1_dot',
              multPerStack,
              stacks:          1,
              endTick,
              nextFireTick:    state.tick + TICK_RATE,
              intervalTicks:   TICK_RATE,
              sustainedDamage: true,
            });
          }
        },
      },

      // Part2: 进入全爆裂 → 自身 ATK ▲ p02% 10s
      {
        on: 'ENTER_FULL_BURST',
        logTargets: 'SELF',
        handler(state, caster) {
          const lv     = caster.skillLevels[0];
          const atkPct = getSkillValue(caster.rawSkill1, 2, lv) / 100;
          pushBuff(state, { name: 'rv_s1_atk', unitId: caster.id,
            atkPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },

  // ── Blue Blade
  // ■ Activates when entering battle / entering Full Burst. Affects self.
  //   Vital Attack: Damage to Parts ▲ {p00}% for {p01=5} sec.
  //   [部件伤害（Damage to Parts）系统未建模 — 跳过]
  // ■ Activates when an ally or self destroys an enemy's part. Affects self if not in A.N. Mode status.
  //   Single Point Attack: Sustained damage ▲ {p02}% for {p03=15} sec. Removes Vital Attack.
  //   [部件摧毁事件（PART_DESTROYED）未建模 — 跳过]
  //
  // group_id: 28512
  // p00 Parts Damage▲%: [12.48, 13.44, 14.4, 15.36, 16.32, 17.28, 18.24, 19.2, 20.16, 21.12]
  // p01 duration (const): [5, ...]
  // p02 Sustained damage▲%: [27.96, 30.11, 32.26, 34.41, 36.56, 38.72, 40.87, 43.02, 45.17, 47.32]
  // p03 duration (const): [15, ...]
  skill2: {
    groupId: 28512,
    triggers: [],
  },

  // ── Tempest
  // ■ Affects all enemies (including parts).
  //   Deals {p00}% of final ATK as Burst Skill damage.
  // ■ Affects self.
  //   A.N. Mode:
  //   Effect 1: Removes Single Point Attack. [未建模]
  //   Effect 2: Sustained damage ▲ {p01}% for {p02=10} sec.
  //
  // group_id: 18513
  // p00 burst damage%: [290.9, 313.28, 335.66, 358.04, 380.41, 402.79, 425.17, 447.55, 469.92, 492.3]
  // p01 sustained damage▲%: [52.85, 56.91, 60.98, 65.04, 69.11, 73.18, 77.24, 81.31, 85.37, 89.44]
  // p02 duration (const): [10, ...]
  burst: {
    groupId: 18513,
    triggers: [
      // Burst P1：全体爆裂技能伤害（延迟 1s）
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ENEMY',
        handler(state, caster) {
          const lv        = caster.skillLevels[2];
          const burstMult = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const sumsSnap  = getBuffSums(state, caster.id);
          state.pendingSkillHits.push({
            fireTick: state.tick + TICK_RATE, caster,
            mult: burstMult, sums: sumsSnap, isCharged: false, label: 'Burst',
          });
        },
      },
      // Burst P2：A.N. Mode — 自身持续伤害倍率▲ p01% 10s
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'SELF',
        handler(state, caster) {
          const lv     = caster.skillLevels[2];
          const sdMult = getSkillValue(caster.rawBurst, 1, lv) / 100;
          pushBuff(state, { name: 'rv_burst_sustainedDmg', unitId: caster.id,
            sustainedDamagePct: sdMult, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },
};
