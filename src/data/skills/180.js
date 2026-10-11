import { pushBuff, fireSkillHit, getBuffSums, applyHpLoss, getHpRatio, getFinalMaxHp,
         TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Guillotine  (resource_id: 180)
//
// 武器：Machine Gun（弹匣 300，装填 2.5s）。爆裂阶段 Step3，CD 40s。

const S2_ATK = 'Shroud of Darkness (ATK)';

export default {

  // ── Residual Heat（S1）
  // ■ Affects self. Activates after landing {p00} normal attack(s).
  //   Critical Rate ▲ {p01}% for {p02} sec.
  //   HP ▼ {p03}%.
  // p00: [30,...]
  // p01: [6.28,6.61,6.95,7.28,7.62,7.95,8.28,8.62,8.95,9.28]
  // p02: [10,...]
  // p03: [2.01,...]
  // p04: [0,...]     — 未在描述中使用
  //
  // 「HP ▼ X%」按当前 HP × X% 扣减（用户确认，2026-10-11；applyHpLoss 下限 1，自损不致死）。
  skill1: {
    triggers: [
      {
        on: 'SHOT_COUNT',
        opts: { every: 30 },   // p00 为常量 30（opts.every 需静态）
        handler(state, caster) {
          const lv  = caster.skillLevels[0];
          const raw = caster.rawSkill1;
          pushBuff(state, { name: 'Residual Heat', unitId: caster.id,
            critRatePct: getSkillValue(raw, 1, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 2, lv) },
            { ...state._logCtx, partIdx: null });
          const curHp = caster.unitHp ?? getFinalMaxHp(state, caster);
          applyHpLoss(state, caster, curHp * getSkillValue(raw, 3, lv) / 100, { partIdx: null });
        },
      },
    ],
  },

  // ── Shroud of Darkness（S2）
  // ■ Activates after landing {p00} normal attack(s). Affects self.
  //   Critical Damage ▲ {p01}% for {p02} sec.
  // ■ Activates when HP falls below {p03}%. Affects self.
  //   ATK ▲ {p04}% continuously for every 1% of HP lost.
  // p00: [150,...]
  // p01: [8.68,9.35,10.02,10.68,11.35,12.02,12.69,13.36,14.02,14.69]
  // p02: [5,...]
  // p03: [70,...]
  // p04: [0.56,0.61,0.65,0.69,0.74,0.78,0.82,0.87,0.91,0.96]
  skill2: {
    triggers: [
      // P1：每 150 发普攻 → 暴击伤害 ▲ p01%（p02 秒）
      {
        on: 'SHOT_COUNT',
        opts: { every: 150 },   // p00 为常量 150
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Shroud of Darkness (Crit Damage)', unitId: caster.id,
            critDamagePct: getSkillValue(caster.rawSkill2, 1, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 2, lv) });
        },
      },
      // P2：HP 低于 p03% 时 → 每损失 1% HP（向下取整）ATK ▲ p04%，随 HP 变化实时更新；回到阈值以上时移除
      {
        on: 'HP_CHANGED',
        handler(state, caster, ctx) {
          if (ctx.unit?.id !== caster.id) return false;
          const lv    = caster.skillLevels[1];
          const raw   = caster.rawSkill2;
          const ratio = getHpRatio(state, caster);
          const buff  = state.buffs.find(b => b.name === S2_ATK && b.unitId === caster.id);
          if (ratio >= getSkillValue(raw, 3, lv) / 100) {
            if (buff) state.buffs = state.buffs.filter(b => b !== buff);
            return false;
          }
          const lost   = Math.floor((1 - ratio) * 100 + 1e-9);
          const atkPct = getSkillValue(raw, 4, lv) / 100 * lost;
          if (buff) {
            buff.atkPct     = atkPct;
            buff.multiplier = lost;
            return false;
          }
          pushBuff(state, { name: S2_ATK, unitId: caster.id, atkPct, multiplier: lost, endTick: Infinity });
        },
      },
    ],
  },

  // ── Dragon of the Deep（Burst）
  // ■ Affects the enemy with the highest final ATK.
  //   Deals {p00}% of final ATK as Burst Skill damage.
  // ■ Affects the same target when the caster's HP falls below {p01}%.
  //   Deals {p02}% of final ATK as additional damage.
  // p00: [731.25,787.5,843.75,900,956.25,1012.5,1068.75,1125,1181.25,1237.5]
  // p01: [50,...]
  // p02: [731.25,787.5,843.75,900,956.25,1012.5,1068.75,1125,1181.25,1237.5]
  //
  // 【全爆裂加成】P1 不受影响（as Burst Skill damage，默认）；P2 受影响（描述 as additional damage，规则判定，未实测）。
  // P2 的 HP 条件按施放时刻判定。
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          const lv   = caster.skillLevels[2];
          const raw  = caster.rawBurst;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, getSkillValue(raw, 0, lv) / 100, sums, 'Burst P1');
          if (getHpRatio(state, caster) < getSkillValue(raw, 1, lv) / 100)
            fireSkillHit(state, caster, getSkillValue(raw, 2, lv) / 100, sums, 'Burst P2',
              { affectedByFullBurst: true });
        },
      },
    ],
  },
};
