import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Seven Dwarves V+VI
  // ■ Activates every 0.2 sec while charging. Affects enemy nearest crosshair (not in Lock-On status).
  //   Lock-On: Designates enemy as Seven Dwarves target. Max Lock-On targets: {p03=5}.
  //   Removal condition: Performing a normal attack or taking cover.
  // ■ Activates every 0.2 sec while charging. Affects self.
  //   Auto Fire Ready: Loads Seven Dwarves with ammo. DEF ▲ {p04}% continuously.
  //   Max ammo loaded by Auto Fire Ready: {p05=5}. Removal condition: Performing a normal attack.
  // ■ Activates every 0.2 sec while charging. Affects all enemies in Lock-On status.
  //   Damage Taken ▲ {p02}% for {p08=4} sec.
  // ■ Activates when attacking with Full Charge.
  //   Auto Fire Effect 1: Deals {p06}% of final ATK as damage. Affects all enemies.
  //   Auto Fire Effect 2: Deals {p07}% of final ATK as damage. Affects Lock-On targets sequentially,
  //   based on ammo loaded by Auto Fire Ready.
  // ■ Activates when attacking with Full Charge while in Seven Dwarves Fully Active status.
  //   Number of uses of Seven Dwarves Fully Active ▼ 1.
  // ■ Activates when performing a normal attack while not in Full Burst. Affects self.
  //   Removes Seven Dwarves Fully Active.
  //
  // group_id: 24711
  // p01: [0.2, ...] (interval sec, const)
  // p02: [2.48, 2.66, 2.84, 3.02, 3.2, 3.38, 3.56, 3.74, 3.92, 4.2] (Damage Taken%)
  // p03: [5, ...] (max Lock-On targets, const)
  // p04: [24.96, 26.8, 28.62, 30.46, 32.28, 34.1, 35.94, 37.76, 39.6, 42.24] (DEF%, defensive skip)
  // p05: [5, ...] (max ammo, const)
  // p06: [24.76, 26.58, 28.4, 30.22, 32.04, 33.86, 35.68, 37.5, 39.32, 41.9] (Auto Fire AoE%)
  // p07: [62.39, 66.95, 71.51, 76.07, 80.63, 85.19, 89.75, 94.31, 98.87, 105.59] (Auto Fire seq% per shot)
  // p08: [4, ...] (Damage Taken duration, const)
  //
  // 简化说明：
  // - "每 0.2s 激活" 效果在蓄力时持续触发：
  //   正常蓄力 1.2s / 0.2s = 6 次 → 弹药上限 5 发（始终满弹）。
  //   FA 蓄力 3.2s / 0.2s = 16 次 → 上限 15 发（始终满弹）。
  // - 单体 Boss 场景下 Lock-On 目标始终存在，Damage Taken 实质持续，以 BATTLE_START 永久施加建模。
  // - Auto Fire Effect 1 (AoE) 为全蓄力命中，isCharged=true 享受蓄力伤害加成。
  // - Auto Fire Effect 2 (sequential) 为七矮人顺序弹，isCharged=false 处理。
  skill1: {
    groupId: 24711,
    triggers: [
      // 战斗开始：Damage Taken ▲ p02% 永久施加（单体 Boss 下锁定目标始终存在）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const p02 = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100;
          state.enemyDamageTakenPct += p02;
        },
      },

      // 全蓄力：Auto Fire（AoE + 顺序攻击）
      // 同帧先推送 S2 增益（Damage to Parts / ATK），确保 Auto Fire 命中时已生效。
      // FA 激活时额外推送 Charge Damage ▲（endTick+1 使其仅对本帧 isCharged=true 的 AoE 有效）。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const s1Lv    = caster.skillLevels[0];
          const s2Lv    = caster.skillLevels[1];
          const faActive = (caster.skillState.swhaFaUses ?? 0) > 0;

          // ── S2 全蓄力增益（同帧推送保证 Auto Fire 受益）
          // 蓄力周期（1.2s）< buff 持续时长（5s）：若不防重叠，会累积多层。
          // 仅在上一次 buff 过期后才重新 push；未过期时旧 buff 仍处于计算中，无需重复。
          const now   = state.tick;
          const p11s2 = getSkillValue(caster.rawSkill2, 10, s2Lv) / 100;  // Damage to Parts ▲
          const p03s2 = getSkillValue(caster.rawSkill2, 2,  s2Lv) / 100;  // ATK ▲
          const end5  = now + TICK_RATE * 5;
          if (now >= (caster.skillState.swhaS2PartsDmgEndTick ?? 0)) {
            pushBuff(state, { name: 'swha_s2_partsDmg', unitId: caster.id,
              attackDamagePct: p11s2, endTick: end5 });
            caster.skillState.swhaS2PartsDmgEndTick = end5;
          }
          if (now >= (caster.skillState.swhaS2AtkEndTick ?? 0)) {
            pushBuff(state, { name: 'swha_s2_atk', unitId: caster.id,
              atkPct: p03s2, endTick: end5 });
            caster.skillState.swhaS2AtkEndTick = end5;
          }

          // FA 时：Charge Damage ▲ p07_s2%（下一 tick 过期，仅影响本帧 isCharged=true 的 AoE 命中）
          if (faActive) {
            const chargeDmg = getSkillValue(caster.rawSkill2, 6, s2Lv) / 100;
            pushBuff(state, { name: 'swha_s2_fa_chargeDmg', unitId: caster.id,
              chargeDamagePct: chargeDmg, endTick: state.tick + 1 });
          }

          const sums = getBuffSums(state, caster.id);

          // Auto Fire Effect 1：p06% 对全体（isCharged=true，受 chargeDamagePct FA 加成）
          const p06 = getSkillValue(caster.rawSkill1, 5, s1Lv) / 100;
          fireSkillHit(state, caster, p06, sums, true, 'swha_s1_autofire_aoe');

          // Auto Fire Effect 2：p07% × ammo 顺序攻击（isCharged=false，chargeDmgStat 不参与）
          const p07    = getSkillValue(caster.rawSkill1, 6, s1Lv) / 100;
          const ammo   = faActive ? 15 : 5;
          const seqMult = faActive
            ? p07 * (1 + getSkillValue(caster.rawSkill2, 8, s2Lv) / 100)  // p09_s2: sequential dmg ▲
            : p07;
          for (let i = 0; i < ammo; i++) {
            fireSkillHit(state, caster, seqMult, sums, false, 'swha_s1_autofire_seq');
          }

          // FA 使用次数递减；耗尽时恢复 S2 固定蓄力时长 1.2s
          if (faActive) {
            caster.skillState.swhaFaUses--;
            if (caster.skillState.swhaFaUses <= 0) {
              caster.skillState.swhaFaUses = 0;
              caster.chargeTimeTicks       = Math.round(1.2 * TICK_RATE);
            }
          }
        },
      },
    ],
  },

  // ── Shades of White
  // ■ Activates at the start of battle. Affects self.
  //   Fixes charge time at {p01=1.2} sec continuously.
  // ■ Activates during Full Charge. Affects self.
  //   Gains Pierce for {p02=5} sec.
  //   ATK ▲ {p03}% for {p04=5} sec.
  //   Damage to Parts ▲ {p11}% for {p04=5} sec.
  // ■ Activates when entering Burst Stage 3. Affects self.
  //   ATK ▲ {p05}% for {p06=10} sec.
  // ■ Activates when at Full Charge only while in Seven Dwarves Fully Active status. Affects self.
  //   Charge Damage ▲ {p07}% for {p08=1} round(s).
  //   Sequential attack damage ▲ {p09}% for {p10=1} round(s).
  //
  // group_id: 24712
  // p01: [1.2, ...] (fix charge time, const)
  // p02: [5, ...] (Pierce duration, const)
  // p03: [27.68, 29.71, 31.73, 33.76, 35.78, 37.81, 39.83, 41.86, 43.88, 46.84] (ATK%)
  // p04: [5, ...] (ATK buff duration, const)
  // p05: [43.68, 46.9, 50.12, 53.34, 56.56, 59.78, 63.0, 66.22, 69.44, 73.92] (B3 ATK%)
  // p06: [10, ...] (B3 ATK duration, const)
  // p07: [312, 334.4, 356.8, 379.2, 401.6, 424.0, 446.4, 468.8, 491.2, 528] (Charge Damage% FA)
  // p08: [1, ...] (round, const)
  // p09: [93.6, 100.32, 107.04, 113.76, 120.48, 127.2, 133.92, 140.64, 147.36, 158.4] (sequential dmg% FA)
  // p10: [1, ...] (round, const)
  // p11: [37.01, 39.74, 42.46, 45.19, 47.91, 50.64, 53.36, 56.09, 58.81, 62.64] (Damage to Parts%)
  //
  // 注：Full Charge 时的 ATK / Damage to Parts / FA Charge Damage 增益由 S1 FULL_CHARGE handler 推送，
  //   保证与 Auto Fire 同帧生效。Pierce 在单体 Boss 场景下不增加 DPS，仅注释说明。
  skill2: {
    groupId: 24712,
    triggers: [
      // 战斗开始：固定蓄力时长为 1.2s（直接覆盖 unit.chargeTimeTicks）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          caster.chargeTimeTicks = Math.round(1.2 * TICK_RATE);
        },
      },

      // 进入爆裂阶段 3：ATK ▲ p05% (10s)
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const p05   = getSkillValue(caster.rawSkill2, 4, caster.skillLevels[1]) / 100;
          const end10 = state.tick + TICK_RATE * 10;
          pushBuff(state, { name: 'swha_s2_b3_atk', unitId: caster.id,
            atkPct: p05, endTick: end10 });
        },
      },
    ],
  },

  // ── Seven Dwarves Fully Active
  // ■ Affects self.
  //   Attack damage ▲ {p03}% for {p04=10} sec.
  //   Seven Dwarves Fully Active status:
  //     Effect 1: Fixes charge time at {p01=3.2} sec continuously.
  //     Effect 2: Max Lock-On targets ▲ {p02=10} continuously. (合计 5+10=15)
  //     Effect 3: Max ammo loaded by Auto Fire Ready ▲ {p02=10} continuously. (合计 5+10=15)
  //     Number of uses: {p05=2}. Removal condition: uses reach 0.
  // ■ Affects all destructible projectiles. Deals {p06}% of final ATK as damage.
  //   （可摧毁弹体伤害：单体 Boss 场景不建模）
  //
  // group_id: 14713
  // p01: [3.2, ...] (FA charge time, const)
  // p02: [10, ...] (Lock-On / ammo increase, const)
  // p03: [49.92, 53.58, 57.24, 60.9, 64.56, 68.22, 71.88, 75.54, 79.2, 84.48] (ATK%)
  // p04: [10, ...] (ATK duration, const)
  // p05: [2, ...] (FA uses, const)
  // p06: [24.76, ..., 41.9] (destructible projectile dmg%, 不建模)
  burst: {
    groupId: 14713,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const bLv   = caster.skillLevels[2];
          const end10 = state.tick + TICK_RATE * 10;

          // Attack Damage ▲ p03% (10s)
          const atkDmgPct = getSkillValue(caster.rawBurst, 2, bLv) / 100;
          pushBuff(state, { name: 'swha_burst_atkDmg', unitId: caster.id,
            attackDamagePct: atkDmgPct, endTick: end10 });

          // Seven Dwarves Fully Active：2 次使用；蓄力时长切换至 3.2s；弹药上限升至 15（S1 handler 直接读取）
          caster.skillState.swhaFaUses = 2;
          caster.chargeTimeTicks       = Math.round(3.2 * TICK_RATE);
        },
      },
    ],
  },
};
