import { pushBuff, applyShield, applyCoverHeal, getFinalMaxHp, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Tia  (resource_id: 451)
//
// 武器：Rocket Launcher（UP 型）。爆裂阶段 Step1，CD 40s；CDN change_burst_step = Step1（爆裂后重入阶段 1，
// 由引擎 advanceAfterBurstI 处理，对应爆裂技能 P3「Re-enters Burst Stage 1」）。
// 重入阶段 1 后须由队伍中另一名冷却就绪的 B1 继续推进，队伍只有 Tia 一名 B1 时爆裂会在阶段 1 超时。
// （Naga 为 B2，常与 Tia 同队是因为其 S1 掩体治疗触发本角色 S1，并不承担第二个 B1。）
// 掩体 HP / 护盾吸收 / 嘲讽均无敌方伤害模型，只建模事件与日志。

const CD_STACK_KEY = 'tiaCdStackTicks';

export default {

  // ── Reptile Lover（S1）
  // ■ Activates when recovering Cover's HP. Affects self.
  //   Cooldown of Burst Skill ▼ {p00} sec, stacks up to {p01} time(s) and lasts for {p02} sec.
  // ■ Activates when recovering Cover's HP. Affects all allies.
  //   Attack damage ▲ {p03}% for {p04} sec.
  // p00: [7,7,7,10,10,10,13,13,13,13]
  // p01: [2,...]
  // p02: [12,...]
  // p03: [17.46,19.08,20.71,22.34,23.97,25.6,27.23,28.85,30.48,32.11]
  // p04: [10,...]
  //
  // 「when recovering Cover's HP」：任意掩体治疗（COVER_HEAL 团队事件，含 Naga S1 / Tia 自身 S2 P2）。
  // P1 冷却缩减按「每层独立计时」解读：p02 秒窗口内最多生效 p01 次，每次立即缩减爆裂冷却 p00 秒。
  skill1: {
    triggers: [
      {
        on: 'COVER_HEAL',
        handler(state, caster) {
          const lv     = caster.skillLevels[0];
          const raw    = caster.rawSkill1;
          const window = TICK_RATE * getSkillValue(raw, 2, lv);
          const stacks = (caster.skillState[CD_STACK_KEY] ?? []).filter(t => t + window > state.tick);
          if (stacks.length >= getSkillValue(raw, 1, lv)) {
            caster.skillState[CD_STACK_KEY] = stacks;
            return false;
          }
          caster.skillState[CD_STACK_KEY] = [...stacks, state.tick];
          const reductionTicks = Math.round(TICK_RATE * getSkillValue(raw, 0, lv));
          caster.burstCdRemaining = Math.max(0, caster.burstCdRemaining - reductionTicks);
          if (state.buffLog)
            state.buffLog.push({ type: 'cd_reduction', tick: state.tick,
              name: 'Reptile Lover (Burst CD)', unitId: caster.id, reductionTicks });
          state.pendingSkillEvents?.push({
            type: 'skill_trigger', tick: state.tick, _seq: state._logSeq++,
            unitName: caster.name, skillLabel: state._logCtx.skillLabel, slot: 'S1',
            partIdx: 0, trigger: 'COVER_HEAL', lineIdx: null, target: caster.name,
            gaugeAfter: state.burstGauge,
          });
        },
      },
      {
        on: 'COVER_HEAL',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          pushBuff(state, { name: 'Reptile Lover (Attack Damage)', unitId: null,
            attackDamagePct: getSkillValue(caster.rawSkill1, 3, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 4, lv) });
        },
      },
    ],
  },

  // ── Chameleon Invisibility（S2）
  // ■ Activates after landing {p00} normal attack(s). Affects self.
  //   Max HP of Cover ▲ {p01}% of the caster's Max HP for {p02} sec.
  //   Attract: Taunts all enemies for {p03} sec.
  // ■ Activates when using Burst Skill. Affects self.
  //   Restores Cover HP by {p04}% of caster's final Max HP.
  //   Recovers {p05}% of attack damage as HP over {p06} sec.
  // p00: [5,...]
  // p01: [19.35,20.84,22.33,23.82,25.31,26.79,28.28,29.77,31.26,32.75]
  // p02: [5,...]   p03: [5,...]
  // p04: [10.5,11.71,12.92,14.14,15.35,16.56,17.77,18.98,20.2,21.41]
  // p05: [18.03,18.47,18.91,19.34,19.78,20.22,20.65,21.09,21.53,21.96]
  // p06: [10,...]
  skill2: {
    triggers: [
      // P1：掩体最大 HP ▲ / 嘲讽（掩体 HP 与敌方攻击未建模）
      {},
      // P2：使用爆裂技能 → 回复掩体 HP（触发 COVER_HEAL）+ 生命偷取 p05%（p06 秒）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          applyCoverHeal(state, null, [caster]);
          pushBuff(state, { name: 'Chameleon Invisibility', unitId: caster.id,
            lifeStealPct: getSkillValue(caster.rawSkill2, 5, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 6, lv) });
        },
      },
    ],
  },

  // ── Lizard's Protection（Burst）
  // ■ Affects self.
  //   Generates a Shield with {p00}% of the caster's final Max HP for {p01} sec.
  // ■ Affects all allies (except self).
  //   Generates a Shield with {p02}% of the caster's final Max HP for {p03} sec.
  // ■ Affects all allies.
  //   Re-enters Burst Stage 1.
  // p00: [20.72,22.32,23.91,25.5,27.1,28.69,30.29,31.88,33.48,35.07]
  // p01: [10,...]
  // p02: [6.03,6.49,6.96,7.42,7.89,8.35,8.81,9.28,9.74,10.21]
  // p03: [10,...]
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv     = caster.skillLevels[2];
          const raw    = caster.rawBurst;
          const maxHp  = getFinalMaxHp(state, caster);
          applyShield(state, caster, Math.round(maxHp * getSkillValue(raw, 0, lv) / 100),
            state.tick + TICK_RATE * getSkillValue(raw, 1, lv), { partIdx: 0 });
          const others = Math.round(maxHp * getSkillValue(raw, 2, lv) / 100);
          const end    = state.tick + TICK_RATE * getSkillValue(raw, 3, lv);
          for (const u of state.squad) {
            if (u.id !== caster.id) applyShield(state, u, others, end, { partIdx: 1 });
          }
          // P3：重入爆裂阶段 1 —— 由 CDN change_burst_step = Step1 驱动（battle.js advanceAfterBurstI）
        },
      },
    ],
  },
};
