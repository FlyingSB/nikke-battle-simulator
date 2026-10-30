import { pushBuff, fireSkillHit, getBuffSums, reloadMagazinePct, enterIntoTheFray, isInIntoTheFray, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Marian: Queen  (resource_id: 19)

const SHARPENED_RESOLVE = 'Sharpened Resolve';
const PENETRANT_WISH    = 'Penetrant Wish';

// 敌人是否处于 Open Wounds 状态（S1 施加，持续且不可移除）
function hasOpenWounds(state) {
  return state.buffs.some(b => b.unitId === '__enemy__' && b.name === 'Open Wounds');
}

// Open Wounds：Damage Taken ▲ p03%，持续、不可移除；描述未写叠加 → 单层，已存在时不重复推入（避免日志刷屏）
function applyOpenWounds(state, caster) {
  if (hasOpenWounds(state)) return;
  const pct = getSkillValue(caster.rawSkill1, 2, caster.skillLevels[0]) / 100;
  pushBuff(state, { name: 'Open Wounds', unitId: '__enemy__', isDebuff: true,
    enemyDamageTakenPct: pct, endTick: Infinity });
}

export default {

  // ── Sharpened Resolve
  // ■ Activates at the start of battle. Affects self.
  //   Into the Fray: Sharpened Resolve
  //   Function: Launches Dark Matter spears at random enemies.
  //   Effect 1: Affects random enemies. Dark Matter Spear: Deals {p01}% of final ATK as damage. Attacks sequentially {p02} times.
  //   Effect 2: Activates when landing a hit with a Dark Matter spear. Affects the target.
  //             Open Wounds: Damage Taken ▲ {p03}%. This effect is continuous and cannot be removed.
  //   Recurring interval: {p04} sec
  // ■ Activates when using Burst Skill. Affects all enemies.
  //   Open Wounds: Damage Taken ▲ {p03}%. This effect is continuous and cannot be removed.
  //
  // group_id: 20191
  // p01: [74.16 … 125.51]   （Dark Matter Spear 每次 %ATK）
  // p02: [7, ...]           （依次攻击次数，常量）
  // p03: [2.98 … 5.05]      （Open Wounds 受到伤害 ▲%）
  // p04: [4, ...]           （发射间隔秒，常量；Penetrant Wish 期间 ▼ S2 p03 秒）
  //
  // 简化说明：
  // - Sharpened Resolve 自开战起持续（描述无持续时间），首次发射按引擎 INTERVAL 约定在开战后 p04 秒（未实测）。
  // - 单体 Boss：随机敌人恒为 Boss；p02 次依次攻击同 tick 结算，首次命中后施加 Open Wounds，后续命中即享受易伤。
  skill1: {
    groupId: 20191,
    triggers: [
      // P1：开战进入 Into the Fray: Sharpened Resolve（持续）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          enterIntoTheFray(caster, SHARPENED_RESOLVE, Infinity);
        },
      },
      // P1：每 p04 秒（Penetrant Wish 期间缩短 S2 p03 秒）发射 Dark Matter Spear × p02（依次攻击）
      {
        on: 'INTERVAL',
        partOverride: 0,
        opts: {
          seconds(state, caster) {
            const base = getSkillValue(caster.rawSkill1, 3, caster.skillLevels[0]);
            if (!isInIntoTheFray(state, caster, PENETRANT_WISH)) return base;
            return Math.max(0.1, base - getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]));
          },
        },
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          const lv    = caster.skillLevels[0];
          const mult  = getSkillValue(caster.rawSkill1, 0, lv) / 100;
          const times = getSkillValue(caster.rawSkill1, 1, lv);
          const sums  = getBuffSums(state, caster.id);
          for (let i = 0; i < times; i++) {
            fireSkillHit(state, caster, mult, sums, 'S1 P1 Dark Matter Spear', { isSequentialAttack: true });
            // Effect 2：命中目标 → Open Wounds（承伤在命中时刻读取，后续命中立即生效）
            applyOpenWounds(state, caster);
          }
        },
      },
      // P2：施放爆裂技能 → 全体敌人 Open Wounds
      {
        on: 'BURST_SKILL_USE',
        partOverride: 1,
        handler(state, caster) {
          applyOpenWounds(state, caster);
        },
      },
    ],
  },

  // ── Synthetic World
  // ■ Activates when using Burst Skill. Affects self.
  //   Into the Fray: Penetrant Wish
  //   Function: Deals core damage to all enemies in the Open Wounds state.
  //   Effect 1: Activates after performing {p01} normal attacks. Affects all enemies in the Open Wounds state.
  //             Deals {p02}% of final ATK as core strike damage.
  //   Effect 2: Affects self. Recurring interval of Into the Fray: Sharpened Resolve ▼ {p03} sec.
  //   Duration: {p04} sec
  // ■ Activates when entering Full Burst while not in the Into the Fray: Penetrant Wish state. Affects self.
  //   Sequential Attack Damage ▲ {p05}% for {p06} sec.
  // ■ Activates when entering Full Burst while in the Into the Fray: Penetrant Wish state. Affects self.
  //   Core Damage ▲ {p07}% for {p08} sec.
  //
  // group_id: 20192
  // p01: [2, ...]            （普攻次数，常量）
  // p02: [8.31 … 14.06]      （核心打击 %ATK）
  // p03: [2, ...]            （S1 间隔缩短秒，常量；由 S1 INTERVAL 的 seconds 函数读取）
  // p04: [10, ...]           （Penetrant Wish 持续秒）
  // p05: [50.33 … 85.17]     （依次攻击伤害 ▲%）
  // p06: [10, ...]
  // p07: [14.56 … 24.64]     （核心伤害 ▲%）
  // p08: [10, ...]
  //
  // 说明：本单位施放 B3 后 0.05s 进入全爆裂，此时已处于 Penetrant Wish → P3 Core Damage ▲；
  //       其他 B3 施放的轮次（本单位爆裂冷却中）→ P2 Sequential Attack Damage ▲。
  //       核心打击须敌人有核心（同 Cinderella: Crystal Wave S2 P5）。
  skill2: {
    groupId: 20192,
    triggers: [
      // P1：施放爆裂技能 → 进入 Into the Fray: Penetrant Wish（p04 秒），普攻计数清零
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const dur = getSkillValue(caster.rawSkill2, 3, caster.skillLevels[1]);
          enterIntoTheFray(caster, PENETRANT_WISH, state.tick + Math.round(TICK_RATE * dur));
          caster.skillState.mqPenetrantShots = 0;
        },
      },
      // P1 Effect 1：Penetrant Wish 期间每 p01 次普攻 → 对处于 Open Wounds 的敌人造成 p02% 核心打击伤害
      {
        on: 'SHOT_COUNT',
        partOverride: 0,
        opts: { every: 1, counterKey: 'mqRawShots' },
        handler(state, caster) {
          if (!isInIntoTheFray(state, caster, PENETRANT_WISH)) return false;
          const lv    = caster.skillLevels[1];
          const every = getSkillValue(caster.rawSkill2, 0, lv);
          caster.skillState.mqPenetrantShots = (caster.skillState.mqPenetrantShots ?? 0) + 1;
          if (caster.skillState.mqPenetrantShots < every) return false;
          caster.skillState.mqPenetrantShots = 0;
          if (state.enemyHp <= 0 || !state.enemyHasCore || !hasOpenWounds(state)) return false;
          const mult = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          fireSkillHit(state, caster, mult, getBuffSums(state, caster.id), 'S2 P1', { hitPart: 'core' });
        },
      },
      // P2：进入全爆裂且不处于 Penetrant Wish → 依次攻击伤害 ▲ p05% p06 秒
      {
        on: 'ENTER_FULL_BURST',
        partOverride: 1,
        handler(state, caster) {
          if (isInIntoTheFray(state, caster, PENETRANT_WISH)) return false;
          const lv  = caster.skillLevels[1];
          const pct = getSkillValue(caster.rawSkill2, 4, lv) / 100;
          const dur = getSkillValue(caster.rawSkill2, 5, lv);
          pushBuff(state, { name: 'Synthetic World (Sequential Damage)', unitId: caster.id,
            sequentialAttackDamagePct: pct, endTick: state.tick + Math.round(TICK_RATE * dur) });
        },
      },
      // P3：进入全爆裂且处于 Penetrant Wish → 核心伤害 ▲ p07% p08 秒
      {
        on: 'ENTER_FULL_BURST',
        partOverride: 2,
        handler(state, caster) {
          if (!isInIntoTheFray(state, caster, PENETRANT_WISH)) return false;
          const lv  = caster.skillLevels[1];
          const pct = getSkillValue(caster.rawSkill2, 6, lv) / 100;
          const dur = getSkillValue(caster.rawSkill2, 7, lv);
          pushBuff(state, { name: 'Synthetic World (Core Damage)', unitId: caster.id,
            coreDamagePct: pct, endTick: state.tick + Math.round(TICK_RATE * dur) });
        },
      },
    ],
  },

  // ── Distant New World
  // ■ Affects self.
  //   Reloads {p01}% of ammo.
  //   Machine Gun Ramp-Up Speed ▲ {p02}% for {p03} sec.
  //   ATK ▲ {p04}% for {p05} sec.
  //   Attack Damage ▲ {p06}% for {p07} sec.
  // ■ Affects all enemies.
  //   Deals {p08}% of final ATK as Burst Skill damage.
  //
  // group_id: 10193
  // p01: [59.09 … 100]       （装弹 %弹匣）
  // p02: [100, ...]          （MG 暖机速度 ▲%）
  // p03: [10, ...]
  // p04: [46.33 … 78.4]      （ATK ▲%）
  // p05: [10, ...]
  // p06: [46.17 … 78.14]     （攻击伤害 ▲%）
  // p07: [10, ...]
  // p08: [795.6 … 1346.4]    （爆裂技能伤害 %ATK）
  //
  // 【全爆裂加成】不受影响（描述 as Burst Skill damage），未实测。
  burst: {
    groupId: 10193,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];
          reloadMagazinePct(state, caster, getSkillValue(caster.rawBurst, 0, lv) / 100, 'mq_burst_reload');
          // MG 暖机 / ATK / 攻击伤害：作用对象与持续时间相同、互不同乘区 → 合并为一条；
          // 爆裂技能唯一的效果段（P2 为伤害）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Distant New World', unitId: caster.id,
            mgHeatSpeedPct:  getSkillValue(caster.rawBurst, 1, lv) / 100,
            atkPct:          getSkillValue(caster.rawBurst, 3, lv) / 100,
            attackDamagePct: getSkillValue(caster.rawBurst, 5, lv) / 100,
            endTick: state.tick + Math.round(TICK_RATE * getSkillValue(caster.rawBurst, 2, lv)) },
          { ...state._logCtx, partIdx: null });

          if (state.enemyHp <= 0) return;
          const mult = getSkillValue(caster.rawBurst, 7, lv) / 100;
          fireSkillHit(state, caster, mult, getBuffSums(state, caster.id), 'Burst');
        },
      },
    ],
  },
};
