import { pushBuff, fireSkillHit, addBurstGauge, getBuffSums,
         TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Cinderella: Crystal Wave  (resource_id: 515)
export default {

  // ── Beauty-Full
  // ■ Activates upon reloading to max ammunition while in the Preparation for Change state. Affects self.
  // Changes the weapon in use: Snipe Mode（Charge 1s / Damage {p01}% ATK / Full Charge 250% / Max Ammo 15 / Pierce / 全蓄力消耗 {p02} 发）。
  // ■ Activates at the start of battle. Affects self.
  // Beauty-Full: Attack Damage ▲ {p03}% continuously.
  // ■ Activates upon reloading to max ammunition. Affects self.
  // Preparation for Change: Reload time fixed 3s for {p04} sec. Removed upon firing the last bullet.
  // ■ Activates every {p10} sec. Affects the enemy nearest to the crosshair.
  // Deals {p07}% of final ATK as damage.
  // ■ Activates each time total ammo consumed by allies reaches {p08}. Affects all allies.
  // Fills Burst Gauge by {p09}%.
  // p01: [62.13,...]        （Snipe Mode 普攻倍率 %ATK）
  // p02: [40,...]           （Snipe Mode 全蓄力消耗弹数）
  // p03: [13.2 … 24]        （Beauty-Full 攻击伤害 ▲%，持续）
  // p04: [6,...]            （Preparation for Change 持续秒数）
  // p07: [450 … 900]        （每 p10 秒定时伤害 %ATK）
  // p08: [200,...]          （全队累计弹药阈值）
  // p09: [7.09 … 12]        （爆裂槽填充 %）
  // p10: [5,...]            （定时伤害周期秒数）
  //
  // [未建模] Snipe Mode 武器切换 + Preparation for Change 装填循环：
  //   该切枪机制（MG→狙击蓄力）依赖装填/瞄准状态机，超出当前引擎建模范围。
  //   模拟中角色始终保持默认 MG（Pinpoint）形态，故 p01/p02/p04 与狙击相关效果不建模。
  skill1: {
    groupId: 25151,
    triggers: [
      // S1 Part2：战斗开始 → Beauty-Full 攻击伤害 ▲ p03% 永久。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const atkDmgPct = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: 'Beauty-Full', unitId: caster.id,
            attackDamagePct: atkDmgPct, endTick: Infinity });
        },
      },

      // S1 Part4：每 p10=5 秒 → 对最近敌人（单 Boss）造成 p07% ATK 伤害。
      {
        on: 'INTERVAL',
        opts: { seconds: 5 },
        handler(state, caster, ctx) {
          if (state.enemyHp <= 0) return;
          const mult = getSkillValue(caster.rawSkill1, 6, caster.skillLevels[0]) / 100;
          const sums = ctx.sums ?? getBuffSums(state, caster.id);
          fireSkillHit(state, caster, mult, sums, 'S1');
        },
      },

      // S1 Part5：全队累计消耗弹药每达 p08=200 发 → 全体填充共享爆裂槽 p09%。
      //   引擎 AMMO_MILESTONE 仅内建 400/500 里程碑，此处以 state.totalAmmoFired 自行追踪 200 里程碑。
      {
        on: 'SQUAD_SHOT_COUNT',
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
  // p03: [13.11 … 26.21]   （Destroy 对部位伤害 ▲%，仅 Snipe Mode → 不建模）
  // p04: [13 … 26]         （Pinpoint 核心攻击伤害 ▲%，持续；默认形态）
  // p05: [654.31 … 1189.66]（Snipe Mode 全爆裂伤害 %ATK → 不建模）
  // p06: [458.58 … 833.79]（非 Snipe Mode 核心打击伤害 %ATK）
  //
  // 模拟中角色始终为默认（非 Snipe / Pinpoint）形态：
  //   → Decoy 不建模（不影响 DPS）。
  //   → Pinpoint 核心攻击伤害 ▲ p04% 战斗开始永久生效。
  //   → 全爆裂进入时走「非 Snipe Mode」分支，对有核心的敌人造成 p06% ATK 核心打击伤害。
  skill2: {
    groupId: 25152,
    triggers: [
      // S2 Part2：战斗开始 → ATK ▲ p02% 永久。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const atkPct = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Mode Swap ATK', unitId: caster.id,
            atkPct, endTick: Infinity });
        },
      },

      // S2 Part4：战斗开始（默认 Pinpoint 形态）→ 核心攻击伤害 ▲ p04% 永久。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const coreDmgPct = getSkillValue(caster.rawSkill2, 3, caster.skillLevels[1]) / 100;
          pushBuff(state, { name: 'Pinpoint', unitId: caster.id,
            coreDamagePct: coreDmgPct, endTick: Infinity });
        },
      },

      // S2 Part5：本轮本单位施放爆裂后进入全爆裂 → 非 Snipe Mode 分支：
      //   对有核心的敌人造成 p06% ATK 核心打击伤害。敌人无核心时（enemyHasCore=false）无目标，跳过。
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          if (!state.burstCastersThisRotation?.has(caster.id)) return;
          if (state.enemyHp <= 0 || !state.enemyHasCore) return;
          const mult = getSkillValue(caster.rawSkill2, 5, caster.skillLevels[1]) / 100;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, mult, sums, 'S2', { hitPart: 'core' });
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
          pushBuff(state, { name: 'Glass Slippers Full Contact W', unitId: caster.id,
            attackDamagePct: atkDmgPct, atkPct, endTick: end10 });

          if (state.enemyHp <= 0) return;
          const burstMult = getSkillValue(caster.rawBurst, 3, caster.skillLevels[2]) / 100;
          const sums      = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, burstMult, sums, 'Burst');
        },
      },
    ],
  },
};
