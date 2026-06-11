import { pushBuff, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Maxwell  (resource_id: 102)
export default {

  // ── Straight Shot
  // ■ Activates when entering Full Burst. Affects the 2 ally unit(s) with the highest final ATK.
  // Charge Speed ▲ {p00}% for {p01} sec.
  // ATK ▲ {p02}% for {p03} sec.
  //
  // group_id: 21021
  // p00 Charge Speed ▲%: [2.65, 2.86, 3.06, 3.27, 3.47, 3.68, 3.88, 4.08, 4.29, 4.48]
  // p01 duration (const): [10, ...]
  // p02 ATK ▲%: [25.46, 27.42, 29.38, 31.34, 33.3, 35.26, 37.22, 39.18, 41.14, 43.1]
  // p03 duration (const): [10, ...]
  skill1: {
    groupId: 21021,
    triggers: [
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv     = caster.skillLevels[0];
          const csPct  = getSkillValue(caster.rawSkill1, 0, lv) / 100;
          const atkPct = getSkillValue(caster.rawSkill1, 2, lv) / 100;
          const endTick = state.tick + TICK_RATE * 10;

          // 取 final ATK 最高的 2 名队员（含自身）
          const sorted  = [...state.squad].sort((a, b) => b.stats.atk - a.stats.atk);
          const targets = sorted.slice(0, 2);

          for (const t of targets) {
            pushBuff(state, { name: 'Straight Shot', unitId: t.id, chargeSpeedPct: csPct, atkPct, endTick });
          }
        },
      },
    ],
  },

  // ── Spark Shot
  // ■ Activates when the number of enemies exceeds {p00}. Affects self.
  // Critical Rate ▲ {p01}%.
  // Critical Damage ▲ {p02}%.
  //
  // group_id: 21022
  // p00 threshold (const): [5, ...]
  // p01 Crit Rate ▲%: [2.85, 3.07, 3.29, 3.51, 3.73, 3.95, 4.17, 4.39, 4.61, 4.83]
  // p02 Crit Damage ▲%: [8.22, 8.85, 9.48, 10.11, 10.74, 11.37, 12, 12.63, 13.27, 13.91]
  //
  // 模拟器为单 Boss 场景（敌人数 = 1），阈值 >5 永不满足，技能不激活。
  skill2: {
    groupId: 21022,
    triggers: [
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const enemyCount = state.enemyCount ?? 1;
          if (enemyCount <= 5) return false;

          const lv    = caster.skillLevels[1];
          const crPct = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const cdPct = getSkillValue(caster.rawSkill2, 2, lv) / 100;
          pushBuff(state, { name: 'Spark Shot', unitId: caster.id,
            critRatePct: crPct, critDamagePct: cdPct, endTick: Infinity });
        },
      },
    ],
  },

  // ── Pierce Shot
  // ■ Affects self.
  // Change the weapon in use:
  //   Damage: {p00}% of final ATK
  //   Full Charge Damage: 300% of damage
  //   Max Ammunition Capacity: 1 round
  //   Additional Effect: Pierce
  //
  // group_id: 11023
  // p00 Damage%: [144.85, 184.26, 223.67, 263.08, 302.5, 341.91, 381.32, 420.73, 460.14, 813.42]
  //
  // 全蓄力伤害 = p00 × 3（300% FC）；蓄力 2s；击发 1 发后自动归还原武器
  burst: {
    groupId: 11023,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const bLv             = caster.skillLevels[2];
          const hitMult         = getSkillValue(caster.rawBurst, 0, bLv) / 100;
          const chargeTimeTicks = Math.round(2 * TICK_RATE);

          caster.ammoLeft   = 1;
          caster.reloadTick = 0;

          caster.skillState.weaponSwitchHitMult          = hitMult;
          caster.skillState.weaponSwitchMaxAmmo          = 1;
          caster.skillState.weaponSwitchType             = 'SR';
          caster.skillState.weaponSwitchEndTick          = Infinity;
          caster.skillState.weaponSwitchRoundsLeft       = 1;
          caster.skillState.weaponSwitchChargeTimeTicks  = chargeTimeTicks;
          caster.skillState.weaponSwitchFullChargeDamage = 30000;  // 300% FC → × 10000 单位
          caster.skillState.weaponSwitchUnlimitedAmmo    = false;
          caster.skillState.weaponSwitchPierce           = true;

          caster.chargeTick = state.tick + chargeTimeTicks;
        },
      },
    ],
  },
};
