import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Asuka: WILLE  (resource_id: 835)

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
          fireSkillHit(state, caster, dmgPct, sums, 'S1 P1');
        },
      },
      // S1 Part2（Annihilation State 期间）：每 10 发 → 技能伤害 p06% + Anti A.T. Field +1 叠（上限 30，30s）
      // 单 Boss 场景下 2 目标等效为 1 次命中
      {
        on: 'SHOT_COUNT',
        opts: { every: 10, counterKey: 'asukaW_s1P2Count' },
        handler(state, caster) {
          const annActive = state.buffs.some(b =>
            b.name === 'Annihilation State' && b.unitId === caster.id && b.endTick > state.tick);
          if (!annActive) return;
          const s1Lv = caster.skillLevels[0];
          const sums = getBuffSums(state, caster.id);
          const p06  = getSkillValue(caster.rawSkill1, 5, s1Lv) / 100;
          const p07  = getSkillValue(caster.rawSkill1, 6, s1Lv) / 100;
          fireSkillHit(state, caster, p06, sums, 'S1 P2');
          pushBuff(state, { name: 'Anti A.T. Field', unitId: ENEMY_UNIT_ID,
            enemyDamageTakenPct: p07, stackLimit: 30,
            endTick: state.tick + TICK_RATE * 30 });
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
        handler(state, caster) {
          const annActive = state.buffs.some(b =>
            b.name === 'Annihilation State' && b.unitId === caster.id && b.endTick > state.tick);
          if (!annActive) return false;
          const atkDmgPct = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Emergency Repair', unitId: caster.id,
            attackDamagePct: atkDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // 固定换弹速度清除：本次装填完成后 fixedReloadSpeedPct 失效
      {
        on: 'RELOAD_END',
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
        handler(state, caster) {
          const bLv  = caster.skillLevels[2];
          const end9 = state.tick + TICK_RATE * 9;

          caster.skillState.annihilationFired = false;

          // Effect 1: Normal Attack Damage Multiplier ▼40%（9s，负 buff）
          // TODO(实测) "Normal Attack Damage Multiplier" 暂按 normalAttackDamagePct（ExtraMultiplier 加法）建模；
          //   参考 Charge Damage Multiplier 与珍藏品同乘区的实测结论，可能应与珍藏品普攻倍率同乘区，待游戏内数据验证
          // Effect 3: ATK ▲p02%（9s）
          const atkPct = getSkillValue(caster.rawBurst, 1, bLv) / 100;
          // Effect 4: Attack Damage ▲p04%（9s）
          const atkDmgPct = getSkillValue(caster.rawBurst, 3, bLv) / 100;
          // Annihilation State 哨兵 buff（S1 P2 / S2 P1 / Rei S1 P3 凭此判断是否有效）
          pushBuff(state, { name: 'Annihilation State', unitId: caster.id,
            normalAttackDamagePct: -0.40, atkPct: atkPct, attackDamagePct: atkDmgPct, endTick: end9 });

          // Effect 2: 装填 p01% 弹匣
          const reloadPct = getSkillValue(caster.rawBurst, 0, bLv) / 100;
          caster.ammoLeft = Math.min(caster.maxAmmo,
            caster.ammoLeft + Math.floor(caster.maxAmmo * reloadPct));
        },
      },

      // Annihilation State buff 到期 → 发动 Annihilation（含 S2 Part2）
      {
        on: 'BUFF_EXPIRE',
        handler(state, caster, ctx) {
          if (ctx.buffName !== 'Annihilation State' || ctx.buffUnitId !== caster.id) return false;
          if (caster.skillState.annihilationFired) return false;
          
          // ─── Annihilation 发动（Annihilation State buff 到期时触发）────────────────────
          // ■ 对 Anti A.T. Field 目标造成叠层伤害并移除 Anti A.T. Field buff
          // ■ S2 Part2 同时激活：MG 过热速度↓100% 3s、清空弹药、HP 回复、换弹速度↑60%
          
          caster.skillState.annihilationFired = true;

          // ATF 叠层伤害（【已实测】非默认：Annihilation 在 Annihilation State 结束时（≈9s 后）发动，
          //   S1 P1 的 ATK▲ 和 Attack Damage▲ buff 与 Annihilation State buff 同时失效，
          //   sums 在发动时重算（不含已过期的 Annihilation State buff），
          //   先造成伤害，再清空Anti A.T. Field
          //   若仍处于全爆裂期间则享受全爆裂+50%补正）
          const atfBuff = state.buffs.find(b =>
            b.name === 'Anti A.T. Field' && b.unitId === ENEMY_UNIT_ID && b.endTick > state.tick);
          const stacks = atfBuff?.stacks ?? 0;
          if (stacks > 0) {
            const annMult = getSkillValue(caster.rawBurst, 5, caster.skillLevels[2]) / 100;
            const sums    = getBuffSums(state, caster.id);
            fireSkillHit(state, caster, annMult * stacks, sums, 'Burst P2');
            state.buffs = state.buffs.filter(b =>
              !(b.name === 'Anti A.T. Field' && b.unitId === ENEMY_UNIT_ID));
          }

          // ── S2 Part2 ──
          const s2Lv = caster.skillLevels[1];

          // MG 过热速度 ▼100% for 3s：通过 buff 归零逐发增速
          if (caster.mgRofChangePerShot != null) {
            pushBuff(state, { name: 'MG Heat Reduction', unitId: caster.id,
              mgHeatSpeedPct: -1, endTick: state.tick + TICK_RATE * 3 }, {
                unitName: caster.name,
                skillLabel: caster.rawSkill2?.name_localkey ?? 'S2',
                slot: null,
                partIdx: 1,
                lineIdx: 3,
                trigger: state._logCtx?.trigger ?? 'BUFF_EXPIRE',
              });
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
        },
      },

    ],
  },
};
