import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Body Contact
  // ■ Activates when entering battle. Affects self.
  //   Charges Restraint Chains by {p00=10}, up to 10.
  // ■ Activates when Full Burst ends if this unit has just used her Burst Skill. Affects self.
  //   Charges Restraint Chains by {p00=10}, up to 10.
  // ■ Affects random enemy units at a specific timing (= BURST_SKILL_USE).
  //   Deals {p01}% of final ATK as damage. Attacks once for every Restraint Chain.
  //   Restraint Chain ▼ 1 per attack.
  // ■ Affects the same enemy units.
  //   Ensnaring Chains: Deals {p02}% final ATK as sustained damage every 1 sec continuously,
  //   stacks up to {p03=20}. This effect cannot be removed.
  //
  // group_id: 21621
  // p00 Restraint Chains charged (const): [10, ...]
  // p01 chain attack mult%: [29.58, 31.86, 34.13, 36.41, 38.68, 40.96, 43.24, 45.51, 47.79, 50.06]
  // p02 Ensnaring Chains DoT %/sec: [14.82, 15.96, 17.1, 18.24, 19.38, 20.52, 21.66, 22.8, 23.94, 25.08]
  // p03 Ensnaring Chains max stacks (const): [20, ...]
  skill1: {
    groupId: 21621,
    triggers: [
      // Part1：战斗开始 → Restraint Chains 充能至 10
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          caster.skillState.mhbcRestraintChains = 10;
        },
      },

      // Part2：全爆裂结束后（本轮使用过爆裂技能）→ Restraint Chains 重充至 10
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          if (!state.burstCastersThisRotation.has(caster.id)) return;
          caster.skillState.mhbcRestraintChains = 10;
        },
      },

      // Part3+4："specific timing" = BURST_SKILL_USE
      // 链式攻击：以当前 Restraint Chain 层数为次数发射，每次 p01% ATK，消耗后归零
      // Ensnaring Chains DoT：p02% ATK/秒，初始层数 = 消耗的 Restraint Chain 数，最多叠 20 层
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv     = caster.skillLevels[0];
          const chains = caster.skillState.mhbcRestraintChains ?? 0;
          if (chains <= 0) return;

          const chainHitMult = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          const dotMult      = getSkillValue(caster.rawSkill1, 2, lv) / 100;
          const sums         = getBuffSums(state, caster.id);

          for (let i = 0; i < chains && state.enemyHp > 0; i++) {
            fireSkillHit(state, caster, chainHitMult, sums, false, 'mhbc_s1_chain');
          }
          caster.skillState.mhbcRestraintChains = 0;

          // 若已有 Ensnaring Chains DoT 则叠层（不超过 20），否则新建
          const existing = state.dots.find(
            d => d.dotName === 'mhbc_ensnaring' && d.casterId === caster.id,
          );
          if (existing) {
            existing.stacks = Math.min(20, existing.stacks + chains);
          } else {
            state.dots.push({
              casterId:      caster.id,
              label:         'mhbc_ensnaring',
              dotName:       'mhbc_ensnaring',
              multPerStack:  dotMult,
              stacks:        chains,
              endTick:       Infinity,
              nextFireTick:  state.tick + TICK_RATE,
              intervalTicks: TICK_RATE,
            });
          }
        },
      },
    ],
  },

  // ── Tighten Up
  // ■ Activates after landing {p00=40} normal attack(s) during Full Burst.
  //   Affects the target if the target is in Ensnaring Chains status.
  //   Stack count of Ensnaring Chains ▲ {p01=1}.
  // ■ Activates when self is incapacitated. Affects targets in Ensnaring Chains status.
  //   Stack count of Ensnaring Chains ▲ {p02=20}.  [TODO: 自身击倒未建模]
  // ■ Activates when the enemy is neutralized. Affects self if target has Ensnaring Chains.
  //   Restraint Chain ▲ {p03=1}, up to 10.         [TODO: Boss 战不会触发]
  // ■ Activates when entering Burst Stage 3. Affects self.
  //   Sustained damage ▲ {p06}% for {p07=10} sec.
  //
  // group_id: 21622
  // p00 shot threshold (const): [40, ...]
  // p01 Ensnaring Chains stack ▲ in burst (const): [1, ...]
  // p02 Ensnaring Chains stack ▲ on death (const): [20, ...]
  // p03 Restraint Chain ▲ on kill (const): [1, ...]
  // p06 Sustained damage ▲%: [35.44, 38.16, 40.89, 43.62, 46.34, 49.07, 51.8, 54.52, 57.25, 59.98]
  // p07 duration (const): [10, ...]
  skill2: {
    groupId: 21622,
    triggers: [
      // Part1：全爆裂期间每 40 次普通攻击 → 目标 Ensnaring Chains +1 层（若目标有该 DoT）
      // 在当前爆裂模型中，Burst 在全爆裂开始前将 Ensnaring Chains 转为 Dragging Chain，
      // 因此此触发通常不激活（保留以备将来场景扩展）。
      {
        on: 'SHOT_COUNT',
        opts: { every: 40, counterKey: 'mhbc_s2p1' },
        handler(state, caster) {
          if (!state.fullBurstActive) return;
          const dot = state.dots.find(
            d => d.dotName === 'mhbc_ensnaring' && d.casterId === caster.id,
          );
          if (!dot) return;
          dot.stacks = Math.min(20, dot.stacks + 1);
        },
      },

      // Part4：进入爆裂阶段 3 → 自身 Sustained damage ▲ p06% 持续 10s
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const lv      = caster.skillLevels[1];
          const sDmgPct = getSkillValue(caster.rawSkill2, 6, lv) / 100;
          pushBuff(state, { name: 'mhbc_s2_sustainedDmg', unitId: caster.id,
            sustainedDamageMult: sDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },

  // ── Bonding Pain
  // ■ Affects targets in Ensnaring Chains status.
  //   Dragging Chain: Deals {p02}% of final ATK as sustained damage every 1 sec.
  //   Mirrors the stack count of Ensnaring Chains on each target for {p03=10} sec.
  //   This effect cannot be removed.
  //   Cancels Ensnaring Chains after the effect is triggered.
  //
  // group_id: 11623
  // p02 Dragging Chain DoT %/sec: [29.57, 31.85, 34.12, 36.4, 38.67, 40.95, 43.22, 45.5, 47.77, 50.05]
  // p03 duration (const): [10, ...]
  burst: {
    groupId: 11623,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const dotIdx = state.dots.findIndex(
            d => d.dotName === 'mhbc_ensnaring' && d.casterId === caster.id,
          );
          if (dotIdx < 0) return;

          const { stacks } = state.dots[dotIdx];
          state.dots.splice(dotIdx, 1);

          const lv           = caster.skillLevels[2];
          const draggingMult = getSkillValue(caster.rawBurst, 2, lv) / 100;

          state.dots.push({
            casterId:      caster.id,
            label:         'mhbc_dragging',
            dotName:       'mhbc_dragging',
            multPerStack:  draggingMult,
            stacks,
            endTick:       state.tick + TICK_RATE * 10,
            nextFireTick:  state.tick + TICK_RATE,
            intervalTicks: TICK_RATE,
          });
        },
      },
    ],
  },
};
