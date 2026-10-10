import { pushBuff, fireSkillHit, addBurstGauge, getBuffSums, recalcMaxAmmo,
         TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { executeSkillTriggers } from '../../engine/skill-executor.js';
import { getSkillValue } from '../../data/models.js';

// Character: Cinderella: Crystal Wave  (resource_id: 515)
//
// 武器：MG（弹匣 300，60 → 4200 RPM 起速，装填 2.5s，核心 ×2）。Attacker，爆裂 Step3，CD 40s。
//
// ── 形态切换机制（S1 P1 / P3）──
//   · 任意一次装填到满弹 → 进入 Preparation for Change（6s，换弹时间固定 3s，打出末弹时移除）。
//   · Preparation for Change 期间再次装填到满弹 → 切换为 Snipe Mode（再次满足则切回 MG）。
//   · Snipe Mode：DOWN_Charge 型狙击（持续按住、固定蓄力 1s 自动击发）、Pierce，弹匣以 15 发为基础
//     重算（装备词条 / 珍藏品 / 魔方等装弹数效果按 15 发基础生效），每发实际扣 1 发；
//     「全蓄力攻击 Expends ammo 40 发」仅指该发按 40 发计入全队累计消耗弹药（S1 P5 等计数），不是真实消耗。
//     末弹移除 Preparation for Change，弹匣耗时远超 6s，故 Snipe Mode 期间的装填不会再触发切换，形态稳定。
//     距离优势仍按原武器 MG 判定（引擎既有规则）。
//   · 自动战斗永不主动装填 → 默认恒为 MG 形态。UI 开关「进入战斗时切换到 Snipe Mode」
//     （config.ccwSnipeModeAtStart → unit.ccwSnipeModeAtStart）按手动打法模拟：
//     射击 1 发 → 立即装填（满弹时无法手动装填）→ 射击 1 发 → 立即装填 → 第二次装填完成即进入 Snipe Mode。
//
// 注：与 bunny-shared.js 相同，存在仅运行时调用的循环导入（skill-executor ↔ skill-traits）。

// Snipe Mode / Preparation for Change 固定参数（技能描述文本内常量，不在 description_value_list 中）
const SNIPE_CHARGE_TICKS = Math.round(1 * TICK_RATE);  // Charge Time: 1 sec（固定，不受蓄速影响）
const SNIPE_FULL_CHARGE  = 25000;                       // Full Charge Damage: 250%（×10000 单位）
const SNIPE_BASE_AMMO    = 15;                          // Max Ammunition Capacity: 15 rounds（基础弹匣，装弹数效果按此重算）
const PFC_RELOAD_TICKS   = Math.round(3 * TICK_RATE);  // Preparation for Change: Reload time fixed at 3 sec
const FAV_AMMO_BUFF_NAME = 'Fav Ammo';                  // 引擎 initBattle 推入的珍藏品装弹数永久 buff（maxAmmoFlat）
const PFC_BUFF_NAME      = 'Preparation for Change';
const SNIPE_BUFF_NAME    = 'Snipe Mode';
const SNIPE_SHOT_LABEL   = 'S1 P1 Snipe Mode';          // Snipe Mode 普攻命中标签（描述给出武器名）

/** 当前是否处于 Snipe Mode（武器切换生效中）。 */
export function snipeModeActive(state, caster) {
  const st = caster.skillState;
  return st.ccw_snipeActive === true
    && (st.weaponSwitchEndTick ?? 0) > 0
    && state.tick <= st.weaponSwitchEndTick;
}

/** 当前是否处于 Preparation for Change 状态（以哨兵 buff 为准）。 */
function pfcActive(state, caster) {
  return state.buffs.some(b => b.unitId === caster.id && b.name === PFC_BUFF_NAME && b.endTick > state.tick);
}

/** 授予 / 刷新 Preparation for Change：哨兵 buff（日志展示）+ 引擎固定换弹时长。 */
function grantPreparationForChange(state, caster, logCtx) {
  const secs    = getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]);
  const endTick = state.tick + TICK_RATE * secs;
  pushBuff(state, { name: PFC_BUFF_NAME, unitId: caster.id, endTick }, logCtx);
  caster.skillState.fixedReloadTicks   = PFC_RELOAD_TICKS;
  caster.skillState.fixedReloadEndTick = endTick;
}

