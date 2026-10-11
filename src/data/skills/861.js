import { pushBuff, TICK_RATE, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { tickSkill2Cooldown } from './active-skill-shared.js';

// Character: Takina  (resource_id: 861)
//
// 武器：Sniper Rifle（UP 型，蓄力 1s，弹匣 6，FC 250%）。爆裂阶段 Step2，CD 20s。
// S2 为主动技能（CharacterSkill 表），CDN 不提供冷却时间，人工填写：15s（nikke.gg 角色页）。
// 与 80 / 220 约定一致：战斗开始先进入冷却，首次施放于 t+15s。
const S2_COOLDOWN_TICKS = 15 * TICK_RATE;

// 爆裂切换武器：CDN ulti skill_value_data = [伤害 11856, 150, 切换武器 shot_id 1086102, 1]。
// 第 2 项按 K（41）同位置 144 = SMG 1440 RPM × (1 − 90%) 的对照推断为切换武器射速（RPM）；
// 150 RPM = 每 0.4s 一发，10s 内 25 发，与实测一致（2026-10-11）；
// 切换武器 shot_id 1086102 无本地数据（无蓄力说明、无弹匣说明），按非蓄力单发武器、期间不耗弹建模。
// 原武器为 SR（蓄力路径），借用 weaponSwitchChargeTimeTicks = 射速发间（3600 / RPM）驱动射击节奏，
// weaponSwitchType 取非蓄力类型 'AR' 使 isCharged = false（不吃全蓄力倍率、不触发 FULL_CHARGE）。
// 核心命中率：引擎对非 SMG / SG 的切换武器恒按 100% 核心命中。实测切换武器并非每发命中核心，
// 但 Takina 不是主要输出角色，暂不细究（2026-10-12 用户确认），已知此处高估。
function switchRateOfFire(caster) {
  return caster.rawBurst?.skill_value_data?.[1]?.skill_value ?? 150;
}

export default {

  // ── Combat Support（S1）
  // ■ Activates at the start of battle and when Full Burst ends. Affects self.
  //   ATK ▲ {p00}% for {p01} sec.
  // ■ Activates when entering Full Burst. Affects self.
  //   True Damage ▲ {p02}% for {p03} sec.
  // p00: [47.29,50.93,54.57,58.21,61.85,65.49,69.12,72.76,76.4,80.04]
  // p01: [5,5,5,5,5,5,5,5,5,5]
  // p02: [20.71,22.3,23.9,25.49,27.08,28.68,30.27,31.86,33.46,35.05]
  // p03: [15,15,15,15,15,15,15,15,15,15]
  skill1: {
    triggers: [
      // P1：战斗开始 → 自身 ATK ▲ p00%（p01 秒）
      {
        on: 'BATTLE_START',
        handler(state, caster) { pushCombatSupportAtk(state, caster); },
      },
      // P2：进入全爆裂 → 自身 True Damage ▲ p02%（p03 秒）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          pushBuff(state, { name: 'Combat Support (True Damage)', unitId: caster.id,
            trueDamagePct: getSkillValue(caster.rawSkill1, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 3, lv) });
        },
      },
      // P1：全爆裂结束 → 同上
      {
        on: 'FULL_BURST_END',
        partOverride: 0,
        handler(state, caster) { pushCombatSupportAtk(state, caster); },
      },
    ],
  },

  // ── Battlefield Control（S2，主动技能，冷却 15s，战斗开始先进入冷却）
  // ■ Affects all enemies.
  //   Damage Taken ▲ {p00}% for {p01} sec.
  //   Stuns for {p02} sec.
  // ■ Affects all allies.
  //   True Damage ▲ {p03}% for {p04} sec.
  // p00: [5.96,6.42,6.88,7.33,7.79,8.25,8.71,9.17,9.63,10.09]
  // p01: [5,5,5,5,5,5,5,5,5,5]
  // p02: [2,2,2,2,2,2,2,2,2,2]        — 眩晕敌人：无敌方行动模型，未建模
  // p03: [83.01,89.4,95.79,102.17,108.56,114.94,121.33,127.72,134.1,140.49]
  // p04: [10,10,10,10,10,10,10,10,10,10]
  skill2: {
    triggers: [
      // 冷却可被「Cooldown of Skill 2 ▼」类效果加速，按 tick 推进（见 active-skill-shared.js）
      {
        on: 'INTERVAL',
        opts: { seconds: 1 / TICK_RATE },
        handler(state, caster) {
          if (!tickSkill2Cooldown(state, caster, 'takinaS2Cd', S2_COOLDOWN_TICKS)) return;
          const lv  = caster.skillLevels[1];
          const raw = caster.rawSkill2;
          // P1：敌人 Damage Taken ▲ p00%（p01 秒）；眩晕未建模
          pushBuff(state, { name: 'Battlefield Control (Damage Taken)', unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDamageTakenPct: getSkillValue(raw, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 1, lv) },
            { ...state._logCtx, partIdx: 0 });
          // P2：全体队友 True Damage ▲ p03%（p04 秒）
          pushBuff(state, { name: 'Battlefield Control (True Damage)', unitId: null,
            trueDamagePct: getSkillValue(raw, 3, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 4, lv) },
            { ...state._logCtx, partIdx: 1 });
        },
      },
    ],
  },

  // ── Suppression Initiated（Burst）
  // ■ Affects self.
  //   Changes the weapon in use.
  //   Damage: {p00}% of final ATK
  //   Duration: {p01} sec
  //   Additional Effects
  //   Affects self: Normal attacks deal true damage for {p02} sec.
  //   Affects targets hit: Damage Taken ▲ {p03}% for {p04} sec.
  // p00: [118.56,127.68,136.8,145.92,155.04,164.16,173.28,182.4,191.52,200.64]
  // p01: [10,10,10,10,10,10,10,10,10,10]
  // p02: [10,10,10,10,10,10,10,10,10,10]
  // p03: [3.56,3.84,4.11,4.39,4.66,4.94,5.21,5.49,5.76,6.04]
  // p04: [5,5,5,5,5,5,5,5,5,5]
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const raw = caster.rawBurst;
          const end = state.tick + TICK_RATE * getSkillValue(raw, 1, lv);
          const shotTicks = Math.round(3600 / switchRateOfFire(caster));
          Object.assign(caster.skillState, {
            weaponSwitchHitMult:         getSkillValue(raw, 0, lv) / 100,
            weaponSwitchType:            'AR',
            // 引擎切换期判定为 tick <= weaponSwitchEndTick（含两端）；首发在施放当 tick，
            // 结束取 end − 1 使 10s 窗口为 [施放, 施放 + 10s)，否则第 10s 整再多打 1 发（26 发）
            weaponSwitchEndTick:         end - 1,
            weaponSwitchRoundsLeft:      0,
            weaponSwitchChargeTimeTicks: shotTicks,
            weaponSwitchUnlimitedAmmo:   true,
            weaponSwitchPierce:          false,
            takinaRechargeAfterSwitch:   true,
          });
          caster.reloadTick = 0;
          if (caster.ammoLeft <= 0) caster.ammoLeft = caster.maxAmmo;
          // 首发于施放当 tick 立即击发，之后每 shotTicks 一发：10s 内 25 发（实测 25 发），
          // 全部落在「普通攻击造成真实伤害」10s 期间内
          caster.chargeTick = state.tick;
          caster.engineChargeTick = null;
          // 普通攻击造成真实伤害（p02 秒）
          pushBuff(state, { name: 'Suppression Initiated (Normal Attack True Damage)', unitId: caster.id,
            normalAttackTrueDamage: true,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 2, lv) });
        },
      },
      // 切换武器命中的目标 → Damage Taken ▲ p03%（p04 秒），每次命中刷新（刷新不写日志，避免逐发刷屏）
      {
        on: 'SHOT_COUNT',
        partOverride: 0,
        handler(state, caster) {
          const st = caster.skillState;
          if (!((st.weaponSwitchEndTick ?? 0) > 0 && state.tick <= st.weaponSwitchEndTick)) return;
          const lv    = caster.skillLevels[2];
          const first = !state.buffs.some(b => b.name === 'Suppression Initiated (Damage Taken)');
          pushBuff(state, { name: 'Suppression Initiated (Damage Taken)', unitId: ENEMY_UNIT_ID, isDebuff: true,
            enemyDamageTakenPct: getSkillValue(caster.rawBurst, 3, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawBurst, 4, lv) },
            first ? state._logCtx : false);
        },
      },
      // 切换武器结束 → 原武器（SR）重新前摇 + 蓄力后才打出下一发（切换期间的发间不延续到 SR）
      {
        on: 'INTERVAL',
        opts: { seconds: 1 / TICK_RATE },
        handler(state, caster) {
          const st = caster.skillState;
          if (!st.takinaRechargeAfterSwitch || state.tick <= (st.weaponSwitchEndTick ?? 0)) return;
          st.takinaRechargeAfterSwitch = false;
          caster.chargeTick       = state.tick + caster.foreswingTicks + caster.chargeTimeTicks;
          caster.engineChargeTick = null;
        },
      },
    ],
  },
};

// S1 P1：自身 ATK ▲ p00%（p01 秒）
function pushCombatSupportAtk(state, caster) {
  const lv = caster.skillLevels[0];
  pushBuff(state, { name: 'Combat Support (ATK)', unitId: caster.id,
    atkPct: getSkillValue(caster.rawSkill1, 0, lv) / 100,
    endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 1, lv) });
}
