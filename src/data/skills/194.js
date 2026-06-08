import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Ludmilla: Winter Owner  (resource_id: 194)
export default {

  // ── The Queen's Gaze
  // ■ Activates when landing 60 normal attack(s). Affects the target.
  //   Damage Taken ▲ {p01}% for {p02=3} sec.
  //   Deals {p03}% of final ATK as additional damage.
  // ■ Activates when landing 60 normal attack(s). Affects self.
  //   Reloads {p05} round(s) of ammunition.
  //
  // group_id: 21941
  // p00 shot threshold (const): [60, ...]
  // p01 Damage Taken ▲%: [7.42, 7.99, 8.56, 9.13, 9.7, 10.27, 10.84, 11.42, 11.99, 12.56]
  // p02 duration (const): [3, ...]
  // p03 Additional damage %: [93.62, 100.82, 108.02, 115.22, 122.42, 129.62, 136.83, 144.03, 151.23, 158.43]
  // p04 shot threshold (const): [60, ...]
  // p05 Reload rounds: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  skill1: {
    groupId: 21941,
    triggers: [
      {
        on: 'SHOT_COUNT',
        opts: { every: 60, counterKey: 'lwo_s1Count' },
        handler(state, caster) {
          const lv   = caster.skillLevels[0];
          const sums = getBuffSums(state, caster.id);

          // P1: 目标承伤 ▲ p01% 3s
          const dtPct      = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          pushBuff(state, { name: 'The Queen\'s Gaze', unitId: '__enemy__', isDebuff: true,
            enemyDamageTakenPct: dtPct, endTick: state.tick + TICK_RATE * 3 });

          // P1: 对目标造成 p03% 追加技能伤害
          const dmgPct = getSkillValue(caster.rawSkill1, 3, lv) / 100;
          fireSkillHit(state, caster, dmgPct, sums, 'S1');

          // P2: 自身补弹 p05 发
          const rounds     = getSkillValue(caster.rawSkill1, 5, lv);
          const ammoBefore = caster.ammoLeft;
          caster.ammoLeft  = Math.min(caster.maxAmmo, caster.ammoLeft + rounds);
          if (caster.ammoLeft >= caster.maxAmmo && caster.reloadTick > 0) caster.reloadTick = 0;
          if (state.ammoLog && caster.ammoLeft !== ammoBefore)
            state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
              delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft,
              maxAmmo: caster.maxAmmo, source: 'lwo_s1_reload' });
        },
      },
    ],
  },

  // ── Snowstorm
  // ■ Activates when hitting the Core for 60 time(s). Affects the target.
  //   Deals {p01}% of final ATK as additional damage.
  // ■ Activates at the beginning of Full Burst. Affects self.
  //   Critical Rate ▲ {p02}% for {p03=10} sec.
  //
  // group_id: 21942
  // p00 core hit threshold (const): [60, ...]
  // p01 Additional damage %: [64.79, 69.77, 74.75, 79.74, 84.72, 89.71, 94.69, 99.67, 104.66, 109.64]
  // p02 Critical Rate ▲%: [8.03, 8.76, 9.49, 10.22, 10.95, 11.68, 12.41, 13.14, 13.87, 14.6]
  // p03 duration (const): [10, ...]
  skill2: {
    groupId: 21942,
    triggers: [
      // S2 P1: 每 60 次核心命中 → 追加技能伤害 p01%
      {
        on: 'CORE_HIT',
        handler(state, caster) {
          const ss = caster.skillState;
          ss.lwo_s2CoreCount = (ss.lwo_s2CoreCount ?? 0) + 1;
          if (ss.lwo_s2CoreCount < 60) return;
          ss.lwo_s2CoreCount -= 60;

          const lv   = caster.skillLevels[1];
          const sums = getBuffSums(state, caster.id);
          const mult = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          fireSkillHit(state, caster, mult, sums, 'S2 P1');
        },
      },
      // S2 P2: 进入全爆裂 → 自身暴击率 ▲ p02% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv        = caster.skillLevels[1];
          const critBonus = getSkillValue(caster.rawSkill2, 2, lv) / 100;
          pushBuff(state, { name: 'Snowstorm', unitId: caster.id,
            critRatePct: critBonus, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },

  // ── Guiding Lantern
  // ■ Affects self.
  //   ATK ▲ {p00}% for {p01=10} sec.
  //   Reloading Speed ▲ {p02}% for {p03=20} sec.
  //
  // group_id: 11943
  // p00 ATK ▲%: [36.96, 39.8, 42.64, 45.49, 48.33, 51.17, 54.01, 56.86, 59.7, 62.54]
  // p01 ATK duration (const): [10, ...]
  // p02 Reloading Speed ▲%: [36.96, 40.32, 43.68, 47.04, 50.4, 53.76, 57.12, 60.48, 63.84, 67.2]
  // p03 Reload speed duration (const): [20, ...]
  burst: {
    groupId: 11943,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];

          // ATK ▲ p00% 10s
          const atkPct = getSkillValue(caster.rawBurst, 0, lv) / 100;
          pushBuff(state, { name: 'Guiding Lantern P1 L1', unitId: caster.id,
            atkPct, endTick: state.tick + TICK_RATE * 10 });

          // 换弹速度 ▲ p02% 20s
          const reloadSpeedPct = getSkillValue(caster.rawBurst, 2, lv) / 100;
          pushBuff(state, { name: 'Guiding Lantern P1 L2', unitId: caster.id,
            reloadSpeedPct, endTick: state.tick + TICK_RATE * 20 });
        },
      },
    ],
  },
};
