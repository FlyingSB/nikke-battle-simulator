import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Snow White  (resource_id: 220)
// S2 冷却时间（CDN 不提供，人工填写）
const S2_COOLDOWN_SEC = 15;

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
          fireSkillHit(state, caster, dmgPct, sums, 'S1');

          const atkPct = getSkillValue(caster.rawSkill1, 2, s1Lv) / 100;
          const end5   = state.tick + TICK_RATE * 5;
          pushBuff(state, { name: 'Determination', unitId: caster.id, atkPct, endTick: end5 }, 
            { ...state._logCtx, partIdx: 1 }
          );
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
      // S2：每 15s 触发一次（首次 t+15s）
      // P1（技能伤害）与 P2（Crit Rate buff）合并在同一 handler，P2 复用 Full Burst 判断
      {
        on: 'INTERVAL',
        opts: { seconds: S2_COOLDOWN_SEC },
        handler(state, caster) {
          const s2Lv  = caster.skillLevels[1];
          const sums  = getBuffSums(state, caster.id);
          // P1: 技能伤害
          const dmgPct = getSkillValue(caster.rawSkill2, 0, s2Lv) / 100;
          fireSkillHit(state, caster, dmgPct, sums, 'S2 P1');
          if (!state.fullBurstActive) return;
          // P2: Crit Rate ▲（Full Burst 期间已在上方确认）
          const crPct = getSkillValue(caster.rawSkill2, 1, s2Lv) / 100;
          pushBuff(state, { name: 'Seven Dwarves: V&VI', unitId: caster.id,
            critRatePct: crPct, endTick: state.tick + TICK_RATE * 10 }, 
            { ...state._logCtx, partIdx: 1 });
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
  // 全蓄力伤害 = p01 × 10（1000% FC = ×10）= lv10: 4995% of final ATK
  // endRounds=1：击发 1 次后武器自动归还 AR
  // 距离加成仍按原始武器（AR，MID 区间）判定，由 battle.js 统一处理
  //
  // [Cat3 TODO] weaponSwitch 系列字段（9 个）应迁移为单一 buff 对象以保证原子性；
  // 需同步修改 battle.js 读取逻辑，跨 102/220/223/281/316/390/470.js 统一重构时处理。
  burst: {
    groupId: 12203,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const bLv             = caster.skillLevels[2];
          const hitMult         = getSkillValue(caster.rawBurst, 0, bLv) / 100;
          const chargeTimeTicks = Math.round(5 * TICK_RATE);

          // 切换至蓄力武器（Charged 类型，满弹匣 1 发，取消进行中的装填）
          caster.ammoLeft   = 1;
          caster.reloadTick = 0;

          // 原子性批量写入 weaponSwitch 状态（Cat3 TODO 见上方注释）
          Object.assign(caster.skillState, {
            weaponSwitchHitMult:          hitMult,
            weaponSwitchMaxAmmo:          1,
            weaponSwitchType:             'Charged',
            weaponSwitchEndTick:          Infinity,
            weaponSwitchRoundsLeft:       1,
            weaponSwitchChargeTimeTicks:  chargeTimeTicks,
            weaponSwitchFullChargeDamage: 100000,  // 1000% FC ÷ 100 × 10000
            weaponSwitchUnlimitedAmmo:    false,
            weaponSwitchBackswingTicks:   90,
            weaponSwitchPierce:           true,
          });

          // 立即开始蓄力，5s 后首次击发
          caster.chargeTick = state.tick + chargeTimeTicks;
        },
      },
    ],
  },
};
