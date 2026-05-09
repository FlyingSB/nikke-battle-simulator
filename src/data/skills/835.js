import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// ─── Asuka: WILLE (835) Anti A.T. Field 叠层管理 ──────────────────────────
// 叠层全批同时计时（每次新增叠层刷新到期时间）。
// 采用 enemyDamageTakenPct 直接累加，移除时整批减去。
function applyAtfStack(state, caster, p07Pct) {
  const now = state.tick;
  // 若已过期，清零旧叠层对应的承伤加成
  if (now >= (caster.skillState.atfStackEndTick ?? 0) && caster.skillState.atfStacks > 0) {
    state.enemyDamageTakenPct -= caster.skillState.atfStacks * p07Pct;
    caster.skillState.atfStacks = 0;
  }
  // 最多 30 层
  if ((caster.skillState.atfStacks ?? 0) < 30) {
    caster.skillState.atfStacks = (caster.skillState.atfStacks ?? 0) + 1;
    state.enemyDamageTakenPct += p07Pct;
  }
  // 刷新整批 30s 到期时间
  caster.skillState.atfStackEndTick = now + TICK_RATE * 30;
}

// Annihilation 发动：消耗全部 Anti A.T. Field 叠层，返回消耗前的层数
function consumeAtfStacks(state, caster, p07Pct) {
  const stacks = caster.skillState.atfStacks ?? 0;
  if (stacks > 0) {
    state.enemyDamageTakenPct -= stacks * p07Pct;
    caster.skillState.atfStacks    = 0;
    caster.skillState.atfStackEndTick = 0;
  }
  return stacks;
}

