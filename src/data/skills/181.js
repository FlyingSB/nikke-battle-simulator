import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { tickSkill2Cooldown } from './active-skill-shared.js';
import { ACTIVE_SKILL_COOLDOWN_SEC } from '../active-skill-cooldowns.js';

// Character: Maiden  (resource_id: 181)
//
// 武器：Shotgun（10 弹丸，弹匣 9）。爆裂阶段 Step3，CD 40s。
// S2 为主动技能（CharacterSkill 表），CDN 不提供冷却时间，人工填写：30s（prydwen.gg / Fandom wiki）。
// 与 80 / 220 / 231 约定一致：战斗开始先进入冷却，首次施放于 t+30s；可被 Arcana S1 The Magician 加速。
// Revenge（S1）依赖「受到攻击」，模拟器不建模敌方攻击，按决定不建模：S1 与爆裂 P2 均不生效。
const S2_COOLDOWN_TICKS = ACTIVE_SKILL_COOLDOWN_SEC[181].skill2 * TICK_RATE;

export default {

  // ── Kotodama: Words of Skill（S1）
  // ■ Activates when attacked {p00} time(s). Affects self.
  //   Revenge: ATK ▲ {p01}% for {p02} sec.
  // p00: [20,...]
  // p01: [15.75,16.96,18.18,19.39,20.6,21.81,23.03,24.24,25.45,26.66]
  // p02: [20,...]
  skill1: {
    triggers: [
      // [TODO] P1（Revenge）：受到攻击 20 次 → 自身 ATK ▲ 20s。
      //   「when attacked」事件在模拟器中不建模（同 222.js / 140.js），占位
      {},
    ],
  },

  // ── Kotodama: Words of Assault（S2，主动技能，冷却 30s）
  // ■ Affects all enemies.
  //   Taunt for {p00} sec.
  // ■ Affects self.
  //   Critical Damage ▲ {p01}% for {p02} sec.
  // p00: [10,...]
  // p01: [94.13,100.65,107.18,113.7,120.22,126.75,133.27,139.79,146.32,152.84]
  // p02: [10,...]
  skill2: {
    triggers: [
      // 冷却就绪时施放：P1 嘲讽为防御性效果，不建模；P2 自身暴击伤害 ▲
      {
        on: 'INTERVAL',
        opts: { seconds: 1 / TICK_RATE },
        handler(state, caster) {
          if (!tickSkill2Cooldown(state, caster, 'maidenS2Cd', S2_COOLDOWN_TICKS)) return;
          const lv  = caster.skillLevels[1];
          const raw = caster.rawSkill2;
          // 技能中唯一的 buff（嘲讽不是 buff）→ 以技能名命名
          pushBuff(state, { name: 'Kotodama: Words of Assault', unitId: caster.id,
            critDamagePct: getSkillValue(raw, 1, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 2, lv) },
            { ...state._logCtx, partIdx: 1 });
        },
      },
    ],
  },

  // ── Kotodama: Words of Power（Burst）
  // ■ Affects all enemies.
  //   Deals {p00}% of final ATK as Burst Skill damage.
  // ■ Affects the same target(s) when in Revenge status.
  //   Deals {p01}% of final ATK as additional damage.
  // p00: [270.56,291.37,312.18,333,353.81,374.62,395.43,416.25,437.06,457.87]
  // p01: [270.56,291.37,312.18,333,353.81,374.62,395.43,416.25,437.06,457.87]
  //
  // 【全爆裂加成】P1 不受影响（描述 as Burst Skill damage，默认）；
  //   P2 受影响（描述 as additional damage，规则判定）——但 P2 依赖 Revenge，当前不建模，永不触发。
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          fireSkillHit(state, caster, getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100,
            getBuffSums(state, caster.id), 'Burst P1');
          // [TODO] P2：Revenge 状态下追加 p01% final ATK（affectedByFullBurst）— Revenge 不建模，跳过
        },
      },
    ],
  },
};
