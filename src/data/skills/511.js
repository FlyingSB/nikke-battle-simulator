import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Flawless Glass
  // ■ Activates when entering Burst Stage 3. Affects self.
  // ATK ▲ {description_value_01}% of caster's final Max HP for {description_value_02} sec.
  // ■ Activates when attacking with Full Charge. Affects self.
  // Charge Speed ▲ {description_value_03}%. Removed upon reloading to max ammunition.
  // ■ Activates when hitting a target with Full Charge. Affects the target.
  // Deals {description_value_04}% of final ATK as additional damage.
  // p01: [1.7, 1.8, 1.92, 2.02, 2.13, 2.26, 2.36, 2.49, 2.58, 2.71]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
  // p04: [80.72, 86.94, 93.13, 99.35, 105.55, 111.76, 117.98, 124.19, 130.39, 136.6]
  skill1: {
    groupId: 25111,
    triggers: [
      // S1 Part1（Flawless Glass）：进入爆裂阶段 3 → 自身 ATK flat ▲2.71% 最终 MaxHP 10s
      // 最终 MaxHP 包含所有来源的 maxHpPct 加成（含外部 buff）
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const sums       = getBuffSums(state, caster.id);
          const finalHp    = caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
          const atkFlatPct = getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100;
          const atkFlat    = Math.round(finalHp * atkFlatPct);
          const endTick    = state.tick + TICK_RATE * 10;
          const existing = state.buffs.find(b => b.name === 'cinderella_s1_atkFlat' && b.unitId === caster.id);
          if (existing) { existing.atkFlat = atkFlat; existing.endTick = endTick; }
          else pushBuff(state, { name: 'cinderella_s1_atkFlat', unitId: caster.id, atkFlat, endTick });
        },
      },
      // S1 Part2：全蓄力攻击 → 自身 Charge Speed ▲100%（自然装填到满后移除）
      {
        on: 'FULL_CHARGE',
        logTargets: 'SELF',
        handler(state, caster) {
          pushBuff(state, { name: 'cinderella_s1_chargeSpd', unitId: caster.id,
            chargeSpeedPct: 1.0, endTick: Infinity });
        },
      },
      {
        on: 'RELOAD_END',
        logTargets: null,
        handler(state, caster) {
          state.buffs = state.buffs.filter(b =>
            !(b.name === 'cinderella_s1_chargeSpd' && b.unitId === caster.id));
        },
      },
      // S1 Part3：全蓄力命中 → [S1 param3]% ATK 附加技能伤害，同时附加对应充能
      {
        on: 'FULL_CHARGE',
        logTargets: null,
        handler(state, caster, ctx) {
          if (state.enemyHp <= 0) return;
          const sums    = ctx.sums ?? getBuffSums(state, caster.id);
          const hitMult = getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]) / 100;
          fireSkillHit(state, caster, hitMult, sums, false, 'S1');
          addBurstGauge(state, caster.name, 'S1_fc_bonus', caster.targetBurstEnergyPerShot ?? 0);
        },
      },
    ],
  },

  // ── Dirt-Resistant Mirror
  // ■ Activates at the start of battle. Affects self.
  // Decoy: Creates an avatar with {description_value_01}% of caster's final Max HP continuously.
  // ■ Activates when entering Burst Skill Stage 3. Affects self.
  // Decoy: Creates an avatar with {description_value_01}% of caster's final Max HP continuously.
  // ■ Activates when decoy exists. Affects self every {description_value_04} sec.
  // Beautiful: Max HP ▲ {description_value_02}% continuously, stacks up to {description_value_03} time(s).
  // p01: [52.8, 57.6, 62.4, 67.2, 72, 76.8, 81.6, 86.4, 91.2, 96]
  // p02: [0.98, 1.07, 1.13, 1.2, 1.28, 1.33, 1.38, 1.46, 1.54, 1.6]
  // p03: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12]
  // p04: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
  skill2: {
    groupId: 25112,
    triggers: [
      // S2（Dirt-Resistant Mirror）：战斗开始 + 进入爆裂阶段 3 → 创建诱饵替身（96% MaxHP，持续）
      {
        on: 'BATTLE_START',
        logTargets: null,
        handler(state, caster) { caster.skillState.cinderellaDecoyActive = true; },
      },
      {
        on: 'ENTER_BURST_III',
        partOverride: 0,
        handler(state, caster) { caster.skillState.cinderellaDecoyActive = true; },
      },
      // 每 3s Beautiful +1 层（上限 12），每层永久 MaxHP ▲1.6%
      // Beautiful 层数存于 cinderellaBeautyStacks；maxHpPct 写入 buff 使 getBuffSums 可聚合
      {
        on: 'INTERVAL',
        partOverride: 1,
        logTargets: 'SELF',
        opts: { seconds: 3 },
        handler(state, caster) {
          if (!caster.skillState.cinderellaDecoyActive) return false;
          if ((caster.skillState.cinderellaBeautyStacks ?? 0) >= 12) return;
          caster.skillState.cinderellaBeautyStacks = (caster.skillState.cinderellaBeautyStacks ?? 0) + 1;
          const stacks       = caster.skillState.cinderellaBeautyStacks;
          const maxHpPerStack = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
          const beautyBuff   = state.buffs.find(b => b.name === 'cinderella_beautiful' && b.unitId === caster.id);
          if (beautyBuff) { beautyBuff.maxHpPct = stacks * maxHpPerStack; }
          else state.buffs.push({ name: 'cinderella_beautiful', unitId: caster.id,
            maxHpPct: stacks * maxHpPerStack, endTick: Infinity });
        },
      },
    ],
  },

  // ── Glass Slippers. Full Contact.
  // ■ Affects random enemies.
  // Deals {description_value_01}% of final ATK as damage. Attacks sequentially for {description_value_02} time(s).
  // ■ Affects the same target(s) when in Beautiful status.
  // Deals {description_value_03}% of final ATK as additional damage.Mirrors the stack count of Beautiful.
  // p01: [853.7, 910.62, 967.5, 1024.46, 1081.38, 1138.26, 1195.16, 1252.08, 1309, 1365.92]
  // p02: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
  // p03: [18.07, 19.28, 20.49, 21.68, 22.88, 24.09, 25.3, 26.5, 27.69, 28.9]
  burst: {
    groupId: 15113,
    triggers: [
      // Burst（Glass Slippers. Full Contact.）：
      //   S3 Part1：10 × 1365.92% ATK 爆裂技能伤害（默认结算，不受全爆裂+50%补正）
      //   S3 Part2：每次 Part1 命中后触发 Beautiful层数 × 28.9% 附加伤害（【已实测】非默认：sums:null，ENTER_FULL_BURST 后重算，享受全爆裂补正）
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ENEMY',
        handler(state, caster) {
          const stacks         = caster.skillState.cinderellaBeautyStacks ?? 0;
          const burstHitMult   = getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100;
          const beautyBonusPct = getSkillValue(caster.rawBurst, 2, caster.skillLevels[2]) / 100;
          const sums           = getBuffSums(state, caster.id);
          for (let i = 0; i < 10 && state.enemyHp > 0; i++) {
            fireSkillHit(state, caster, burstHitMult, sums, false, 'Burst P1');
            if (stacks > 0) {
              state.pendingFireInBurstHits.push({
                caster, mult: stacks * beautyBonusPct, sums: null,
                isCharged: false, label: 'Burst P2', opts: {},
              });
            }
          }
        },
      },
    ],
  },
};
