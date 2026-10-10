import { pushBuff, fireSkillHit, addBurstGauge, applyHeal, setMaxHpBuffValue,
         getBuffSums, snapshotBuffBreakdown, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Maiden: Ice Rose  (resource_id: 183)

// S2 指定段的日志上下文：S2 效果 inline 于 S1 / Burst 触发器中推入，日志需归属到 S2 对应段
function s2LogCtx(state, caster, partIdx, lineIdx = null) {
  return {
    ...state._logCtx,
    skillLabel: caster.rawSkill2?.name_localkey ?? 'S2',
    slot: 'S2', partIdx, lineIdx,
  };
}

// S2 Part1（MP 补充时）：除自身外的 Electric 友军 ElemAdv ATK Dmg ▲[S2 param0]% + ATK ▲[S2 param2]% caster ATK flat 10s
function pushS2P1(state, caster) {
  const end10      = state.tick + TICK_RATE * 10;
  const elemAdvPct = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
  const atkFlatPct = getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]) / 100;
  const atkFlat    = Math.round(caster.stats.atk * atkFlatPct);
  const logCtx     = s2LogCtx(state, caster, 0);
  const unitIds    = state.squad.filter(u => u.id !== caster.id && u.element === 'Electric').map(u => u.id);
  pushBuff(state, { name: 'Blessings Upon You P1 (ATK)', unitIds, elementAdvantagePct: elemAdvPct, atkFlat, endTick: end10 }, logCtx);
}