/** 移除 Preparation for Change（打出末弹）。 */
function removePreparationForChange(state, caster) {
  state.buffs = state.buffs.filter(b => !(b.unitId === caster.id && b.name === PFC_BUFF_NAME));
  caster.skillState.fixedReloadEndTick = 0;
}

/** 派发 SNIPE_MODE_CHANGED（S2 据此切换 Destroy / Pinpoint），保存并恢复外层日志上下文。 */
function dispatchSnipeModeChanged(state, caster, active) {
  const outerLogCtx = state._logCtx;
  executeSkillTriggers(state, 'SNIPE_MODE_CHANGED', { unit: caster, active });
  state._logCtx = outerLogCtx;
}

/**
 * Snipe Mode 换弹后首发排定：DOWN_Charge 型换弹后首发 = 换弹完成 + 对准期（前摇）+ 固定蓄力 1s。
 * 末发后摇已计入引擎换弹相位（reloadRecoveryTicks），此处不重复计算。
 */
function scheduleSnipeShotAfterReload(state, caster) {
  caster.chargeTick = state.tick + (caster.reloadAimTicks ?? 0) + SNIPE_CHARGE_TICKS;
}

/**
 * 切换当前武器的基础弹匣并重算最大装弹数：装备词条（OL Ammo，百分比 buff）随 baseAmmo 自动按新基础生效；
 * 珍藏品装弹数（Fav Ammo，引擎按原武器基础预先折成 flat）按同一百分比以新基础重算。
 * recalcMaxAmmo 在上限下降时截断当前弹药（§5.1.3）。
 */
function setWeaponBaseAmmo(state, caster, baseAmmo) {
  const mgBaseAmmo = caster.skillState.ccw_mgBaseAmmo;
  const favBuff    = state.buffs.find(b => b.unitId === caster.id && b.name === FAV_AMMO_BUFF_NAME);
  if (favBuff && mgBaseAmmo > 0) {
    const favPct = (caster.favMaxAmmoFlat ?? 0) / mgBaseAmmo;
    favBuff.maxAmmoFlat = Math.round(baseAmmo * favPct);
  }
  caster.baseAmmo = baseAmmo;
  const ammoBefore = caster.ammoLeft;
  recalcMaxAmmo(state, caster);
  if (state.ammoLog && caster.ammoLeft !== ammoBefore)
    state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
      delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft,
      maxAmmo: caster.maxAmmo, source: SNIPE_BUFF_NAME });
}

/** 进入 Snipe Mode：以 'SR' 类型武器切换实现（蓄力倍率、必中核心、Pierce），永久直至再次切换。 */
function enterSnipeMode(state, caster) {
  const lv = caster.skillLevels[0];
  caster.skillState.ccw_mgBaseAmmo ??= caster.baseAmmo;
  Object.assign(caster.skillState, {
    ccw_snipeActive:              true,
    weaponSwitchHitMult:          getSkillValue(caster.rawSkill1, 0, lv) / 100,
    weaponSwitchMaxAmmo:          null,     // 弹匣上限随 unit.maxAmmo（15 发基础 + 装弹数效果）
    weaponSwitchFixedAmmo:        false,    // 装弹数效果 / Bastion 补弹照常作用
    weaponSwitchType:             'SR',
    weaponSwitchEndTick:          Infinity,
    weaponSwitchRoundsLeft:       0,
    weaponSwitchChargeTimeTicks:  SNIPE_CHARGE_TICKS,
    weaponSwitchFullChargeDamage: SNIPE_FULL_CHARGE,
    weaponSwitchUnlimitedAmmo:    false,
    weaponSwitchPierce:           true,
    // 「Expends ammo. Amount: 40」：每发按 40 发计入全队累计消耗弹药（S1 P5 等计数），实际弹匣仍扣 1 发
    weaponSwitchAmmoCountPerShot: getSkillValue(caster.rawSkill1, 1, lv),
    weaponSwitchCoreRate:         null,
    weaponSwitchLabel:            SNIPE_SHOT_LABEL,
  });
  // 形态哨兵 buff（无数值字段），仅用于战斗日志展示当前形态
  pushBuff(state, { name: SNIPE_BUFF_NAME, unitId: caster.id, endTick: Infinity }, state._logCtx);
  // 弹匣以 15 发为基础重算（刚装填到满弹 → 截断为 Snipe Mode 满弹匣）
  setWeaponBaseAmmo(state, caster, SNIPE_BASE_AMMO);
  scheduleSnipeShotAfterReload(state, caster);
  dispatchSnipeModeChanged(state, caster, true);
}

