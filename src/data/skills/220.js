import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// S2 冷却时间（CDN 不提供，人工填写）
const S2_COOLDOWN_TICKS = 15 * TICK_RATE;

export default {

  // ── Determination
  // ■ Activates when normal attack hits {p01} time(s). Affects the target(s).
  // Deals {p02}% of final ATK as additional damage.
  // ■ Activates when normal attack hits {p01} time(s). Affects self.
  // ATK ▲ {p03}% for {p04} sec.
  //
  // group_id: 22201
  // p01: [30,...] p02 (lv10=82.8%) p03 (lv10=8.28%) p04: [5,...]
  skill1: {
    groupId: 22201,
    triggers: [
      // 每 30 发命中 → 追加技能伤害 [p02]% + 自身 ATK ▲[p03]% 5s
      {
        on: 'SHOT_COUNT',
        opts: { every: 30, counterKey: 'swS1ShotCount' },
        handler(state, caster) {
          const s1Lv   = caster.skillLevels[0];
          const sums   = getBuffSums(state, caster.id);
          const dmgPct = getSkillValue(caster.rawSkill1, 1, s1Lv) / 100;
          fireSkillHit(state, caster, dmgPct, sums, false, 'S1');

          const atkPct = getSkillValue(caster.rawSkill1, 2, s1Lv) / 100;
          const end5   = state.tick + TICK_RATE * 5;
          pushBuff(state, { name: 'sw_s1_atkPct', unitId: caster.id, atkPct, endTick: end5 });
        },
      },
    ],
  },

  // ── Seven Dwarves: V&VI（主动技能，冷却 15s，战斗开始即进入冷却）
  // ■ Affects enemies within the attack range.
  // Deals {p01}% of final ATK as damage.
  // ■ Activates when attacking during Full Burst Time. Affects self.
  // Critical Rate ▲ {p02}% for {p03} sec.
  //
  // group_id: 12202
  // p01 (lv10=144.73%) p02 (lv10=26.1%) p03: [10,...]
  skill2: {
    groupId: 12202,
    triggers: [
      // 战斗开始 → S2 立即进入 15s 冷却（不能在首次全爆裂时发动）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          caster.skillState.swS2CooldownEndTick = state.tick + S2_COOLDOWN_TICKS;
        },
      },
      // 进入全爆裂 → 若 S2 冷却完毕则发动：技能伤害 [p01]% + 自身 Crit Rate ▲[p02]% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          if (state.tick < (caster.skillState.swS2CooldownEndTick ?? 0)) return;
          caster.skillState.swS2CooldownEndTick = state.tick + S2_COOLDOWN_TICKS;

          const s2Lv   = caster.skillLevels[1];
          const sums   = getBuffSums(state, caster.id);
          const dmgPct = getSkillValue(caster.rawSkill2, 0, s2Lv) / 100;
          fireSkillHit(state, caster, dmgPct, sums, false, 'S2');

          const crPct = getSkillValue(caster.rawSkill2, 1, s2Lv) / 100;
          const end10 = state.tick + TICK_RATE * 10;
          pushBuff(state, { name: 'sw_s2_critRate', unitId: caster.id, critRateBonus: crPct, endTick: end10 });
        },
      },
    ],
  },

  // ── Seven Dwarves: I
  // ■ Affects self.
  // Change the weapon in use:
  //   Charge Time: 5 sec
  //   Damage: {p01}% of final ATK
  //   Full Charge Damage: 1000% of damage
  //   Max Ammunition Capacity: {p02} round(s)
  //   Additional Effect: Pierce（武器切换期间射击注入 pierceDamagePct 加成）
  //   [TODO] Pierce：能命中隐藏（装甲保护）核心；同时对重叠零件与敌人本体造成伤害
  //
  // group_id: 12203
  // p01 (lv10=499.5%) p02: [1,...] p03: [1,...]
  //
  // 满蓄力伤害 = p01 × 10（1000% FC = ×10）= lv10: 4995% of final ATK
  // endRounds=1：击发 1 次后武器自动归还 AR
  // 距离加成仍按原始武器（AR，MID 区间）判定，由 battle.js 统一处理
  burst: {
    groupId: 12203,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const bLv             = caster.skillLevels[2];
          const hitMult         = getSkillValue(caster.rawBurst, 0, bLv) / 100;
          const chargeTimeTicks = Math.round(5 * TICK_RATE);

          // 切换至蓄力狙击武器（满弹匣 1 发，取消进行中的装填）
          caster.ammoLeft  = 1;
          caster.reloadTick = 0;

          caster.skillState.weaponSwitchHitMult          = hitMult;
          caster.skillState.weaponSwitchType             = 'SR';
          caster.skillState.weaponSwitchEndTick          = Infinity;
          caster.skillState.weaponSwitchRoundsLeft       = 1;
          caster.skillState.weaponSwitchChargeTimeTicks  = chargeTimeTicks;
          caster.skillState.weaponSwitchFullChargeDamage = 100000;  // 1000% FC ÷ 100 × 10000
          caster.skillState.weaponSwitchUnlimitedAmmo    = false;
          // 击发后 backswing（约 90 ticks），在 skill-executor.js 的 endRounds 归零时生效
          caster.skillState.weaponSwitchBackswingTicks   = 90;
          caster.skillState.weaponSwitchPierce           = true;  // pierce 伤害类型，受 pierceDamagePct buff 加成
          // 立即开始蓄力，5s 后首次击发
          caster.chargeTick = state.tick + chargeTimeTicks;
        },
      },
    ],
  },
};
