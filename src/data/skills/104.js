import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Drake: Great Villain  (resource_id: 104)
//
// 武器：Shotgun（10 弹丸，弹匣 9，RPM 90，装填 1.5s）。Defender，爆裂阶段 Step3，CD 40s。

// Super Duper Overdrive 固定参数（技能描述文本内常量，不在 description_value_list 中）
const SDO_CHARGE_TICKS  = Math.round(1.5 * TICK_RATE);  // Charge Time: Fixed at 1.5 sec
const SDO_FULL_CHARGE   = 30000;                        // Full Charge Damage: 300%（×10000 单位）
const SDO_CORE_RATE     = 0.20;                         // 15 弹丸霰弹散布 → 沿用 SG 核心率

function sdoActive(state, caster) {
  return caster.skillState.dgv_sdoActive === true
    && (caster.skillState.weaponSwitchEndTick ?? 0) > 0
    && state.tick <= caster.skillState.weaponSwitchEndTick;
}

// S2 P2：按当前最终 MaxHP 重算「HP→ATK」flat buff（S2 P1 叠层或外部 MaxHP buff 变化后调用）。
function recalcFashionablyLate(state, caster) {
  const sums    = getBuffSums(state, caster.id);
  const finalHp = caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
  const atkFlat = Math.round(finalHp * getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) / 100);
  const existing = state.buffs.find(b => b.name === 'Fashionably Late' && b.unitId === caster.id);
  if (existing) existing.atkFlat = atkFlat;
  else pushBuff(state, { name: 'Fashionably Late', unitId: caster.id, atkFlat, endTick: Infinity });
}

