import { pushBuff, fireSkillHit, getBuffSums, enterIntoTheFray, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Scarlet: Goddeath  (resource_id: 472)
//
// 武器：Assault Rifle（InstantBox 宽幅判定，107.57%，弹匣 9，射速 90 RPM，换弹 1.17s，散布圈 scale 10）。
// 爆裂阶段 Step3，CD 40s。
// 爆裂切换武器：CDN ulti skill_value_data = [伤害 10757, 90, 切换武器 shot_id 1047202, 0, 1]，
// 第 2 项按 Moran / Takina 对照为切换武器射速（RPM）→ 90 RPM，与原武器相同。
// 切换武器 shot_id 1047202 无本地数据（弹匣未知）；S2 P1「不处于 Full Bloom 时」才补弹，
// 推断 Full Bloom 期间弹药不受限 → 按期间不耗弹建模（未实测）。

const SERENE_MIND = 'Serene Mind';
const AT_ONE_WITH_THE_SWORD = 'At One With the Sword';

// 是否处于 Beyond the Fade: Full Bloom（爆裂切换武器）期间
function inFullBloom(state, caster) {
  return (caster.skillState.sgdFullBloomEndTick ?? 0) > state.tick;
}

export default {

  // ── Beyond the Fade: Bloom
  // ■ Activates at the start of battle. Affects self.
  //   Into the Fray: Serene Mind
  //   Function: Normal attacks become wide-range piercing attacks and deal additional damage to the enemy.
  //   Effect 1: Affects self. Gains Pierce. This effect is continuous and cannot be removed.
  //   Effect 2: Affects self. Normal Attack Critical Rate ▲ {p01}%. This effect is continuous and cannot be removed.
  //   Effect 3: Activates when performing a normal attack. Affects the enemy unit nearest to the crosshair.
  //             Iai: Deals {p02}% of final ATK as additional damage.
  // ■ Activates when entering Full Burst. Affects self.
  //   Critical Damage ▲ {p03}% for {p04} sec.
  //
  // group_id: 24721
  // p01: [20.68 … 35]        （普攻暴击率 ▲%）
  // p02: [54.5 … 109]        （Iai 每次普攻附加伤害 %最终 ATK；At One With the Sword 期间 ×2）
  // p03: [33 … 60]           （暴击伤害 ▲%）
  // p04: [10, ...]
  //
  // 简化说明：「宽幅」攻击只影响多目标，单 Boss 无影响，不建模。
  skill1: {
    groupId: 24721,
    triggers: [
      // P1：开战进入 Into the Fray: Serene Mind（持续）；穿透 + 普攻暴击率 ▲（同对象、同为持续，合并为一条）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          enterIntoTheFray(caster, SERENE_MIND, Infinity);
          pushBuff(state, { name: SERENE_MIND, unitId: caster.id, pierce: true,
            normalAttackCritRatePct: getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100,
            endTick: Infinity });
        },
      },
      // P1 Effect 3：每次普通攻击（含 Full Bloom 切换武器）→ Iai 附加伤害 p02%；
      // S2 At One With the Sword 期间倍率 scaled by 100%（×2）
      // 技能伤害命中按默认规则充能（fireSkillHit 统一计算，battle-logic.md §6.1）
      {
        on: 'SHOT_COUNT',
        partOverride: 0,
        opts: { every: 1, counterKey: 'sgdIaiShots' },
        handler(state, caster) {
          if (state.enemyHp <= 0) return false;
          const scaled = (caster.skillState.sgdIaiScaledEndTick ?? 0) > state.tick;
          const mult = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100 * (scaled ? 2 : 1);
          fireSkillHit(state, caster, mult, getBuffSums(state, caster.id), 'S1 P1 Iai',
            { burstEnergySource: 'sgd_s1_iai' });
        },
      },
      // P2：进入全爆裂 → 自身暴击伤害 ▲ p03%（p04 秒）
      // 技能内唯一未具名 buff / 唯一未具名效果段 → 名称取技能名，日志标签省略 P 后缀
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          pushBuff(state, { name: 'Beyond the Fade: Bloom', unitId: caster.id,
            critDamagePct: getSkillValue(caster.rawSkill1, 2, lv) / 100,
            endTick: state.tick + Math.round(TICK_RATE * getSkillValue(caster.rawSkill1, 3, lv)) },
          { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },

  // ── Beyond the Fade: Sword Dance
  // ■ Activates after landing {p01} critical hits with normal attacks while not in the Beyond the Fade: Full Bloom state. Affects self.
  //   Reloads {p02} round(s).
  // ■ Activates when using Burst Skill. Affects self.
  //   Into the Fray: At One With the Sword
  //   Function: Enhances Iai damage and the offensive capabilities of normal attacks.
  //   Effect 1: Normal Attack Critical Rate ▲ {p03}% for {p04} sec. This effect cannot be removed.
  //   Effect 2: Attack Damage ▲ {p05}% for {p06} sec. This effect cannot be removed.
  //   Effect 3: Iai's additional damage is scaled by 100% for {p07} sec. This effect cannot be removed.
  //
  // group_id: 24722
  // p01: [2, ...]            （普攻暴击次数，常量）
  // p02: [1, ...]            （补弹发数，常量）
  // p03: [29.54 … 50]        （普攻暴击率 ▲%）
  // p04: [10, ...]
  // p05: [58 … 116]          （攻击伤害 ▲%）
  // p06: [10, ...]
  // p07: [10, ...]           （Iai 倍率 ×2 持续秒；由 S1 Iai 触发器读取 sgdIaiScaledEndTick）
  //
  // 说明：暴击按整发判定（射击上下文 ctx.isCrit，同 EVE）；Full Bloom 期间的暴击不计数。
  skill2: {
    groupId: 24722,
    triggers: [
      // P1：非 Full Bloom 期间普攻每暴击 p01 次 → 补弹 p02 发
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'sgdCritShots' },
        handler(state, caster, ctx) {
          if (!ctx?.isCrit || inFullBloom(state, caster)) return false;
          const lv = caster.skillLevels[1];
          const need = getSkillValue(caster.rawSkill2, 0, lv);
          const st = caster.skillState;
          st.sgdCritHits = (st.sgdCritHits ?? 0) + 1;
          if (st.sgdCritHits < need) return false;
          st.sgdCritHits = 0;
          const rounds = getSkillValue(caster.rawSkill2, 1, lv);
          const ammoBefore = caster.ammoLeft;
          caster.ammoLeft = Math.min(caster.maxAmmo, Math.max(0, caster.ammoLeft) + rounds);
          if (caster.ammoLeft >= caster.maxAmmo && caster.reloadTick > 0) caster.reloadTick = 0;
          if (state.ammoLog && caster.ammoLeft !== ammoBefore)
            state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
              delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft, maxAmmo: caster.maxAmmo,
              source: 'sgd_s2_reload' });
        },
      },
      // P2：施放爆裂技能 → 进入 Into the Fray: At One With the Sword
      // 普攻暴击率 ▲ / 攻击伤害 ▲：同对象、不同乘区，持续时间 p04 = p06（常量 10s）→ 合并为一条；
      // Iai 倍率 ×2 记录到期 tick 供 S1 读取
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          const raw = caster.rawSkill2;
          const end = state.tick + Math.round(TICK_RATE * getSkillValue(raw, 3, lv));
          enterIntoTheFray(caster, AT_ONE_WITH_THE_SWORD, end);
          pushBuff(state, { name: AT_ONE_WITH_THE_SWORD, unitId: caster.id,
            normalAttackCritRatePct: getSkillValue(raw, 2, lv) / 100,
            attackDamagePct: getSkillValue(raw, 4, lv) / 100,
            endTick: end });
          caster.skillState.sgdIaiScaledEndTick = state.tick + Math.round(TICK_RATE * getSkillValue(raw, 6, lv));
        },
      },
    ],
  },

  // ── Beyond the Fade: Goddeath
  // ■ Affects self.
  //   Beyond the Fade: Full Bloom: Changes the weapon in use.
  //   Function: Enhances Scarlet: Goddeath and increases the range of normal attacks.
  //   Damage: {p01}% of final ATK
  //   Duration: {p02} sec
  //   Additional Effects
  //   Effect 1: Normal Attack Range ▲ 100% for {p03} sec. This effect cannot be removed.
  //   Effect 2: ATK ▲ {p04}% for {p05} sec. This effect cannot be removed.
  // ■ Affects the {p06} enemy unit(s) nearest to the crosshair.
  //   Deals {p07}% of final ATK as additional damage.
  //
  // group_id: 14723
  // p01: [107.57 … 115]      （切换武器每发 %最终 ATK）
  // p02: [10, ...]           （切换持续秒）
  // p03: [10, ...]           （普攻射程 ▲；单 Boss 无影响，不建模）
  // p04: [66 … 120]          （ATK ▲%）
  // p05: [10, ...]
  // p06: [1, ...]            （目标数，单 Boss 恒为 1）
  // p07: [1649.98 … 3000]    （附加伤害 %最终 ATK）
  //
  // 【全爆裂加成】P2 受影响（描述 as additional damage），未实测。
  burst: {
    groupId: 14723,
    triggers: [
      // P1：切换为 Full Bloom 武器 p02 秒 + 自身 ATK ▲ p04%（p05 秒）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];
          const raw = caster.rawBurst;
          const end = state.tick + Math.round(TICK_RATE * getSkillValue(raw, 1, lv));
          Object.assign(caster.skillState, {
            sgdFullBloomEndTick:       end,
            weaponSwitchHitMult:       getSkillValue(raw, 0, lv) / 100,
            weaponSwitchType:          'AR',
            weaponSwitchEndTick:       end,
            weaponSwitchRoundsLeft:    0,
            weaponSwitchUnlimitedAmmo: true,
            weaponSwitchRateOfFire:    raw?.skill_value_data?.[1]?.skill_value ?? 90,
            // 切换武器无散布数据，沿用原武器散布圈（scale 10）
            weaponSwitchAccuracyScale: caster.accStartScale ?? 10,
          });
          caster.reloadTick = 0;
          if (caster.ammoLeft <= 0) caster.ammoLeft = caster.maxAmmo;
          pushBuff(state, { name: 'Beyond the Fade: Full Bloom (ATK)', unitId: caster.id,
            atkPct: getSkillValue(raw, 3, lv) / 100,
            endTick: state.tick + Math.round(TICK_RATE * getSkillValue(raw, 4, lv)) });
        },
      },
      // P2：准星最近的 p06 名敌人 → p07% 附加伤害（单 Boss 仅 1 次）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (state.enemyHp <= 0) return false;
          const mult = getSkillValue(caster.rawBurst, 6, caster.skillLevels[2]) / 100;
          fireSkillHit(state, caster, mult, getBuffSums(state, caster.id), 'Burst',
            { affectedByFullBurst: true });
        },
      },
    ],
  },
};