/** 移除 Snipe Mode（Preparation for Change 期间再次装填到满弹）：回到 MG 形态。 */
function exitSnipeMode(state, caster) {
  const st = caster.skillState;
  st.ccw_snipeActive              = false;
  st.weaponSwitchEndTick          = state.tick - 1;
  // 退出发生在装填完成时：下面重算弹匣后直接填满原武器弹匣，并阻止引擎在下一次射击判定时再次补满
  st._weaponSwitchAmmoFilled      = st.weaponSwitchEndTick;
  st.weaponSwitchAmmoCountPerShot = null;
  st.weaponSwitchLabel            = null;
  state.buffs = state.buffs.filter(b => !(b.unitId === caster.id && b.name === SNIPE_BUFF_NAME));
  setWeaponBaseAmmo(state, caster, st.ccw_mgBaseAmmo);
  caster.ammoLeft = caster.maxAmmo;
  dispatchSnipeModeChanged(state, caster, false);
}

/** 手动装填：清空弹匣让引擎于下一 tick 按常规换弹流程开始装填（不触发 LAST_BULLET）。 */
function startManualReload(state, caster) {
  const ammoBefore = caster.ammoLeft;
  caster.ammoLeft            = 0;
  caster.reloadTick          = 0;
  caster.backswingReloadTick = 0;
  if (state.ammoLog && ammoBefore !== 0)
    state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
      delta: -ammoBefore, ammoAfter: 0, maxAmmo: caster.maxAmmo, source: 'manual_reload' });
}

