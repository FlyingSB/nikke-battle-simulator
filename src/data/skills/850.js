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
      //   通过比较 caster.critCount 与上一次记录值判断本次是否暴击（critCount 在 onShotFired 前已更新）。
      //   Part3：仅当敌人为电击属性时施加承伤 debuff；敌人非电击则跳过。
      //   Impact-Type Exospine Mk2：Mk2 期间 Unstable Energy 伤害系数 +100%（basePct × 2）。
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
          const lv      = caster.skillLevels[0];
          const basePct = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          // Impact-Type Exospine Mk2：Mk2 期间伤害系数 +100%（翻倍）
          const inMk2   = state.buffs.some(b => b.name === 'eve_burst_mk2_atkPct' && b.unitId === caster.id);
          const hitPct  = inMk2 ? basePct * 2 : basePct;
          const sums    = getBuffSums(state, caster.id);
          for (let h = 0; h < 3 && state.enemyHp > 0; h++) {
            fireSkillHit(state, caster, hitPct, sums, false, 'eve_s1_unstableEnergy');
          }

          // Part3：敌人为电击属性时施加 Damage Taken ▲ p03% 10s
          if (state.enemyElement !== 'Electric') return;
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
  //   ATK ▲ {p00}% continuously.
  //   Max Ammunition Capacity ▲ {p01}% continuously.
  // ■ Activates when landing {p02=10} normal attack(s) on an Electric Code target. Affects self.
  //   Reloads {p03=3} round(s).
  //   [简化] 单 Boss 场景中每 10 发射击触发（不区分敌人元素）。
  //
  // group_id: 28502
  // p00 ATK▲%: [29.55, 31.82, 34.09, 36.36, 38.64, 40.91, 43.18, 45.46, 47.73, 50]
  // p01 Max Ammo▲%: [14.77, 15.91, 17.04, 18.18, 19.32, 20.45, 21.59, 22.73, 23.86, 25]
  // p02 hit trigger count (const): [10, ...]
  // p03 rounds to reload (const): [3, ...]
  skill2: {
    groupId: 28502,
    triggers: [
      // S2 Part1：战斗开始 → 自身永久 ATK ▲ p00% + Max Ammo ▲ p01%（flat 值，取整）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const lv       = caster.skillLevels[1];
          const atkPct   = getSkillValue(caster.rawSkill2, 0, lv) / 100;
          const ammoPct  = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const ammoFlat = Math.round(caster.maxAmmo * ammoPct);
          pushBuff(state, { name: 'eve_s2_atkPct', unitId: caster.id,
            atkPct, endTick: Infinity });
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
  // ■ Affects self. Exospine Mk2 for {p02} sec.
  //   Triggers Impact-Type Exospine Mk2:
  //     Damage multiplier of Unstable Energy sequential attacks is scaled by 100%.
  //     → Mk2 期间 Unstable Energy 伤害系数 +100%（basePct × 2）。通过检测 eve_burst_mk2_atkPct buff 判断窗口。
  //   Triggers Eagle Eye-Type Exospine Mk2:
  //     Damage multiplier of Eagle Eye-Type Exospine is scaled by 100%.
  //     → Mk2 期间追加与 S2 Part1 等量的额外 ATK▲ 和 MaxAmmo▲（总效果翻倍）。
  //
  // group_id: 18503
  // p00 Burst hit%: [270.13, 290.91, 311.69, 332.47, 353.25, 374.03, 394.8, 415.58, 436.36, 457.14]
  // p01 sequential count (const): [6, ...]
  // p02 Mk2 duration(s): [3, 3, 3, 5, 5, 5, 7, 7, 7, 10]
  burst: {
    groupId: 18503,
    triggers: [
      // Burst：6 连发技能伤害 × p00%（默认结算，不受全爆裂+50%补正）
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
      // Eagle Eye-Type Exospine Mk2：爆裂后 p02s 内，追加与 S2 Part1 等量的 ATK▲ 和 MaxAmmo▲
      //   S2 Part1 永久 buff 不变；Mk2 buff 到期后总效果恢复到 S2 Part1 基准。
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const burstLv    = caster.skillLevels[2];
          const mk2Sec     = getSkillValue(caster.rawBurst, 2, burstLv);
          const mk2End     = state.tick + TICK_RATE * mk2Sec;
          const s2Lv       = caster.skillLevels[1];
          const mk2AtkPct  = getSkillValue(caster.rawSkill2, 0, s2Lv) / 100;
          const mk2AmmoPct = getSkillValue(caster.rawSkill2, 1, s2Lv) / 100;
          const mk2AmmoFlat = Math.round(caster.maxAmmo * mk2AmmoPct);
          pushBuff(state, { name: 'eve_burst_mk2_atkPct', unitId: caster.id,
            atkPct: mk2AtkPct, endTick: mk2End });
          pushBuff(state, { name: 'eve_burst_mk2_maxAmmo', unitId: caster.id,
            maxAmmoFlat: mk2AmmoFlat, endTick: mk2End });
        },
      },
    ],
  },
};
