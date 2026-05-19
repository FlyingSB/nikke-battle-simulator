import { pushBuff, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// S2 Part2 激活条件：HP < 60%（首次低于阈值时永久生效，不重复叠加）
function checkAndApplyS2P2(state, caster) {
  if (caster.skillState.scS2CritApplied) return;
  if (caster.unitHp / caster.stats.hp >= 0.6) return;
  caster.skillState.scS2CritApplied = true;
  const lv    = caster.skillLevels[1];
  const cdPct = getSkillValue(caster.rawSkill2, 3, lv) / 100;
  pushBuff(state, { name: 'sc_s2_critDmg', unitId: caster.id,
    critDmgBonus: cdPct, endTick: Infinity });
}

export default {

  // ── Blood for Blood
  // ■ Activates after landing {p00=10} normal attack(s). Affects self.
  //   ATK ▲ {p01}%, stacks up to {p03=5} time(s) and lasts for {p02=5} sec.
  //   Current HP ▼ {p04=4.01}%.
  //
  // group_id: 22221
  // p00 (shot threshold, const): [10, ...]
  // p01 ATK▲% per stack: [17.48, 18.11, 18.74, 19.37, 20, 20.63, 21.26, 21.89, 22.52, 23.15]
  // p02 duration (const): [5, ...]
  // p03 max stacks (const): [5, ...]
  // p04 current HP cost% (const): [4.01, ...]
  skill1: {
    groupId: 22221,
    triggers: [
      {
        on: 'SHOT_COUNT',
        opts: { every: 10, counterKey: 'sc_s1' },
        handler(state, caster) {
          const lv      = caster.skillLevels[0];
          const atkPct  = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          const endTick = state.tick + TICK_RATE * 5;

          // ATK ▲ 独立叠层（最多 5 层，5s/层）— 使用 0~4 轮转槽位
          const slot = (caster.skillState.scS1AtkSlot ?? 0) % 5;
          caster.skillState.scS1AtkSlot = slot + 1;
          pushBuff(state, { name: `sc_s1_atk_${slot}`, unitId: caster.id,
            atkPct, endTick });

          // 扣除当前 HP 的 4.01%（不低于 1）
          const hpCost = Math.round(caster.stats.hp * 0.0401);
          caster.unitHp = Math.max(1, (caster.unitHp ?? caster.stats.hp) - hpCost);

          // HP 下降后检测 S2 Part2 阈值
          checkAndApplyS2P2(state, caster);
        },
      },
    ],
  },

  // ── Zatoichi
  // ■ There is a {p00=30}% chance of activating when attacked. Affects self.
  //   Deals {p01}% of final ATK as additional damage.
  //   [TODO: "when attacked" 事件在模拟器中不建模，此部分跳过]
  // ■ Activates when HP falls below {p02=60}%. Affects self.
  //   Critical Damage ▲ {p03}% continuously.
  //
  // group_id: 22222
  // p00 chance (const): [30, ...]
  // p01 additional damage% of final ATK: [86.39, 92.15, 97.91, 103.68, 109.44, 115.2, 120.96, 126.72, 132.48, 138.24]
  // p02 HP threshold (const): [60, ...]
  // p03 Critical Damage▲%: [4.13, 4.4, 4.68, 4.95, 5.23, 5.51, 5.78, 6.06, 6.33, 6.61]
  skill2: {
    groupId: 22222,
    triggers: [
      // Part2：战斗开始时检测初始 HP（通常满血不触发；安全起见保留）
      {
        on: 'BATTLE_START',
        handler: checkAndApplyS2P2,
      },
    ],
  },

  // ── Scarlet Flash
  // ■ Affects self. Activates when HP falls below {p00=50}%.
  //   Critical Rate ▲ {p01}% for {p02=10} sec.
  // ■ Affects all enemies.
  //   Deals {p03}% of final ATK as Burst Skill damage.
  //
  // group_id: 12223
  // p00 HP threshold (const): [50, ...]
  // p01 Critical Rate▲%: [12.23, 13.05, 13.86, 14.68, 15.49, 16.31, 17.12, 17.94, 18.75, 19.57]
  // p02 duration (const): [10, ...]
  // p03 burst damage% of final ATK: [530.71, 566.1, 601.48, 636.86, 672.24, 707.62, 743, 778.38, 813.76, 849.15]
  burst: {
    groupId: 12223,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];

          // Part1：HP < 50% → 自身 Crit Rate ▲[p01]% 10s
          const hpPct = (caster.unitHp ?? caster.stats.hp) / caster.stats.hp;
          if (hpPct < 0.5) {
            const crPct = getSkillValue(caster.rawBurst, 1, lv) / 100;
            pushBuff(state, { name: 'sc_burst_critRate', unitId: caster.id,
              critRateBonus: crPct, endTick: state.tick + TICK_RATE * 10 });
          }

          // Part2：延迟 1.38s 后触发爆裂伤害（默认结算）。
          // sums 预捕获以排除 ENTER_FULL_BURST buff；全爆裂补正由引擎自动抑制（suppressFullBurst）。
          const burstMult = getSkillValue(caster.rawBurst, 3, lv) / 100;
          const sumsSnap  = getBuffSums(state, caster.id);
          state.pendingSkillHits.push({
            fireTick:  state.tick + Math.round(1.38 * TICK_RATE),
            caster,
            mult:      burstMult,
            sums:      sumsSnap,
            isCharged: false,
            label:     'sc_burst',
          });
        },
      },
    ],
  },
};
