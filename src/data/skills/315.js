import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Ade: Agent Bunny  (resource_id: 315)
// 计算当前 Minimum Effective Range 累积值（%）。
// 来源：Spy Lens 叠层（每层 4.44%，最多 10 层）+ 爆裂技能（+55.56%，10s）。
function calcMinEffRangePct(state, caster) {
  const stacksPct = (caster.skillState.aabSpyLensStacks ?? 0) * 4.44;
  const burstPct  = (caster.skillState.aabBurstMinEffRangeEndTick ?? 0) > state.tick ? 55.56 : 0;
  return stacksPct + burstPct;
}

// Ade 的有效射程下界（连续距离刻度）。SR 默认优势射程 min=45（FAR）；
// Minimum Effective Range 累积值扩展下界：≥44% → 35（MID 也计入）；≥99% → 20（NEAR 也计入）。
// 阈值距离取自 constants.ZONE_TO_DISTANCE（NEAR20/MID35/FAR45），与几何命中模型同刻度。
function effRangeMin(state, caster) {
  const total = calcMinEffRangePct(state, caster);
  return total >= 99 ? 20 : total >= 44 ? 35 : 45;
}

// 判断当前敌人是否处于 Ade 的"有效射程"内（触发优势射程加成 / 全蓄力条件）。
function isInEffectiveRange(state, caster) {
  const d = state.enemyDistance;
  if (d == null) return false;                 // HIDDEN / 不可瞄准
  return d >= effRangeMin(state, caster);       // 其 SR 上界为 100，enemyDistance≤100 恒满足
}

// 同步 caster.skillState.effRangeMin —— battle.js 的 unitDistanceAdvantage 读取它，
// 取 min(bonusRangeMin, effRangeMin) 作为优势射程下界。每次 Spy Lens 叠层或爆裂改变状态后调用。
function syncEffRangeMin(state, caster) {
  caster.skillState.effRangeMin = effRangeMin(state, caster);
}

