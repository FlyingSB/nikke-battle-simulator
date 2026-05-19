import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Lucky Charm
  // ■ Activates when above {p01=70}% HP. Affects all allies.
  //   ATK ▲ {p02}% of caster's ATK constantly.
  //
  // group_id: 22711
  // p01: [70, ...] (HP 阈值，固定)
  // p02: [8.32, 8.96, 9.6, 10.24, 10.88, 11.52, 12.16, 12.8, 13.44, 14.08] (ATK% of caster ATK)
  //
  // HP 条件在模拟器中恒满足，BATTLE_START 一次性施加永久 buff。
  skill1: {
    groupId: 22711,
    triggers: [
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const pct     = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100;
          const atkFlat = Math.round(caster.stats.atk * pct);
          pushBuff(state, { name: 'noir_s1_atkFlat', unitId: null,
            atkFlat, endTick: Infinity });
        },
      },
    ],
  },

  // ── Rabbit Twins B
  // ■ Activates when entering Full Burst. Affects all allies.
  //   Max Ammunition Capacity ▲ {p01} round(s) for {p02=10} sec.
  //   Reload {p03}% magazine(s).
  //
  // group_id: 22712
  // p01: [3, 3, 3, 3, 4, 4, 4, 4, 5, 5] (MaxAmmo flat 加成，整数发数)
  // p02: [10, ...] (持续时间，固定)
  // p03: [26.02, 27.56, 29.1, 30.64, 32.18, 33.72, 35.26, 36.8, 38.34, 39.88] (立即装填%)
  //
  // 弹匣扩充通过 noirAmmoBoostExtra/noirAmmoBoostEndTick 存入 skillState（见 battle.js 装填路径），
  // 同时立即按扩充后容量的 reloadPct 向全员补弹。
  skill2: {
    groupId: 22712,
    triggers: [
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const ammoFlat  = getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]);
          const reloadPct = getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]) / 100;
          const endTick   = state.tick + TICK_RATE * 10;
          for (const u of state.squad) {
            u.skillState.noirAmmoBoostExtra   = ammoFlat;
            u.skillState.noirAmmoBoostEndTick = endTick;
            const expandedMax = u.maxAmmo + ammoFlat;
            const reloadAmt   = Math.round(expandedMax * reloadPct);
            u.ammoLeft        = Math.min(expandedMax, u.ammoLeft + reloadAmt);
            if (state.ammoLog)
              state.ammoLog.push({ tick: state.tick, unitId: u.id, unitName: u.name,
                delta: reloadAmt, ammoAfter: u.ammoLeft, maxAmmo: expandedMax,
                maxAmmoDelta: ammoFlat, source: `noir_s2_maxAmmo(+${ammoFlat})_reload(${(reloadPct * 100).toFixed(2)}%)` });
          }
        },
      },
    ],
  },

  // ── Finale
  // ■ Affects all enemies.
  //   Deals {p01}% of final ATK as Burst Skill damage.
  // ■ Affects all allies with a Shotgun.
  //   Hit Rate ▲ {p02}% for {p03=10} sec.
  //   Damage to Interruption Parts ▲ {p04}% for {p05=10} sec.
  // ■ Activates with an ally from the same squad still on the battlefield. Affects all allies.
  //   Hit Rate ▲ {p06}% for {p07=30} sec.
  //   Damage to Interruption Parts ▲ {p08}% for {p09=30} sec.
  //
  // group_id: 12713
  // p01: [207.79, 223.77, 239.76, 255.74, 271.72, 287.71, 303.69, 319.68, 335.66, 351.64]
  // p02: [8.23, 8.87, 9.5, 10.13, 10.77, 11.4, 12.03, 12.67, 13.3, 13.93] (SG Hit Rate%)
  // p03: [10, ...] (SG buff 持续时间，固定)
  // p04: [13.72, 14.78, 15.84, 16.89, 17.95, 19, 20.06, 21.12, 22.17, 23.23] (SG Parts Dmg%)
  // p05: [10, ...] (SG Parts Dmg 持续时间，固定)
  // p06: [6.86, 7.39, 7.92, 8.44, 8.97, 9.5, 10.03, 10.56, 11.08, 11.61] (全员 Hit Rate%)
  // p07: [30, ...] (全员 buff 持续时间，固定)
  // p08: [11.44, 12.32, 13.2, 14.08, 14.96, 15.84, 16.72, 17.6, 18.48, 19.36] (全员 Parts Dmg%)
  // p09: [30, ...] (全员 Parts Dmg 持续时间，固定)
  //
  // Damage to Interruption Parts 伤害系统当前未建模，interruptionPartsDamagePct 字段已记录但不计入伤害输出。
  burst: {
    groupId: 12713,
    triggers: [
      // Part1：爆裂技能伤害（全敌）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const pct  = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, pct, sums, false, 'noir_burst_dmg');
        },
      },
      // Part2：霰弹枪友军 Hit Rate + Interruption Parts Dmg（10 sec）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const hitRatePct  = getSkillValue(caster.rawBurst, 1, caster.skillLevels[2]) / 100;
          const partsDmgPct = getSkillValue(caster.rawBurst, 3, caster.skillLevels[2]) / 100;
          const end10       = state.tick + TICK_RATE * 10;
          for (const u of state.squad) {
            if (u.weaponType !== 'SG') continue;
            pushBuff(state, { name: 'noir_burst_sg_hitRate',  unitId: u.id,
              hitRateBonus: hitRatePct, endTick: end10 });
            pushBuff(state, { name: 'noir_burst_sg_partsDmg', unitId: u.id,
              interruptionPartsDamagePct: partsDmgPct, endTick: end10 });
          }
        },
      },
      // Part3：同小队友军存活 → 全员 Hit Rate + Interruption Parts Dmg（30 sec）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const hasSquadAlly = state.squad.some(
            u => u.id !== caster.id && u.squad === caster.squad && u.unitHp > 0,
          );
          if (!hasSquadAlly) return;
          const hitRatePct  = getSkillValue(caster.rawBurst, 5, caster.skillLevels[2]) / 100;
          const partsDmgPct = getSkillValue(caster.rawBurst, 7, caster.skillLevels[2]) / 100;
          const end30       = state.tick + TICK_RATE * 30;
          pushBuff(state, { name: 'noir_burst_squad_hitRate',  unitId: null,
            hitRateBonus: hitRatePct, endTick: end30 });
          pushBuff(state, { name: 'noir_burst_squad_partsDmg', unitId: null,
            interruptionPartsDamagePct: partsDmgPct, endTick: end30 });
        },
      },
    ],
  },
};
