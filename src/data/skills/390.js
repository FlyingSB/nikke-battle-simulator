import { pushBuff, applyCoverHeal, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Zwei  (resource_id: 390)
// SSR 珍藏品: Four-Leaf Clover Bookmark（id: 201501）
// 所有三个技能槽均被 SSR 珍藏品替换（skill_change_slot=1/2/3）。
export default {

  // ── Pierce Equation（S1）
  // base group_id: 23901 / SSR group_id: 123901（skill_change_slot=1）
  //
  // ■ Activates when entering Full Burst. Affects all allies.
  //   Pierce Damage ▲ {p00}% for {p01=1} round(s).
  //   Pierce Damage ▲ {p02}% for {p03=10} sec.
  // ■ [SSR 新增] Activates when performing a normal attack during Full Burst. Affects all allies.
  //   Pierce Damage ▲ {p04}%, stacks up to {p05=3} time(s), for {p06=1} round(s).
  //   endRounds:1 作用于整个 buff 对象（含全部层数），1 次射击后所有层同时到期。
  //
  // base/SSR group_id: 23901 / 123901
  // p00 Pierce Damage ▲% (1 round): [11.89,12.81,13.72,14.64,15.55,16.47,17.38,18.3,19.21,20.13]
  // p01 rounds (const): [1,...]
  // p02 Pierce Damage ▲% (10s): [5.94,6.4,6.86,7.32,7.77,8.23,8.69,9.15,9.6,10.06]
  // p03 sec (const): [10,...]
  // p04 [SSR] Pierce Damage ▲% (stacking): [14.76,15.9,17.04,18.17,19.31,20.44,21.58,22.72,23.85,24.99]
  // p05 [SSR] max stacks (const): [3,...]
  // p06 [SSR] rounds (const): [1,...]
  skill1: {
    groupId: 123901,
    triggers: [
      // P1：进入全爆裂 → 全队穿透伤害 ▲ p00%（1 round）+ p02%（10s）
      // base 与 SSR 的 p00/p02 数值相同，故 skillObj 回退到 rawSkill1 时仍正确。
      {
        on: 'ENTER_FULL_BURST',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const favS1    = caster.ssrFavSkills?.skill1;
          const lv       = favS1?._activeSkillLevel ?? caster.skillLevels[0];
          const skillObj = favS1 ?? caster.rawSkill1;
          const endTick  = state.tick + TICK_RATE * 10;

          const pierce1rPct  = getSkillValue(skillObj, 0, lv) / 100;
          const pierce10sPct = getSkillValue(skillObj, 2, lv) / 100;

          // Pierce Damage ▲ p00%（endRounds:1 → 下次射击后整体失效）
          pushBuff(state, { name: 'zwei_s1_pierce1r', unitId: null,
            pierceDamagePct: pierce1rPct, endTick, endRounds: 1 });

          // Pierce Damage ▲ p02%（10s）
          pushBuff(state, { name: 'zwei_s1_pierce10s', unitId: null,
            pierceDamagePct: pierce10sPct, endTick });
        },
      },
      // P2 [SSR]：全爆裂中每次普攻 → 全队穿透伤害 ▲ p04%（stackLimit:3，endRounds:1）
      // 每次叠层刷新 roundsLeft=1；每次射击后 roundsLeft 归零，全部层数同时消耗。
      // "during Full Burst" = state.fullBurstActive（B3 施放后的 10s 窗口）。
      {
        on: 'SHOT_COUNT',
        opts: { every: 1 },
        handler(state, caster) {
          if (!state.fullBurstActive) return;
          const favS1 = caster.ssrFavSkills?.skill1;
          if (!favS1) return;
          const lv        = favS1._activeSkillLevel ?? 10;
          const piercePct = getSkillValue(favS1, 4, lv) / 100;
          pushBuff(state, { name: 'zwei_s1_pierce_stack', unitId: null,
            pierceDamagePct: piercePct,
            endTick: state.tick + TICK_RATE * 10,
            endRounds: 1,
            stackLimit: 3 });
        },
      },
    ],
  },

  // ── Frame Analysis（S2）
  // base group_id: 23902 / SSR group_id: 123902（skill_change_slot=2）
  //
  // ■ Activates after {p00=5} normal attack(s). Affects all allies.
  //   Restores {p01}% of Cover HP.
  // ■ Activates when entering Full Burst. Affects all allies.
  //   Critical Rate ▲ {p02}% for {p03} sec.   [SSR: 10s；base: 5s]
  // ■ [SSR 新增] Activates when performing a normal attack while in Pierce Attacks 101 status.
  //   Affects all allies. Critical Rate ▲ {p04}% for {p06=5} sec, stacks up to {p05=3} time(s).
  //   Pierce Attacks 101 由 burst handler 在 BURST_SKILL_USE 时写入 skillState.zwei_PA101EndTick，
  //   与 state.fullBurstActive（B3 后才为 true）不同：Zwei 是 B1，PA101 早于 Full Burst 开始。
  //
  // base/SSR group_id: 23902 / 123902
  // p00 shot threshold (const): [5,...]
  // p01 Cover HP restore %: [4.38,4.73,5.08,5.43,5.78,6.13,6.48,6.83,7.17,7.52]
  // p02 Critical Rate ▲%: [11.01,11.86,12.7,13.55,14.4,15.25,16.09,16.94,17.79,18.63]
  // p03 sec (base: 5s / SSR: 10s): base=[5,...] / SSR=[10,...]
  // p04 [SSR] Critical Rate ▲% (stacking): [8.86,9.55,10.23,10.91,11.59,12.28,12.96,13.64,14.32,15]
  // p05 [SSR] max stacks (const): [3,...]
  // p06 [SSR] sec (const): [5,...]
  skill2: {
    groupId: 123902,
    triggers: [
      // P1：每 5 次普攻 → 全队封面 HP 回复（仅建模事件，不追踪数值）
      {
        on: 'SHOT_COUNT',
        opts: { every: 5, counterKey: 'zwei_s2_coverShots' },
        logTargets: 'ALL_ALLIES',
        handler(state) {
          applyCoverHeal(state);
        },
      },
      // P2：进入全爆裂 → 全队暴击率 ▲ p02%（p03 秒；SSR: 10s，base: 5s）
      {
        on: 'ENTER_FULL_BURST',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const favS2    = caster.ssrFavSkills?.skill2;
          const lv       = favS2?._activeSkillLevel ?? caster.skillLevels[1];
          const skillObj = favS2 ?? caster.rawSkill2;

          const critPct = getSkillValue(skillObj, 2, lv) / 100;
          const dur     = getSkillValue(skillObj, 3, lv);   // base: 5s, SSR: 10s
          pushBuff(state, { name: 'zwei_s2_critRate', unitId: null,
            critRateBonus: critPct, endTick: state.tick + TICK_RATE * dur });
        },
      },
      // P3 [SSR]：Pierce Attacks 101 中每次普攻 → 全队暴击率 ▲ p04% 5s（最多 3 层）
      // Pierce Attacks 101 = Zwei 自己的 burst 触发后的 10s 状态（早于 Full Burst 开始）。
      {
        on: 'SHOT_COUNT',
        opts: { every: 1 },
        handler(state, caster) {
          if ((caster.skillState.zwei_PA101EndTick ?? 0) <= state.tick) return;
          const favS2 = caster.ssrFavSkills?.skill2;
          if (!favS2) return;
          const lv      = favS2._activeSkillLevel ?? 10;
          const critPct = getSkillValue(favS2, 4, lv) / 100;
          const dur     = getSkillValue(favS2, 6, lv);    // 5s
          pushBuff(state, { name: 'zwei_s2_crit_stack', unitId: null,
            critRateBonus: critPct,
            endTick: state.tick + TICK_RATE * dur,
            stackLimit: 3 });
        },
      },
    ],
  },

  // ── Overcharge Formula（Burst）
  // base group_id: 13903 / SSR group_id: 113903（skill_change_slot=3）
  //
  // ■ Affects self. Changes the weapon in use:
  //   Charge Time: {1.2s（SSR）/ 1.5s（base）}
  //   Damage: {p00}% of final ATK, Full Charge Damage: 300% of damage
  //   Max Ammunition Capacity: {p01=1}, Additional Effect: Pierce
  // ■ Affects all allies. Pierce Attacks 101: Pierce Damage ▲ {p02}% for {p03=10} sec.
  //
  // base/SSR group_id: 13903 / 113903
  // p00 charge shot Damage %: [29.95,32.26,34.56,36.86,39.17,41.47,43.78,46.08,48.38,50.69]
  // p01 max ammo (const): [1,...]
  // p02 Pierce Damage ▲%: base=[9.15,9.85,10.56,11.26,11.96,12.67,13.37,14.08,14.78,15.48]
  //                        SSR =[14.79,15.92,17.06,18.2,19.34,20.48,21.61,22.75,23.89,25.03]
  // p03 sec (const): [10,...]
  burst: {
    groupId: 113903,
    triggers: [
      // P1：武器切换（自身）→ 蓄力穿透 SR，1 发，300% 全蓄伤害
      // SSR Charge Time: 1.2s（72 ticks）；base: 1.5s（90 ticks）
      // 建模规范参照 Snow White（220.js）weaponSwitch 字段约定。
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'SELF',
        handler(state, caster) {
          const favBurst = caster.ssrFavSkills?.burst;
          const lv       = favBurst?._activeSkillLevel ?? caster.skillLevels[2];
          const skillObj = favBurst ?? caster.rawBurst;

          const hitMult         = getSkillValue(skillObj, 0, lv) / 100;
          const chargeTimeTicks = favBurst
            ? Math.round(1.2 * TICK_RATE)   // SSR: 1.2s
            : Math.round(1.5 * TICK_RATE);  // base: 1.5s

          // Pierce Attacks 101 状态（10s），供 S2 P3 使用
          caster.skillState.zwei_PA101EndTick = state.tick + TICK_RATE * 10;

          // 切换至蓄力穿透武器（1 发弹匣，取消进行中的装填）
          caster.ammoLeft   = 1;
          caster.reloadTick = 0;

          caster.skillState.weaponSwitchHitMult          = hitMult;
          caster.skillState.weaponSwitchType             = 'SR';
          caster.skillState.weaponSwitchEndTick          = Infinity;
          caster.skillState.weaponSwitchRoundsLeft       = 1;
          caster.skillState.weaponSwitchChargeTimeTicks  = chargeTimeTicks;
          caster.skillState.weaponSwitchFullChargeDamage = 30000;  // 300% FC: 300÷100×10000
          caster.skillState.weaponSwitchUnlimitedAmmo    = false;
          // backswing 实测推算：burst 击发至首发 SG = 67 帧；SG spot_first_delay=20→12 ticks 前摇；67−12=55。
          caster.skillState.weaponSwitchBackswingTicks   = 55;
          caster.skillState.weaponSwitchPierce           = true;
          // 游戏实机特性（可视为 bug）：武器切换后的一击造成两次独立伤害。
          // 第一次命中触发 S1 P2（消耗掉 S1 P1 的一发穿透 buff），
          // 第二次命中受 S1 P2 本次叠加的 pierce_stack 加成，但不消耗它。
          // 战斗引擎识别此标志并执行双重命中逻辑（见 battle.js）。
          caster.skillState.weaponSwitchDoubleHit        = true;
          // 立即开始蓄力
          caster.chargeTick = state.tick + chargeTimeTicks;
        },
      },
      // P2：全队 Pierce Attacks 101 → Pierce Damage ▲ p02% 10s
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const favBurst = caster.ssrFavSkills?.burst;
          const lv       = favBurst?._activeSkillLevel ?? caster.skillLevels[2];
          const skillObj = favBurst ?? caster.rawBurst;

          const piercePct = getSkillValue(skillObj, 2, lv) / 100;
          pushBuff(state, { name: 'zwei_burst_pierce', unitId: null,
            pierceDamagePct: piercePct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },
};
