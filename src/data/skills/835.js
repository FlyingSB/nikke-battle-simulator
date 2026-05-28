import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// ─── Anti A.T. Field 叠层管理 ──────────────────────────────────────────────
// 叠层全批同时计时（每次新增叠层刷新到期时间）。
// 直接累加 enemyDamageTakenPct，移除时整批减去。
function applyAtfStack(state, caster, p07Pct) {
  const now = state.tick;
  // 若已过期，清零旧叠层对应的承伤加成
  if (now >= (caster.skillState.atfStackEndTick ?? 0) && caster.skillState.atfStacks > 0) {
    state.enemyDamageTakenPct -= caster.skillState.atfStacks * p07Pct;
    caster.skillState.atfStacks = 0;
  }
  if ((caster.skillState.atfStacks ?? 0) < 30) {
    caster.skillState.atfStacks = (caster.skillState.atfStacks ?? 0) + 1;
    state.enemyDamageTakenPct += p07Pct;
  }
  // 刷新整批 30s 到期时间
  caster.skillState.atfStackEndTick = now + TICK_RATE * 30;
}

function consumeAtfStacks(state, caster, p07Pct) {
  const stacks = caster.skillState.atfStacks ?? 0;
  if (stacks > 0) {
    state.enemyDamageTakenPct    -= stacks * p07Pct;
    caster.skillState.atfStacks   = 0;
    caster.skillState.atfStackEndTick = 0;
  }
  return stacks;
}

