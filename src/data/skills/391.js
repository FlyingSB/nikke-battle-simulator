import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Ein  (resource_id: 391)
//
// 武器：Sniper Rifle（UP 型，蓄力 1s，弹匣 6，FC 250%）。爆裂阶段 Step3，CD 40s。
//
// Near Feather（近距羽翼）：召唤数量写在描述文本内（S1 战斗开始 4 只、爆裂 6 只），不在 description_value_list 中。
// 建模为「每召唤 1 只 → S2 P1 Near Feather Attack 命中 1 次」（S2 P1 由召唤事件触发，描述未给出持续攻击）。
// TODO(审核时实测)：据 nikke.gg 分析，羽翼会持续攻击且会自动消失（描述无时长），场上最多 6 只；
//   6 只时一次全爆裂约攻击 34 次（其中 2 次在全爆裂结束后），4 只的攻击速度明显更慢。
//   当前「召唤 1 只命中 1 次」明显低估，待实测 4 只 / 6 只的攻击间隔与存在时长后重新建模。
const BATTLE_START_FEATHERS = 4;
const BURST_FEATHERS        = 6;

// 召唤 n 只 Near Feather → 触发 S2 P1 n 次（p01% 最终 ATK 真实伤害）。
// 爆裂技能中召唤时临时关闭 B3 伤害延迟：Near Feather Attack 是 S2 伤害，召唤时即刻结算，
// 不属于「B3 爆裂技能伤害从进入全爆裂开始计时」的范围。
function summonNearFeathers(state, caster, count) {
  if (state.enemyHp <= 0) return;
  const prevDefer = state._deferB3HitsFor;
  state._deferB3HitsFor = null;
  const mult = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
  for (let i = 0; i < count; i++) {
    fireSkillHit(state, caster, mult, getBuffSums(state, caster.id), 'S2 P1 Near Feather Attack',
      { isTrueDamage: true });
  }
  state._deferB3HitsFor = prevDefer;
}

export default {

  // ── Feather Standby（S1）
  // ■ Activates when entering battle. Affects self.
  //   Summons 4 Near Feathers.
  // ■ Activates when entering Burst Skill Stage 3. Affects self.
  //   ATK ▲ {p00}% for {p01} sec.
  // p00: [41.18,44.4,47.61,50.83,54.04,57.26,60.48,63.69,66.91,70.12]
  // p01: [10,...]
  skill1: {
    triggers: [
      // P1：战斗开始 → 召唤 4 只 Near Feather
      {
        on: 'BATTLE_START',
        handler(state, caster) { summonNearFeathers(state, caster, BATTLE_START_FEATHERS); },
      },
      // P2：进入爆裂阶段 3 → 自身 ATK ▲ p00%（p01 秒）
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          pushBuff(state, { name: 'Feather Standby', unitId: caster.id,
            atkPct: getSkillValue(caster.rawSkill1, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 1, lv) },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },

  // ── Feather Shot（S2）
  // ■ Activates when Near Feather is summoned. Affects {p00} random enemy unit(s).
  //   Near Feather Attack: Deals {p01}% of final ATK as true damage.
  // ■ Activates when attacking with Full Charge. Affects self.
  //   Charge Damage ▲ {p02}% for {p03} shot(s).
  // p00: [1,...]
  // p01: [59.01,62.54,66.08,69.61,73.15,76.68,80.21,83.75,87.28,90.81]
  // p02: [47.27,50.91,54.54,58.18,61.82,65.45,69.09,72.73,76.36,80]
  // p03: [1,...]
  skill2: {
    triggers: [
      // P1：随召唤触发（见 summonNearFeathers）
      {},
      // P2：全蓄力攻击后 → 蓄力伤害 ▲ p02%，作用于其后 p03 发（回合制，下一发普攻消耗）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Feather Shot', unitId: caster.id,
            chargeDamagePct: getSkillValue(caster.rawSkill2, 2, lv) / 100,
            endRounds: getSkillValue(caster.rawSkill2, 3, lv) },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },

  // ── Feather All-Range（Burst）
  // ■ Affects self.
  //   Summons 6 Near Feathers.
  //   True Damage ▲ {p00}% for {p01} sec.
  //   Charge Damage ▲ {p02}% for {p03} sec.
  // ■ Affects {p04} enemy unit(s) with the highest final DEF.
  //   Deals {p05}% of final ATK as true damage.
  // p00: [31.2,33.87,36.55,39.23,41.91,44.59,47.27,49.94,52.62,55.3]
  // p01: [10,...]
  // p02: [82.36,88.84,95.32,101.8,108.28,114.76,121.24,127.72,134.2,140.68]
  // p03: [10,...]
  // p04: [10,...]       — Boss 战单体，仅命中 1 次
  // p05: [170.32,184.73,199.14,213.55,227.96,242.38,256.79,271.2,285.61,300.02]
  //
  // 【全爆裂加成】P2 不受影响（描述 as true damage，默认）。
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const raw = caster.rawBurst;
          pushBuff(state, { name: 'Feather All-Range (True Damage)', unitId: caster.id,
            trueDamagePct: getSkillValue(raw, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 1, lv) }, { ...state._logCtx, partIdx: 0 });
          pushBuff(state, { name: 'Feather All-Range (Charge Damage)', unitId: caster.id,
            chargeDamagePct: getSkillValue(raw, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 3, lv) }, { ...state._logCtx, partIdx: 0 });
          // P1：召唤 6 只 Near Feather（S2 P1，召唤时即刻命中；享受本技能刚推入的 True Damage ▲）
          summonNearFeathers(state, caster, BURST_FEATHERS);
          if (state.enemyHp <= 0) return;
          fireSkillHit(state, caster, getSkillValue(raw, 5, lv) / 100, getBuffSums(state, caster.id), 'Burst',
            { isTrueDamage: true });
        },
      },
    ],
  },
};
