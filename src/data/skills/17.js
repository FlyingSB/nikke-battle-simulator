import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, rollProjectileCore, isEnemyHittable, TICK_RATE, ALL_ALLIES } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Anis: Star  (resource_id: 17)
const MY_OWN_STAR_BUFF = 'My Own Star';

// S1 Part2 公共逻辑：根据队伍 B1 构成决定 Star 状态并施加相应效果（两种状态互斥）
function applyStarEffect(state, caster) {
  const lv         = caster.skillLevels[0];
  const hasOtherB1 = state.squad.some(
    u => u.id !== caster.id && u.burstStep === 'Step1' && u.canBurst !== false,
  );
  caster.skillState.astarStarMode = hasOtherB1 ? 'everyone' : 'own';

  if (hasOtherB1) {
    // Everyone's Star：Effect 1 取消 My Own Star；Effect 2 爆裂施放后重入阶段 1
    // 引擎在 B1 施放后读取 changeBurstStep，'Step1' 时不推进到阶段 2，由其他 B1 继续施放
    state.buffs = state.buffs.filter(
      b => !(b.name === MY_OWN_STAR_BUFF && b.unitId === caster.id),
    );
    caster.changeBurstStep = 'Step1';
    return;
  }

  // My Own Star：Effect 1 取消 Everyone's Star（恢复原生阶段推进）
  caster.changeBurstStep = caster.nativeChangeBurstStep;
  // Effect 2：自身 ATK% 永久加成（continuous，pushBuff 自动刷新 endTick）
  const atkPct = getSkillValue(caster.rawSkill1, 1, lv) / 100;
  pushBuff(state, { name: MY_OWN_STAR_BUFF, unitId: caster.id,
    atkPct, endTick: Infinity });
  // Effect 3：全员爆裂冷却缩减（直接减少 burstCdRemaining，不低于 0）
  const cdReduceTicks = Math.round(getSkillValue(caster.rawSkill1, 2, lv) * TICK_RATE);
  for (const u of state.squad) {
    u.burstCdRemaining = Math.max(0, u.burstCdRemaining - cdReduceTicks);
  }
}

