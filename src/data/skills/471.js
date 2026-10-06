import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Snow White: Heavy Arms  (resource_id: 471)
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
  // p04: [24.96, 26.8, 28.62, 30.46, 32.28, 34.1, 35.94, 37.76, 39.6, 42.24] (DEF%)
  // p05: [5, ...] (max ammo, const)
  // p06: [24.76, 26.58, 28.4, 30.22, 32.04, 33.86, 35.68, 37.5, 39.32, 41.9] (Auto Fire AoE%)
  // p07: [62.39, 66.95, 71.51, 76.07, 80.63, 85.19, 89.75, 94.31, 98.87, 105.59] (Auto Fire seq% per shot)
  // p08: [4, ...] (Damage Taken duration, const)
  //
  // 简化说明：
  // - "每 0.2s 激活" 效果在蓄力时持续触发：
  //   正常蓄力 1.2s / 0.2s = 6 次 → 弹药上限 5 发（始终满弹）。
  //   FA 蓄力 3.2s / 0.2s = 16 次 → 上限 15 发（始终满弹）。
  // - Auto Fire Ready DEF ▲ p04%：蓄力期间持续，普攻时清除；模拟中不执行普攻，以 BATTLE_START 永久施加建模。
  // - 单体 Boss 场景下 Lock-On 目标始终存在，Damage Taken 实质持续，以 BATTLE_START 永久施加建模。
  skill1: {
    groupId: 24711,
    triggers: [
      // tdefIdx=0：■段0(Lock-On，每0.2s interval)未建模，占位
      {},
      // 战斗开始：Auto Fire Ready DEF ▲ p04%（蓄力期间持续刷新；近乎全程覆盖）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const p04 = getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'Auto Fire Ready', unitId: caster.id,
            defPct: p04, endTick: Infinity });
        },
      },
      // 战斗开始：Damage Taken ▲ p02% 永久施加（单体 Boss 下锁定目标始终存在）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const p02 = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'Seven Dwarves V+VI', unitId: '__enemy__', isDebuff: true,
            enemyDamageTakenPct: p02, endTick: Infinity });
        },
      },

      // 全蓄力：Auto Fire（AoE + 顺序攻击）
      // S2 P2/P4 的增益由各自 DURING_FULL_CHARGE 触发器在本 tick 更早推入，getBuffSums 可直接读到。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const s1Lv    = caster.skillLevels[0];
          const faActive = (caster.skillState.swhaFaUses ?? 0) > 0;
          const sums    = getBuffSums(state, caster.id);

          // Auto Fire Effect 1：p06% 对全体
          const p06 = getSkillValue(caster.rawSkill1, 5, s1Lv) / 100;
          fireSkillHit(state, caster, p06, sums, 'S1 P4 Auto Fire (All)', {
            burstEnergy: caster.targetBurstEnergyPerShot, burstEnergySource: 'swha_s1_aoe' });

          // Auto Fire Effect 2：p07% × ammo 顺序攻击（isCharged=false）
          // FA 时 S2 P4 推入 sequentialAttackDamagePct，经 sums 自动参与计算
          const p07     = getSkillValue(caster.rawSkill1, 6, s1Lv) / 100;
          const ammo    = faActive ? 15 : 5;
          const seqMult = p07 * (1 + (sums.sequentialAttackDamagePct ?? 0));
          for (let i = 0; i < ammo; i++) {
            fireSkillHit(state, caster, seqMult, sums, 'S1 P4 Auto Fire (Sequential)', {
              burstEnergy: caster.targetBurstEnergyPerShot, burstEnergySource: 'swha_s1_seq' });
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
  // 注：P2 DURING_FULL_CHARGE 触发器在 getBuffSums 之前执行，Pierce / ATK / Damage to Parts 对 Auto Fire 同帧有效。
  //     P4 同理。Pierce 通过 swha_s2_pierce buff（pierce:true）建模，由 getBuffSums 汇总为 sums.pierce。
  skill2: {
    groupId: 24712,
    triggers: [
      // P1：战斗开始：固定蓄力时长为 1.2s；永久免疫技能/buff 来源的蓄力速度变化
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          caster.chargeTimeTicks        = Math.round(1.2 * TICK_RATE);
          caster.immuneSkillChargeSpeed = true;
        },
      },

      // P2：全蓄力期间：Pierce (5s) + ATK ▲ p03% (5s) + Damage to Parts ▲ p11% (5s)
      {
        on: 'DURING_FULL_CHARGE',
        handler(state, caster) {
          const lv   = caster.skillLevels[1];
          const end5 = state.tick + TICK_RATE * 5;
          const p03  = getSkillValue(caster.rawSkill2, 2, lv) / 100;
          const p11  = getSkillValue(caster.rawSkill2, 10, lv) / 100;
          pushBuff(state, { name: 'Shades of White P2 (ATK)', unitId: caster.id, pierce: true, atkPct: p03, damageToPartsPct: p11, endTick: end5 });
        },
      },

      // P3：进入爆裂阶段 3：ATK ▲ p05% (10s)
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const p05   = getSkillValue(caster.rawSkill2, 4, caster.skillLevels[1]) / 100;
          const end10 = state.tick + TICK_RATE * 10;
          pushBuff(state, { name: 'Shades of White P3 (ATK)', unitId: caster.id,
            atkPct: p05, endTick: end10 });
        },
      },

      // P4：全蓄力期间（FA 状态下）：Charge Damage ▲ p07% + Sequential attack damage ▲ p09%（均 1 round）
      {
        on: 'DURING_FULL_CHARGE',
        handler(state, caster) {
          if ((caster.skillState.swhaFaUses ?? 0) <= 0) return;
          const lv = caster.skillLevels[1];
          const p07 = getSkillValue(caster.rawSkill2, 6, lv) / 100;
          const p09 = getSkillValue(caster.rawSkill2, 8, lv) / 100;
          pushBuff(state, { name: 'Shades of White (Charge Damage)', unitId: caster.id,
            chargeDamagePct: p07, endTick: state.tick + 1 });
          pushBuff(state, { name: 'Shades of White (Sequential Damage)', unitId: caster.id,
            sequentialAttackDamagePct: p09, endTick: state.tick + 1 });
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
          // 爆裂技能唯一的效果段（P2 为伤害）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Seven Dwarves Fully Active', unitId: caster.id,
            attackDamagePct: atkDmgPct, endTick: end10 }, { ...state._logCtx, partIdx: null });

          // Seven Dwarves Fully Active：2 次使用；蓄力时长切换至 3.2s；弹药上限升至 15（S1 handler 直接读取）
          caster.skillState.swhaFaUses = 2;
          caster.chargeTimeTicks       = Math.round(3.2 * TICK_RATE);
        },
      },
    ],
  },
};
