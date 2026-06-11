import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Red Hood  (resource_id: 470)
// ─── Red Hood (470) S1 辅助：更新蓄力伤害转化 buff ────────────────────────────
// 超出 100% 的蓄力速度 → Charge Damage ▲240% × 超出量（连续）
// endTick 由调用方传入，与产生该超量的 CS buff 同生命周期。
function updateRhCsConversion(state, caster, endTick = Infinity) {
  const sums     = getBuffSums(state, caster.id);
  const totalCS  = (caster.stats.chargeSpeedPct ?? 0) + sums.chargeSpeedPct;
  const excess   = Math.max(0, totalCS - 1.0);
  const convRate = getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]) / 100;
  const cdBonus  = excess > 0 ? Math.round(excess * convRate * 100000) / 100000 : 0;
  const conv    = state.buffs.find(b => b.name === 'Glaring Eyes P2 L2' && b.unitId === caster.id);
  if (cdBonus > 0) {
    if (conv) { conv.chargeDamagePct = cdBonus; conv.endTick = endTick; }
    else state.buffs.push({ name: 'Glaring Eyes P2 L2', unitId: caster.id, chargeDamagePct: cdBonus, endTick });
  } else if (conv) {
    state.buffs.splice(state.buffs.indexOf(conv), 1);
  }
}