export default {

  // ── Super Duper Overdrive
  // ■ Activates when entering Full Burst. Affects self.
  // Changes the weapon in use: Super Duper Overdrive
  //   Charge Time: Fixed at 1.5 sec / Damage: {p01}% of final ATK / Pellet Count: 15
  //   Full Charge Damage: 300% / Max Ammunition Capacity: {p02}
  // ■ Activates when Super Duper Overdrive ends. Affects self.
  // Removes {p03}% of ammo.
  // p01: [121.88 … 243.75] （每次射击伤害 %ATK，15 弹丸合计；全蓄力 ×3）
  // p02: [6,...]           （弹匣容量）
  // p03: [100,...]         （结束时移除弹药 %）
  //
  // 建模：以 'Charged' 类型武器切换实现（获得蓄力倍率），发间固定 90t 不受蓄速影响、无前后摇；
  //   核心率按霰弹 20%（weaponSwitchCoreRate）。结束时机 = 全爆裂结束（FULL_BURST_END）。
  //   弹药打空时自然装填，完成后截断至 p02 发（引擎装填按原武器弹匣上限填充）。
  //   结束时移除 p03% 弹药并抑制引擎「切换结束补满原武器弹匣」→ 回到原武器立即进入装填。
  skill1: {
    groupId: 21041,
    triggers: [
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv   = caster.skillLevels[0];
          const ammo = getSkillValue(caster.rawSkill1, 1, lv);

          caster.ammoLeft   = ammo;
          caster.reloadTick = 0;
          Object.assign(caster.skillState, {
            dgv_sdoActive:                true,
            weaponSwitchHitMult:          getSkillValue(caster.rawSkill1, 0, lv) / 100,
            weaponSwitchMaxAmmo:          ammo,
            weaponSwitchType:             'Charged',
            weaponSwitchEndTick:          Infinity,
            weaponSwitchRoundsLeft:       0,
            weaponSwitchChargeTimeTicks:  SDO_CHARGE_TICKS,
            weaponSwitchFullChargeDamage: SDO_FULL_CHARGE,
            weaponSwitchUnlimitedAmmo:    false,
            weaponSwitchPierce:           false,
            weaponSwitchCoreRate:         SDO_CORE_RATE,
            weaponSwitchLabel:            caster.rawSkill1?.name_localkey ?? 'S1',
          });
          caster.chargeTick = state.tick + SDO_CHARGE_TICKS;
        },
      },

      // Super Duper Overdrive 期间装填完成：弹匣截断至 p02，并重新蓄力 1.5s。
      {
        on: 'RELOAD_END',
        partOverride: 0,
        handler(state, caster) {
          if (!sdoActive(state, caster)) return;
          caster.ammoLeft   = Math.min(caster.ammoLeft, caster.skillState.weaponSwitchMaxAmmo);
          caster.chargeTick = state.tick + SDO_CHARGE_TICKS;
        },
      },

      // S1 P2：Super Duper Overdrive 结束（全爆裂结束）→ 移除 p03% 弹药。
      {
        on: 'FULL_BURST_END',
        partOverride: 1,
        handler(state, caster) {
          const st = caster.skillState;
          if (!st.dgv_sdoActive) return;
          st.dgv_sdoActive        = false;
          st.weaponSwitchEndTick  = state.tick - 1;
          st.weaponSwitchCoreRate = null;
          st.weaponSwitchLabel    = null;
          // 标记本次切换结束已处理，阻止引擎在下一次射击判定时补满原武器弹匣
          st._weaponSwitchAmmoFilled = st.weaponSwitchEndTick;

          const pct = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          const ammoBefore  = caster.ammoLeft;
          caster.ammoLeft   = Math.max(0, caster.ammoLeft - Math.ceil(caster.maxAmmo * pct));
          caster.reloadTick = 0;
          if (state.ammoLog && caster.ammoLeft !== ammoBefore)
            state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
              delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft,
              maxAmmo: caster.maxAmmo, source: 'Super Duper Overdrive' });
        },
      },
    ],
  },

  // ── Fashionably Late Villain
  // ■ Activates when Full Burst ends. Affects all allies.
  // Max HP ▲ {p02}% of the skill user's max HP (without restoring HP) continuously.
  // Stacks up to {p03} times.
  // ■ Activates at the start of battle. Affects self.
  // Fashionably Late: ATK ▲ {p01}% of the skill user's final max HP continuously.
  // p01: [3.12 … 6.23]     （最终 MaxHP → ATK flat %）
  // p02: [5.77 … 10.5]     （每层 Max HP flat，%施法者 MaxHP）
  // p03: [4,...]           （层数上限）
  //
  // p02「skill user's max HP」（非 final）→ 取施法者基础面板 caster.stats.hp，避免递归放大。
  // p01「final max HP」随 MaxHP 变化实时生效：战斗开始、自身叠层后、爆裂施放 / 进入全爆裂时刷新。
  skill2: {
    groupId: 21042,
    triggers: [
      // S2 P1：全爆裂结束 → 全队 Max HP flat 叠层（上限 p03），随后刷新 P2。
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          // S2 唯一未具名效果段（P2 为 Fashionably Late）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Fashionably Late Villain', unitId: null,
            maxHpFlat:  Math.round(caster.stats.hp * getSkillValue(caster.rawSkill2, 1, lv) / 100),
            stackLimit: getSkillValue(caster.rawSkill2, 2, lv),
            endTick:    Infinity }, { ...state._logCtx, partIdx: null });
          recalcFashionablyLate(state, caster);
        },
      },

      // S2 P2：战斗开始 → Fashionably Late（ATK ▲ p01% × 最终 MaxHP，永久）。
      {
        on: 'BATTLE_START',
        handler(state, caster) { recalcFashionablyLate(state, caster); },
      },
      {
        on: 'BURST_SKILL_USE',
        partOverride: 1,
        handler(state, caster) { recalcFashionablyLate(state, caster); },
      },
      {
        on: 'ENTER_FULL_BURST',
        partOverride: 1,
        handler(state, caster) { recalcFashionablyLate(state, caster); },
      },
    ],
  },

  // ── Special Villainous Web
  // ■ Affects self.
  // Attack Damage ▲ {p01}% for {p02} sec.
  // ■ Affects all enemies.
  // Deals {p03}% of final ATK as Burst Skill damage.
  // p01: [13.75 … 27.5]    （攻击伤害 ▲%）
  // p02: [25,...]          （持续秒数）
  // p03: [750 … 1350]      （爆裂技能伤害 %ATK）
  burst: {
    groupId: 11043,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];
          // 爆裂技能唯一的效果段（P2 为伤害）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Special Villainous Web', unitId: caster.id,
            attackDamagePct: getSkillValue(caster.rawBurst, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawBurst, 1, lv) },
            { ...state._logCtx, partIdx: null });
          if (state.enemyHp <= 0) return;
          fireSkillHit(state, caster, getSkillValue(caster.rawBurst, 2, lv) / 100,
            getBuffSums(state, caster.id), 'Burst');
        },
      },
    ],
  },
};