export default {

  // ── Meditation
  // ■ Activates when entering Burst Stage 1. Affects self when MP is 0.
  // MP recovers by {description_value_01}. MP can be accumulated up to a maximum of 12. All accumulated MP is consumed when using Burst Skill.
  // ■ Activates when entering Full Burst. Affects self when MP is above 1.
  // MP replenishes by {description_value_02}. MP can be accumulated up to a maximum of 12. All accumulated MP is consumed when using Burst Skill.
  // ■ Activates when attacking with Full Charge for {description_value_06} time(s). Affects self.
  // Max HP ▲ {description_value_03}% without restoring HP for {description_value_05} sec, stacks up to {description_value_04} time(s).
  // p01: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p02: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p03: [3.74, 4.03, 4.32, 4.61, 4.9, 5.19, 5.47, 5.76, 6.05, 6.34]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15]
  // p06: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6]
  skill1: {
    groupId: 21831,
    triggers: [
      // S1 Part1（Meditation）：进入 B1 阶段，MP=0 时 → MP=1 + S2 Part1 Electric 友军 buff
      //   S2 Part1：ElemAdv ATK Dmg ▲[S2 param0]% + ATK ▲[S2 param2]% caster ATK flat 10s
      {
        on: 'ENTER_BURST_I',
        handler(state, caster) {
          if ((caster.skillState.iceroseMP ?? 0) > 0) return;
          caster.skillState.iceroseMP = 1;
          pushS2P1(state, caster);
        },
      },
      // S1 Part2（Meditation）：进入全爆裂，MP≥1 时 → MP+1（上限 12）+ S2 Part1 Electric 友军 buff
      //   S2 Part1：ElemAdv ATK Dmg ▲[S2 param0]% + ATK ▲[S2 param2]% caster ATK flat 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          if ((caster.skillState.iceroseMP ?? 0) < 1) return false;
          caster.skillState.iceroseMP = Math.min(12, caster.skillState.iceroseMP + 1);
          pushS2P1(state, caster);
        },
      },
      // S1 Part3（Meditation）：每 6 次全蓄力 → 自身 Max HP ▲[S1 param2]% 15s（叠加至 10 层）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          caster.skillState.iceroseChargeCount = (caster.skillState.iceroseChargeCount ?? 0) + 1;
          if (caster.skillState.iceroseChargeCount < 6) return false;
          caster.skillState.iceroseChargeCount = 0;
          const maxHpPctPerStack = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          // 「without restoring HP」→ noRestore：只提升上限，不回复当前 HP
          const existing = state.buffs.find(b => b.name === 'Meditation' && b.unitId === caster.id);
          const stacks   = Math.min(10, (existing?.stackCount ?? 0) + 1);
          const end15    = state.tick + TICK_RATE * 15;
          if (existing) {
            existing.stackCount = stacks;
            setMaxHpBuffValue(state, existing, { maxHpPct: stacks * maxHpPctPerStack });
            existing.endTick    = end15;
          } else {
            state.buffs.push({ name: 'Meditation', unitId: caster.id, noRestore: true,
              maxHpPct: maxHpPctPerStack, endTick: end15, stackCount: 1 });
          }
        },
      },
    ],
  },

  // ── Blessings Upon You
  // ■ Activates when MP is replenished. Affects all Electric Code allies except for self.
  // Elemental Advantage Attack Damage ▲ {description_value_01}% for {description_value_02} sec.
  // ATK ▲ {description_value_03}% of caster's ATK for {description_value_04} sec.
  // ■ Activates when MP is used. Affects self.
  // Elemental Advantage Attack Damage ▲ {description_value_05}% for {description_value_06} sec.
  // ATK ▲ {description_value_07}% of caster's final Max HP for {description_value_08} sec.
  // ■ Activates when attacking with Full Charge for {description_value_11} time(s). Affects {description_value_09} enemy unit(s) nearest to the crosshair.
  // Deals {description_value_10}% of final ATK as damage.
  // p01: [24.2, 26.06, 27.91, 29.77, 31.62, 33.48, 35.33, 37.19, 39.04, 40.9]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [12.35, 13.3, 14.25, 15.2, 16.15, 17.1, 18.05, 19, 19.95, 20.9]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [18.72, 20.16, 21.6, 23.04, 24.48, 25.92, 27.36, 28.8, 30.24, 31.68]
  // p06: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p07: [1.89, 2.03, 2.18, 2.32, 2.47, 2.62, 2.76, 2.91, 3.05, 3.2]
  // p08: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p09: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p10: [323.58, 348.48, 373.37, 398.26, 423.16, 448.05, 472.94, 497.84, 522.73, 547.62]
  // p11: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  skill2: {
    groupId: 21832,
    triggers: [
      // tdefIdx=0：■段0(MP replenished 时)inline 于 S1 触发器，此处占位
      {},
      // tdefIdx=1：■段1(MP used 时)inline 于 Burst 触发器，此处占位
      {},
      // S2 Part3（Blessings Upon You）：每次全蓄力 → [S2 param9]% ATK 技能伤害
      // S2 Part1 inline 于 S1 触发器；S2 Part2 inline 于 Burst 触发器
      {
        on: 'FULL_CHARGE',
        handler(state, caster, ctx) {
          const skillDmg = getSkillValue(caster.rawSkill2, 9, caster.skillLevels[1]) / 100;
          const sums     = ctx.sums ?? getBuffSums(state, caster.id);
          fireSkillHit(state, caster, skillDmg, sums, 'S2', {
            burstEnergy: caster.targetBurstEnergyPerShot, burstEnergySource: 'icr_s2_fc_dmg' });
        },
      },
    ],
  },

  // ── Diamond Dust
  // ■ Affects {description_value_01} enemy unit(s) nearest to the crosshair.
  // Deals damage equal to {description_value_03}% of the sum of {description_value_02}% of the caster's final Max HP and the caster's final ATK. Attacks continuously based on the current MP.
  // 实际公式：(最终 ATK + 最终 MaxHP × param2%) × param3%
  //   最终 ATK / 最终 MaxHP 均含施放时刻的全部 buff（MaxHP 含 maxHpPct / maxHpFlat）。
  //   与其他直接伤害型 B3 一样：不受全爆裂补正，也不受「进入全爆裂时」生效的 buff 影响。
  // p01: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [811.2, 873.6, 936, 998.4, 1060.8, 1123.2, 1185.6, 1248, 1310.4, 1372.8]
  burst: {
    groupId: 11833,
    triggers: [
      // Burst P1（敌人）：消耗全部 MP，每点 MP 发动 1 次 (最终 ATK + 最终 MaxHP × param2%) × param3%
      //   伤害在施放时刻即已确定（进入全爆裂后 0.73s 起按 0.1s 间隔出伤；B3 施放后 1.13s，引擎统一后移 0.4s），
      //   因此在 BURST_SKILL_USE 时预捕获 sums：
      //   ENTER_FULL_BURST buff 与下方 P2 触发器随后推入的 S2 Part2 均不计入；
      //   全爆裂 +50% 补正由引擎对延迟命中自动标记 suppressFullBurst 屏蔽。
      //   MaxHP 部分通过 extraAtkFlat 加入 ATK 加算项。
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const preSums     = getBuffSums(state, caster.id);
          // 同步快照 buff 明细，使伤害明细与预捕获 sums 一致（不混入 S2 Part2 / ENTER_FULL_BURST buff）
          const preBuffBreakdown = snapshotBuffBreakdown(state, caster.id);
          const buffedMaxHp = Math.round(caster.stats.hp * (1 + preSums.maxHpPct) + (preSums.maxHpFlat ?? 0));
          const hpPct       = getSkillValue(caster.rawBurst, 1, caster.skillLevels[2]) / 100;
          const burstMult   = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          const mp          = caster.skillState.iceroseMP ?? 0;
          const firstHitDelay = Math.round(0.73 * TICK_RATE);
          const intervalTicks = Math.round(0.1 * TICK_RATE);
          for (let i = 0; i < mp; i++) {
            state.pendingSkillHits.push({
              fireTick: state.tick + firstHitDelay + i * intervalTicks, caster, mult: burstMult,
              sums: preSums, isCharged: false, label: 'Burst',
              opts: { extraAtkFlat: Math.round(buffedMaxHp * hpPct),
                      extraAtkFlatLabel: `最终 MaxHP × ${Math.round(hpPct * 100)}%`,
                      preBuffBreakdown, isSequentialAttack: true },
            });
          }
          caster.skillState.iceroseMP = 0;
          caster.skillState.icrBurstBuffedMaxHp = buffedMaxHp;
        },
      },
      // Burst P2（自身）：S2 Part2 — 消耗 MP 后自身 ElemAdv ATK Dmg ▲ + ATK flat ▲ 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const buffedMaxHp  = caster.skillState.icrBurstBuffedMaxHp ?? 0;
          const end10        = state.tick + TICK_RATE * 10;
          const selfElemAdv  = getSkillValue(caster.rawSkill2, 4, caster.skillLevels[1]) / 100;
          const selfHpAtkPct = getSkillValue(caster.rawSkill2, 6, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Blessings Upon You (Elem Adv Damage)', unitId: caster.id,
            elementAdvantagePct: selfElemAdv, endTick: end10 }, s2LogCtx(state, caster, 1, 1));
          pushBuff(state, { name: 'Blessings Upon You P2 (ATK)', unitId: caster.id,
            atkFlat: Math.round(buffedMaxHp * selfHpAtkPct), endTick: end10 }, s2LogCtx(state, caster, 1, 2));
        },
      },
    ],
  },
};
