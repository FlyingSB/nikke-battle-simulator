import { pushBuff, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// 计算 Rouge 施法时的有效 MaxHP（含 maxHpPct / maxHpFlat buff）
function casterMaxHp(state, caster) {
  const sums = getBuffSums(state, caster.id);
  return caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
}

// 返回 Rouge 在阵容中两侧相邻友军（含自身）的 id 列表
// back row = 位置 2 或 4（索引 1 或 3）；左右各取一名
function adjacentTargetIds(state, caster) {
  const idx = state.squad.indexOf(caster);
  const ids = [caster.id];
  if (state.squad[idx - 1]) ids.push(state.squad[idx - 1].id);
  if (state.squad[idx + 1]) ids.push(state.squad[idx + 1].id);
  return ids;
}

export default {

  // ── Card Throw
  // ■ Activates when attacking with Full Charge for {p01=8} time(s). Affects all allies.
  //   Max HP ▲ {p02}% of the caster's Max HP without restoring HP, lasts for {p03=5} sec.
  //   Cooldown of Burst Skill ▼ {p04} sec.
  //
  // group_id: 22721
  // p01 (index 0): FC 触发次数 (const 8)
  // p02 (index 1): Max HP% of caster: [2.95, 3.18, 3.41, 3.63, 3.86, 4.09, 4.32, 4.54, 4.77, 5.00]
  // p03 (index 2): 持续时间 (const 5)
  // p04 (index 3): 冷却缩减 sec: [4.13, 4.45, 4.77, 5.09, 5.40, 5.72, 6.04, 6.36, 6.68, 7.00]
  skill1: {
    groupId: 22721,
    triggers: [
      // 每 8 次全蓄力 → 全员 Max HP ▲（仅增上限，不恢复 HP）+ 全员爆裂冷却▼
      {
        on: 'FULL_CHARGE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          caster.skillState.rougeS1FcCount = (caster.skillState.rougeS1FcCount ?? 0) + 1;
          if (caster.skillState.rougeS1FcCount < 8) return;
          caster.skillState.rougeS1FcCount = 0;

          const lv        = caster.skillLevels[0];
          const maxHpFlat = Math.round(casterMaxHp(state, caster)
                              * getSkillValue(caster.rawSkill1, 1, lv) / 100);
          const cdTicks   = Math.round(getSkillValue(caster.rawSkill1, 3, lv) * TICK_RATE);
          const endTick   = state.tick + TICK_RATE * 5;

          pushBuff(state, { name: 'rouge_s1_maxHp', unitId: null, maxHpFlat, endTick });
          for (const u of state.squad)
            u.burstCdRemaining = Math.max(0, u.burstCdRemaining - cdTicks);
        },
      },
    ],
  },

  // ── Coin Flip
  // ■ Activates when assigned to the back row in battle (positions 2 & 4).
  //   Affects self and 2 allies on both sides (adjacent left & right).
  //   Sword Coin: Attack Damage ▲ {p01}% continuously.
  // ■ Activates when attacking with Full Charge for {p02=30} time(s) while in Sword Coin status.
  //   Affects self and 2 allies on both sides.
  //   Shield Coin: Damage Taken ▼ {p03}% continuously.  [未建模：模拟器不追踪友军受到伤害]
  // ■ Activates when using Burst Skill for {p04=5} time(s) while in Shield Coin status.
  //   Affects all allies.
  //   Double Sword Coin: Max HP ▲ {p05}% of caster's Max HP continuously.
  //
  // group_id: 22722
  // p01 (index 0): Attack Damage%: [3.93, 4.23, 4.54, 4.84, 5.14, 5.44, 5.75, 6.05, 6.35, 6.65]
  // p02 (index 1): FC 触发次数 (const 30)
  // p03 (index 2): Damage Taken%: [8.98, 9.67, 10.36, 11.05, 11.75, 12.44, 13.13, 13.82, 14.51, 15.20]  [未建模]
  // p04 (index 3): Burst 触发次数 (const 5)
  // p05 (index 4): Max HP% of caster: [8.91, 9.59, 10.28, 10.96, 11.65, 12.34, 13.02, 13.71, 14.39, 15.08]
  skill2: {
    groupId: 22722,
    triggers: [
      // Part1：战斗开始时处于 back row → Sword Coin 状态 → 自身+两侧友军永久 Attack Damage ▲
      {
        on: 'BATTLE_START',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const idx = state.squad.indexOf(caster);
          if (idx !== 1 && idx !== 3) return;  // 非 back row 不触发

          caster.skillState.rougeCoinLevel = 1;
          const attackDmgPct = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;

          for (const uid of adjacentTargetIds(state, caster)) {
            pushBuff(state, { name: `rouge_s2_swordCoin_attackDmg_${uid}`, unitId: uid,
              attackDamagePct: attackDmgPct, endTick: Infinity });
          }
        },
      },

      // Part2：已有 Sword Coin（level=1）时每 30 次全蓄力 → 叠加 Shield Coin（level→2）
      // Damage Taken ▼ 对友军的减伤不影响 DPS 输出，此处仅推进层级，不建模减伤 buff
      {
        on: 'FULL_CHARGE',
        logTargets: null,
        handler(state, caster) {
          if ((caster.skillState.rougeCoinLevel ?? 0) !== 1) return;

          caster.skillState.rougeS2FcCount = (caster.skillState.rougeS2FcCount ?? 0) + 1;
          if (caster.skillState.rougeS2FcCount < 30) return;
          caster.skillState.rougeS2FcCount  = 0;
          caster.skillState.rougeCoinLevel  = 2;
        },
      },

      // Part3：已有 Shield Coin（level=2）时每 5 次施放爆裂技能 → 叠加 Double Sword Coin（level→3）
      // 全员永久 Max HP ▲（不恢复 HP，模拟器中 maxHpFlat 不触发治疗）
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster, ctx) {
          if (ctx.unit?.id !== caster.id) return;
          if ((caster.skillState.rougeCoinLevel ?? 0) !== 2) return;

          caster.skillState.rougeS2BurstCount = (caster.skillState.rougeS2BurstCount ?? 0) + 1;
          if (caster.skillState.rougeS2BurstCount < 5) return;
          caster.skillState.rougeS2BurstCount = 0;
          caster.skillState.rougeCoinLevel    = 3;

          const maxHpFlat = Math.round(casterMaxHp(state, caster)
                              * getSkillValue(caster.rawSkill2, 4, caster.skillLevels[1]) / 100);
          pushBuff(state, { name: 'rouge_s2_doubleSwordCoin_maxHp', unitId: null,
            maxHpFlat, endTick: Infinity });
        },
      },
    ],
  },

  // ── Game Master
  // ■ Affects all allies.
  //   ATK ▲ {p01}% of caster's ATK for {p02=10} sec.
  // ■ Activates when in Sword Coin status. Affects all allies.
  //   Max HP ▲ {p03}% of caster's Max HP without restoring HP, lasts for {p04=10} sec.
  // ■ Activates when in Shield Coin status. Affects all allies.
  //   Max HP ▲ {p05}% of caster's Max HP for {p06=10} sec.
  // ■ Activates when in Double Sword Coin status. Affects all allies.
  //   Max HP ▲ {p07}% of caster's Max HP without restoring HP, lasts for {p08=10} sec.
  //
  // group_id: 12723
  // p01 (index 0): ATK% of caster: [7.12, 8.01, 8.89, 9.77, 10.66, 11.54, 12.42, 13.31, 14.19, 15.07]
  // p02 (index 1): 持续时间 (const 10)
  // p03 (index 2): Sword Coin Max HP%: [6.00, 6.46, 6.92, 7.38, 7.85, 8.31, 8.77, 9.23, 9.69, 10.15]
  // p04 (index 3): 持续时间 (const 10)
  // p05 (index 4): Shield Coin Max HP%: [11.88, 12.79, 13.70, 14.62, 15.53, 16.44, 17.36, 18.27, 19.19, 20.10]
  // p06 (index 5): 持续时间 (const 10)
  // p07 (index 6): Double Sword Coin Max HP%: [17.74, 19.10, 20.47, 21.83, 23.19, 24.56, 25.92, 27.29, 28.65, 30.02]
  // p08 (index 7): 持续时间 (const 10)
  burst: {
    groupId: 12723,
    triggers: [
      // Part1：无条件 → 全员 ATK flat ▲（% of caster ATK，10 sec）
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster, ctx) {
          if (ctx.unit?.id !== caster.id) return;
          const lv      = caster.skillLevels[2];
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(caster.rawBurst, 0, lv) / 100);
          pushBuff(state, { name: 'rouge_burst_atkFlat', unitId: null,
            atkFlat, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // Part2：有 Sword Coin（level≥1）→ 全员 Max HP ▲（不恢复 HP，10 sec）
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster, ctx) {
          if (ctx.unit?.id !== caster.id) return;
          if ((caster.skillState.rougeCoinLevel ?? 0) < 1) return;
          const lv        = caster.skillLevels[2];
          const maxHpFlat = Math.round(casterMaxHp(state, caster)
                              * getSkillValue(caster.rawBurst, 2, lv) / 100);
          pushBuff(state, { name: 'rouge_burst_swordCoin_maxHp', unitId: null,
            maxHpFlat, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // Part3：有 Shield Coin（level≥2）→ 全员 Max HP ▲（10 sec；原文无"不恢复 HP"说明）
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster, ctx) {
          if (ctx.unit?.id !== caster.id) return;
          if ((caster.skillState.rougeCoinLevel ?? 0) < 2) return;
          const lv        = caster.skillLevels[2];
          const maxHpFlat = Math.round(casterMaxHp(state, caster)
                              * getSkillValue(caster.rawBurst, 4, lv) / 100);
          pushBuff(state, { name: 'rouge_burst_shieldCoin_maxHp', unitId: null,
            maxHpFlat, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // Part4：有 Double Sword Coin（level≥3）→ 全员 Max HP ▲（不恢复 HP，10 sec）
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster, ctx) {
          if (ctx.unit?.id !== caster.id) return;
          if ((caster.skillState.rougeCoinLevel ?? 0) < 3) return;
          const lv        = caster.skillLevels[2];
          const maxHpFlat = Math.round(casterMaxHp(state, caster)
                              * getSkillValue(caster.rawBurst, 6, lv) / 100);
          pushBuff(state, { name: 'rouge_burst_doubleSwordCoin_maxHp', unitId: null,
            maxHpFlat, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },
};
