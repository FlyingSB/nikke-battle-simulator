import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Sugar  (resource_id: 140)
// SSR 珍藏品: Commemorative Keychain（id: 202101）
// 所有三个技能槽均被 SSR 珍藏品替换（skill_change_slot=1/2/3），仅建模 SSR 版（见 docs/ssr-collectible-rules.md）。

// 水冷 / 铁甲代码的霰弹枪友军（S2 P3、Burst P2 的作用对象）
function waterIronShotgunAllies(state) {
  return state.squad.filter(u => u.weaponType === 'SG' && (u.element === 'Water' || u.element === 'Iron'));
}

export default {

  // ── Black Typhoon（S1）
  // SSR group_id: 121401（skill_change_slot=1）
  // ■ Activates when cover is attacked. Affects self.
  //   Critical Damage ▲ {p00}% for {p01} sec.
  //   Reload Speed ▲ {p02}% for {p03} sec.
  //   Restores cover HP equal to {p04}% of the skill user's final max HP.
  // ■ Activates if this unit's cover is still intact. Affects self.
  //   Attack Damage ▲ {p06}% continuously.
  // ■ Activates at the start of battle. Affects self.
  //   Converts damage to Elemental Advantage damage against Fire Code enemies. This effect is continuous and cannot be removed.
  // p00 Critical Damage ▲%: [9.68 … 16.39]
  // p01 sec (const):        [10,...]
  // p02 Reload Speed ▲%:    [7.16 … 12.12]
  // p03 sec (const):        [10,...]
  // p04 cover heal %:       [0.89 … 1.5]
  // p05 （空）
  // p06 Attack Damage ▲%:   [10.99 … 19.98]
  skill1: {
    groupId: 121401,
    triggers: [
      // P1：掩体受到攻击 — 模拟器不建模敌方攻击（同 222.js "when attacked"），占位
      {},
      // P2：掩体未被破坏 → 攻击伤害 ▲ p06%，永久（模拟器掩体不会被破坏）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          pushBuff(state, { name: 'Black Typhoon (Attack Damage)', unitId: caster.id,
            attackDamagePct: getSkillValue(s1, 6, s1._activeSkillLevel) / 100,
            endTick: Infinity });
        },
      },
      // P3：战斗开始 → 对燃烧代码敌人的伤害视为优越代码伤害，永久
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          pushBuff(state, { name: 'Black Typhoon (Elem Adv)', unitId: caster.id,
            elementAdvantageVs: 'Fire', endTick: Infinity });
        },
      },
    ],
  },

  // ── Noire Sensor（S2）
  // SSR group_id: 121402（skill_change_slot=2）
  // ■ Activates when entering Full Burst. Affects self.
  //   Critical Rate ▲ {p00}% for {p01} sec.
  //   ATK ▲ {p02}% for {p03} sec.
  // ■ Activates when entering Full Burst. Affects all allies with shotguns.
  //   Max Ammunition Capacity ▲ {p04}% for {p05} sec.
  // ■ Activates when entering Full Burst. Affects all Water Code and Iron Code allies with shotguns.
  //   Elemental Advantage Attack Damage ▲ {p06}% for {p07} sec.
  // p00 Critical Rate ▲%:       [7.69 … 13.02]
  // p01 sec (const):            [10,...]
  // p02 ATK ▲%:                 [13.76 … 25.01]
  // p03 sec (const):            [10,...]
  // p04 Max Ammo ▲%:            [49.52 … 83.8]
  // p05 sec (const):            [15,...]
  // p06 Elem Adv Attack Dmg ▲%: [20.01 … 40.02]
  // p07 sec (const):            [15,...]
  skill2: {
    groupId: 121402,
    triggers: [
      // P1：进入全爆裂 → 自身暴击率 ▲ + ATK ▲ 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          pushBuff(state, { name: 'Noire Sensor (ATK)', unitId: caster.id,
            critRatePct: getSkillValue(s2, 0, lv) / 100,
            atkPct:      getSkillValue(s2, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 1, lv) });
        },
      },
      // P2：进入全爆裂 → 全体霰弹枪友军最大弹匣 ▲ p04% 15s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          pushBuff(state, { name: 'Noire Sensor (Max Ammo)', unitId: null, weaponFilter: 'SG',
            maxAmmoPct: getSkillValue(s2, 4, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(s2, 5, lv) });
        },
      },
      // P3：进入全爆裂 → 水冷/铁甲霰弹枪友军优越代码伤害 ▲ p06% 15s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const s2 = caster.ssrFavSkills.skill2;
          const lv = s2._activeSkillLevel;
          const endTick = state.tick + TICK_RATE * getSkillValue(s2, 7, lv);
          pushBuff(state, { name: 'Noire Sensor (Elem Adv Damage)',
            unitIds: waterIronShotgunAllies(state).map(u => u.id),
            elementAdvantagePct: getSkillValue(s2, 6, lv) / 100, endTick });
        },
      },
    ],
  },

  // ── Trouble Shooter（Burst）
  // SSR group_id: 111403（skill_change_slot=3）
  // ■ Affects self.
  //   Attack Speed ▲ {p00}% for {p01} sec.
  //   Hit Rate ▲ {p02}% for {p03} sec.
  //   ATK ▲ {p04}% for {p05} sec.
  // ■ Affects all Water Code and Iron Code allies with shotguns.
  //   Elemental Advantage Attack Damage ▲ {p06}% for {p07} sec.
  // p00 Attack Speed ▲%:        [39 … 66]
  // p01 sec (const):            [15,...]
  // p02 Hit Rate ▲%:            [19.5 … 33]
  // p03 sec (const):            [15,...]
  // p04 ATK ▲%:                 [11 … 20]
  // p05 sec (const):            [15,...]
  // p06 Elem Adv Attack Dmg ▲%: [30.01 … 60.01]
  // p07 sec (const):            [15,...]
  burst: {
    groupId: 111403,
    triggers: [
      // P1：自身攻速 / 命中率 / ATK ▲ 15s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const burst = caster.ssrFavSkills.burst;
          const lv    = burst._activeSkillLevel;
          pushBuff(state, { name: 'Trouble Shooter (ATK)', unitId: caster.id,
            atkSpeedPct: getSkillValue(burst, 0, lv) / 100,
            hitRatePct:  getSkillValue(burst, 2, lv) / 100,
            atkPct:      getSkillValue(burst, 4, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(burst, 1, lv) });
        },
      },
      // P2：水冷/铁甲霰弹枪友军优越代码伤害 ▲ p06% 15s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const burst = caster.ssrFavSkills.burst;
          const lv    = burst._activeSkillLevel;
          const endTick = state.tick + TICK_RATE * getSkillValue(burst, 7, lv);
          pushBuff(state, { name: 'Trouble Shooter (Elem Adv Damage)',
            unitIds: waterIronShotgunAllies(state).map(u => u.id),
            elementAdvantagePct: getSkillValue(burst, 6, lv) / 100, endTick });
        },
      },
    ],
  },
};
