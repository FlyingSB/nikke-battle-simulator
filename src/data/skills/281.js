import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Moran  (resource_id: 281)

// 爆裂变更武器的射速（RPM）：1440 = 每秒 24 发，与大多数 SMG 相同。
// 数据来自 https://nikke.gg/characterguides/moran/，未实测验证。
const BURST_WEAPON_RATE_OF_FIRE = 1440;

export default {

  // ── Bring It On!
  // ■ Activates at the start of battle. Affects self.
  // DEF ▲ {description_value_01}% continuously for every 1% of HP lost.
  // ■ Activates when landing {description_value_03} normal attack(s) while weapon is changed. Affects the target.
  // Deals {description_value_02}% of final ATK as additional damage.
  // ■ Activates when Raptures appear. Affects self.
  // Fervor: Cooldown of Burst Skill ▼ {description_value_04} sec continuously.
  // p01: [1.93, 2.1, 2.28, 2.45, 2.63, 2.81, 2.98, 3.16, 3.33, 3.51]
  // p02: [25.95, 28.31, 30.67, 33.03, 35.38, 37.74, 40.1, 42.46, 44.82, 47.18]
  // p03: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]
  // p04: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20]
  skill1: {
    groupId: 22811,
    triggers: [
      // S1 T1（被动）：DEF ▲ X%/每损失 1% HP — [TODO] 未建模（需 HP 受伤追踪）
      // tdefIdx=0：■段0(DEF passive)未建模，占位
      {},
      // S1 T2：武器替换期间每 5 发普通攻击 → X% ATK 技能伤害（lv10=47.18%）
      {
        on: 'SHOT_COUNT',
        opts: { every: 5, counterKey: 'moranBurstS1Count' },
        handler(state, caster, ctx) {
          const switchActive = (caster.skillState?.weaponSwitchEndTick ?? 0) > 0
            && state.tick <= caster.skillState.weaponSwitchEndTick;
          if (!switchActive) return;
          const s1 = caster.ssrFavSkills?.skill1;
          const lv = s1?._activeSkillLevel ?? 0;
          if (!s1 || lv <= 0) return;
          const mult = getSkillValue(s1, 1, lv) / 100;
          const sums = ctx.sums ?? getBuffSums(state, caster.id);
          fireSkillHit(state, caster, mult, sums, 'S1');
        },
      },
      // S1 SSR Fervor（被动）：战斗开始 → 激活 Fervor 状态（用于 S2 与 Burst）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          if (!caster.ssrFavSkills?.skill1) return false;
          caster.skillState.moranFervorActive = true;
        },
      },
    ],
  },

  // ── Leave It To Me!
  // ■ Activates when firing the final bullet. Affects the {description_value_07} enemy unit(s) with the highest final ATK.
  // Taunts for {description_value_08} sec.
  // ■ Activates when HP falls below {description_value_09}%. Affects self.
  // Effect changes according to the number of activation times. Perseverance: Effect of each phase does not stack.
  // Once: Max HP ▲ {description_value_01}% for {description_value_02} sec. Activates once per battle.
  // Twice: Max HP ▲ {description_value_03}% for {description_value_04} sec. Activates once per battle.
  // Three Times: Max HP ▲ {description_value_05}% for {description_value_06} sec. Activates once per battle.
  // ■ Activates when entering Full Burst while in Fervor status. Affects all allies.
  // Cooldown of Burst Skill ▼ {description_value_10} sec.
  // p01: [55, 59, 63, 67, 71, 75, 79, 83, 87, 91]
  // p02: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p03: [36.09, 39.84, 43.59, 47.34, 51.09, 54.84, 58.59, 62.34, 66.09, 69.84]
  // p04: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p05: [25.78, 28.59, 31.4, 34.21, 37.03, 39.84, 42.65, 45.46, 48.28, 51.09]
  // p06: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p07: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  // p08: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4]
  // p09: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20]
  // p10: [5.34, 5.58, 5.82, 6.05, 6.29, 6.53, 6.77, 7, 7.24, 7.48]
  skill2: {
    groupId: 22812,
    triggers: [
      // [TODO] S2 P1：末弹 → 最高 ATK 3 名敌人嘲讽 4s（无敌人选择/嘲讽模型）
      {},
      // [TODO] S2 P2：HP 低于 91% 时分阶段（Once/Twice/Three Times）提升 MaxHP（无 HP 受伤模型）
      {},
      //
      // S2 SSR Fervor：进入全爆裂时，Fervor 状态下 → 全员爆裂冷却 ▼X s（lv10=7.48s）
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          if (!caster.skillState.moranFervorActive) return false;
          const s2 = caster.ssrFavSkills?.skill2;
          const lv = s2?._activeSkillLevel ?? 0;
          if (!s2 || lv <= 0) return false;
          const sec = getSkillValue(s2, 9, lv);
          const reductionTicks = Math.round(TICK_RATE * sec);
          for (const u of state.squad)
            u.burstCdRemaining = Math.max(0, u.burstCdRemaining - reductionTicks);
          if (state.buffLog)
            state.buffLog.push({ type: 'cd_reduction', tick: state.tick,
              name: 'Leave It To Me! (Burst CD)', unitId: null, reductionTicks });
        },
      },
    ],
  },

  // ── Fair and Square!
  // ■ Affects self.
  // Changes the weapon in use:
  // Damage: {description_value_01}% of final ATK
  // Duration: 10 sec
  // Additional Effect:
  // Recovers {description_value_02}% of attack damage as HP for {description_value_03} sec.
  // Attract: Taunts all enemies for {description_value_04} sec.
  // Unlimited ammunition for {description_value_04} sec.
  // ■ Affects all allies.
  // Damage Taken ▼ {description_value_05}% for {description_value_06} sec.
  // DEF ▲ {description_value_07}% of caster's DEF for {description_value_08} sec.
  // ATK ▲ {description_value_09}% of caster's ATK for {description_value_10} sec.
  // p01: [11.46, 11.82, 12.18, 12.54, 12.9, 13.26, 13.62, 13.98, 14.34, 14.7]
  // p02: [19.89, 21.7, 23.51, 25.31, 27.12, 28.92, 30.73, 32.53, 34.34, 36.14]
  // p03: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p04: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p05: [21.78, 23.26, 24.75, 26.23, 27.72, 29.2, 30.69, 32.17, 33.66, 35.14]
  // p06: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p07: [8.16, 8.91, 9.65, 10.39, 11.13, 11.88, 12.62, 13.36, 14.1, 14.85]
  // p08: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p09: [23.41, 25.54, 27.67, 29.79, 31.92, 34.05, 36.18, 38.31, 40.44, 42.57]
  // p10: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  burst: {
    groupId: 12813,
    triggers: [
      // Burst（Fair and Square!）— 自身：
      //   武器替换 10s（hitMult lv10=14.7%）+ 无限弹药 10s
      //   变更武器射速 1440 RPM（24 发/秒；来源 nikke.gg，未实测验证）
      //   生命偷取 X%（lv10=36.14%）10s
      //   S1 Fervor 效果：使用后自身爆裂冷却 ▼20s（param[3] 常量）
      // 全员（SSR）：ATK flat ▲ X% Moran ATK 10s（lv10=42.57%）
      // 全员（未建模）：承伤 ▼X% 10s；DEF ▲X% Moran DEF 10s（防御性，对 DPS 无影响）
      // [TODO 基础技能] 爆裂技能基础版（group_id 12813）武器替换/无限弹/生命偷取/承伤/DEF 加成数值未建模
      // Burst P1（自身）：武器切换 10s + 生命偷取 + S1 Fervor CD 减少
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const burstSkill = caster.ssrFavSkills?.burst;
          const lv         = burstSkill?._activeSkillLevel ?? 0;
          if (!burstSkill || lv <= 0) return false;
          const hitMult = getSkillValue(burstSkill, 0, lv) / 100;
          const lsPct   = getSkillValue(burstSkill, 1, lv) / 100;
          const end10   = state.tick + TICK_RATE * 10;

          caster.skillState.weaponSwitchHitMult       = hitMult;
          caster.skillState.weaponSwitchType          = null;
          caster.skillState.weaponSwitchEndTick       = end10;
          caster.skillState.weaponSwitchRoundsLeft    = 0;
          caster.skillState.weaponSwitchUnlimitedAmmo = true;
          // 射速覆盖：1440 RPM（来源 nikke.gg，未实测验证，见文件顶部常量注释）
          caster.skillState.weaponSwitchRateOfFire    = BURST_WEAPON_RATE_OF_FIRE;

          pushBuff(state, { name: 'Fair and Square! (Life Steal)', unitId: caster.id,
            lifeStealPct: lsPct, endTick: end10 });

          const s1   = caster.ssrFavSkills?.skill1;
          const s1Lv = s1?._activeSkillLevel ?? 0;
          if (s1 && s1Lv > 0 && caster.skillState.moranFervorActive) {
            const fervorSec   = getSkillValue(s1, 3, s1Lv);
            const fervorTicks = Math.round(TICK_RATE * fervorSec);
            caster.burstCdRemaining = Math.max(0, caster.burstCdRemaining - fervorTicks);
          }
        },
      },
      // Burst P2（全员）：ATK flat ▲（SSR 专属）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const burstSkill = caster.ssrFavSkills?.burst;
          const lv         = burstSkill?._activeSkillLevel ?? 0;
          if (!burstSkill || lv <= 0) return false;
          const atkPct = getSkillValue(burstSkill, 8, lv) / 100;
          if (atkPct <= 0) return false;
          pushBuff(state, { name: 'Fair and Square! (ATK)', unitId: null,
            atkFlat: Math.round(caster.stats.atk * atkPct), endTick: state.tick + TICK_RATE * 10 });
        },
      },
    ],
  },
};
