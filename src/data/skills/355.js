import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { getCharacterTraits } from '../../data/character-traits.js';

export default {

  // ── Starfish (Shaped) Omurice
  // ■ Activates when entering Full Burst. Affects all allies.
  // Effect changes according to the number of activation times. Previous effects trigger repeatedly.
  // Once: Potency of HP ▲ {description_value_01}% for {description_value_02} sec.
  // Twice: Distributed Damage ▲ {description_value_03}% for {description_value_04} sec.
  // Three times: Stack count of debuffs ▼ {description_value_05}.
  // ■ Activates when entering Full Burst while an ally from the same squad is on the battlefield. Affects all allies.
  // Recovers {description_value_06}% of caster's Max HP every 1 sec for {description_value_07} sec.
  // p01: [18.29, 19.7, 21.11, 22.51, 23.92, 25.33, 26.74, 28.14, 29.55, 30.96]
  // p02: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p03: [17.96, 19.34, 20.72, 22.1, 23.49, 24.87, 26.25, 27.63, 29.01, 30.4]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p06: [1.79, 1.93, 2.07, 2.21, 2.34, 2.48, 2.62, 2.76, 2.9, 3.04]
  // p07: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8]
  skill1: {
    groupId: 23551,
    triggers: [
      // S1 Part 1（Starfish Omurice）："前效重复触发"，每次进入全爆裂：
      //   [TODO] 第 1 次+：HP 回复效能 ▲30.96% 5s（全员）— 待治疗系统实现
      //   第 2 次+：Distributed Damage ▲30.40% 10s（全员）
      //   第 3 次+：移除 1 层 Mast Drunken（防 Hangover；仅移除 isDebuff:true 且 stackLimit>1 的堆叠 buff）
      // 同一部队条件（Anchor + Mast 同队）在当前阵容中恒满足，注释保留
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          caster.skillState.anchorFbCount++;
          const cnt = caster.skillState.anchorFbCount;
          if (cnt >= 2) {
            const distDmgPct = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
            pushBuff(state, { name: 'anchor_s1_t2_distributedDmg', unitId: null,
              distributedDamagePct: distDmgPct, endTick: state.tick + TICK_RATE * 10 });
          }
          if (cnt >= 3) {
            const stackedBuff = state.buffs.find(b => b.isDebuff === true && (b.stackLimit ?? 0) > 1 && (b.stackCount ?? 0) > 0);
            if (stackedBuff) {
              stackedBuff.stackCount--;
              if (stackedBuff.stackCount === 0)
                state.buffs = state.buffs.filter(b => b !== stackedBuff && b.derivedFrom !== stackedBuff.name);
            }
          }
        },
      },
      // S1 Part 2：进入全爆裂，同 squad 队员在阵时 → 自身 HP 回复 3.04%/s × 8s（8 次 HoT）
      // 条件读取 CHARACTER_TRAITS.squad 字段（CDN squad 字段）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const mySquad = getCharacterTraits(caster.id)?.squad;
          if (!mySquad) return;
          const hasSquadMate = state.squad.some(u =>
            u.id !== caster.id && getCharacterTraits(u.id)?.squad === mySquad);
          if (!hasSquadMate) return;
          const ticksPerSec = TICK_RATE;
          const hotHealPct  = getSkillValue(caster.rawSkill1, 5, caster.skillLevels[0]) / 100;
          const amount      = Math.round(caster.stats.hp * hotHealPct);
          for (let i = 1; i <= 8; i++) {
            for (const ally of state.squad)
              state.pendingHoTs.push({ fireTick: state.tick + i * ticksPerSec, targetId: ally.id, amount });
          }
        },
      },
    ],
  },

  // ── Sea Anemone (Shaped) Pasta
  // ■ Activates when Full Burst ends. Affects all allies.
  // Effect changes according to the number of activation times. Previous effects trigger repeatedly.
  // Once: Hit Rate ▲ {description_value_01}% for {description_value_02} sec.
  // Twice: ATK ▲ {description_value_03}% of caster's ATK for {description_value_04} sec.
  // Three times: Reloading Speed ▲ {description_value_05}% for {description_value_06} sec.
  // p01: [5.98, 6.44, 6.9, 7.36, 7.83, 8.29, 8.75, 9.21, 9.67, 10.13]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [20.65, 22.25, 23.85, 25.44, 27.04, 28.64, 30.23, 31.83, 33.43, 35.02]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [23.82, 25.62, 27.42, 29.23, 31.03, 32.83, 34.63, 36.44, 38.24, 40.04]
  // p06: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15]
  skill2: {
    groupId: 23552,
    triggers: [
      // S2（Sea Anemone Pasta）："前效重复触发"，每次全爆裂结束：
      //   第 1 次+：Hit Rate ▲10.13% 10s（全员）
      //   第 2 次+：ATK flat ▲35.02% Anchor ATK 10s（全员）
      //   第 3 次+：Reload Speed ▲40.04% 15s（全员）
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const cnt        = caster.skillState.anchorFbCount;
          const end10      = state.tick + TICK_RATE * 10;
          const end15      = state.tick + TICK_RATE * 15;
          const hitRatePct = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          const atkFlatPct = getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]) / 100;
          const reloadPct  = getSkillValue(caster.rawSkill2, 4, caster.skillLevels[1]) / 100;
          if (cnt >= 1) pushBuff(state, { name: 'anchor_s2_t1_hitRate',   unitId: null, hitRateBonus: hitRatePct, endTick: end10 });
          if (cnt >= 2) pushBuff(state, { name: 'anchor_s2_t2_atkFlat',   unitId: null, atkFlat: Math.round(caster.stats.atk * atkFlatPct), endTick: end10 });
          if (cnt >= 3) pushBuff(state, { name: 'anchor_s2_t3_reloadSpd', unitId: null, reloadSpeedPct: reloadPct, endTick: end15 });
        },
      },
    ],
  },

  // ── Seaside Stroll
  // ■ Affects all allies.
  // Storage: Stores excess healing received by the caster, up to {description_value_01}% of their Max HP. Lasts for {description_value_02} sec.
  // Recovers {description_value_03}% of caster's Max HP as HP.
  // ATK ▲ {description_value_04}% of caster's ATK for {description_value_05} sec.
  // p01: [35.56, 38.3, 41.04, 43.77, 46.51, 49.24, 51.98, 54.72, 57.45, 60.19]
  // p02: [25, 25, 25, 25, 25, 25, 25, 25, 25, 25]
  // p03: [23.56, 25.41, 27.25, 29.1, 30.95, 32.79, 34.64, 36.49, 38.33, 40.18]
  // p04: [17.78, 19.15, 20.52, 21.88, 23.25, 24.62, 25.99, 27.36, 28.72, 30.09]
  // p05: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 13553,
    triggers: [
      // Burst（Seaside Stroll）：全员 ATK flat ▲30.09% Anchor ATK 10s
      //   + 全员立即 HP 回复 40.18% caster max HP
      //   [TODO: 过量治疗储存 60.19%×MaxHP 25s 未建模]
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const atkFlatPct = getSkillValue(caster.rawBurst, 3, caster.skillLevels[2]) / 100;
          const healPct    = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'anchor_burst_atkFlat', unitId: null,
            atkFlat: Math.round(caster.stats.atk * atkFlatPct), endTick: state.tick + TICK_RATE * 10 });
          const healAmt = Math.round(caster.stats.hp * healPct);
          for (const u of state.squad) applyHeal(state, u, healAmt);
        },
      },
    ],
  },
};