// ─── Annihilation 发动（Annihilation State 结束时触发）────────────────────
// ■ 对 Anti A.T. Field 目标造成叠层伤害并移除叠层
// ■ S2 Part2 同时激活：MG 过热速度↓100% 3s、清空弹药、HP 回复、换弹速度↑60%
function fireAnnihilation(state, caster) {
  caster.skillState.annihilationFired = true;

  // ATF 叠层伤害（【已实测】非默认：Annihilation 在 Annihilation State 结束时（≈9s 后）发动，
  //   S1 Part1 的 ATK▲ 和 Attack Damage▲ buff 与 annihilationStateEndTick 同时失效，
  //   sums 在发动时重算（不含已过期的 Annihilation State buff），
  //   若仍处于全爆裂期间则享受全爆裂+50%补正）
  const p07    = getSkillValue(caster.rawSkill1, 6, caster.skillLevels[0]) / 100;
  const stacks = consumeAtfStacks(state, caster, p07);
  if (stacks > 0) {
    const annMult = getSkillValue(caster.rawBurst, 5, caster.skillLevels[2]) / 100;
    const sums    = getBuffSums(state, caster.id);
    fireSkillHit(state, caster, annMult * stacks, sums, false, 'Burst');
  }

  // ── S2 Part2 ──
  const s2Lv = caster.skillLevels[1];

  // MG 过热速度 ▼100% for 3s：将逐发增速归零
  // current_rate_of_fire_change_pershot = base × (1 + increment - decrement) = 0（decrement=1）
  if (caster.mgRofChangePerShot != null) {
    caster.asukaW_mgHeatOrig    = caster.mgRofChangePerShot;
    caster.mgRofChangePerShot   = 0;
    caster.skillState.asukaW_mgHeatEndTick = state.tick + TICK_RATE * 3;
  }

  // 清空弹药（100%）→ 触发装填
  caster.ammoLeft  = 0;
  caster.reloadTick = 0;

  // 换弹速度固定 ↑p08%（仅本次装填生效，屏蔽其他换弹速度效果；由 skill2 RELOAD_END 清除）
  caster.skillState.fixedReloadSpeedPct = getSkillValue(caster.rawSkill2, 7, s2Lv) / 100;

  // HP 回复 p06% MaxHP/s × p07 秒（HoT）
  const hotPct    = getSkillValue(caster.rawSkill2, 5, s2Lv) / 100;
  const hotSecs   = getSkillValue(caster.rawSkill2, 6, s2Lv);  // p07 = 3
  const hotAmount = Math.round(caster.stats.hp * hotPct);
  for (let i = 1; i <= hotSecs; i++) {
    state.pendingHoTs.push({ fireTick: state.tick + i * TICK_RATE, targetId: caster.id, amount: hotAmount });
  }
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
          fireSkillHit(state, caster, dmgPct, sums, false, 'S1 P1');
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
          fireSkillHit(state, caster, p06, sums, false, 'S1 P2');
          applyAtfStack(state, caster, p07);
        },
      },
    ],
  },

  // ── Emergency Repair
  // ■ Activates when entering Full Burst while in Annihilation State status. Affects self.
  //   Attack Damage ▲ {p01}% for {p02} sec.
  // ■ Activates when using Annihilation (i.e. when Annihilation State ends). Affects self.
  //   Effect 1: MG heating up speed ▼ {p03}% for {p04} sec.
  //   Effect 2: Clears {p05}% of ammo.
  //   Effect 3: Constantly recovers {p06}% of final Max HP every 1 sec over {p07} sec.
  //   Effect 4: Reloading Speed is fixed at a {p08}% increase for {p09} round(s).
  //
  // group_id: 28352
  // p01 (lv10=30.97%)  p02: [10, ...]  p03: [100, ...]  p04: [3, ...]  p05: [100, ...]
  // p06 (lv10=3.77%)  p07: [3, ...]  p08: [60, ...]  p09: [1, ...]
  //
  // 注：S2 Part2 由 burst 的 INTERVAL handler 内 fireAnnihilation() 统一调用
  skill2: {
    groupId: 28352,
    triggers: [
      // S2 Part1：进入全爆裂时若处于 Annihilation State → Attack Damage ▲p01% 10s
      {
        on: 'ENTER_FULL_BURST',
        logTargets: 'SELF',
        handler(state, caster) {
          if (state.tick > (caster.skillState.annihilationStateEndTick ?? 0)) return false;
          const atkDmgPct = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'asuka_w_s2_p1_atkDmg', unitId: caster.id,
            attackDamagePct: atkDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // 固定换弹速度清除：本次装填完成后 fixedReloadSpeedPct 失效
      {
        on: 'RELOAD_END',
        logTargets: null,
        handler(state, caster, ctx) {
          if (ctx.unit.id !== caster.id) return;
          caster.skillState.fixedReloadSpeedPct = null;
        },
      },
    ],
  },

  // ── Annihilation State
  // ■ Affects self. Annihilation State（获得时立即生效，持续 9s）:
  //   Effect 1: Normal Attack Damage Multiplier ▼ {p07}% for {p08} sec.
  //   Effect 2: Reloads {p01}% magazine(s).
  //   Effect 3: ATK ▲ {p02}% of caster's ATK for {p03} sec.
  //   Effect 4: Attack Damage ▲ {p04}% for {p05} sec.
  // ■ Affects targets afflicted with Anti A.T. Field. Annihilation（9s 结束时发动）:
  //   Deals {p06}% of final ATK × stack count as damage. Removes Anti A.T. Field.
  //
  // group_id: 18353
  // p01 (lv10=21.0%)  p02 (lv10=46.8%)  p03: [9, ...]  p04 (lv10=36.0%)  p05: [9, ...]
  // p06 (lv10=6.62%)  p07: [40, ...]  p08: [9, ...]
  burst: {
    groupId: 18353,
    triggers: [
      // Annihilation State 激活（爆裂技能使用时）
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'SELF',
        handler(state, caster) {
          const bLv  = caster.skillLevels[2];
          const end9 = state.tick + TICK_RATE * 9;

          // S1 Part2 / S2 Part1 凭此判断 Annihilation State 是否有效
          caster.skillState.annihilationStateEndTick = end9;
          caster.skillState.annihilationFired        = false;

          // Effect 1: Normal Attack Damage Multiplier ▼40%（9s，负 buff）
          pushBuff(state, { name: 'asuka_w_burst_naDebuff', unitId: caster.id,
            normalAttackDamagePct: -0.40, endTick: end9 });

          // Effect 3: ATK ▲p02%（9s）
          const atkPct = getSkillValue(caster.rawBurst, 1, bLv) / 100;
          pushBuff(state, { name: 'asuka_w_burst_atk', unitId: caster.id,
            atkPct, endTick: end9 });

          // Effect 4: Attack Damage ▲p04%（9s）
          const atkDmgPct = getSkillValue(caster.rawBurst, 3, bLv) / 100;
          pushBuff(state, { name: 'asuka_w_burst_atkDmg', unitId: caster.id,
            attackDamagePct: atkDmgPct, endTick: end9 });

          // Effect 2: 装填 p01% 弹匣（Annihilation 发动时 S2 会清空弹药；净补弹量由时序决定）
          const reloadPct = getSkillValue(caster.rawBurst, 0, bLv) / 100;
          caster.ammoLeft = Math.min(caster.maxAmmo,
            caster.ammoLeft + Math.floor(caster.maxAmmo * reloadPct));
        },
      },

      // Annihilation 到期检查 + MG 过热恢复检查（每 1s 轮询）
      {
        on: 'INTERVAL',
        logTargets: null,
        opts: { seconds: 1 },
        handler(state, caster) {
          const asEnd     = caster.skillState.annihilationStateEndTick ?? 0;
          const mgHeatEnd = caster.skillState.asukaW_mgHeatEndTick ?? 0;
          const willFire  = (asEnd > 0 && state.tick >= asEnd && !caster.skillState.annihilationFired)
                         || (mgHeatEnd > 0 && state.tick >= mgHeatEnd);
          if (!willFire) return false;

          // Annihilation State 结束 → 发动 Annihilation（含 S2 Part2）
          if (asEnd > 0 && state.tick >= asEnd && !caster.skillState.annihilationFired) {
            fireAnnihilation(state, caster);
          }
          // MG 过热速度恢复（3s 后还原 mgRofChangePerShot）
          if (mgHeatEnd > 0 && state.tick >= mgHeatEnd) {
            if (caster.asukaW_mgHeatOrig != null) {
              caster.mgRofChangePerShot = caster.asukaW_mgHeatOrig;
              caster.asukaW_mgHeatOrig  = null;
            }
            caster.skillState.asukaW_mgHeatEndTick = 0;
          }
        },
      },
    ],
  },
};