export default {

  // ── Agent's Gaze
  // ■ Activates when landing Full Charge attacks on targets within the effective range. Affects all allies.
  //   ATK ▲ {p00}% of caster's ATK for {p01=5} sec.
  // ■ Activates when attacking with Full Charge. Affects self.
  //   Spy Lens: Minimum Effective Range ▲ {p02=4.44}%, stacks up to {p03=10} time(s) and lasts for {p04=5} sec.
  //
  // group_id: 23151
  // p00 ATK▲% of caster's ATK: [8.98, 9.67, 10.36, 11.05, 11.75, 12.44, 13.13, 13.82, 14.51, 15.2]
  // p01 duration (const): [5, ...]
  // p02 minEffectiveRange per stack (const): [4.44, ...]
  // p03 max stacks (const): [10, ...]
  // p04 stack duration (const): [5, ...]
  skill1: {
    groupId: 23151,
    triggers: [
      // Part1：全蓄力命中有效射程内 → 全队 ATK ▲[p00]% of caster ATK（flat）5s
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (!isInEffectiveRange(state, caster)) return;
          const lv   = caster.skillLevels[0];
          const pct  = getSkillValue(caster.rawSkill1, 0, lv) / 100;
          const flat = Math.round(caster.stats.atk * pct);
          // S1 唯一未具名效果段（P2 为 Spy Lens）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Agent\'s Gaze', unitId: null,
            atkFlat: flat, endTick: state.tick + TICK_RATE * 5 }, { ...state._logCtx, partIdx: null });
        },
      },

      // Part2：任意全蓄力（不需在有效射程内）→ 自身 Spy Lens 叠层（最多 10 层，5s 内未刷新则清零）
      // 达到满层（10 层）时激活 S2 Part2 的 pierce + ATK% 持续效果
      // 每次叠层后同步 effRangeMin，使下一发射击立即享受扩展的优势射程
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const now = state.tick;

          // 若上次堆叠已过期则清零
          if ((caster.skillState.aabSpyLensEndTick ?? 0) < now) {
            caster.skillState.aabSpyLensStacks = 0;
          }

          const stacks = Math.min(10, (caster.skillState.aabSpyLensStacks ?? 0) + 1);
          caster.skillState.aabSpyLensStacks  = stacks;
          caster.skillState.aabSpyLensEndTick = now + TICK_RATE * 5;

          syncEffRangeMin(state, caster);

          // 首次达到满层时激活 S2 Part2（pierce 持续 + ATK% 持续）
          if (stacks >= 10 && !caster.skillState.aabS2FullyStacked) {
            caster.skillState.aabS2FullyStacked = true;
            const lv2    = caster.skillLevels[1];
            const atkPct = getSkillValue(caster.rawSkill2, 2, lv2) / 100;
            pushBuff(state, { name: 'Agent\'s Movement (ATK)', unitId: caster.id, pierce: true, atkPct, endTick: Infinity });
          }
        },
      },
    ],
  },

  // ── Agent's Movement
  // ■ Activates when landing Full Charge attacks on targets within the effective range. Affects all allies.
  //   Pierce Damage ▲ {p00}% for {p01=5} sec.
  // ■ Activates only if Spy Lens is fully stacked. Affects self.
  //   Gain Pierce continuously.
  //   ATK ▲ {p02}% continuously.
  //   [S2 Part2 在 S1 Part2 达满层时触发，已在 skill1 处理]
  //
  // group_id: 23152
  // p00 Pierce Damage▲%: [9.15, 10.17, 11.2, 12.22, 13.24, 14.27, 15.29, 16.32, 17.34, 18.36]
  // p01 duration (const): [5, ...]
  // p02 ATK▲%（spy lens = 10，持续）: [9.36, 10.09, 10.83, 11.57, 12.31, 13.05, 13.78, 14.52, 15.26, 16]
  skill2: {
    groupId: 23152,
    triggers: [
      // Part1：全蓄力命中有效射程内 → 全队 Pierce Damage ▲[p00]% 5s
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (!isInEffectiveRange(state, caster)) return;
          const lv  = caster.skillLevels[1];
          const pct = getSkillValue(caster.rawSkill2, 0, lv) / 100;
          pushBuff(state, { name: 'Agent\'s Movement (Pierce Damage)', unitId: null,
            pierceDamagePct: pct, endTick: state.tick + TICK_RATE * 5 });
        },
      },
    ],
  },

  // ── Cutting-Edge Agent Equipment
  // ■ Affects self.
  //   Minimum Effective Range ▲ {p00=55.56}% for {p01=10} sec.
  //   → 记录 aabBurstMinEffRangeEndTick，并同步 effRangeMin
  // ■ Affects all allies.
  //   Attack Damage ▲ {p02}% for {p03=10} sec.
  //   Pierce Damage ▲ {p04}% for {p05=10} sec.
  //
  // group_id: 13153
  // p00 minEffectiveRange (const): [55.56, ...]
  // p01 duration self (const): [10, ...]
  // p02 Attack Damage▲%: [29.85, 32.65, 35.45, 38.25, 41.05, 43.85, 46.64, 49.44, 52.24, 55.04]
  // p03 duration all (const): [10, ...]
  // p04 Pierce Damage▲%: [5.14, 5.7, 6.25, 6.81, 7.36, 7.92, 8.47, 9.02, 9.58, 10.13]
  // p05 duration all (const): [10, ...]
  burst: {
    groupId: 13153,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv    = caster.skillLevels[2];
          const end10 = state.tick + TICK_RATE * 10;

          // 自身：Minimum Effective Range ▲55.56%（10s），立即同步 effRangeMin
          caster.skillState.aabBurstMinEffRangeEndTick = end10;
          syncEffRangeMin(state, caster);

          // 全队：Attack Damage + Pierce Damage
          const atkDmgPct = getSkillValue(caster.rawBurst, 2, lv) / 100;
          const piercePct = getSkillValue(caster.rawBurst, 4, lv) / 100;
          pushBuff(state, { name: 'Cutting-Edge Agent Equipment', unitId: null,
            attackDamagePct: atkDmgPct, pierceDamagePct: piercePct, endTick: end10 },
            { ...state._logCtx, partIdx: 1 });
        },
      },
    ],
  },
};