export default {

  // ── Beauty-Full
  // ■ Activates upon reloading to max ammunition while in the Preparation for Change state. Affects self.
  // Changes the weapon in use: Snipe Mode（Charge 1s / Damage {p01}% ATK / Full Charge 250% / Max Ammo 15 / Pierce /
  //   Additional Effect 2: 全蓄力攻击时 Expends ammo {p02} 发 —— 仅按 {p02} 发计入「累计消耗弹药」类计数，非真实消耗）。
  // Removal Condition: Reloading to max ammunition while in the Preparation for Change state.
  // ■ Activates at the start of battle. Affects self.
  // Beauty-Full: Attack Damage ▲ {p03}% continuously.
  // ■ Activates upon reloading to max ammunition. Affects self.
  // Preparation for Change: Reload time fixed 3s for {p04} sec. Removed upon firing the last bullet.
  // ■ Activates every {p10} sec. Affects the enemy nearest to the crosshair.
  // Deals {p07}% of final ATK as damage.
  // ■ Activates each time total ammo consumed by allies reaches {p08}. Affects all allies.
  // Fills Burst Gauge by {p09}%.
  // p01: [62.13,...]        （Snipe Mode 普攻倍率 %ATK）
  // p02: [40,...]           （Snipe Mode 全蓄力「Expends ammo」计数，计入全队累计消耗弹药）
  // p03: [13.2 … 24]        （Beauty-Full 攻击伤害 ▲%，持续）
  // p04: [6,...]            （Preparation for Change 持续秒数）
  // p07: [450 … 900]        （每 p10 秒定时伤害 %ATK）
  // p08: [200,...]          （全队累计弹药阈值）
  // p09: [7.09 … 12]        （爆裂槽填充 %）
  // p10: [5,...]            （定时伤害周期秒数）
  //
  // 触发器与 ■ 段不一一对应（P1 / P3 各有两个触发器），全部以 partOverride 显式对齐段号。
  skill1: {
    groupId: 25151,
    triggers: [
      // 程序初始化：手动切枪流程开关（由 UI 选项写入 unit.ccwSnipeModeAtStart）。
      {
        on: 'PROGRAM_INIT',
        partOverride: 0,
        handler(state, caster) {
          caster.skillState.ccw_switchToSnipe = caster.ccwSnipeModeAtStart === true;
          caster.skillState.ccw_snipeActive   = false;
        },
      },

      // S1 Part1：装填到满弹 → 处于 Preparation for Change 时切换形态（MG ↔ Snipe Mode）。
      //   须先于 Part3 的 Preparation for Change 刷新判定（本次装填完成前是否已处于该状态），
      //   否则首次装填就会满足切换条件；两者同为 RELOAD_END，按数组顺序执行。
      //   Snipe Mode 期间未切换的装填：重新蓄力（换弹完成 + 对准 + 固定蓄力 1s）。
      {
        on: 'RELOAD_END',
        partOverride: 0,
        handler(state, caster) {
          const wasPfc = pfcActive(state, caster);
          if (snipeModeActive(state, caster)) {
            if (wasPfc) exitSnipeMode(state, caster);
            else        scheduleSnipeShotAfterReload(state, caster);
          } else if (wasPfc) {
            enterSnipeMode(state, caster);
          }
        },
      },

      // S1 Part1 手动切枪流程（UI 选项）：进入 Snipe Mode 之前每次射击后立即主动装填。
      //   第 1 次装填完成 → Preparation for Change；第 2 次装填（固定 3s < 6s）完成 → Snipe Mode。
      {
        on: 'SHOT_COUNT',
        partOverride: 0,
        handler(state, caster) {
          if (!caster.skillState.ccw_switchToSnipe || snipeModeActive(state, caster)) return;
          startManualReload(state, caster);
        },
      },

      // S1 Part2：战斗开始 → Beauty-Full 攻击伤害 ▲ p03% 永久。
      {
        on: 'BATTLE_START',
        partOverride: 1,
        handler(state, caster) {
          const atkDmgPct = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'Beauty-Full', unitId: caster.id,
            attackDamagePct: atkDmgPct, endTick: Infinity }, state._logCtx);
        },
      },

      // S1 Part3：装填到满弹 → Preparation for Change（p04 秒，换弹时间固定 3s）。
      {
        on: 'RELOAD_END',
        partOverride: 2,
        handler(state, caster) {
          grantPreparationForChange(state, caster, state._logCtx);
        },
      },

      // S1 Part3：打出末弹 → 移除 Preparation for Change。
      {
        on: 'LAST_BULLET',
        partOverride: 2,
        handler(state, caster) {
          if (pfcActive(state, caster)) removePreparationForChange(state, caster);
        },
      },

      // S1 Part4：每 p10=5 秒 → 对最近敌人（单 Boss）造成 p07% ATK 伤害。
      {
        on: 'INTERVAL',
        partOverride: 3,
        opts: { seconds: 5 },
        handler(state, caster, ctx) {
          if (state.enemyHp <= 0) return;
          const mult = getSkillValue(caster.rawSkill1, 6, caster.skillLevels[0]) / 100;
          const sums = ctx.sums ?? getBuffSums(state, caster.id);
          fireSkillHit(state, caster, mult, sums, 'S1');
        },
      },

      // S1 Part5：全队累计消耗弹药每达 p08=200 发 → 全体填充共享爆裂槽 p09%。
      //   引擎 AMMO_MILESTONE 仅内建 400/500 里程碑，此处以 state.totalAmmoFired 自行追踪 200 里程碑
      //   （Snipe Mode 每发按「Expends ammo」40 发计入 totalAmmoFired）。
      {
        on: 'SQUAD_SHOT_COUNT',
        partOverride: 4,
        handler(state, caster) {
          const threshold = getSkillValue(caster.rawSkill1, 7, caster.skillLevels[0]);
          const cur  = Math.floor((state.totalAmmoFired ?? 0) / threshold);
          const last = caster.skillState.ccw_ammoMilestone ?? 0;
          if (cur <= last) return;
          caster.skillState.ccw_ammoMilestone = cur;
          const gaugePct = getSkillValue(caster.rawSkill1, 8, caster.skillLevels[0]) / 100;
          addBurstGauge(state, caster.name, 'ccw_s1_gauge', Math.round(gaugePct * BURST_GAUGE_MAX));
        },
      },
    ],
  },

  // ── Mode Swap
  // ■ Activates at the start of battle and when using Burst Skill. Affects self.
  // Decoy: Creates an avatar with {p01}% of final Max HP. Continuous.
  // ■ Activates at the start of battle. Affects self.
  // ATK ▲ {p02}% continuously.
  // ■ Activates when Snipe Mode takes effect. Affects self.
  // Destroy: Damage to Parts ▲ {p03}% continuously. Removes Pinpoint.
  // ■ Activates at the start of battle and when Snipe Mode is removed. Affects self.
  // Pinpoint: Damage dealt when attacking core ▲ {p04}% continuously. Removes Destroy.
  // ■ Activates when entering Full Burst after this unit uses her Burst Skill. Effect varies by current mode（仅其一生效）。
  // Snipe Mode：Affects all enemies (incl. parts). Effect1 deals {p05}% of final ATK as damage.
  // Not Snipe Mode：Affects all enemies with activated cores. Effect1 deals {p06}% of final ATK as core strike damage.
  // p01: [41.56 … 70.34]   （Decoy MaxHP%，防御向 → 不建模）
  // p02: [15.95 … 29]      （ATK ▲%，持续）
  // p03: [13.11 … 26.21]   （Destroy 对部位伤害 ▲%，Snipe Mode 期间持续）
  // p04: [13 … 26]         （Pinpoint 核心攻击伤害 ▲%，非 Snipe Mode 期间持续）
  // p05: [654.31 … 1189.66]（Snipe Mode 全爆裂伤害 %ATK）
  // p06: [458.58 … 833.79]（非 Snipe Mode 核心打击伤害 %ATK）
  //
  // Destroy / Pinpoint 互斥，随 SNIPE_MODE_CHANGED（本文件 S1 派发）切换；Decoy 不建模（不影响 DPS）。
  skill2: {
    groupId: 25152,
    triggers: [
      // S2 Part2：战斗开始 → ATK ▲ p02% 永久。
      {
        on: 'BATTLE_START',
        partOverride: 1,
        handler(state, caster) {
          const atkPct = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
          // S2 唯一未具名效果段（Decoy / Destroy / Pinpoint 具名，P5 为伤害）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Mode Swap', unitId: caster.id,
            atkPct, endTick: Infinity }, { ...state._logCtx, partIdx: null });
        },
      },

      // S2 Part3：Snipe Mode 生效 → Destroy（对部位伤害 ▲ p03% 持续），移除 Pinpoint。
      {
        on: 'SNIPE_MODE_CHANGED',
        partOverride: 2,
        handler(state, caster, ctx) {
          if (!ctx.active) return;
          state.buffs = state.buffs.filter(b => !(b.unitId === caster.id && b.name === 'Pinpoint'));
          const partsDmgPct = getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Destroy', unitId: caster.id,
            damageToPartsPct: partsDmgPct, endTick: Infinity }, state._logCtx);
        },
      },

      // S2 Part4：战斗开始 / Snipe Mode 移除 → Pinpoint（核心攻击伤害 ▲ p04% 持续），移除 Destroy。
      {
        on: 'BATTLE_START',
        partOverride: 3,
        handler(state, caster) {
          const coreDmgPct = getSkillValue(caster.rawSkill2, 3, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Pinpoint', unitId: caster.id,
            coreDamagePct: coreDmgPct, endTick: Infinity }, state._logCtx);
        },
      },
      {
        on: 'SNIPE_MODE_CHANGED',
        partOverride: 3,
        handler(state, caster, ctx) {
          if (ctx.active) return;
          state.buffs = state.buffs.filter(b => !(b.unitId === caster.id && b.name === 'Destroy'));
          const coreDmgPct = getSkillValue(caster.rawSkill2, 3, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Pinpoint', unitId: caster.id,
            coreDamagePct: coreDmgPct, endTick: Infinity }, state._logCtx);
        },
      },

      // S2 Part5：本轮本单位施放爆裂后进入全爆裂 → 按当前形态二选一：
      //   Snipe Mode：对所有敌人（含部位）造成 p05% ATK 伤害（单 Boss → 1 次命中）。
      //   非 Snipe Mode：对有核心的敌人造成 p06% ATK 核心打击伤害；敌人无核心时无目标，跳过。
      {
        on: 'ENTER_FULL_BURST',
        partOverride: 4,
        handler(state, caster) {
          if (!state.burstCastersThisRotation?.has(caster.id)) return;
          if (state.enemyHp <= 0) return;
          const sums = getBuffSums(state, caster.id);
          // 两分支互斥、同属 P5 段 → 统一标签 'S2 P5'（显示「Mode Swap P5」），日志与明细按段归并
          if (snipeModeActive(state, caster)) {
            const mult = getSkillValue(caster.rawSkill2, 4, caster.skillLevels[1]) / 100;
            fireSkillHit(state, caster, mult, sums, 'S2 P5');
            return;
          }
          if (!state.enemyHasCore) return;
          const mult = getSkillValue(caster.rawSkill2, 5, caster.skillLevels[1]) / 100;
          fireSkillHit(state, caster, mult, sums, 'S2 P5', { hitPart: 'core' });
        },
      },
    ],
  },

  // ── Glass Slippers Full Contact W
  // ■ Affects self.
  // Attack Damage ▲ {p01}% for {p02} sec.
  // ATK ▲ {p05}% for {p06} sec.
  // ■ Affects the enemy with the highest final ATK.
  // Deals {p04}% of final ATK as Burst Skill damage.
  // p01: [46 … 92]              （攻击伤害 ▲%，10s）
  // p02: [10,...]
  // p03: [100,...]              （残留参数，描述未引用）
  // p04: [3299.97 … 6000]       （爆裂技能伤害 %ATK）
  // p05: [35.75 … 65]           （ATK ▲%，10s）
  // p06: [10,...]
  burst: {
    groupId: 15153,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const end10     = state.tick + TICK_RATE * 10;
          const atkDmgPct = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const atkPct    = getSkillValue(caster.rawBurst, 4, caster.skillLevels[2]) / 100;
          // 先施加自身 buff，使本次爆裂伤害享受自身 ATK ▲ / 攻击伤害 ▲。
          // 爆裂技能唯一的效果段（P2 为伤害）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Glass Slippers Full Contact W', unitId: caster.id,
            attackDamagePct: atkDmgPct, atkPct, endTick: end10 }, { ...state._logCtx, partIdx: null });

          if (state.enemyHp <= 0) return;
          const burstMult = getSkillValue(caster.rawBurst, 3, caster.skillLevels[2]) / 100;
          const sums      = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, burstMult, sums, 'Burst');
        },
      },
    ],
  },
};
