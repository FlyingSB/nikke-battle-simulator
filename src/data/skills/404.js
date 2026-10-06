import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { BUNNY_STANCE, BUNNY_ENGAGE, getBunnyMode, toggleBunnyMode,
         applyBunnyModeBuff } from './bunny-shared.js';

// Character: Guilty: Mighty Bunny  (resource_id: 404)
//
// 武器：Sniper Rifle（UP 型，charge 1s，弹匣 6，装填 2s，FC 250%）。爆裂阶段 Step3，CD 40s。
// Bunny Mode 机制见 bunny-shared.js（自动战斗恒为 Stance）。

// Mighty Stomp 固定参数（技能描述文本内常量，不在 description_value_list 中）
const STOMP_CHARGE_TICKS = Math.round(1.5 * TICK_RATE);  // Charge Time: Fixed at 1.5 sec
const STOMP_FULL_CHARGE  = 25000;                        // Full Charge Damage: 250%（×10000 单位）

export default {

  // ── What Should I Do...?
  // ■ Activates at the start of battle. Affects self.
  // ATK ▲ {p01}%. This effect is continuous.
  // ■ Activates at the start of battle and when Full Charge is maintained for {p02} or more
  //   seconds while this unit is not in the Mighty Stomp state. Affects self.
  // Initiates a new Bunny Mode based on the current mode.
  //   In Bunny Mode: Stance → Bunny Mode: Engage / Otherwise → Bunny Mode: Stance
  // ■ Activates when this unit enters the Bunny Mode: Engage state. Affects all allies in the
  //   Bunny Mode: Stance state. Initiates Bunny Mode: Engage.
  // ■ Activates when this unit enters the Bunny Mode: Stance state. Affects all allies in the
  //   Bunny Mode: Engage state. Initiates Bunny Mode: Stance.
  // p01: [11.88 … 20.1]    （ATK ▲%）
  // p02: [1,...]           （按住满蓄秒数 — 手动操作，未建模）
  //
  // P3/P4 形态带动由 bunny-shared.js enterBunnyMode 统一处理。
  skill1: {
    groupId: 24041,
    triggers: [
      // S1 P1：战斗开始 → 自身 ATK ▲ p01% 永久。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          pushBuff(state, { name: 'What Should I Do...?', unitId: caster.id,
            atkPct: getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100,
            endTick: Infinity });
        },
      },
      // S1 P2：战斗开始 → 切换 Bunny Mode（初始无形态 → Stance）。
      {
        on: 'BATTLE_START',
        handler(state, caster) { toggleBunnyMode(state, caster); },
      },
    ],
  },

  // ── Can I Take These Off...?
  // ■ Activates only if this unit is in the Bunny Mode: Engage state.
  // Chain Release: Changes some attacks' damage into true damage.
  //   Effect 1: Affects self. Normal attacks deal true damage.
  //   Effect 2: Affects self. Mighty Stomp deals true damage.
  //   Effect 3: Activates when landing a Full Charge attack. Affects the target.
  //     Deals {p01}% of final ATK as true damage.
  // ■ Activates only when this unit is in the Bunny Mode: Stance state.
  // Chain Enhance: Enhances this unit's offensive capabilities.
  //   Effect 1: Affects self. Attack Damage ▲ {p02}%.
  //   Effect 2: Affects self. Charge Damage ▲ {p03}%.
  //   Effect 3: Activates when landing a Full Charge attack. Affects the target.
  //     Deals {p04}% of final ATK as additional damage.
  // p01: [218.68 … 370.08] （Engage 全蓄力追加真实伤害 %ATK）
  // p02: [12.08 … 20.45]   （Stance 攻击伤害 ▲%）
  // p03: [23.64 … 40]      （Stance 蓄力伤害 ▲%）
  // p04: [266.44 … 450.89] （Stance 全蓄力追加伤害 %ATK）
  //
  // Mighty Stomp 为武器切换后的普通攻击，Effect 1/2 统一由 normalAttackTrueDamage 覆盖。
  // 全蓄力追加伤害命中按 targetBurstEnergyPerShot 充能（同 Helm S2 追加伤害）。
  skill2: {
    groupId: 24042,
    triggers: [
      // 形态变化 → 刷新 Chain Release / Chain Enhance。
      {
        on: 'BUNNY_MODE_CHANGED',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          applyBunnyModeBuff(state, caster, {
            [BUNNY_ENGAGE]: { name: 'Chain Release', normalAttackTrueDamage: true },
            [BUNNY_STANCE]: { name: 'Chain Enhance',
              attackDamagePct: getSkillValue(caster.rawSkill2, 1, lv) / 100,
              chargeDamagePct: getSkillValue(caster.rawSkill2, 2, lv) / 100 },
          });
        },
      },

      // 全蓄力命中 → Engage：p01% 真实伤害 / Stance：p04% 追加伤害。
      {
        on: 'FULL_CHARGE',
        handler(state, caster, ctx) {
          if (state.enemyHp <= 0) return;
          const lv     = caster.skillLevels[1];
          const mode   = getBunnyMode(caster);
          const sums   = ctx.sums ?? getBuffSums(state, caster.id);
          const gauge  = { burstEnergy: caster.targetBurstEnergyPerShot, burstEnergySource: 'gmb_s2_skill' };
          if (mode === BUNNY_ENGAGE) {
            fireSkillHit(state, caster, getSkillValue(caster.rawSkill2, 0, lv) / 100,
              sums, 'S2 P1', { isTrueDamage: true, ...gauge });
          } else if (mode === BUNNY_STANCE) {
            fireSkillHit(state, caster, getSkillValue(caster.rawSkill2, 3, lv) / 100, sums, 'S2 P2', gauge);
          }
        },
      },
    ],
  },

  // ── I'm Finally Free...!
  // ■ Affects self.
  // Mighty Stomp: Changes the weapon in use
  //   Charge Time: Fixed at 1.5 sec / Damage: {p03}% of final ATK / Full Charge Damage: 250%
  //   Duration: {p04} rounds
  //   Additional Effect 1: Charge Damage ▲ {p05}% for {p06} rounds.
  //   Additional Effect 2: Attack Damage ▲ {p01}% for {p02} sec.
  // p01: [45.71 … 77.35]   （攻击伤害 ▲%）
  // p02: [10,...]          （持续秒数）
  // p03: [61.3 … 101.3]    （Mighty Stomp 伤害 %ATK）
  // p04: [1,...]           （Mighty Stomp 持续回合）
  // p05: [827.27 … 1400]   （蓄力伤害 ▲%）
  // p06: [1,...]           （蓄力伤害持续回合）
  //
  // 建模：回合制武器切换（SR 类型，发间固定 90t 无前后摇）。切换期间占用 1 发临时弹药；
  //   Mighty Stomp 击发后恢复施放前原武器弹药（施放时正在装填则为 0 → 重新装填），
  //   并按 UP 型 SR 重新前摇 + 蓄力。
  burst: {
    groupId: 14043,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];
          const st = caster.skillState;

          st.gmb_savedAmmo   = caster.ammoLeft;
          st.gmb_stompPending = true;
          caster.ammoLeft    = 1;
          caster.reloadTick  = 0;
          Object.assign(st, {
            weaponSwitchHitMult:          getSkillValue(caster.rawBurst, 2, lv) / 100,
            weaponSwitchMaxAmmo:          1,
            weaponSwitchType:             'SR',
            weaponSwitchEndTick:          Infinity,
            weaponSwitchRoundsLeft:       getSkillValue(caster.rawBurst, 3, lv),
            weaponSwitchChargeTimeTicks:  STOMP_CHARGE_TICKS,
            weaponSwitchFullChargeDamage: STOMP_FULL_CHARGE,
            weaponSwitchUnlimitedAmmo:    false,
            weaponSwitchPierce:           false,
          });
          caster.chargeTick = state.tick + STOMP_CHARGE_TICKS;

          // 行号按描述原文：L7 = Additional Effect 1，L8 = Additional Effect 2
          pushBuff(state, { name: "I'm Finally Free...! (Charge Damage)", unitId: caster.id,
            chargeDamagePct: getSkillValue(caster.rawBurst, 4, lv) / 100,
            endRounds: getSkillValue(caster.rawBurst, 5, lv) },
            { ...state._logCtx, lineIdx: 6 });
          pushBuff(state, { name: "I'm Finally Free...! (Attack Damage)", unitId: caster.id,
            attackDamagePct: getSkillValue(caster.rawBurst, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawBurst, 1, lv) },
            { ...state._logCtx, lineIdx: 7 });
        },
      },

      // Mighty Stomp 击发后：恢复原武器弹药与 UP 型蓄力节奏。
      {
        on: 'FULL_CHARGE',
        partOverride: 0,
        handler(state, caster) {
          const st = caster.skillState;
          if (!st.gmb_stompPending) return;
          st.gmb_stompPending = false;
          caster.ammoLeft = Math.min(caster.maxAmmo, st.gmb_savedAmmo ?? 0);
          if (caster.ammoLeft > 0) {
            caster.chargeTick = state.tick + caster.backswingTicks + caster.foreswingTicks
              + caster.chargeTimeTicks;
          }
        },
      },
    ],
  },
};
