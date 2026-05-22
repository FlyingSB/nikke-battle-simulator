import { pushBuff, fireSkillHit, applyHeal, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// S1 Part2/3 公共逻辑：根据队伍 B1 构成决定 Star 状态并施加相应效果
function applyStarEffect(state, caster) {
  const lv         = caster.skillLevels[0];
  const hasOtherB1 = state.squad.some(
    u => u.id !== caster.id && u.burstStep === 'Step1' && u.canBurst !== false,
  );
  caster.skillState.astarStarMode = hasOtherB1 ? 'everyone' : 'own';

  if (!hasOtherB1) {
    // My Own Star：自身 ATK% 永久加成（continuous，pushBuff 自动刷新 endTick）
    const atkPct = getSkillValue(caster.rawSkill1, 1, lv) / 100;
    pushBuff(state, { name: 'astar_s1_myOwnStarAtk', unitId: caster.id,
      atkPct, endTick: Infinity });
    // 全员爆裂冷却缩减（直接减少 burstSkillCooldownEndTick，不低于当前 tick）
    const cdReduceTicks = Math.round(getSkillValue(caster.rawSkill1, 2, lv) * TICK_RATE);
    for (const u of state.squad) {
      u.burstSkillCooldownEndTick = Math.max(state.tick, u.burstSkillCooldownEndTick - cdReduceTicks);
    }
  }
  // Everyone's Star：爆裂重入阶段 1（changeBurstStep 应在此处设置，当前仅记录状态供其他技能读取）
}

export default {

  // ── Starfall
  // ■ Activates at the start of battle only if self is alive. Affects all allies.
  //   Burst Gauge filling speed ▲ {p05}% continuously.
  // ■ Activates at the start of battle and when Full Burst ends.
  //   Effect differs according to squad formation. Only the corresponding effect is applied.
  //   If there are no other Burst 1 allies (My Own Star):
  //     Affects self. ATK ▲ {p02}%. This effect is continuous and cannot be removed.
  //     Affects all allies. Cooldown of Burst Skill ▼ {p03} sec.
  //   If there are any other Burst 1 allies (Everyone's Star):
  //     Affects self. Re-enters Burst and changes to Stage 1 (continuous).
  //     [TODO: changeBurstStep 切换逻辑待 battle.js 实现阶段推进后接入]
  // ■ Activates when hitting a target with Full Charge. Affects the target.
  //   Deals {p04}% of final ATK as additional damage.
  //
  // group_id: 20171
  // p01 (index 0): burst stage (const 1，未使用)
  // p02 (index 1): My Own Star ATK%: [23.64, 25.46, 27.28, 29.09, 30.91, 32.73, 34.55, 36.37, 38.19, 40.01]
  // p03 (index 2): 爆裂冷却缩减 sec: [5.34, 5.58, 5.82, 6.05, 6.29, 6.53, 6.77, 7, 7.24, 7.48]
  // p04 (index 3): 满蓄力附加伤害%: [71, 76.46, 81.92, 87.38, 92.84, 98.3, 103.76, 109.22, 114.68, 120.13]
  // p05 (index 4): Burst Gauge 充能速度%: [3.54, 3.81, 4.09, 4.36, 4.63, 4.91, 5.18, 5.45, 5.72, 6]
  skill1: {
    groupId: 20171,
    triggers: [
      // Part1：战斗开始 → 全员 Burst Gauge 充能速度永久加成
      // burstGaugeFlat = burstEnergyPerShot × p05%，与基础充能叠加
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const lv       = caster.skillLevels[0];
          const speedPct = getSkillValue(caster.rawSkill1, 4, lv) / 100;
          for (const u of state.squad) {
            pushBuff(state, { name: 'astar_s1_burstGaugeFlat', unitId: u.id,
              burstGaugeFlat: Math.round(u.burstEnergyPerShot * speedPct), endTick: Infinity });
          }
        },
      },

      // Part2+3：战斗开始 → 确定 Star 状态，施加相应效果
      {
        on: 'BATTLE_START',
        handler: applyStarEffect,
      },

      // Part2+3：全爆裂结束 → 重新施加 Star 效果
      {
        on: 'FULL_BURST_END',
        handler: applyStarEffect,
      },

      // Part4：满蓄力命中 → 对目标造成附加伤害（普通技能伤害，非 sustained）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv   = caster.skillLevels[0];
          const pct  = getSkillValue(caster.rawSkill1, 3, lv) / 100;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, pct, sums, false, 'S1');
        },
      },
    ],
  },

  // ── Stardust
  // ■ Activates when entering Full Burst while in My Own Star status. Affects all allies.
  //   ATK ▲ {p01}% of caster's ATK for {p02=10} sec.
  // ■ Activates when performing a Full Charge attack while in Everyone's Star status. Affects all allies.
  //   Restores {p03}% of the caster's final max HP as HP.
  // ■ Activates when entering Full Burst. Affects self and all allies with lower final DEF than self.
  //   Projectile Explosion Damage ▲ {p04}% for {p05=10} sec.
  // ■ Activates when entering Full Burst. Affects all allies.
  //   Attack Damage ▲ {p06}% for {p07=10} sec.
  //
  // group_id: 20172
  // p01 (index 0): My Own Star ATK% of caster: [20.68, 22.28, 23.87, 25.46, 27.05, 28.64, 30.23, 31.82, 33.42, 35.01]
  // p02 (index 1): 持续时间 (const 10)
  // p03 (index 2): Everyone's Star HP 回复% per FC: [0.74, 0.8, 0.85, 0.91, 0.97, 1.03, 1.08, 1.14, 1.2, 1.26]
  // p04 (index 3): Projectile Explosion Damage%: [54.38, 58.56, 62.74, 66.93, 71.11, 75.29, 79.48, 83.66, 87.84, 92.03]
  // p05 (index 4): 持续时间 (const 10)
  // p06 (index 5): Attack Damage%: [20.09, 21.63, 23.18, 24.79, 26.27, 27.89, 29.36, 30.91, 32.45, 34]
  // p07 (index 6): 持续时间 (const 10)
  skill2: {
    groupId: 20172,
    triggers: [
      // Part1：进入全爆裂且处于 My Own Star → 全员 ATK flat 加成（p01% of caster ATK，10 sec）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          if (caster.skillState.astarStarMode !== 'own') return;
          const lv      = caster.skillLevels[1];
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(caster.rawSkill2, 0, lv) / 100);
          pushBuff(state, { name: 'astar_s2_myOwnStarAtkFlat', unitId: null,
            atkFlat, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // Part2：满蓄力命中时，处于 Everyone's Star → 以施放者最终 MaxHP × p03% 治疗全员
      // 治疗会触发 HEAL_RECEIVED（battle.js 在 onShotFired 后调用 flushHealReceived）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (caster.skillState.astarStarMode !== 'everyone') return;
          const lv      = caster.skillLevels[1];
          const healPct = getSkillValue(caster.rawSkill2, 2, lv) / 100;
          const sums    = getBuffSums(state, caster.id);
          const maxHp   = caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
          const amt     = Math.round(maxHp * healPct);
          for (const u of state.squad) applyHeal(state, u, amt);
        },
      },

      // Part3：进入全爆裂 → 自身及最终 DEF 低于自身的友军 Projectile Explosion Damage ▲（10 sec）
      // 最终 DEF 包含 defFlat + defPct 加成（如自身爆裂技能施加的 DEF buff）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv            = caster.skillLevels[1];
          const projExpDmgPct = getSkillValue(caster.rawSkill2, 3, lv) / 100;
          const endTick       = state.tick + TICK_RATE * 10;
          const casterSums    = getBuffSums(state, caster.id);
          const casterEffDef  = caster.stats.def * (1 + casterSums.defPct) + casterSums.defFlat;
          for (const u of state.squad) {
            const uSums   = getBuffSums(state, u.id);
            const uEffDef = u.stats.def * (1 + uSums.defPct) + uSums.defFlat;
            if (u.id !== caster.id && uEffDef >= casterEffDef) continue;
            pushBuff(state, { name: `astar_s2_projExpDmg_${u.id}`, unitId: u.id,
              projectileExplosionDamagePct: projExpDmgPct, endTick });
          }
        },
      },

      // Part4：进入全爆裂 → 全员 Attack Damage ▲（10 sec）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv           = caster.skillLevels[1];
          const attackDmgPct = getSkillValue(caster.rawSkill2, 5, lv) / 100;
          pushBuff(state, { name: 'astar_s2_attackDmg', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },

  // ── Star Anis
  // ■ Affects self.
  //   Shooting Stars: Attacks random targets automatically.
  //   Damage: {p01}% of final ATK. Attack Interval: 0.25 sec. Duration: {p02=10} sec.
  //   Additional Effects (duration {p02} sec):
  //     Charge time is fixed at {p10=0.7} sec（不受技能类蓄力速度 buff 影响，仅受魔方/装备影响）.
  //     Explosion Radius ▲ {p03}%.                [TODO: 爆炸半径不影响伤害输出，未建模]
  //     DEF ▲ {p05}%.
  // ■ Activates while in My Own Star status. Affects self.
  //   Attack Damage ▲ {p06}% for {p07=10} sec.
  // ■ Activates while in Everyone's Star status. Affects all allies.
  //   Max HP ▲ {p08}% of the caster's max HP for {p09=10} sec.
  //
  // group_id: 10173
  // p01 (index 0): Shooting Stars 每次命中%: [23.64, 25.46, 27.28, 29.1, 30.91, 32.73, 34.55, 36.37, 38.19, 40.01]
  // p02 (index 1): 持续时间 (const 10)
  // p03 (index 2): Explosion Radius%: [59.09, 63.63, 68.18, 72.73, 77.27, 81.82, 86.36, 90.91, 95.45, 100]  [未建模]
  // p04 (index 3): 空
  // p05 (index 4): DEF%: [32.44, 34.95, 37.46, 39.96, 42.47, 44.98, 47.49, 49.99, 52.5, 55.01]
  // p06 (index 5): My Own Star Attack Damage%: [20.8, 22.4, 24, 25.6, 27.2, 28.8, 30.4, 32, 33.6, 35.2]
  // p07 (index 6): 持续时间 (const 10)
  // p08 (index 7): Everyone's Star Max HP%: [8.87, 9.56, 10.24, 10.92, 11.6, 12.29, 12.97, 13.65, 14.34, 15.02]
  // p09 (index 8): 持续时间 (const 10)
  // p10 (index 9): 固定蓄力时间 sec (const 0.7)
  burst: {
    groupId: 10173,
    triggers: [
      // Part1：Shooting Stars — 0.25 sec 间隔普通技能伤害 DoT（持续 10 sec，非 sustained damage）
      // 同时设置固定蓄力时间（0.7 sec，仅受装备/魔方蓄力速度影响，屏蔽技能类 buff）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv      = caster.skillLevels[2];
          const mult    = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const endTick = state.tick + TICK_RATE * 10;
          state.dots.push({
            casterId:        caster.id,
            label:           'Burst',
            dotName:         'astar_burst_shootingStars',
            multPerStack:    mult,
            stacks:          1,
            endTick,
            nextFireTick:    state.tick + Math.round(TICK_RATE / 4),
            intervalTicks:   Math.round(TICK_RATE / 4),
            sustainedDamage: false,
          });
          // 固定蓄力时间：0.7 sec × (1 - 装备/魔方 chargeSpeedPct)
          // battle.js 读取 skillState.fixedChargeEndTick / fixedChargeTimeTicks 覆盖蓄力时长
          caster.skillState.fixedChargeTimeTicks = Math.round(0.7 * TICK_RATE);
          caster.skillState.fixedChargeEndTick   = endTick;
        },
      },

      // Part1 附加：DEF ▲ p05% 自身（持续 10 sec）
      // 会影响同轮内 S2 Part3 的 DEF 比较（S2 ENTER_FULL_BURST 在 B1 burst 后才触发）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv     = caster.skillLevels[2];
          const defPct = getSkillValue(caster.rawBurst, 4, lv) / 100;
          pushBuff(state, { name: 'astar_burst_defPct', unitId: caster.id,
            defPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // Part2：My Own Star 状态 → 自身 Attack Damage ▲（10 sec）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (caster.skillState.astarStarMode !== 'own') return;
          const lv           = caster.skillLevels[2];
          const attackDmgPct = getSkillValue(caster.rawBurst, 5, lv) / 100;
          pushBuff(state, { name: 'astar_burst_myOwnStarAttackDmg', unitId: caster.id,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // Part3：Everyone's Star 状态 → 全员 Max HP ▲ p08% of caster max HP（flat，10 sec）
      // 影响 Cinderella 等以 Max HP 换算攻击力的角色（通过 maxHpFlat buff 传递）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (caster.skillState.astarStarMode !== 'everyone') return;
          const lv        = caster.skillLevels[2];
          const maxHpPct  = getSkillValue(caster.rawBurst, 7, lv) / 100;
          const maxHpFlat = Math.round(caster.stats.hp * maxHpPct);
          pushBuff(state, { name: 'astar_burst_everyoneMaxHp', unitId: null,
            maxHpFlat, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },
};
