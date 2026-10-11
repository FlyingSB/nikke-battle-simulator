import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Jill  (resource_id: 841)
//
// 武器：Assault Rifle（150 RPM，弹匣 9，装填 1s）。爆裂阶段 Step3，CD 40s。

const ACID_ARMED_KEY = 'jillAcidArmed';
const ACID_DOT_NAME  = 'jill_acid_ammo';

// S1 P1：Magnum Ammo — 普通攻击伤害倍率 ▲ p00%，持续 p01 发
function applyMagnumAmmo(state, caster) {
  const lv = caster.skillLevels[0];
  // TODO(实测) "Normal Attack Damage Multiplier" 按项目惯例建模为 normalAttackDamagePct（同 405.js）
  pushBuff(state, { name: 'Magnum Ammo', unitId: caster.id,
    normalAttackDamagePct: getSkillValue(caster.rawSkill1, 0, lv) / 100,
    endRounds: getSkillValue(caster.rawSkill1, 1, lv) });
}

export default {

  // ── Magnum Ammo（S1）
  // ■ Activates at the start of battle and upon reloading to Max Ammunition. Affects self.
  //   Magnum Ammo: Normal Attack Damage Multiplier ▲ {p00}% for {p01} round(s).
  // ■ Activates when using Burst Skill. Affects self.
  //   True Damage ▲ {p02}% for {p03} sec.
  // p00: [17.01,18.46,19.9,21.34,22.79,24.23,25.67,27.12,28.56,30]
  // p01: [9,...]
  // p02: [20.59,22.19,23.79,25.39,26.99,28.59,30.19,31.79,33.39,34.99]
  // p03: [10,...]
  skill1: {
    triggers: [
      // P1：战斗开始
      { on: 'BATTLE_START', handler(state, caster) { applyMagnumAmmo(state, caster); } },
      // P2：使用爆裂技能 → 自身 True Damage ▲ p02%（p03 秒）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          pushBuff(state, { name: 'Magnum Ammo (True Damage)', unitId: caster.id,
            trueDamagePct: getSkillValue(caster.rawSkill1, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 3, lv) });
        },
      },
      // P1：装填至满弹
      { on: 'RELOAD_END', partOverride: 0, handler(state, caster) { applyMagnumAmmo(state, caster); } },
    ],
  },

  // ── Acid Ammo（S2）
  // ■ Activates at the start of battle and upon reloading to max ammunition. Affects self.
  //   Acid Ammo
  //   Function: Upon reloading to max ammunition, only the first round deals sustained damage to the target.
  //   Effect: Deals {p00}% of final ATK as sustained damage every 1 sec for {p01} sec.
  // ■ Activates when entering Full Burst. Affects self.
  //   ATK ▲ {p02}% for {p03} sec.
  // p00: [113.45,122.18,130.9,139.63,148.36,157.09,165.81,174.54,183.27,192]
  // p01: [30,...]
  // p02: [22.15,24.13,26.12,28.11,30.1,32.08,34.07,36.06,38.04,40.03]
  // p03: [10,...]
  skill2: {
    triggers: [
      // P1：战斗开始 / 装填至满弹 → 下一发普攻附带 Acid Ammo
      { on: 'BATTLE_START', handler(state, caster) { caster.skillState[ACID_ARMED_KEY] = true; } },
      // P1：附带 Acid Ammo 的那一发命中 → 持续伤害 p00% 最终 ATK / 秒，持续 p01 秒。
      //     同名 DoT 重复施加时刷新持续时间（不叠层）。
      {
        on: 'SHOT_COUNT',
        partOverride: 0,
        handler(state, caster) {
          if (!caster.skillState[ACID_ARMED_KEY]) return false;
          caster.skillState[ACID_ARMED_KEY] = false;
          const lv   = caster.skillLevels[1];
          const mult = getSkillValue(caster.rawSkill2, 0, lv) / 100;
          const end  = state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 1, lv);
          const existing = state.dots.find(d => d.dotName === ACID_DOT_NAME && d.casterId === caster.id);
          if (existing) {
            existing.multPerStack = mult;
            existing.endTick      = end;
          } else {
            state.dots.push({
              casterId:        caster.id,
              label:           'S2 P1 Acid Ammo',
              dotName:         ACID_DOT_NAME,
              multPerStack:    mult,
              stacks:          1,
              endTick:         end,
              nextFireTick:    state.tick + TICK_RATE,
              intervalTicks:   TICK_RATE,
              sustainedDamage: true,
            });
          }
        },
      },
      // P2：进入全爆裂 → 自身 ATK ▲ p02%（p03 秒）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Acid Ammo', unitId: caster.id,
            atkPct: getSkillValue(caster.rawSkill2, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 3, lv) });
        },
      },
      { on: 'RELOAD_END', partOverride: 0, handler(state, caster) { caster.skillState[ACID_ARMED_KEY] = true; } },
    ],
  },

  // ── Supercop（Burst）
  // ■ Affects self.
  //   Reloading Speed is fixed at a {p00}% increase for {p01} sec.
  //   Removes {p04}% of bullets.
  //   Forced Reload
  //   Hit Rate ▲ {p05}% for {p06} sec.
  //   Attack Damage ▲ {p07}% for {p08} sec.
  //   Normal attacks deal True Damage for {p09} sec.
  // p00: [54.6,59.64,64.68,69.72,74.76,79.8,84.84,89.88,94.92,99.96]
  // p01: [10,...]
  // p04: [100,...]
  // p05: [47.73,51.4,55.08,58.75,62.42,66.09,69.76,73.44,77.11,80.78]
  // p06: [10,...]
  // p07: [42.43,46.05,49.67,53.28,56.9,60.52,64.14,67.76,71.38,75]
  // p08: [10,...]
  // p09: [10,...]
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const raw = caster.rawBurst;
          // 换弹速度固定为 +p00%（屏蔽其他换弹速度效果），p01 秒
          caster.skillState.fixedReloadSpeedPct     = getSkillValue(raw, 0, lv) / 100;
          caster.skillState.fixedReloadSpeedEndTick = state.tick + TICK_RATE * getSkillValue(raw, 1, lv);
          // 移除 p04% 弹药 + 强制装填（弹匣归零，下一 tick 起按固定换弹速度装填，完成时触发 RELOAD_END）
          const removed = Math.round(caster.ammoLeft * getSkillValue(raw, 4, lv) / 100);
          caster.ammoLeft -= removed;
          if (caster.ammoLeft <= 0) {
            caster.ammoLeft = 0;
            caster.reloadTick = 0;
            caster.backswingReloadTick = 0;
          }
          // 命中率 ▲ + 攻击伤害 ▲ + 普攻真实伤害（同为自身 10s，合并为一条）
          pushBuff(state, { name: 'Supercop', unitId: caster.id,
            hitRatePct:      getSkillValue(raw, 5, lv) / 100,
            attackDamagePct: getSkillValue(raw, 7, lv) / 100,
            normalAttackTrueDamage: true,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 6, lv) },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },
};
