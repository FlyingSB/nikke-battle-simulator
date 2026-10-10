import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Rapi: Red Hood  (resource_id: 16)
export default {

  // ── Battlefield Assessment
  // ■ Activates at the start of battle and when Full Burst ends.
  // Effect differs according to squad formation. Only the corresponding effect is applied.
  // Affects self if there are no Burst 1 allies..
  // Combat Assist: Changes to Burst Stage {description_value_01}. This effect is continuous.
  // Affects self if there are Burst 1 allies.
  // Removes Combat Assist.
  // ■ Activates when entering Full Burst while in Combat Assist status. Affects all allies.
  // Cooldown of Burst Skill ▼ {description_value_02} sec.
  // Attack Damage ▲ {description_value_07}% for {description_value_08} sec.
  // ■ Activates when entering Full Burst while not in Combat Assist status. Affects self.
  // ATK ▲ {description_value_03}% for {description_value_04} sec.
  // Damage to Interruption Parts ▲ {description_value_05}% for {description_value_06} sec.
  // p01: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p02: [5.34, 5.58, 5.82, 6.05, 6.29, 6.53, 6.77, 7, 7.24, 7.48]
  // p03: [59.4, 63.36, 67.32, 71.28, 75.24, 79.2, 83.16, 87.12, 91.08, 95.04]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [30, 32, 34, 36, 38, 40, 42, 44, 46, 48]
  // p06: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p07: [5.01, 5.35, 5.68, 6.01, 6.35, 6.68, 7.02, 7.35, 7.69, 8.02]
  // p08: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  skill1: {
    groupId: 20161,
    triggers: [
      // S1（Battlefield Assessment）— Combat Assist 状态在战斗开始和全爆裂结束时结算：
      //   无原生 B1 友军 → combatAssistStatus = true，burstStep = 'Step1'（Rapi 代补 B1）
      //   有原生 B1 友军 → combatAssistStatus = false，burstStep = nativeBurstStep（恢复 B3）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const hasNativeB1 = state.squad.some(u => u.id !== caster.id && u.nativeBurstStep === 'Step1');
          caster.combatAssistStatus = !hasNativeB1;
          caster.burstStep = caster.combatAssistStatus ? 'Step1' : caster.nativeBurstStep;
        },
      },
      // 注：FULL_BURST_END 与 BATTLE_START 同属■段0，此触发器 tdefIdx=1（partIdx=1），接受偏移
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const hasNativeB1 = state.squad.some(u => u.id !== caster.id && u.nativeBurstStep === 'Step1');
          const newStatus = !hasNativeB1;
          if (newStatus === caster.combatAssistStatus) return false;
          caster.combatAssistStatus = newStatus;
          caster.burstStep = caster.combatAssistStatus ? 'Step1' : caster.nativeBurstStep;
        },
      },
      // Scenario C（Combat Assist + 进入全爆裂）：
      //   全员爆裂冷却 ▼[S1 param1]s（lv10=7.48） + 全员 Attack Damage ▲[S1 param6]%（lv10=8.02%）10s
      {
        on: 'ENTER_FULL_BURST',
        conditions: [{ type: 'IS_COMBAT_ASSIST' }],
        partOverride: 1,   // ■ 第 2 段（CA 进入全爆裂），数组序号 2 被 FULL_BURST_END 占用
        handler(state, caster) {
          const cdSec        = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]);
          const attackDmgPct = getSkillValue(caster.rawSkill1, 6, caster.skillLevels[0]) / 100;
          const reductionTicks = Math.round(TICK_RATE * cdSec);
          for (const u of state.squad)
            u.burstCdRemaining = Math.max(0, u.burstCdRemaining - reductionTicks);
          if (state.buffLog)
            state.buffLog.push({ type: 'cd_reduction', tick: state.tick, name: 'Battlefield Assessment (Burst CD)', unitId: null, reductionTicks });
          pushBuff(state, { name: 'Battlefield Assessment (Attack Damage)', unitId: null,
            attackDamagePct: attackDmgPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // Scenario D（非 Combat Assist + 进入全爆裂）：
      //   自身 ATK ▲[S1 param2]%（lv10=95.04%）10s + Damage to Interruption Parts ▲[S1 param4]%（lv10=48%）10s
      //   适用于切换为 B1（无原生 B1 友军）及保持 B3（有原生 B1 但非 Combat Assist）两种情况。
      //   注：Interruption Parts 伤害系统当前未建模，interruptionPartsDamagePct 字段已记录但不计入伤害输出。
      {
        on: 'ENTER_FULL_BURST',
        conditions: [{ type: 'NOT_COMBAT_ASSIST' }],
        handler(state, caster) {
          const atkPct      = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          const partsDmgPct = getSkillValue(caster.rawSkill1, 4, caster.skillLevels[0]) / 100;
          const endTick     = state.tick + TICK_RATE * 10;
          pushBuff(state, { name: 'Battlefield Assessment (ATK)', unitId: caster.id, atkPct, interruptionPartsDamagePct: partsDmgPct, endTick },
            { ...state._logCtx, partIdx: 2}
          );
        },
      },
    ],
  },

  // ── Attachable Projectiles
  // ■ Activates at the start of battle. Affects self.
  // Applies Elemental Advantage damage to Electric Code enemies continuously.
  // Projectile Attachment Damage ▲ {description_value_05}% continuously.
  // Projectile Explosion Damage ▲ {description_value_06}% continuously.
  // ■ Activates after {description_value_01} normal attack(s). Affects self.
  // Attachable Projectiles
  // Effect: Launches attachable projectiles that attach to hit locations. When entering Full Burst, the projectiles explode.
  // Projectile Attachment Damage: Deals {description_value_02}% of final ATK as damage.
  // Projectile Explosion Damage: Deals {description_value_03}% of final ATK as damage.
  // Max Ammunition Capacity: {description_value_04} round(s).
  // p01: [120, 120, 120, 120, 120, 120, 120, 120, 120, 120]
  // p02: [49.71, 53.98, 58.25, 62.51, 66.78, 71.05, 75.31, 79.58, 83.85, 88.11]
  // p03: [49.71, 53.98, 58.25, 62.51, 66.78, 71.05, 75.31, 79.58, 83.85, 88.11]
  // p04: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
  // p05: [94.2, 100.48, 106.76, 113.04, 119.32, 125.6, 131.88, 138.16, 144.44, 150.72]
  // p06: [59.44, 64.02, 68.59, 73.16, 77.74, 82.31, 86.88, 91.46, 96.03, 100.6]
  skill2: {
    groupId: 20162,
    triggers: [
      // S2 P1（被动）：战斗开始时推入永久 buff（attach/explosion 加成），并初始化弹丸计数器
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const attachBonus    = getSkillValue(caster.rawSkill2, 4, caster.skillLevels[1]) / 100;
          const explosionBonus = getSkillValue(caster.rawSkill2, 5, caster.skillLevels[1]) / 100;
          caster.skillState.rapiShotCount              = 0;
          caster.skillState.rapiProjectileThreshold    = 120;
          caster.skillState.rapiPendingProjectileCount = 0;
          caster.skillState.rapiProjectileBuffEndTick  = 0;
          // S2 唯一未具名效果段（P2 为具名的 Attachable Projectiles 弹丸）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Attachable Projectiles', unitId: caster.id,
            elementAdvantageVs:            'Electric',
            projectileAttachmentDamagePct: attachBonus,
            projectileExplosionDamagePct:  explosionBonus,
            endTick: Infinity }, { ...state._logCtx, partIdx: null });
        },
      },
      // S2（Attachable Projectiles）：每 120 发（全爆裂期间 60 发）触发 projectile
      // rapiShotCount 在 handler 内手动累积；若爆裂时计数 ≥60 则扣除 60 不发射
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'rapiRawShotCount' },
        handler(state, caster, ctx) {
          caster.skillState.rapiShotCount++;
          if (caster.skillState.rapiShotCount < caster.skillState.rapiProjectileThreshold) return;
          caster.skillState.rapiShotCount = 0;
          const sums    = ctx.sums ?? getBuffSums(state, caster.id);
          // 弹丸命中伤害：[S2 param1]% ATK（lv10=88.11%）
          const hitMult = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
          fireSkillHit(state, caster, hitMult, sums, 'S2 P2 Projectile Attachment', {
            isCore: state.enemyHasCore, coreDmgIncrement: caster.coreDmgIncrement ?? 0,
            extraAttackDamagePct: sums.projectileAttachmentDamagePct ?? 0, applyDistanceAdv: true,
          });
          if (state.fullBurstActive) {
            // 全爆裂期间立即爆炸；projectileExplosionDamagePct 由 sums 自动读取
            fireSkillHit(state, caster, hitMult, sums, 'S2 P2 Projectile Explosion', {
              isCore: false, projectileExplosion: true, applyDistanceAdv: true,
            });
          } else {
            caster.skillState.rapiPendingProjectileCount++;
          }
        },
      },
      // 待定 projectile 在进入全爆裂时爆炸（享受 ENTER_FULL_BURST buff 加成，按累计数量各爆一次）
      // 注：与 SHOT_COUNT 同属■段1，此触发器 tdefIdx=2（partIdx=2），接受偏移
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const count = caster.skillState.rapiPendingProjectileCount;
          if (count <= 0) return false;
          caster.skillState.rapiPendingProjectileCount = 0;
          const sums    = getBuffSums(state, caster.id);
          const hitMult = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
          for (let i = 0; i < count; i++) {
            fireSkillHit(state, caster, hitMult, sums, 'S2 P2 Projectile Explosion', {
              isCore: false, projectileExplosion: true, applyDistanceAdv: true,
            });
          }
        },
      },
    ],
  },

  // ── Power of Inheritance
  // When used in Stage 1: Squad Support Action Style
  // ■ Affects self.
  // Cooldown of Burst Skill ▼ 20 sec.
  // Explosion Radius ▲ {description_value_01}% for {description_value_02} sec.
  // ■ Affects all allies.
  // ATK ▲ {description_value_03}% of caster's ATK for {description_value_04} sec.
  // When used in Stage 3: High-Mobility Close-Range Combat Weapon
  // ■ Affects the enemy nearest to the crosshair.
  // Deals {description_value_05}% of final ATK as additional damage.
  // ■ Affects self.
  // Explosion Radius ▲ {description_value_01}% for {description_value_02} sec.
  // Projectile Attachment Damage ▲ {description_value_06}% for {description_value_07} sec.
  // Skill 2's requirement for triggering attachable projectiles ▼ {description_value_08} for {description_value_09} sec.
  // p01: [62.88, 67.08, 71.27, 75.46, 79.65, 83.85, 88.04, 92.23, 96.42, 100.62]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [11.16, 11.92, 12.68, 13.44, 14.2, 14.96, 15.72, 16.48, 17.24, 18.01]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [1512, 1656, 1800, 1944, 2088, 2232, 2376, 2520, 2664, 2808]
  // p06: [216, 238.8, 261.6, 284.4, 307.2, 330, 352.8, 375.6, 398.4, 421.2]
  // p07: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p08: [60, 60, 60, 60, 60, 60, 60, 60, 60, 60]
  // p09: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 10163,
    triggers: [
      // ■ P1（Stage 1 / CA）：自身爆裂冷却 ▼20s
      // [TODO: Explosion Radius ▲[Burst param0]% — 未建模]
      {
        on: 'BURST_SKILL_USE',
        conditions: [{ type: 'IS_COMBAT_ASSIST' }],
        handler(state, caster) {
          caster.burstCdRemaining = Math.max(0, caster.burstCdRemaining - TICK_RATE * 20);
        },
      },
      // ■ P2（Stage 1 / CA）：全员 ATK flat ▲[Burst param2]%（lv10=18.01%）Rapi ATK 10s
      {
        on: 'BURST_SKILL_USE',
        conditions: [{ type: 'IS_COMBAT_ASSIST' }],
        handler(state, caster) {
          const atkPct = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'Power of Inheritance (ATK)', unitId: null,
            atkFlat: Math.round(caster.stats.atk * atkPct), endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // ■ P3（Stage 3 / 非 CA）：[Burst param4]% ATK 附加伤害（lv10=2808%）
      // 【全爆裂加成】受影响（描述 as additional damage；已实测）：全爆裂 +50% 及 ENTER_FULL_BURST buff，sums 取进入全爆裂瞬间快照
      // 进入全爆裂后 0.1s 命中（B3 施放后 0.5s，引擎统一后移 0.4s）；rapiShotCount ≥60 时消耗计数代替 projectile
      {
        on: 'BURST_SKILL_USE',
        conditions: [{ type: 'NOT_COMBAT_ASSIST' }],
        handler(state, caster) {
          if (caster.skillState.rapiShotCount >= 60) {
            caster.skillState.rapiShotCount -= 60;
          }
          const burstMult = caster.rawBurst
            ? getSkillValue(caster.rawBurst, 4, caster.skillLevels[2]) / 100
            : 28.08;
          state.pendingSkillHits.push({
            fireTick: state.tick + Math.round(0.1 * TICK_RATE),
            caster, mult: burstMult, isCharged: false, label: 'Burst',
            opts: { affectedByFullBurst: true },
          });
        },
      },
      // ■ P4（Stage 3 / 非 CA）：自身 Projectile Attachment ▲[Burst param5]% + S2 触发阈值 ▼60 发（10s）
      // S2 P1 被动 buff 已常驻，此处只叠加 Burst 增益部分
      {
        on: 'BURST_SKILL_USE',
        conditions: [{ type: 'NOT_COMBAT_ASSIST' }],
        handler(state, caster) {
          const end10            = state.tick + TICK_RATE * 10;
          const burstAttachBonus = getSkillValue(caster.rawBurst, 5, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'Power of Inheritance (Attachment Damage)', unitId: caster.id,
            projectileAttachmentDamagePct: burstAttachBonus, endTick: end10 });
          caster.skillState.rapiProjectileThreshold   = 60;
          caster.skillState.rapiProjectileBuffEndTick = end10;
        },
      },
      // 全爆裂结束：若 Burst P4 buff 已过期则还原触发阈值（buff 本身自动过期，无需手动移除）
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          if (state.tick < caster.skillState.rapiProjectileBuffEndTick) return;
          caster.skillState.rapiProjectileThreshold = 120;
        },
      },
    ],
  },
};