export default {

  // ── Starfall
  // ■ Activates at the start of battle only if self is alive. Affects all allies.
  //   Burst Gauge filling speed ▲ {p05}% continuously.
  // ■ Activates at the start of battle and when Full Burst ends.
  //   Effect differs according to squad formation. Only the corresponding effect is applied.
  //   If there are no other Burst {p01} allies:
  //   Effect 1: Affects self. Cancels Everyone's Star.
  //   Effect 2: Affects self. My Own Star: ATK ▲ {p02}%. This effect is continuous and cannot be removed.
  //   Effect 3: Affects all allies. Cooldown of Burst Skill ▼ {p03} sec.
  //   If there are any other Burst {p01} allies:
  //   Effect 1: Affects self. Cancels My Own Star.
  //   Effect 2: Affects self. Everyone's Star: Re-enters Burst and changes to Stage {p01}.
  //             This effect is continuous and cannot be removed.
  // ■ Activates when hitting a target with Full Charge. Affects the target.
  //   Deals {p04}% of final ATK as additional damage.
  //
  // 行号以 CDN 原文（上方逐行对应）为准：P2 的 My Own Star ATK 为 L5
  //
  // group_id: 20171
  // p01 (index 0): burst stage (const 1，未使用)
  // p02 (index 1): My Own Star ATK%: [23.64, 25.46, 27.28, 29.09, 30.91, 32.73, 34.55, 36.37, 38.19, 40.01]
  // p03 (index 2): 爆裂冷却缩减 sec: [5.34, 5.58, 5.82, 6.05, 6.29, 6.53, 6.77, 7, 7.24, 7.48]
  // p04 (index 3): 全蓄力附加伤害%: [71, 76.46, 81.92, 87.38, 92.84, 98.3, 103.76, 109.22, 114.68, 120.13]
  // p05 (index 4): Burst Gauge 充能速度%: [3.54, 3.81, 4.09, 4.36, 4.63, 4.91, 5.18, 5.45, 5.72, 6]
  skill1: {
    groupId: 20171,
    triggers: [
      // Part1：战斗开始 → 全员 Burst Gauge 充能速度永久加成
      // 「filling speed ▲ n%」= 施法者命中目标每发充能的 n%，对全员是同一个固定值 → 全队一条 buff
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const lv       = caster.skillLevels[0];
          const speedPct = getSkillValue(caster.rawSkill1, 4, lv) / 100;
          pushBuff(state, { name: 'Starfall (Burst Gauge)', unitId: null,
            burstGaugeFlat: Math.round(caster.targetBurstEnergyPerShot * speedPct), endTick: Infinity });
        },
      },

      // Part2：战斗开始 → 确定 Star 状态，施加相应效果
      {
        on: 'BATTLE_START',
        handler(state, caster) { applyStarEffect(state, caster); },
      },

      // Part2：全爆裂结束 → 重新施加 Star 效果
      // partOverride=1：与上方 BATTLE_START 同属 ■ 第 2 段，强制对齐到 P2
      {
        on: 'FULL_BURST_END',
        partOverride: 1,
        handler(state, caster) { applyStarEffect(state, caster); },
      },

      // Part3：全蓄力命中 → 对目标造成附加伤害（普通技能伤害，非 sustained），同时附加对应充能
      // partOverride=2：FULL_BURST_END 占用了数组序号 2，强制对齐到 P3
      {
        on: 'FULL_CHARGE',
        partOverride: 2,
        handler(state, caster, ctx) {
          if (state.enemyHp <= 0) return;
          const lv   = caster.skillLevels[0];
          const pct  = getSkillValue(caster.rawSkill1, 3, lv) / 100;
          const sums = ctx.sums ?? getBuffSums(state, caster.id);
          fireSkillHit(state, caster, pct, sums, 'S1', {
            burstEnergy: caster.targetBurstEnergyPerShot, burstEnergySource: 'astar_s1_fc_dmg' });
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
          if (caster.skillState.astarStarMode !== 'own') return false;
          const lv      = caster.skillLevels[1];
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(caster.rawSkill2, 0, lv) / 100);
          pushBuff(state, { name: 'Stardust (ATK)', unitId: null,
            atkFlat, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // Part2：全蓄力命中时，处于 Everyone's Star → 以施放者最终 MaxHP × p03% 治疗全员
      // 治疗会触发 HEAL_RECEIVED（battle.js 在 onShotFired 后调用 flushHealReceived）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (caster.skillState.astarStarMode !== 'everyone') return false;
          const lv      = caster.skillLevels[1];
          const healPct = getSkillValue(caster.rawSkill2, 2, lv) / 100;
          const sums    = getBuffSums(state, caster.id);
          const maxHp   = caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
          const amt     = Math.round(maxHp * healPct);
          applyHeal(state, ALL_ALLIES, amt, null, caster);
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
          const unitIds = state.squad.filter(u => {
            if (u.id === caster.id) return true;
            const uSums = getBuffSums(state, u.id);
            return u.stats.def * (1 + uSums.defPct) + uSums.defFlat < casterEffDef;
          }).map(u => u.id);
          pushBuff(state, { name: 'Stardust (Explosion Damage)', unitIds,
            projectileExplosionDamagePct: projExpDmgPct, endTick });
        },
      },

      // Part4：进入全爆裂 → 全员 Attack Damage ▲（10 sec）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv           = caster.skillLevels[1];
          const attackDmgPct = getSkillValue(caster.rawSkill2, 5, lv) / 100;
          pushBuff(state, { name: 'Stardust (Attack Damage)', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },

  // ── Star Anis
  // ■ Affects self.
  //   Shooting Stars
  //   Function: Generates stars around Anis that attack random targets automatically.
  //   Damage: {p01}% of final ATK
  //   Attack Interval: 0.25 sec
  //   Duration: {p02=10} sec
  //   Additional Effects
  //   Charge time is fixed at {p10=0.7} sec for {p02} sec.（不受技能类蓄力速度 buff 影响，仅受魔方/装备影响）
  //   Explosion Radius ▲ {p03}% for {p02} sec.     [单目标模型下爆炸半径不影响伤害，未建模]
  //   DEF ▲ {p05}% for {p02} sec.
  // 行号以 CDN 原文（上方逐行对应）为准：P1 的 DEF ▲ 为 L10
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
      // Part1：BURST_SKILL_USE → 激活 Shooting Stars 状态 + 固定蓄力时间 + 自身 DEF ▲（均持续 10 sec）
      // 固定蓄力时间 0.7 sec 仅受装备/魔方蓄力速度影响，屏蔽技能类 buff
      // DEF ▲ 会影响同轮内 S2 Part3 的 DEF 比较（S2 ENTER_FULL_BURST 在 B1 burst 后才触发）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv      = caster.skillLevels[2];
          const endTick = state.tick + TICK_RATE * 10;
          // Shooting Stars 状态到期时刻，供 INTERVAL handler 检查
          caster.skillState.shootingStarsEndTick = endTick;
          // 将下方 INTERVAL 触发器（burst 数组序号 1）的计时起点对齐到施放时刻：
          // 首次命中在施放后 0.25 sec，10 sec 内恰好 40 次，不随战斗开始时刻的相位漂移
          caster.skillState.intervalBattleLast_burst_1 = state.tick;
          caster.skillState.fixedChargeTimeTicks = Math.round(0.7 * TICK_RATE);
          caster.skillState.fixedChargeEndTick   = endTick;
          const defPct = getSkillValue(caster.rawBurst, 4, lv) / 100;
          pushBuff(state, { name: 'Star Anis (DEF)', unitId: caster.id, defPct, endTick });
        },
      },

      // Part1 INTERVAL：Shooting Star —— 每 0.25 sec 以当前 buff 状态造成一次伤害
      // 性质：RL 未蓄力的普通攻击（isCharged=false，chargeMult=1）
      //   · 自动攻击随机目标：不受自动战斗停火影响，敌人进入 HIDDEN 后前 0.9s 仍可命中并继续攻击，
      //     之后敌人无法被命中（无目标）时跳过该轮（isEnemyHittable，dev/game-data.md）
      //   · 可命中核心：类 RL 弹道（有飞行时间），敌人有核心且未被保护时按 RL 核心命中率
      //     （随敌人距离缩放）判定（rollProjectileCore，默认 1 = 恒中；RL 无穿透）
      //   · 享受普攻加成（normalAttackDamagePct / normalAttackCritRatePct）
      //   · 享受 Projectile Explosion Damage 加成（如 S2 P3）
      //   · 享受 Explosion Radius 加成：单目标模型下不影响伤害，无需额外计算
      //   · 可以充能（dev/game-data.md 实测）；是否计入攻击次数未知，暂不触发 SHOT_COUNT
      // 标签 'Burst P1 Shooting Stars'：日志显示为 Shooting Star，tooltip 定位到爆裂技能 P1
      // partOverride=0：与上方 BURST_SKILL_USE 同属 ■ 第 1 段，强制对齐到 P1
      // 注意：此触发器必须保持在数组序号 1（上方 handler 依赖 intervalBattleLast_burst_1）
      {
        on: 'INTERVAL',
        opts: { seconds: 0.25 },
        partOverride: 0,
        handler(state, caster) {
          const endTick = caster.skillState.shootingStarsEndTick;
          if (!endTick || state.tick > endTick) return false;
          if (state.enemyHp <= 0) return;
          // 敌人隐藏且已不可命中（隐藏动画前 0.9s 仍可命中）→ 无目标，本轮跳过（计时照常推进，不顺延）
          if (!isEnemyHittable(state)) return;
          const lv     = caster.skillLevels[2];
          const pct    = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const sums   = getBuffSums(state, caster.id);
          const isCore = rollProjectileCore(state);
          fireSkillHit(state, caster, pct, sums, 'Burst P1 Shooting Stars', {
            hitPart:             isCore ? 'core' : 'body',
            coreDmgIncrement:    caster.coreDmgIncrement ?? 0,
            projectileExplosion: true,
            isNormalAttack:      true,
            applyDistanceAdv:    true,
            // 充能：按未蓄力普攻计 = target_burst_energy_pershot + burstGaugeFlat（无全蓄力倍率）
            // 仅在 burstPhase===0 时生效；Shooting Star 大多落在爆裂期间，实战几乎不充能
            burstEnergy:         caster.targetBurstEnergyPerShot + (sums.burstGaugeFlat ?? 0),
            burstEnergySource:   'astar_shooting_star',
          });
        },
      },

      // Part2：My Own Star 状态 → 自身 Attack Damage ▲（10 sec）
      // partOverride=1：INTERVAL 占用了数组序号 1，强制对齐到 P2
      {
        on: 'BURST_SKILL_USE',
        partOverride: 1,
        handler(state, caster) {
          if (caster.skillState.astarStarMode !== 'own') return false;
          const lv           = caster.skillLevels[2];
          const attackDmgPct = getSkillValue(caster.rawBurst, 5, lv) / 100;
          pushBuff(state, { name: 'Star Anis (Attack Damage)', unitId: caster.id,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },

      // Part3：Everyone's Star 状态 → 全员 Max HP ▲ p08% of caster max HP（flat，10 sec）
      // 基数为施放者 max HP（描述未写 final，不含 buff）
      // 影响 Cinderella 等以 Max HP 换算攻击力的角色（通过 maxHpFlat buff 传递）
      // partOverride=2：数组序号为 3，强制对齐到 P3
      {
        on: 'BURST_SKILL_USE',
        partOverride: 2,
        handler(state, caster) {
          if (caster.skillState.astarStarMode !== 'everyone') return false;
          const lv        = caster.skillLevels[2];
          const maxHpPct  = getSkillValue(caster.rawBurst, 7, lv) / 100;
          const maxHpFlat = Math.round(caster.stats.hp * maxHpPct);
          pushBuff(state, { name: 'Star Anis (Max HP)', unitId: null,
            maxHpFlat, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },
};
