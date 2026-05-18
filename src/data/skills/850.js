import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Impact-Type Exospine
  // ■ Activates at the start of battle. Affects self.
  //   Impact-Type Exospine: Critical Rate ▲ {p00}% continuously.
  // ■ Activates after landing {p05=44} critical hit(s) with normal attacks. Affects random enemy units.
  //   Unstable Energy: Deals {p01}% of final ATK as damage. Attacks sequentially {p02=3} time(s).
  // ■ Activates when Unstable Energy hits an Electric Code target. Affects the target.
  //   Damage Taken ▲ {p03}% for {p04=10} sec.
  //   [简化] 单 Boss 场景中敌人元素不区分，承伤 debuff 无条件应用。
  //
  // group_id: 28501
  // p00 Crit Rate▲%: [35.45, 38.18, 40.91, 43.63, 46.36, 49.09, 51.82, 54.54, 57.27, 60]
  // p01 Unstable Energy hit%: [141.82, 152.72, 163.63, 174.54, 185.45, 196.36, 207.27, 218.18, 229.09, 240]
  // p02 sequential count (const): [3, ...]
  // p03 Damage Taken▲%: [5.91, 6.36, 6.82, 7.27, 7.73, 8.18, 8.64, 9.09, 9.55, 10]
  // p04 duration (const): [10, ...]
  // p05 crit hit trigger count (const): [44, ...]
  skill1: {
    groupId: 28501,
    triggers: [
      // S1 Part1：战斗开始 → 自身暴击率永久 ▲ p00%
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const critRatePct = getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'eve_s1_critRate', unitId: caster.id,
            critRateBonus: critRatePct, endTick: Infinity });
        },
      },
      // S1 Part2+3：每次普通攻击检测暴击；累计 44 次暴击 → Unstable Energy（3× 技能伤害）
      //   + 敌人 Damage Taken ▲ p03% 10s
      //   通过比较 caster.critCount 与上一次记录值判断本次是否暴击。
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'eve_s1_shotDummy' },
        handler(state, caster) {
          // 检测本次是否暴击
          const currCrits = caster.critCount;
          const lastCrits = caster.skillState.eve_lastCritCount ?? 0;
          caster.skillState.eve_lastCritCount = currCrits;
          if (currCrits <= lastCrits) return;

          // 累计暴击计数
          caster.skillState.eve_critHits = (caster.skillState.eve_critHits ?? 0) + 1;
          if (caster.skillState.eve_critHits < 44) return;
          caster.skillState.eve_critHits -= 44;

          if (state.enemyHp <= 0) return;
          const lv     = caster.skillLevels[0];
          const hitPct = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          const sums   = getBuffSums(state, caster.id);
          for (let h = 0; h < 3 && state.enemyHp > 0; h++) {
            fireSkillHit(state, caster, hitPct, sums, false, 'eve_s1_unstableEnergy');
          }

          // 敌人 Damage Taken ▲ p03% 10s（若 buff 已存在则仅刷新时长）
          const dtPct     = getSkillValue(caster.rawSkill1, 3, lv) / 100;
          const alreadyOn = state.buffs.some(b => b.name === 'eve_s1_damageTaken');
          if (!alreadyOn) state.enemyDamageTakenPct += dtPct;
          pushBuff(state, { name: 'eve_s1_damageTaken', unitId: null,
            enemyDamageTakenPct: dtPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },

  // ── Eagle Eye-Type Exospine
  // ■ Activates at the start of battle. Affects self.
  //   Eagle Eye-Type Exospine. Previous effects trigger repeatedly.
  //   ATK ▲ {p00}% of caster's ATK continuously.
  //   Max Ammunition Capacity ▲ {p01}% continuously.
  // ■ Activates when landing {p02=10} normal attack(s) on an Electric Code target. Affects self.
  //   Reloads {p03=3} round(s).
  //   [简化] 单 Boss 场景中每 10 发射击触发（不区分敌人元素）。
  //
  // group_id: 28502
  // p00 ATK flat▲% of caster's ATK: [29.55, 31.82, 34.09, 36.36, 38.64, 40.91, 43.18, 45.46, 47.73, 50]
  // p01 Max Ammo▲%: [14.77, 15.91, 17.04, 18.18, 19.32, 20.45, 21.59, 22.73, 23.86, 25]
  // p02 hit trigger count (const): [10, ...]
  // p03 rounds to reload (const): [3, ...]
  skill2: {
    groupId: 28502,
    triggers: [
      // S2 Part1：战斗开始 → 自身永久 ATK flat ▲ p00%（of base ATK）+ Max Ammo ▲ p01%（flat 值）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const lv       = caster.skillLevels[1];
          const atkPct   = getSkillValue(caster.rawSkill2, 0, lv) / 100;
          const atkFlat  = Math.round(caster.stats.atk * atkPct);
          const ammoPct  = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const ammoFlat = Math.round(caster.maxAmmo * ammoPct);
          pushBuff(state, { name: 'eve_s2_atkFlat', unitId: caster.id,
            atkFlat, endTick: Infinity });
          pushBuff(state, { name: 'eve_s2_maxAmmo', unitId: caster.id,
            maxAmmoFlat: ammoFlat, endTick: Infinity });
        },
      },
      // S2 Part2：每 10 发普通攻击 → 自身补弹 3 发（上限 maxAmmo）
      {
        on: 'SHOT_COUNT',
        opts: { every: 10, counterKey: 'eve_s2_hits' },
        handler(state, caster) {
          const ammoBefore = caster.ammoLeft;
          caster.ammoLeft  = Math.min(caster.maxAmmo, caster.ammoLeft + 3);
          if (state.ammoLog && caster.ammoLeft !== ammoBefore)
            state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
              delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft,
              maxAmmo: caster.maxAmmo, source: 'eve_s2_eagleEye_reload' });
        },
      },
    ],
  },

  // ── Counter Chain
  // ■ Affects random enemy units.
  //   Deals {p00}% of final ATK as damage. Attacks sequentially for {p01=6} time(s).
  // ■ Affects self.
  //   Exospine Mk2: Enhances Exospine for {p02} sec.
  //   Triggers Impact-Type Exospine Mk2: Damage multiplier of Unstable Energy sequential attacks
  //     is scaled by 100%.
  //   Triggers Eagle Eye-Type Exospine Mk2: Damage multiplier of Eagle Eye-Type Exospine
  //     is scaled by 100%.
  //   [注] "scaled by 100%" = 原始效果完整生效，Mk2 窗口内技能行为不变，仅记录状态标记。
  //
  // group_id: 18503
  // p00 Burst hit%: [270.13, 290.91, 311.69, 332.47, 353.25, 374.03, 394.8, 415.58, 436.36, 457.14]
  // p01 sequential count (const): [6, ...]
  // p02 Mk2 duration(s): [3, 3, 3, 5, 5, 5, 7, 7, 7, 10]
  burst: {
    groupId: 18503,
    triggers: [
      // Burst：6 连发技能伤害 × p00%
      {
        on: 'BURST_SKILL_USE',
        target: 'ENEMY',
        effects: [
          {
            type: 'SKILL_DAMAGE',
            count: 6,
            mult: (caster) => getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100,
            label: 'eve_burst_hit',
          },
        ],
      },
      // Burst Mk2：记录 Exospine Mk2 状态标记（p02 秒）供未来扩展
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const sec = getSkillValue(caster.rawBurst, 2, lv);
          caster.skillState.eve_mk2EndTick = state.tick + TICK_RATE * sec;
        },
      },
    ],
  },
};
