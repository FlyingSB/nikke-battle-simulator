import { pushBuff, fireSkillHit, getBuffSums, applyHeal,
         TICK_RATE, ALL_ALLIES } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { hasWindCodeEnemy, personaAlliesOfStep, dispatchPersonaEvent,
         finalMaxHp } from './persona-shared.js';

// Character: Yukiko  (resource_id: 871)
//
// 武器：Machine Gun（弹匣 300，RPM 60→4200 起速，装填 2.5s）。爆裂阶段 Step3，CD 40s。
// Persona 联动机制（Persona 状态 / 1 More / Follow Up）见 persona-shared.js。

export default {

  // ── Persona: Konohana Sakuya
  // ■ Activates at the start of battle. Affects self.
  // Persona - Konohana Sakuya: This effect is continuous and cannot be removed.
  //   Effect 1: Activates every {p01} sec. Affects all allies.
  //   Media: Restores HP equal to {p02}% of the skill user's final max HP.
  // ■ Activates at the start of battle and when Full Burst ends. Affects self.
  // ATK ▲ {p04}% for {p05} sec.
  // ■ Activates when 1 More takes effect. Affects all enemies.
  // Deals {p03}% of final ATK as distributed damage.
  // p01: [3,...]           （Media 间隔秒数；INTERVAL opts 需静态值，与之同步写为 3）
  // p02: [3.37 … 5.7]      （Media 治疗 %最终 MaxHP）
  // p03: [236.54 … 400.31] （1 More 分摊伤害 %ATK）
  // p04: [38.62 … 65.37]   （ATK ▲%）
  // p05: [15,...]          （持续秒数）
  skill1: {
    groupId: 28711,
    triggers: [
      // S1 P1：战斗开始 → Persona - Konohana Sakuya（Persona 状态标记，永久）。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          pushBuff(state, { name: 'Persona - Konohana Sakuya', unitId: caster.id,
            personaState: true, endTick: Infinity });
        },
      },
      // S1 P1 Effect 1：每 3s 全体队友 Media 治疗 p02% × 施法者最终 MaxHP。
      {
        on: 'INTERVAL',
        opts: { seconds: 3 },
        partOverride: 0,
        handler(state, caster) {
          const pct = getSkillValue(caster.rawSkill1, 1, caster.skillLevels[0]) / 100;
          applyHeal(state, ALL_ALLIES, Math.round(finalMaxHp(state, caster) * pct));
        },
      },

      // S1 P2：战斗开始 / 全爆裂结束 → 自身 ATK ▲ p04% 15s。
      {
        on: 'BATTLE_START',
        partOverride: 1,
        handler(state, caster) { applySakuyaAtk(state, caster); },
      },
      {
        on: 'FULL_BURST_END',
        partOverride: 1,
        handler(state, caster) { applySakuyaAtk(state, caster); },
      },

      // S1 P3：1 More 生效 → 全体敌人 p03% 分摊伤害。
      {
        on: 'ONE_MORE',
        partOverride: 2,
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          const lv = caster.skillLevels[0];
          fireSkillHit(state, caster, getSkillValue(caster.rawSkill1, 2, lv) / 100,
            getBuffSums(state, caster.id), 'S1 P3', { isDistributed: true });
        },
      },
    ],
  },

  // ── Scarlet Flower
  // ■ Activates at the start of battle. Affects self.
  // Attack Damage ▲ {p10}% continuously.
  // ■ Activates when using Burst Skill.
  // Scarlet Flower（持续至全爆裂结束）:
  //   Effect 1: Activates every {p01} sec. Affects all allies.
  //     Mediarama: Restores HP equal to {p02}% of the skill user's final max HP.
  //   Effect 2: Affects self. Fire Amp: Distributed Damage ▲ {p03}% continuously.
  //   Effect 3: Affects self. Scarlet Protection: Damage taken from Water Code enemies ▼ {p04}%.
  //   Deactivation condition: When Full Burst ends.
  // ■ Activates when entering Burst Stage 3. Affects self.
  // Elemental Advantage Attack Damage ▲ {p05}% for {p06} sec.
  // ■ Activates when 1 More takes effect. Affects all standard Burst {p07} allies (except the
  //   skill user) in the Persona state.
  // Follow Up: ATK ▲ {p08}% of the skill user's ATK for {p09} sec.
  // p01: [3,...]           （Mediarama 间隔秒数）
  // p02: [3.37 … 5.7]      （Mediarama 治疗 %最终 MaxHP）
  // p03: [53.18 … 90.01]   （分摊伤害 ▲%）
  // p04: [10.6 … 17.95]    （受水冷代码敌人伤害 ▼% — 模拟器不建模敌方输出，忽略）
  // p05: [28.45 … 48.15]   （优越代码伤害 ▲%）
  // p06: [10,...]          （持续秒数）
  // p07: [3,...]           （目标爆裂阶段）
  // p08: [47.42 … 80.25]   （Follow Up：施法者 ATK → ATK flat %）
  // p09: [25,...]          （Follow Up 持续秒数）
  // p10: [32.68 … 55.31]   （攻击伤害 ▲%）
  //
  // Mediarama 从 Scarlet Flower 生效起计时（首次 +p01 秒），由每 tick 的 INTERVAL 检查驱动。
  // Follow Up「skill user's ATK」（非 final）→ 取施法者基础面板 caster.stats.atk。
  skill2: {
    groupId: 28712,
    triggers: [
      // S2 P1：战斗开始 → 自身攻击伤害 ▲ p10% 永久。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          pushBuff(state, { name: 'Scarlet Flower P1', unitId: caster.id,
            attackDamagePct: getSkillValue(caster.rawSkill2, 9, caster.skillLevels[1]) / 100,
            endTick: Infinity });
        },
      },

      // S2 P2：使用爆裂技能 → Scarlet Flower（Fire Amp 分摊伤害 ▲ + Mediarama 计时开始）。
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Scarlet Flower', unitId: caster.id,
            distributedDamagePct: getSkillValue(caster.rawSkill2, 2, lv) / 100,
            endTick: Infinity });
          caster.skillState.yk_nextMediaramaTick =
            state.tick + Math.round(TICK_RATE * getSkillValue(caster.rawSkill2, 0, lv));
        },
      },
      // S2 P2 Effect 1：Scarlet Flower 期间每 p01 秒 Mediarama 全体治疗。
      {
        on: 'INTERVAL',
        opts: { seconds: 1 / TICK_RATE },
        partOverride: 1,
        handler(state, caster) {
          const st = caster.skillState;
          if (st.yk_nextMediaramaTick == null || state.tick < st.yk_nextMediaramaTick) return;
          const lv = caster.skillLevels[1];
          st.yk_nextMediaramaTick += Math.round(TICK_RATE * getSkillValue(caster.rawSkill2, 0, lv));
          const pct = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          applyHeal(state, ALL_ALLIES, Math.round(finalMaxHp(state, caster) * pct));
        },
      },
      // S2 P2 解除：全爆裂结束。
      {
        on: 'FULL_BURST_END',
        partOverride: 1,
        handler(state, caster) {
          state.buffs = state.buffs.filter(b =>
            !(b.name === 'Scarlet Flower' && b.unitId === caster.id));
          caster.skillState.yk_nextMediaramaTick = null;
        },
      },

      // S2 P3：进入爆裂阶段 3 → 自身优越代码伤害 ▲ p05% 10s。
      {
        on: 'ENTER_BURST_III',
        partOverride: 2,
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Scarlet Flower P3', unitId: caster.id,
            elementAdvantagePct: getSkillValue(caster.rawSkill2, 4, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 5, lv) });
        },
      },

      // S2 P4：1 More 生效 → Persona 状态的 B3 队友（除自身）Follow Up，并对其派发 FOLLOW_UP。
      {
        on: 'ONE_MORE',
        partOverride: 3,
        handler(state, caster) {
          const lv      = caster.skillLevels[1];
          const step    = getSkillValue(caster.rawSkill2, 6, lv);
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(caster.rawSkill2, 7, lv) / 100);
          const end     = state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 8, lv);
          const targets = personaAlliesOfStep(state, caster, step);
          for (const ally of targets) {
            pushBuff(state, { name: 'Follow Up', unitId: ally.id, atkFlat, endTick: end });
          }
          for (const ally of targets) dispatchPersonaEvent(state, 'FOLLOW_UP', ally);
        },
      },
    ],
  },

  // ── Maragidyne
  // ■ Affects all enemies.
  // Deals {p01}% of final ATK as distributed damage.
  // ■ Activates if a Wind Code enemy is present. Affects self.
  // 1 More: ATK ▲ {p02}% for {p03} sec.
  // p01: [743.83 … 1258.79]（分摊伤害 %ATK）
  // p02: [26.79 … 45.33]   （1 More ATK ▲%）
  // p03: [10,...]
  burst: {
    groupId: 18713,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];
          if (state.enemyHp > 0) {
            fireSkillHit(state, caster, getSkillValue(caster.rawBurst, 0, lv) / 100,
              getBuffSums(state, caster.id), 'Burst', { isDistributed: true });
          }

          if (!hasWindCodeEnemy(state)) return;
          pushBuff(state, { name: '1 More', unitId: caster.id,
            atkPct: getSkillValue(caster.rawBurst, 1, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawBurst, 2, lv) });
          dispatchPersonaEvent(state, 'ONE_MORE', caster);
        },
      },
    ],
  },
};

function applySakuyaAtk(state, caster) {
  const lv = caster.skillLevels[0];
  pushBuff(state, { name: 'Persona: Konohana Sakuya P2', unitId: caster.id,
    atkPct: getSkillValue(caster.rawSkill1, 3, lv) / 100,
    endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 4, lv) });
}
