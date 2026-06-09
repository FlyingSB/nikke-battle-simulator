import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Velvet  (resource_id: 316)
export default {

  // ── Sticky Fingers
  // ■ 战斗开始时及进入爆裂阶段 2 时激活，影响自身：
  //   弹药袋掠夺：移除所有敌人 {p00}% 的子弹（敌人输出相关，建模忽略）。
  //   弹药袋：充满至 {p01=6000}（上限 {p02=6000}），效果持续，不可移除。
  // ■ 不在全爆裂状态下使用全蓄力攻击时激活，影响自身：
  //   消耗弹药袋 {p03=100} 发（计入全队弹药消耗，但非攻击命中）。
  //   ATK ▲ {p04}%，持续 {p05=3} 秒。
  //   Attack Damage ▲ {p06}%，持续 {p07=3} 秒。
  //
  // group_id: 23161
  // p00 子弹移除% (const): [2.95, 3.18, 3.41, 3.63, 3.86, 4.09, 4.31, 4.54, 4.77, 5]
  // p04 ATK▲%: [18.02, 19.41, 20.8, 22.18, 23.57, 24.96, 26.34, 27.73, 29.12, 30.5]
  // p06 Attack Damage▲%: [18.02, 19.41, 20.8, 22.18, 23.57, 24.96, 26.34, 27.73, 29.12, 30.5]
  skill1: {
    groupId: 23161,
    triggers: [
      // Part1：战斗开始 → 弹药袋初始化至 6000
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          caster.skillState.velvetAmmoPouch = 6000;
        },
      },
      // Part1：进入爆裂阶段 2（B1 施放后、B2 施放前）→ 弹药袋充满至 6000
      // 注：与 BATTLE_START 同属■段0，此触发器 tdefIdx=1（partIdx=1），接受偏移
      {
        on: 'ENTER_BURST_II',
        handler(state, caster) {
          caster.skillState.velvetAmmoPouch = 6000;
        },
      },
      // Part2：全蓄力攻击（非全爆裂）→ 消耗弹药袋 100 发，自身 ATK + Attack Damage ▲ 3s
      // 弹药袋消耗计入全队弹药里程碑（供 LM 等统计），但不视作攻击命中。
      // 注：属■段1，但因■段0有2个触发器，此触发器 tdefIdx=2（partIdx=2），接受偏移
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (state.fullBurstActive) return false;
          const pouch = caster.skillState.velvetAmmoPouch ?? 0;
          if (pouch < 100) return false;
          caster.skillState.velvetAmmoPouch = pouch - 100;
          state.totalAmmoFired += 100;

          const lv   = caster.skillLevels[0];
          const end3 = state.tick + TICK_RATE * 3;
          pushBuff(state, { name: 'Sticky Fingers P2', unitId: caster.id,
            atkPct: getSkillValue(caster.rawSkill1, 4, lv) / 100,
            attackDamagePct: getSkillValue(caster.rawSkill1, 6, lv) / 100, endTick: end3 },
            { ...state._logCtx, partIdx: 1 });
        },
      },
    ],
  },

  // ── Bullets of Love
  // ■ 全爆裂期间使用全蓄力攻击时激活：
  //   消耗弹药袋 {p00=300} 发（计入全队弹药消耗，非攻击命中）。
  //   影响所有友军，ATK ▲ {p01}%（施法者 ATK 的绝对值），持续 {p02=3} 秒。
  //   影响所有友军，Charge Damage ▲ {p03}%，持续 {p04=3} 秒。
  // ■ 全爆裂期间累计命中 {p05=50} 次普通攻击时激活（每次全爆裂重置计数）：
  //   消耗弹药袋 {p06=300} 发（计入全队弹药消耗，非攻击命中）。
  //   影响自身，Attack Damage ▲ {p07}%，持续 {p08=5} 秒。
  //   对目标造成最终 ATK × {p09}% 的额外伤害。
  //
  // group_id: 23162
  // p01 ATK▲% of caster ATK (flat): [14.89, 16.03, 17.18, 18.32, 19.47, 20.61, 21.76, 22.9, 24.05, 25.2]
  // p03 Charge Damage▲%: [59.56, 64.14, 68.72, 73.31, 77.89, 82.47, 87.05, 91.63, 96.22, 100.8]
  // p07 Attack Damage▲%: [8.88, 9.56, 10.25, 10.93, 11.61, 12.3, 12.98, 13.66, 14.35, 15.03]
  // p09 额外伤害%: [236.9, 255.13, 273.35, 291.57, 309.8, 328.02, 346.25, 364.47, 382.69, 400.92]
  skill2: {
    groupId: 23162,
    triggers: [
      // Part1：全爆裂全蓄力 → 消耗弹药袋 300 发，全队 ATK flat + Charge Damage▲ 3s（持续刷新）
      // 爆裂武器切换（SMG）期间不触发 FULL_CHARGE，本效果在武器切换结束后由 SR 全蓄力触发。
      {
        on: 'FULL_CHARGE',
        conditions: [{ type: 'IN_FULL_BURST' }],
        handler(state, caster) {
          const pouch = caster.skillState.velvetAmmoPouch ?? 0;
          if (pouch < 300) return false;
          caster.skillState.velvetAmmoPouch = pouch - 300;
          state.totalAmmoFired += 300;

          const lv      = caster.skillLevels[1];
          const end3    = state.tick + TICK_RATE * 3;
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(caster.rawSkill2, 1, lv) / 100);
          pushBuff(state, { name: 'Bullets of Love P1',
            unitId: null, atkFlat, chargeDamagePct: getSkillValue(caster.rawSkill2, 3, lv) / 100, endTick: end3 });
        },
      },
      // Part2 辅助：进入全爆裂 → 重置普攻计数器
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          caster.skillState.velvetFbShotCount = 0;
        },
      },
      // Part2：全爆裂期间每 50 发普通攻击 → 消耗弹药袋 300 发，Attack Damage▲ 5s + 额外伤害
      // 爆裂武器切换（SMG，约 60 发/秒）驱动计数；50 发约 0.83 秒触发一次。
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'velvetS2ShotTracker' },
        handler(state, caster) {
          if (!state.fullBurstActive) return;
          const cnt = (caster.skillState.velvetFbShotCount ?? 0) + 1;
          caster.skillState.velvetFbShotCount = cnt;
          if (cnt % 50 !== 0) return;

          const pouch = caster.skillState.velvetAmmoPouch ?? 0;
          if (pouch < 300) return;
          caster.skillState.velvetAmmoPouch = pouch - 300;
          state.totalAmmoFired += 300;

          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Bullets of Love P2',
            unitId: caster.id, attackDamagePct: getSkillValue(caster.rawSkill2, 7, lv) / 100,
            endTick: state.tick + TICK_RATE * 5 });
          fireSkillHit(state, caster, getSkillValue(caster.rawSkill2, 9, lv) / 100,
            getBuffSums(state, caster.id), false, 'velvet_s2_bonusHit');
        },
      },
    ],
  },

  // ── Perfect Execution
  // ■ 影响自身。切换当前使用武器（副武器自动射击，持续 {p01=10} 秒）：
  //   每发伤害：最终 ATK × {p00}%。
  //   附加效果：Attack Damage ▲ {p02}%，持续 {p03=10} 秒。
  //
  // group_id: 13163
  // p00 换装武器每发伤害%: [4.14, 4.45, 4.77, 5.09, 5.41, 5.73, 6.05, 6.37, 6.68, 7]
  // p02 Attack Damage▲%: [20.4, 21.97, 23.54, 25.1, 26.67, 28.24, 29.81, 31.38, 32.95, 34.52]
  //
  // 武器切换：SMG 类型（非蓄力，不触发 FULL_CHARGE），chargeTimeTicks=1（≈60 发/秒）。
  // 实测约 52.5 发/秒（500-550 发/10s，取中间值），整数近似误差约 +14%。
  // 每 50 发触发 S2 Part2；S2 Part1 在武器切换到期后由 SR 全蓄力触发。
  burst: {
    groupId: 13163,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv    = caster.skillLevels[2];
          const end10 = state.tick + TICK_RATE * 10;

          pushBuff(state, { name: 'Perfect Execution',
            unitId: caster.id, attackDamagePct: getSkillValue(caster.rawBurst, 2, lv) / 100, endTick: end10 });

          caster.skillState.weaponSwitchHitMult         = getSkillValue(caster.rawBurst, 0, lv) / 100;
          caster.skillState.weaponSwitchType            = 'SMG'; // 非蓄力，高频自动射击
          caster.skillState.weaponSwitchEndTick         = end10;
          caster.skillState.weaponSwitchChargeTimeTicks = 1;     // ≈60 发/秒；实测 52.5，整数近似
          caster.skillState.weaponSwitchUnlimitedAmmo   = true;
          caster.chargeTick = state.tick; // 立即开始，首发尽快打出
        },
      },
    ],
  },
};
