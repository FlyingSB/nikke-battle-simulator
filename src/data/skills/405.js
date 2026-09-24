import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { BUNNY_STANCE, BUNNY_ENGAGE, getBunnyMode, toggleBunnyMode,
         applyBunnyModeBuff } from './bunny-shared.js';

// Character: Sin: Swift Bunny  (resource_id: 405)
//
// 武器：Sniper Rifle（UP 型，charge 1s，弹匣 6，装填 2s，FC 250%）。爆裂阶段 Step3，CD 40s。
// Bunny Mode 机制见 bunny-shared.js（自动战斗恒为 Stance）。

// Swift Piercing 固定参数（技能描述文本内常量，不在 description_value_list 中）
const SP_CHARGE_TICKS = Math.round(0.5 * TICK_RATE);  // Charge Time: Fixed at 0.5 sec
const SP_FULL_CHARGE  = 30000;                        // Full Charge Damage: 300%（×10000 单位）

function swiftPiercingActive(state, caster) {
  return (caster.skillState.ssb_spEndTick ?? -1) >= state.tick;
}

export default {

  // ── Bunny Shift
  // ■ Activates at the start of battle. Affects self.
  // ATK ▲ {p01}%. This effect is continuous.
  // ■ Activates during Full Charge if this unit is not in the Swift Piercing state. Affects self.
  // Normal Attack Damage Multiplier ▲ {p02}% for {p03} round(s).
  // Charge Damage ▲ {p04}% for {p05} round(s).
  // ■ Activates at the start of battle and when Full Charge is maintained for {p06} or more
  //   seconds. Affects self.
  // Initiates a new Bunny Mode based on the current mode.
  //   In Bunny Mode: Stance → Bunny Mode: Engage / Otherwise → Bunny Mode: Stance
  // ■ Activates when this unit enters the Bunny Mode: Engage / Stance state …（形态带动，同 Guilty）
  // p01: [9.07 … 15.35]    （ATK ▲%）
  // p02: [59.09 … 100]     （普通攻击伤害倍率 ▲% — 按项目惯例建模为 normalAttackDamagePct）
  // p03: [1,...]           （回合）
  // p04: [30.8 … 52.12]    （蓄力伤害 ▲%）
  // p05: [1,...]           （回合）
  // p06: [1,...]           （按住满蓄秒数 — 手动操作，未建模）
  skill1: {
    groupId: 24051,
    triggers: [
      // S1 P1：战斗开始 → 自身 ATK ▲ p01% 永久。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          pushBuff(state, { name: 'Bunny Shift', unitId: caster.id,
            atkPct: getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100,
            endTick: Infinity });
        },
      },

      // S1 P2：全蓄力击发前（非 Swift Piercing）→ 本发普攻伤害倍率 / 蓄力伤害 ▲（1 回合）。
      {
        on: 'DURING_FULL_CHARGE',
        handler(state, caster) {
          if (swiftPiercingActive(state, caster)) return;
          const lv = caster.skillLevels[0];
          pushBuff(state, { name: 'Bunny Shift P2 L1', unitId: caster.id,
            normalAttackDamagePct: getSkillValue(caster.rawSkill1, 1, lv) / 100,
            endRounds: getSkillValue(caster.rawSkill1, 2, lv) });
          pushBuff(state, { name: 'Bunny Shift P2 L2', unitId: caster.id,
            chargeDamagePct: getSkillValue(caster.rawSkill1, 3, lv) / 100,
            endRounds: getSkillValue(caster.rawSkill1, 4, lv) });
        },
      },

      // S1 P3：战斗开始 → 切换 Bunny Mode（初始无形态 → Stance）。
      {
        on: 'BATTLE_START',
        handler(state, caster) { toggleBunnyMode(state, caster); },
      },
    ],
  },

  // ── Bullet Switch
  // ■ Activates only if this unit is in the Bunny Mode: Engage state.
  // Noise Bullets: Changes some attacks' damage into true damage.
  //   Effect 1: Normal attacks deal true damage. / Effect 2: Swift Piercing deals true damage.
  // ■ Activates only if this unit is in the Bunny Mode: Stance state.
  // Enhanced Bullets: Enhances this unit's offensive capabilities.
  //   Effect 1: Critical Rate ▲ {p01}%. / Effect 2: Critical Damage ▲ {p02}%.
  // ■ Activates when using Burst Skill. Affects self.
  // Swift Piercing: Changes the weapon in use
  //   Charge Time: Fixed at 0.5 sec / Damage: {p03}% of final ATK / Full Charge Damage: 300%
  //   Duration: {p04} sec
  // p01: [20.76 … 35.14]   （Stance 暴击率 ▲%）
  // p02: [44.39 … 75.12]   （Stance 暴击伤害 ▲%）
  // p03: [43.27 … 73.22]   （Swift Piercing 伤害 %ATK；全蓄力 ×3）
  // p04: [5,...]           （Swift Piercing 持续秒数）
  //
  // Swift Piercing 未给出弹匣容量 → 期间弹药不消耗（unlimitedAmmo）；结束后引擎补满原武器弹匣。
  skill2: {
    groupId: 24052,
    triggers: [
      // 形态变化 → 刷新 Noise Bullets / Enhanced Bullets。
      {
        on: 'BUNNY_MODE_CHANGED',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          applyBunnyModeBuff(state, caster, {
            [BUNNY_ENGAGE]: { name: 'Noise Bullets', normalAttackTrueDamage: true },
            [BUNNY_STANCE]: { name: 'Enhanced Bullets',
              critRatePct:   getSkillValue(caster.rawSkill2, 0, lv) / 100,
              critDamagePct: getSkillValue(caster.rawSkill2, 1, lv) / 100 },
          });
        },
      },

      // S2 P3：使用爆裂技能 → Swift Piercing 武器切换 p04 秒。
      {
        on: 'BURST_SKILL_USE',
        partOverride: 2,
        handler(state, caster) {
          const lv  = caster.skillLevels[1];
          const end = state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 3, lv);
          caster.reloadTick = 0;
          if (caster.ammoLeft <= 0) caster.ammoLeft = caster.maxAmmo;
          Object.assign(caster.skillState, {
            ssb_spEndTick:                end,
            weaponSwitchHitMult:          getSkillValue(caster.rawSkill2, 2, lv) / 100,
            weaponSwitchType:             'SR',
            weaponSwitchEndTick:          end,
            weaponSwitchRoundsLeft:       0,
            weaponSwitchChargeTimeTicks:  SP_CHARGE_TICKS,
            weaponSwitchFullChargeDamage: SP_FULL_CHARGE,
            weaponSwitchUnlimitedAmmo:    true,
            weaponSwitchPierce:           false,
          });
          caster.chargeTick = state.tick + SP_CHARGE_TICKS;
        },
      },
    ],
  },

  // ── Swift Piercing
  // ■ Affects self.
  // ATK ▲ {p01}% for {p02} sec.
  // ■ Affects all enemies.
  // Deals {p03}% of final ATK as Burst Skill damage.
  // ■ Activates if this unit is in the Bunny Mode: Stance state. Affects the same targets.
  // Deals {p04}% of final ATK as additional damage.
  // ■ Activates if this unit is in the Bunny Mode: Engage state. Affects the same targets.
  // Deals {p05}% of final ATK as true damage.
  // p01: [65 … 110]        （ATK ▲%）
  // p02: [5,...]           （持续秒数）
  // p03: [305.26 … 516.6]  （爆裂技能伤害 %ATK）
  // p04: [566.62 … 958.9]  （Stance 追加伤害 %ATK）
  // p05: [504.99 … 854.6]  （Engage 真实伤害 %ATK）
  burst: {
    groupId: 14053,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];
          pushBuff(state, { name: 'Swift Piercing', unitId: caster.id,
            atkPct: getSkillValue(caster.rawBurst, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawBurst, 1, lv) });

          if (state.enemyHp <= 0) return;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, getSkillValue(caster.rawBurst, 2, lv) / 100, sums, 'Burst');

          if (state.enemyHp <= 0) return;
          const mode = getBunnyMode(caster);
          if (mode === BUNNY_STANCE) {
            fireSkillHit(state, caster, getSkillValue(caster.rawBurst, 3, lv) / 100, sums, 'Burst P3');
          } else if (mode === BUNNY_ENGAGE) {
            fireSkillHit(state, caster, getSkillValue(caster.rawBurst, 4, lv) / 100, sums, 'Burst P4',
              { isTrueDamage: true });
          }
        },
      },
    ],
  },
};