export default {

  // ── Glaring Eyes
  // ■ Activates when casting a normal attack. Affects self.
  // Charge Speed ▲ {description_value_01}%, stacks up to {description_value_02} time(s) and lasts for {description_value_03} sec.
  // ■ Activates when entering battle. Affects self.
  // Convert excess value over 100% of Charge Speed to Charge Damage. Charge Damage ▲ {description_value_04}% of the excess value continuously.
  // p01: [2.28, 2.45, 2.62, 2.79, 2.96, 3.13, 3.3, 3.47, 3.64, 3.81]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p04: [240, 240, 240, 240, 240, 240, 240, 240, 240, 240]
  skill1: {
    groupId: 24701,
    triggers: [
      // S1 Part1（Glaring Eyes）：每次全蓄力 → 自身 Charge Speed ▲3.81%（10层 · 5s）
      // 每新增一层刷新计时；叠层过期后归零重新计数。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const existing   = state.buffs.find(b => b.name === 'Glaring Eyes P1 L1' && b.unitId === caster.id);
          const prevStacks = existing ? caster.skillState.rhCsStacks : 0;
          const newStacks  = Math.min(10, prevStacks + 1);
          caster.skillState.rhCsStacks = newStacks;
          const end5          = state.tick + TICK_RATE * 5;
          const csPerStack    = getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100;
          if (existing) {
            existing.chargeSpeedPct = newStacks * csPerStack;
            existing.endTick = end5;
          } else {
            state.buffs.push({ name: 'Glaring Eyes P1 L1', unitId: caster.id,
              chargeSpeedPct: newStacks * csPerStack, endTick: end5 });
          }
          // S1 Part2：更新超量 CS → Charge Damage 转化（与叠层同生命周期）
          updateRhCsConversion(state, caster, end5);
        },
      },
    ],
  },

  // ── Wild Tooth
  // ■ Activates when entering battle. Affects self.
  // Gain Pierce continuously.
  // ■ Activates during Beast Cage. Affects all allies.
  // DEF ▲ {description_value_01}% of caster's DEF for {description_value_02} sec.
  // ■ Activates during The Last Howl. Affects self.
  // Recovers {description_value_03}% of attack damage as HP over {description_value_04} sec.
  // ■ Activates when casting Red Wolf. Affects self.
  // ATK ▲ {description_value_05}% for {description_value_06} sec.
  // p01: [31.68, 33.79, 35.9, 38.01, 40.12, 42.24, 44.35, 46.46, 48.57, 50.68]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [14.4, 15.36, 16.32, 17.28, 18.24, 19.2, 20.16, 21.12, 22.08, 23.04]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [44.64, 47.61, 50.59, 53.56, 56.54, 59.52, 62.49, 65.47, 68.44, 71.42]
  // p06: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  skill2: {
    groupId: 24702,
    triggers: [
      // S2 Part1（Wild Tooth）：战斗开始 → 自身持续 Pierce
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          pushBuff(state, { name: 'Wild Tooth', unitId: caster.id, pierce: true, endTick: Infinity });
        },
      },
    ],
    // [TODO] S2 Part2（Beast Cage）：全员 DEF ▲50.68% RH.DEF 10s
    // [TODO] S2 Part3（The Last Howl）：自身攻击伤害→HP 回复 23.04% 10s
    // S2 Part4（Red Wolf）：自身 ATK ▲71.42% 10s — inline 于 Burst handler
    // [TODO] 用法2：AllStep B1 奇数轮/偶数轮 — Beast Cage 效果（全员 ATK ▲77.55% 施者ATK · 10s）
    // [TODO] 用法3：用法2补充 — 首轮额外使用一次 Beast Cage（利用一次性 -40s CD）
    // [TODO] 用法4：首轮其他角色推进爆裂链，第二轮 Red Hood 独自 B1+B2+B3 推全爆裂，之后退回用法1
    //         配合暖机 CD 缩减角色（Liter / Helm: Aquamarine / Volume / Dolla）在冷却真空期抢时间
  },

  // ── Red Wolf
  // When used in Step 1: Beast Cage
  // ■ Affects all allies.
  // ATK ▲ {description_value_01}% of caster's ATK for {description_value_02} sec.
  // ■ Affects self.
  // Cooldown of Burst Skill ▼ 40 sec. Activates once per battle.
  // When used in Step 2: The Last Howl
  // ■ Affects self.
  // Attract: Taunts all enemies for {description_value_04} sec.
  // Potency of HP restored ▲ {description_value_05}% for {description_value_06} sec.
  // Cooldown of Burst Skill ▼ 40 sec. Activates once per battle.
  // When used in Step 3: Red Wolf
  // ■ Affects self.
  // Changes the weapon in use:
  // Damage: {description_value_07}% of final ATK
  // Full Charge Damage: 250% of damage
  // Duration: 10 sec
  // Additional Effects:
  // Expand Pierce range by {description_value_08}% for {description_value_09} sec.
  // Charge Speed ▲ {description_value_10}% for {description_value_11} sec.
  // p01: [48.47, 51.7, 54.93, 58.16, 61.39, 64.62, 67.85, 71.08, 74.32, 77.55]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [46.8, 49.92, 53.04, 56.16, 59.28, 62.4, 65.52, 68.64, 71.76, 74.88]
  // p06: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p07: [37.02, 38.63, 40.23, 41.84, 43.44, 45.05, 46.65, 48.26, 49.86, 51.46]
  // p08: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
  // p09: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p10: [100.8, 100.8, 100.8, 100.8, 100.8, 100.8, 100.8, 100.8, 100.8, 100.8]
  // p11: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 14703,
    triggers: [
      // Red Wolf（仅 Step3/StepFull）：
      //   S2 Part4 ATK ▲71.42% + CS ▲100.8% + 武器切换（51.46%·250%FC·10s·弹匣99）
      //   Beast Cage（Step1）/ The Last Howl（Step2）使用 burst 时此 handler 直接返回。
      //   weaponSwitchChargeTimeTicks=19：跳过 fore/backswing，
      //   游戏实测 10s 内 32 次攻击 → 600/(32-1) = 19.35 ≈ 19 ticks/shot。
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const isRedWolf = caster.burstStep === 'Step3' || caster.burstStep === 'StepFull';
          if (!isRedWolf) return false;
          const end10            = state.tick + TICK_RATE * 10;
          // S2 Part4：自身 ATK ▲[S2 param4]% 10s（仅 Red Wolf）
          const s2AtkPct         = getSkillValue(caster.rawSkill2, 4, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Wild Tooth P4 L2', unitId: caster.id,
            atkPct: s2AtkPct, endTick: end10 });
          // Charge Speed ▲[Burst param9]% 10s（Red Wolf 追加效果）
          const chargeSpeedPct   = getSkillValue(caster.rawBurst, 9, caster.skillLevels[2]) / 100;
          pushBuff(state, { name: 'Red Wolf P1 L5', unitId: caster.id,
            chargeSpeedPct, endTick: end10 });
          // 武器切换：Damage [Burst param6]% final ATK · FC 250% · 10s · 弹匣容量 99
          // Red Wolf 弹匣 99 发，10s 实测约 32 发，不会触发装弹
          const weaponSwitchHitMult = getSkillValue(caster.rawBurst, 6, caster.skillLevels[2]) / 100;
          caster.skillState.rhNormalAmmoSaved             = caster.ammoLeft;
          caster.ammoLeft                                 = 99;
          caster.skillState.weaponSwitchHitMult           = weaponSwitchHitMult;
          caster.skillState.weaponSwitchType              = 'SR';
          caster.skillState.weaponSwitchEndTick           = end10;
          caster.skillState.weaponSwitchChargeTimeTicks   = 19;
          caster.skillState.weaponSwitchFullChargeDamage  = 25000; // 250% FC
          caster.skillState.weaponSwitchUnlimitedAmmo     = false;
          // 立即开始蓄力（全爆裂期间首发尽快打出）
          caster.chargeTick = state.tick;
          // 更新 CS 转化 buff（Red Wolf CS buff 现已生效）
          updateRhCsConversion(state, caster, end10);
        },
      },
      // 全爆裂结束：恢复普通武器弹药 + 重算 CS 转化
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          if ((caster.skillState.weaponSwitchEndTick ?? 0) <= state.tick)
            caster.skillState.weaponSwitchEndTick = 0;
          // 恢复切换前的普通弹匣余量
          if (caster.skillState.rhNormalAmmoSaved != null) {
            caster.ammoLeft = caster.skillState.rhNormalAmmoSaved;
            caster.skillState.rhNormalAmmoSaved = null;
          }
          updateRhCsConversion(state, caster, state.tick + TICK_RATE * 5);
        },
      },
    ],
  },
};
