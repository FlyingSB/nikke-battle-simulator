import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';
import { hasWindCodeEnemy, personaAlliesOfStep, dispatchPersonaEvent } from './persona-shared.js';

// Character: Queen (Makoto)  (resource_id: 870)
//
// 武器：Shotgun（10 弹丸，弹匣 9，RPM 90，装填 1.5s）。爆裂阶段 Step3，CD 40s。
// Persona 联动机制（Persona 状态 / 1 More / Follow Up）见 persona-shared.js。

export default {

  // ── Persona: Johanna
  // ■ Activates at the start of battle. Affects self.
  // Persona - Johanna: This effect is continuous and cannot be removed.
  //   Effect 1: Nuke Boost: Elemental Advantage Attack Damage ▲ {p01}% continuously.
  //   Effect 2: Defense Master: DEF ▲ {p02}% continuously.
  // ■ Activates at the start of battle and when Full Burst ends. Affects self.
  // ATK ▲ {p05}% for {p06} sec.
  // ■ Activates when 1 More takes effect. Affects all enemies.
  // Deals {p03}% of final ATK as distributed damage.
  // ■ Activates when Follow Up takes effect. Affects all enemies.
  // Deals {p04}% of final ATK as distributed damage.
  // p01: [8.03 … 13.59]    （优越代码伤害 ▲%）
  // p02: [8.73 … 14.78]    （DEF ▲%）
  // p03: [324.39 … 548.99] （1 More 分摊伤害 %ATK）
  // p04: [324.39 … 548.99] （Follow Up 分摊伤害 %ATK）
  // p05: [29.7 … 50.28]    （ATK ▲%）
  // p06: [15,...]          （持续秒数）
  skill1: {
    groupId: 28701,
    triggers: [
      // S1 P1：战斗开始 → Persona - Johanna（Persona 状态 + 优越代码伤害 / DEF ▲，永久）。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          pushBuff(state, { name: 'Persona - Johanna', unitId: caster.id, personaState: true,
            elementAdvantagePct: getSkillValue(caster.rawSkill1, 0, lv) / 100,
            defPct:              getSkillValue(caster.rawSkill1, 1, lv) / 100,
            endTick: Infinity });
        },
      },

      // S1 P2：战斗开始 / 全爆裂结束 → 自身 ATK ▲ p05% 15s。
      {
        on: 'BATTLE_START',
        handler(state, caster) { applyJohannaAtk(state, caster); },
      },
      {
        on: 'FULL_BURST_END',
        partOverride: 1,
        handler(state, caster) { applyJohannaAtk(state, caster); },
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

      // S1 P4：Follow Up 生效（Yukiko S2 施加）→ 全体敌人 p04% 分摊伤害。
      {
        on: 'FOLLOW_UP',
        partOverride: 3,
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          const lv = caster.skillLevels[0];
          fireSkillHit(state, caster, getSkillValue(caster.rawSkill1, 3, lv) / 100,
            getBuffSums(state, caster.id), 'S1 P4', { isDistributed: true });
        },
      },
    ],
  },

  // ── Fist of Justice!
  // ■ Activates at the start of battle. Affects self.
  // Attack Damage ▲ {p09}% continuously.
  // ■ Activates when using Burst Skill. Affects self.
  // Fist of Justice!（持续至全爆裂结束）:
  //   Effect 1: Nuke Amp: Elemental Advantage Attack Damage ▲ {p01}% continuously.
  //   Effect 2: Rakukaja: DEF ▲ {p02}% continuously.
  //   Deactivation condition: When Full Burst ends.
  // ■ Activates when entering Burst Stage 3. Affects self.
  // Distributed Damage ▲ {p03}% for {p04} sec.
  // ■ Activates when 1 More takes effect. Affects all standard Burst {p05} allies (except the
  //   skill user) in the Persona state.
  // Baton Pass: ATK ▲ {p06}% of the skill user's ATK continuously. Stacks up to {p07} times.
  // p01: [15.09 … 25.56]   （优越代码伤害 ▲%）
  // p02: [10.6 … 17.95]    （DEF ▲%）
  // p03: [53.18 … 90.01]   （分摊伤害 ▲%）
  // p04: [10,...]          （持续秒数）
  // p05: [3,...]           （目标爆裂阶段）
  // p06: [20.8 … 35.2]     （Baton Pass：施法者 ATK → ATK flat %，每层）
  // p07: [3,...]           （Baton Pass 层数上限）
  // p09: [17.72 … 30]      （攻击伤害 ▲%）
  //
  // Baton Pass「skill user's ATK」（非 final）→ 取施法者基础面板 caster.stats.atk。
  skill2: {
    groupId: 28702,
    triggers: [
      // S2 P1：战斗开始 → 自身攻击伤害 ▲ p09% 永久。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          pushBuff(state, { name: 'Fist of Justice! (Attack Damage)', unitId: caster.id,
            attackDamagePct: getSkillValue(caster.rawSkill2, 8, caster.skillLevels[1]) / 100,
            endTick: Infinity });
        },
      },

      // S2 P2：使用爆裂技能 → Fist of Justice!（优越代码伤害 / DEF ▲），全爆裂结束时解除。
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Fist of Justice!', unitId: caster.id,
            elementAdvantagePct: getSkillValue(caster.rawSkill2, 0, lv) / 100,
            defPct:              getSkillValue(caster.rawSkill2, 1, lv) / 100,
            endTick: Infinity });
        },
      },
      {
        on: 'FULL_BURST_END',
        partOverride: 1,
        handler(state, caster) {
          state.buffs = state.buffs.filter(b =>
            !(b.name === 'Fist of Justice!' && b.unitId === caster.id));
        },
      },

      // S2 P3：进入爆裂阶段 3 → 自身分摊伤害 ▲ p03% 10s。
      {
        on: 'ENTER_BURST_III',
        partOverride: 2,
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Fist of Justice! (Distributed Damage)', unitId: caster.id,
            distributedDamagePct: getSkillValue(caster.rawSkill2, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 3, lv) });
        },
      },

      // S2 P4：1 More 生效 → Persona 状态的 B3 队友（除自身）Baton Pass 叠层。
      {
        on: 'ONE_MORE',
        partOverride: 3,
        handler(state, caster) {
          const lv      = caster.skillLevels[1];
          const step    = getSkillValue(caster.rawSkill2, 4, lv);
          const atkFlat = Math.round(caster.stats.atk * getSkillValue(caster.rawSkill2, 5, lv) / 100);
          const limit   = getSkillValue(caster.rawSkill2, 6, lv);
          pushBuff(state, { name: 'Baton Pass',
            unitIds: personaAlliesOfStep(state, caster, step).map(a => a.id),
            atkFlat, stackLimit: limit, endTick: Infinity });
        },
      },
    ],
  },

  // ── Mafreidyne
  // ■ Affects all enemies.
  // Deals {p01}% of final ATK as distributed damage.
  // ■ Activates if a Wind Code enemy is present. Affects self.
  // 1 More: ATK ▲ {p02}% for {p03} sec.
  // p01: [840.08 … 1421.69]（分摊伤害 %ATK）
  // p02: [17.88 … 30.27]   （1 More ATK ▲%）
  // p03: [10,...]
  burst: {
    groupId: 18703,
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
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawBurst, 2, lv) },
            { ...state._logCtx, partIdx: 1 });
          dispatchPersonaEvent(state, 'ONE_MORE', caster);
        },
      },
    ],
  },
};

function applyJohannaAtk(state, caster) {
  const lv = caster.skillLevels[0];
  // S1 唯一未具名效果段（P1 为 Persona - Johanna，P3/P4 为伤害）→ 日志标签省略 P 后缀
  pushBuff(state, { name: 'Persona: Johanna', unitId: caster.id,
    atkPct: getSkillValue(caster.rawSkill1, 4, lv) / 100,
    endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 5, lv) },
    { ...state._logCtx, partIdx: null });
}
