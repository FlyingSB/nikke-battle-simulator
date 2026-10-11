import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE, ENEMY_UNIT_ID } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { tickSkill2Cooldown } from './active-skill-shared.js';

// Character: Isabel  (resource_id: 231)
//
// 武器：Shotgun（10 弹丸，弹匣 9）。爆裂阶段 Step3，CD 40s。
// S2 为主动技能（CharacterSkill 表），CDN 不提供冷却时间，人工填写：15s（prydwen.gg / nikke.gg）。
// 与 80 / 220 约定一致：战斗开始先进入冷却，首次施放于 t+15s；可被 Arcana S1 The Magician 加速。
const S2_COOLDOWN_TICKS = 15 * TICK_RATE;

// Marked Target 阶段：按 S1 触发（使用爆裂技能）次数，3 次及以上保持第 3 阶段
const MT_KEY = 'isabelMarkedTarget';
function markedTargetPhase(caster) { return Math.min(3, caster.skillState[MT_KEY] ?? 0); }

const MT_TIERS = [
  { name: 'Marked Target 1', field: 'critRatePct',   v: 0, d: 1 },
  { name: 'Marked Target 2', field: 'critDamagePct', v: 2, d: 3 },
  { name: 'Marked Target 3', field: 'atkPct',        v: 4, d: 5 },
];

export default {

  // ── Marked Target（S1）
  // ■ Activates when using Burst Skill. Affects self.
  //   Effect changes according to the number of activation times. Previous effects trigger repeatedly:
  //   Once: Marked Target 1 - Critical Rate ▲ {p00}% for {p01} sec.
  //   Twice: Marked Target 2 - Critical Damage ▲ {p02}% for {p03} sec.
  //   Three times: Marked Target 3 - ATK ▲ {p04}% for {p05} sec.
  // p00: [3.91,4.17,4.43,4.69,4.95,5.22,5.48,5.74,6,6.26]
  // p01: [45,...]
  // p02: [11.27,12.02,12.77,13.52,14.27,15.03,15.78,16.53,17.28,18.03]
  // p03: [45,...]
  // p04: [10.8,11.52,12.24,12.96,13.68,14.4,15.12,15.84,16.56,17.28]
  // p05: [45,...]
  skill1: {
    triggers: [
      // 使用爆裂技能 → 计数 +1，按阶段施加 Marked Target 1..n（「Previous effects trigger repeatedly」）。
      // S1 先于爆裂技能 handler 执行（skill1 → burst 顺序），爆裂技能据此读取当前阶段。
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          caster.skillState[MT_KEY] = (caster.skillState[MT_KEY] ?? 0) + 1;
          const lv  = caster.skillLevels[0];
          const raw = caster.rawSkill1;
          MT_TIERS.slice(0, markedTargetPhase(caster)).forEach((t, i) => {
            pushBuff(state, { name: t.name, unitId: caster.id,
              [t.field]: getSkillValue(raw, t.v, lv) / 100,
              endTick: state.tick + TICK_RATE * getSkillValue(raw, t.d, lv) },
              { ...state._logCtx, lineIdx: i + 2 });
          });
        },
      },
    ],
  },

  // ── Pointed Feather（S2，主动技能，冷却 15s）
  // ■ Affects {p00} enemy unit(s) with the highest final DEF.
  //   Deals {p01}% of final ATK as damage.
  // p00: [5,...]        — Boss 战单体，仅命中 1 次
  // p01: [106.61,113.72,120.83,127.93,135.04,142.15,149.26,156.36,163.47,170.58]
  skill2: {
    triggers: [
      {
        on: 'INTERVAL',
        opts: { seconds: 1 / TICK_RATE },
        handler(state, caster) {
          if (!tickSkill2Cooldown(state, caster, 'isabelS2Cd', S2_COOLDOWN_TICKS)) return;
          if (state.enemyHp <= 0) return;
          fireSkillHit(state, caster, getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100,
            getBuffSums(state, caster.id), 'S2');
        },
      },
    ],
  },

  // ── Sonic Chaser（Burst）
  // ■ Affects all enemies.
  //   Deals {p00}% of final ATK as Burst Skill damage.
  //   Additional effect(s) triggered according to the Marked Target's phase. Previous effects trigger repeatedly:
  //   Marked Target 1: Damage Taken ▲ {p01}% for {p02} sec.
  //   Marked Target 2: Deals {p03}% of final ATK as additional damage.
  //   Marked Target 3: Deals {p04}% of final ATK as additional damage.
  // ■ Affects all allies.
  //   Full Burst Time ▼ 5 sec.
  // p00: [93.65,99.9,106.14,112.38,118.63,124.87,131.11,137.36,143.6,149.85]
  // p01: [24.97,26.64,28.3,29.97,31.63,33.3,34.96,36.63,38.29,39.96]
  // p02: [5,...]
  // p03: [187.31,199.8,212.28,224.77,237.26,249.75,262.23,274.72,287.21,299.7]
  // p04: [218.53,233.1,247.66,262.23,276.8,291.37,305.94,320.51,335.08,349.65]
  //
  // 【全爆裂加成】P1 主伤害（as Burst Skill damage）不受影响（默认）；
  //   Marked Target 2 / 3 追加伤害受影响（描述 as additional damage，规则判定，未实测）。
  // Marked Target 1 承伤 ▲ 在施放时施加：B3 伤害于进入全爆裂后结算，故本技能的主伤害与追加伤害均享受该 debuff。
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv    = caster.skillLevels[2];
          const raw   = caster.rawBurst;
          const phase = markedTargetPhase(caster);
          if (phase >= 1) {
            pushBuff(state, { name: 'Sonic Chaser (Damage Taken)', unitId: ENEMY_UNIT_ID, isDebuff: true,
              enemyDamageTakenPct: getSkillValue(raw, 1, lv) / 100,
              endTick: state.tick + TICK_RATE * getSkillValue(raw, 2, lv) },
              { ...state._logCtx, partIdx: 0, lineIdx: 3 });
          }
          // P2：本轮全爆裂时间 ▼ 5s（常量写在描述文本内；CDN burst_duration = 500 与之一致），
          //     由引擎在进入全爆裂时消费（battle.js fullBurstTimeReductionTicks）
          state.fullBurstTimeReductionTicks = (state.fullBurstTimeReductionTicks ?? 0) + 5 * TICK_RATE;

          if (state.enemyHp <= 0) return;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, getSkillValue(raw, 0, lv) / 100, sums, 'Burst P1');
          if (phase >= 2)
            fireSkillHit(state, caster, getSkillValue(raw, 3, lv) / 100, sums, 'Burst P1 Marked Target 2',
              { affectedByFullBurst: true });
          if (phase >= 3)
            fireSkillHit(state, caster, getSkillValue(raw, 4, lv) / 100, sums, 'Burst P1 Marked Target 3',
              { affectedByFullBurst: true });
        },
      },
    ],
  },
};