export default {

  // ── Anti A.T. Field
  // ■ Activates after landing 50 normal attack(s). Affects the target(s).
  //   Deals {p02}% of final ATK as additional damage.
  // ■ Activates only when in Annihilation State status. Affects self.
  //   Every {p04} shot(s): Deals {p06}% ATK to 2 nearest enemy unit(s).
  //   Additional Effect: Anti A.T. Field: Damage Taken ▲ {p07}% for {p09} sec, stacks up to {p08} time(s).
  //
  // group_id: 28351
  // p01: [50, ...]  p02 (lv10=471.86%)  p03: [9, ...]  p04: [10, ...]  p05: [2, ...]
  // p06 (lv10=15.62%)  p07 (lv10=0.83%)  p08: [30, ...]  p09: [30, ...]
  skill1: {
    groupId: 28351,
    triggers: [
      // S1 Part1：每 50 发 → 对目标造成 p02% 追加伤害
      {
        on: 'SHOT_COUNT',
        opts: { every: 50, counterKey: 'asukaW_s1P1Count' },
        handler(state, caster) {
          const sums   = getBuffSums(state, caster.id);
          const dmgPct = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100;
          fireSkillHit(state, caster, dmgPct, sums, false, 'asuka_w_s1_p1');
        },
      },
      // S1 Part2（Annihilation State 期间）：每 10 发 → 技能伤害 p06% + Anti A.T. Field 叠层
      // 单 Boss 场景下 2 目标等效为 1 次命中
      {
        on: 'SHOT_COUNT',
        opts: { every: 10, counterKey: 'asukaW_s1P2Count' },
        handler(state, caster) {
          if (state.tick > (caster.skillState.annihilationStateEndTick ?? 0)) return;
          const s1Lv = caster.skillLevels[0];
          const sums = getBuffSums(state, caster.id);
          const p06  = getSkillValue(caster.rawSkill1, 5, s1Lv) / 100;
          const p07  = getSkillValue(caster.rawSkill1, 6, s1Lv) / 100;
          fireSkillHit(state, caster, p06, sums, false, 'asuka_w_s1_p2');
          applyAtfStack(state, caster, p07);
        },
      },
    ],
  },

  // ── Emergency Repair
  // ■ Activates when entering Full Burst while in Annihilation State status. Affects self.
  //   Attack Damage ▲ {p01}% for {p02} sec.
  // ■ Activates when using Annihilation. Affects self.
  //   Effect 1: MG heating up speed ▼ {p03}% for {p04} sec. [TODO: 引擎无 MG 过热建模]
  //   Effect 2: Clears {p05}% of ammo.
  //   Effect 3: Constantly recovers {p06}% of final Max HP every 1 sec over {p07} sec. [TODO]
  //   Effect 4: Reloading Speed is fixed at a {p08}% increase for {p09} round(s).
  //
  // group_id: 28352
  // p01 (lv10=30.97%)  p02: [10, ...]  p03: [100, ...]  p04: [3, ...]  p05: [100, ...]
  // p06 (lv10=3.77%)  p07: [3, ...]  p08: [60, ...]  p09: [1, ...]
  skill2: {
    groupId: 28352,
    triggers: [
      // S2 Part1：进入全爆裂时若处于 Annihilation State → Attack Damage ▲p01% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          if (state.tick > (caster.skillState.annihilationStateEndTick ?? 0)) return;
          const atkDmgPct = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'asuka_w_s2_p1_atkDmg', unitId: caster.id,
            attackDamagePct: atkDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // S2 Part2 inline 于 burst.BURST_SKILL_USE handler（与 Annihilation State 同时激活）
    ],
  },

  // ── Annihilation State
  // ■ Affects self. Annihilation State:
  //   Effect 1: Normal Attack Damage Multiplier ▼ {p07}% for {p08} sec.
  //   Effect 2: Reloads {p01}% magazine(s).
  //   Effect 3: ATK ▲ {p02}% of caster's ATK for {p03} sec.
  //   Effect 4: Attack Damage ▲ {p04}% for {p05} sec.
  // ■ Affects targets afflicted with Anti A.T. Field. Annihilation:
  //   Deals {p06}% of final ATK as additional damage. Mirrors Anti A.T. Field stack count. Removes Anti A.T. Field.
  //
  // group_id: 18353
  // p01 (lv10=21.0%)  p02 (lv10=46.8%)  p03: [9, ...]  p04 (lv10=36.0%)  p05: [9, ...]
  // p06 (lv10=6.62%)  p07: [40, ...]  p08: [9, ...]
  burst: {
    groupId: 18353,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const bLv  = caster.skillLevels[2];
          const s2Lv = caster.skillLevels[1];
          const end9 = state.tick + TICK_RATE * 9;

          // Annihilation State 标记（S1 Part2 / S2 Part1 检查此值）
          caster.skillState.annihilationStateEndTick = end9;

          // Effect 3: ATK ▲p02%（9s）
          const atkPct = getSkillValue(caster.rawBurst, 1, bLv) / 100;
          pushBuff(state, { name: 'asuka_w_burst_atk', unitId: caster.id,
            atkPct, endTick: end9 });

          // Effect 4: Attack Damage ▲p04%（9s）
          const atkDmgPct = getSkillValue(caster.rawBurst, 3, bLv) / 100;
          pushBuff(state, { name: 'asuka_w_burst_atkDmg', unitId: caster.id,
            attackDamagePct: atkDmgPct, endTick: end9 });

          // Effect 1: Normal Attack Damage Multiplier ▼40%（9s，负 buff）
          pushBuff(state, { name: 'asuka_w_burst_naDebuff', unitId: caster.id,
            normalAttackDamagePct: -0.40, endTick: end9 });

          // Effect 2: 装填 p01% 弹匣（随后被 S2 清空，净效果为 0；保留以符合游戏逻辑）
          const reloadPct = getSkillValue(caster.rawBurst, 0, bLv) / 100;
          caster.ammoLeft = Math.min(caster.maxAmmo,
            caster.ammoLeft + Math.floor(caster.maxAmmo * reloadPct));

          // ── S2 Part2（使用 Annihilation 时同时激活）──
          // Effect 2（S2）: 清空弹药 → 触发装填
          caster.ammoLeft  = 0;
          caster.reloadTick = 0;

          // Effect 4（S2）: 装填速度 ↑p08%（约 5s，覆盖本次装填周期）
          const reloadSpeedPct = getSkillValue(caster.rawSkill2, 7, s2Lv) / 100;
          pushBuff(state, { name: 'asuka_w_s2_reloadSpd', unitId: caster.id,
            reloadSpeedPct, endTick: state.tick + TICK_RATE * 5 });

          // [TODO] Effect 3（S2）: HP 回复 p06% MaxHP/s × 3s（引擎暂不支持技能触发 HoT）

          // ── Annihilation（消耗 Anti A.T. Field 叠层）──
          const p07    = getSkillValue(caster.rawSkill1, 6, caster.skillLevels[0]) / 100;
          const stacks = consumeAtfStacks(state, caster, p07);
          if (stacks > 0) {
            const annMult = getSkillValue(caster.rawBurst, 5, bLv) / 100;
            const sums    = getBuffSums(state, caster.id);
            fireSkillHit(state, caster, annMult * stacks, sums, false,
              'asuka_w_burst_annihilation', { burstSkillDamage: true });
          }
        },
      },
    ],
  },
};
