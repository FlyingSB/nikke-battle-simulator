import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { rng } from '../../engine/rng.js';
import { getSkillValue } from '../../data/models.js';

// Character: Harran  (resource_id: 230)
// 优势射程：Harran 虽为 SR，CDN bonusrange 为 25–45（与 AR 相同，而非 SR 的 45–100）。
// 引擎按 _nikkeData.bonusrange_min/max 判定优势射程，本文件无需额外处理。

const VIRUS_DOT_KEY = 'harran_virus_transfer';

export default {

  // ── Plague Transfer
  // ■ There is a {p06=25}% chance of activating when attacking.
  //   Virus Transfer: Deals {p00}% of final ATK as sustained damage every second for {p01=5} sec.
  // ■ Activates when an enemy is brought down while in the Virus Transfer state. Affects the {p05=2} nearest enemy unit(s).
  //   Virus Transfer: Deals {p00}% of final ATK as sustained damage every second for {p01=5} sec.
  //   [TODO: 敌人被击倒事件未建模（Boss 战单目标不会触发）— 跳过]
  //
  // group_id: 22301
  // p00 Virus Transfer %/sec: [10.8, 11.52, 12.24, 12.96, 13.68, 14.4, 15.12, 15.84, 16.56, 17.28]
  // p01 duration (const): [5, ...]
  // p05 spread target count (const): [2, ...]
  // p06 activation chance% (const): [25, ...]
  skill1: {
    groupId: 22301,
    triggers: [
      // P1：每次普通攻击 25% 概率 → 目标 Virus Transfer（每秒 p00% 最终 ATK，持续 p01 秒）。
      //   原文 as sustained damage → sustainedDamage: true（受 Sustained Damage ▲ 加成）。
      //   同名 DoT 重复施加时刷新持续时间（描述未写叠层），保留原有每秒出伤节奏。
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'harran_s1_shot' },
        handler(state, caster) {
          const lv     = caster.skillLevels[0];
          const chance = getSkillValue(caster.rawSkill1, 6, lv) / 100;
          if (rng() >= chance) return false;

          const mult = getSkillValue(caster.rawSkill1, 0, lv) / 100;
          const end  = state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 1, lv);
          const existing = state.dots.find(d => d.dotName === VIRUS_DOT_KEY && d.casterId === caster.id);
          if (existing) {
            existing.multPerStack = mult;
            existing.endTick      = end;
          } else {
            state.dots.push({
              casterId:        caster.id,
              label:           'S1 P1 Virus Transfer',
              dotName:         VIRUS_DOT_KEY,
              multPerStack:    mult,
              stacks:          1,
              endTick:         end,
              nextFireTick:    state.tick + TICK_RATE,
              intervalTicks:   TICK_RATE,
              sustainedDamage: true,
            });
          }
        },
      },
    ],
  },

  // ── Predator
  // ■ Activates when performing a Full Charge attack. Affects self.
  //   Gains Pierce for {p01=1} round(s).
  //   Critical Rate ▲ {p00}% for {p01=1} round(s).
  // ■ Activates when defeating an enemy. Affects self.
  //   ATK ▲ {p02}%. Stacks up to {p04=15} times and lasts for {p03=10} sec.
  //   [TODO: 击杀敌人事件未建模（Boss 战不会触发）— 跳过]
  //
  // group_id: 22302
  // p00 Crit Rate▲%: [1.84, 1.96, 2.09, 2.21, 2.33, 2.46, 2.58, 2.7, 2.82, 2.95]
  // p01 rounds (const): [1, ...]
  // p02 ATK▲%/stack: [1.89, 2.01, 2.14, 2.26, 2.39, 2.52, 2.64, 2.77, 2.89, 3.02]
  // p03 duration (const): [10, ...]
  // p04 max stacks (const): [15, ...]
  skill2: {
    groupId: 22302,
    triggers: [
      // P1：全蓄力攻击后 → 自身 Pierce + Crit Rate ▲ p00%，作用于其后 p01 发（回合制，下一发普攻消耗）。
      //   Pierce 与 Crit Rate 作用对象、持续相同且不在同一伤害乘区 → 合并为一条 buff（§4.1）。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Predator P1', unitId: caster.id,
            pierce: true,
            critRatePct: getSkillValue(caster.rawSkill2, 0, lv) / 100,
            endRounds: getSkillValue(caster.rawSkill2, 1, lv) });
        },
      },
    ],
  },

  // ── Death Scythe
  // ■ Affects all enemies.
  //   Deals {p00}% of final ATK as Burst Skill damage.
  //   【全爆裂加成】不受影响（描述 as Burst Skill damage，默认规则）
  //
  // group_id: 12303
  // p00 Burst damage%: [624.37, 666, 707.62, 749.25, 790.87, 832.5, 874.12, 915.75, 957.37, 999]
  burst: {
    groupId: 12303,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        target: 'ENEMY',
        effects: [
          {
            type: 'SKILL_DAMAGE',
            mult: (caster) => getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100,
            label: 'Burst',
          },
        ],
      },
    ],
  },
};
