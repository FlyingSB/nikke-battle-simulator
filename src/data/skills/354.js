import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Mast: Romantic Maid  (resource_id: 354)
export default {

  // ── A Pirate's Heart
  // ■ Activates when entering Burst stage 1. Affects self.
  // Drunken: Hit Rate ▼ {description_value_01}%, stacks up to {description_value_02} times continuously.
  // ■ Activates only when in Drunken status. Affects all allies.
  // Critical Rate ▲ {description_value_03}% continuously.
  // ATK ▲ {description_value_04}% of caster's ATK continuously.
  // p01: [35.92, 34.15, 32.38, 30.62, 28.85, 27.08, 25.31, 23.54, 21.77, 20]
  // p02: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p03: [11.85, 12.76, 13.67, 14.58, 15.49, 16.4, 17.32, 18.23, 19.14, 20.05]
  // p04: [20.69, 22.28, 23.87, 25.46, 27.06, 28.65, 30.24, 31.83, 33.42, 35.02]
  skill1: {
    groupId: 23541,
    triggers: [
      // S1（A Pirate's Heart）：进入爆裂阶段 1 → Drunken 层数 +1（上限 3）
      // 首层时推送全员永久 buff：Crit Rate ▲20.05% + ATK flat ▲35.02% Mast ATK
      {
        on: 'ENTER_BURST_I',
        handler(state, caster) {
          const drunken = state.buffs.find(b => b.name === 'Drunken');
          const current = drunken?.stackCount ?? 0;
          if (current >= 3) return;
          if (current === 0) {
            const critRatePct = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
            const atkFlatPct    = getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]) / 100;
            // S1 唯一未具名效果段（P1 为 Drunken）→ 日志标签省略 P 后缀
            pushBuff(state, { name: 'A Pirate\'s Heart', derivedFrom: 'Drunken',
              unitId: null, critRatePct, atkFlat: Math.round(caster.stats.atk * atkFlatPct), endTick: Infinity },
              { ...state._logCtx, partIdx: null });
            state.buffs.push({ name: 'Drunken', unitId: caster.id, isDebuff: true,
              stackCount: 1, stackLimit: 3, endTick: Infinity });
          } else {
            drunken.stackCount++;
          }
        },
      },
    ],
  },

  // ── A Pirate's Spirit
  // ■ Activates when entering Burst stage 3 in Drunken status. Affects all allies.
  // Distributed Damage ▲ {description_value_01}% * Number of Drunken stacks for {description_value_02} sec.
  // Reloading Speed ▲ {description_value_03}% * Number of Drunken stacks for {description_value_04} sec.
  // ■ Activates when the caster reaches max stacks of Drunken at the end of Full Burst. Affects self after the stacks are removed.
  // Hangover: Stun for {description_value_05} sec.
  // p01: [8.88, 9.56, 10.24, 10.93, 11.61, 12.29, 12.98, 13.66, 14.34, 15.03]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [8.73, 9.43, 10.13, 10.83, 11.53, 12.24, 12.94, 13.64, 14.34, 15.04]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  skill2: {
    groupId: 23542,
    triggers: [
      // S2（A Pirate's Spirit）：进入爆裂阶段 3 时（B3 施放前），Drunken ≥1 层时
      //   全员 Distributed Damage ▲15.03%×stacks + Reload Speed ▲15.04%×stacks 10s
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const stacks = state.buffs.find(b => b.name === 'Drunken')?.stackCount ?? 0;
          if (stacks <= 0) return;
          const end10            = state.tick + TICK_RATE * 10;
          const distDmgPerStack  = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          const reloadSpdPerStack = getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]) / 100;
          // S2 唯一未具名效果段（P2 为 Hangover）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'A Pirate\'s Spirit', unitId: null,
            distributedDamagePct: distDmgPerStack * stacks, reloadSpeedPct: reloadSpdPerStack * stacks,
            multiplier: stacks, endTick: end10 }, { ...state._logCtx, partIdx: null });
        },
      },
      // S2 Hangover：全爆裂结束，stacks = 3 → 眩晕自身 10s + 层数归零 + S1 被动移除
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const drunken = state.buffs.find(b => b.name === 'Drunken');
          if ((drunken?.stackCount ?? 0) < 3) return false;
          caster.skillState.stunnedUntilTick = state.tick + TICK_RATE * 10;
          state.buffs = state.buffs.filter(b => b.name !== 'Drunken' && b.derivedFrom !== 'Drunken');
        },
      },
    ],
  },

  // ── A Pirate's Romance
  // ■ Affects all allies.
  // Critical Damage ▲ {description_value_01}% for {description_value_02} sec.
  // Attack Damage ▲ {description_value_03}% for {description_value_04} sec.
  // ■ Affects all allies if in Drunken status.
  // ATK ▲ ({description_value_05}% * Number of Drunken stacks) of caster's ATK for {description_value_06} sec.
  // p01: [23.51, 25.34, 27.18, 29.02, 30.86, 32.69, 34.53, 36.37, 38.2, 40.04]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [8.89, 9.57, 10.26, 10.94, 11.62, 12.31, 12.99, 13.68, 14.36, 15.04]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [11.85, 12.76, 13.68, 14.59, 15.5, 16.41, 17.32, 18.24, 19.15, 20.06]
  // p06: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 13543,
    triggers: [
      // Burst（A Pirate's Romance）：
      //   全员 Crit Dmg ▲40.04% + Attack Dmg ▲15.04% 10s（无条件）
      //   若 Drunken ≥1：全员 ATK flat ▲20.06%×stacks×Mast.atk 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const end10          = state.tick + TICK_RATE * 10;
          const critDamagePct   = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const attackDmgPct   = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          const atkFlatPerStack = getSkillValue(caster.rawBurst, 4, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'A Pirate\'s Romance (Attack Damage)', unitId: null, critDamagePct, attackDamagePct: attackDmgPct, endTick: end10 });
          const stacks = state.buffs.find(b => b.name === 'Drunken')?.stackCount ?? 0;
          if (stacks > 0)
            pushBuff(state, { name: 'A Pirate\'s Romance (ATK)', unitId: null,
              atkFlat: Math.round(caster.stats.atk * atkFlatPerStack * stacks), multiplier: stacks, endTick: end10 },
              { ...state._logCtx, partIdx: 1 });
        },
      },
    ],
  },
};
