import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Ein  (resource_id: 391)
//
// 武器：Sniper Rifle（UP 型，蓄力 1s，弹匣 6，FC 250%）。爆裂阶段 Step3，CD 40s。
//
// ── Near Feather（近距羽翼）机制（2026-10-12 实测反推，召唤数量写在描述文本内，不在 description_value_list）
// 1. 数量：场上最多 6 只。战斗开始召唤 4 只；爆裂「召唤 6 只」= 补满到 6，补上的部分（临时羽翼）
//    在 B3 施放后 10s 消失（实测 3.90s 施放 → 13.9s 由 6 变 4，与全爆裂结束时刻无关）。
// 2. 衰减：最近一次召唤后 26s 起，原有羽翼每 6s 消失 1 只，最少保留 1 只（永久）。
//    实测：开场召唤 → 26 / 32 / 38s 依次 4→3→2→1；B3 于 3.90s 召唤 → 29.9s 4→3（计时被召唤重置）。
// 3. 攻击：全体羽翼共用一个出手计时器，每次出手按「当时在场数量」决定到下一次出手的间隔
//    （数量变化本身不重置计时器）；出手后约 0.6s 命中（伤害跳字）。
//    间隔：6 只 0.30s、4 只 2.90s、1 只 6.70s（高精度实测，长序列平均）；2 只 5.45s（单次实测）；
//    3 只 / 5 只为线性插值（未实测；在当前模型下 5 只不会出现）。
// 4. 召唤 / 临时羽翼消失时重置计时器（拟合实测）：
//    战斗开始 → 首次出手于 2.9s（命中 3.45s）；爆裂召唤 → B3 后 0.1s 首次出手（命中 B3 + 0.7s，实测 4.59s）；
//    临时羽翼消失 → 0.7s 后出手（命中 15.2s），之后按 4 只节奏。
//    据此全爆裂内共 34 次命中，其中 2 次在全爆裂结束后（不受全爆裂补正），与实测一致。
//
// 【精度】6 只 / 4 只：每次命中时刻误差 ≤0.1s。
//   实战主流配置带爆裂 CD 缩减（如 Anis: Star 每次全爆裂 −7.48s，Ein 隔轮开爆裂约 −15s）且充能 ≤5s，
//   Ein 两次爆裂间隔通常不超过召唤后 26s + 少量，绝大部分时间保持 4–6 只、极少掉到 3 只，故以 6 / 4 只为精度重点。
//   数量较低时（召唤 26s 后进入衰减）：
//   - 衰减过渡窗口（召唤后 26–41s，3 只 / 2 只期间）实测出手时刻与本模型不完全吻合，
//     单次命中时刻最多偏差约 3s，但窗口内命中次数一致（实测 5 次 / 模型 5 次）；
//   - 之后 1 只稳态阶段相位偏差约 0.4s（命中次数无差异）；
//   - 综合估计：每轮衰减最多 ±1 次命中误差（1 只时约 6.7s 一击，对总伤害影响 <3%）。
// 【未实测】在场不足 4 只时开爆裂：本模型按「原有羽翼保留、补满部分 10s 后消失」处理
//   （如 3 只时开爆裂 → 6 只 10s → 3 只），实际可能恢复为 4 只；实战中极少出现。

const BATTLE_START_FEATHERS = 4;
const MAX_FEATHERS          = 6;
// 出手间隔（秒），下标 = 在场数量
const LAUNCH_INTERVAL_SECS  = [null, 6.70, 5.45, 4.18, 2.90, 1.60, 0.30];
const HIT_TRAVEL_TICKS      = Math.round(0.6 * TICK_RATE);   // 出手 → 命中
const TEMP_LIFETIME_TICKS   = 10 * TICK_RATE;                // 临时羽翼存活时间（自 B3 施放）
const DECAY_START_TICKS     = 26 * TICK_RATE;                // 召唤后开始衰减
const DECAY_STEP_TICKS      = 6 * TICK_RATE;                 // 衰减步长
const BURST_FIRST_LAUNCH_TICKS   = Math.round(0.1 * TICK_RATE);  // 爆裂召唤 → 首次出手
const TEMP_EXPIRE_RELAUNCH_TICKS = Math.round(0.7 * TICK_RATE);  // 临时羽翼消失 → 下次出手

function launchIntervalTicks(count) {
  return Math.round(LAUNCH_INTERVAL_SECS[Math.max(1, Math.min(MAX_FEATHERS, count))] * TICK_RATE);
}

function featherCount(ss) { return (ss.nfBase ?? 0) + (ss.nfTemp ?? 0); }

// 召唤（重置衰减计时与出手计时）。temp > 0 时补上的部分为临时羽翼。
function summonFeathers(state, caster, { base, temp, firstLaunchTicks }) {
  const ss = caster.skillState;
  ss.nfBase           = base;
  ss.nfTemp           = temp;
  ss.nfTempEndTick    = temp > 0 ? state.tick + TEMP_LIFETIME_TICKS : Infinity;
  ss.nfDecayTick      = state.tick + DECAY_START_TICKS;
  ss.nfNextLaunchTick = state.tick + firstLaunchTicks;
}

// 出手：命中延迟 0.6s 结算（S2 P1 真实伤害；buff 与全爆裂状态取命中时刻）。
// 每次命中充能（实测），按未蓄力普攻计 target_burst_energy_pershot（与其他技能伤害充能约定一致）；
// 爆裂期间（burstPhase≠0）引擎不累加。
function launchAttack(state, caster) {
  const mult = getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]) / 100;
  state.pendingSkillHits.push({
    fireTick: state.tick + HIT_TRAVEL_TICKS, caster, mult,
    label: 'S2 P1 Near Feather Attack',
    opts: { isTrueDamage: true,
      burstEnergy: caster.targetBurstEnergyPerShot ?? 0, burstEnergySource: 'ein_s2_near_feather' },
  });
}

// 每 tick：出手 → 临时羽翼消失 → 衰减（同 tick 先出手：实测 B3 后 10.0s 的出手仍按 6 只计）
function updateFeathers(state, caster) {
  const ss = caster.skillState;
  if (ss.nfNextLaunchTick == null || state.enemyHp <= 0) return;

  if (state.tick >= ss.nfNextLaunchTick) {
    launchAttack(state, caster);
    ss.nfNextLaunchTick = state.tick + launchIntervalTicks(featherCount(ss));
  }
  if (ss.nfTemp > 0 && state.tick >= ss.nfTempEndTick) {
    ss.nfTemp = 0;
    ss.nfTempEndTick = Infinity;
    ss.nfNextLaunchTick = state.tick + TEMP_EXPIRE_RELAUNCH_TICKS;
  }
  if (ss.nfBase > 1 && state.tick >= ss.nfDecayTick) {
    ss.nfBase--;
    ss.nfDecayTick += DECAY_STEP_TICKS;
  }
}

export default {

  // ── Feather Standby（S1）
  // ■ Activates when entering battle. Affects self.
  //   Summons 4 Near Feathers.
  // ■ Activates when entering Burst Skill Stage 3. Affects self.
  //   ATK ▲ {p00}% for {p01} sec.
  // p00: [41.18,44.4,47.61,50.83,54.04,57.26,60.48,63.69,66.91,70.12]
  // p01: [10,...]
  skill1: {
    triggers: [
      // P1：战斗开始 → 召唤 4 只 Near Feather，2.9s 后首次出手
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          summonFeathers(state, caster, { base: BATTLE_START_FEATHERS, temp: 0,
            firstLaunchTicks: launchIntervalTicks(BATTLE_START_FEATHERS) });
        },
      },
      // P2：进入爆裂阶段 3 → 自身 ATK ▲ p00%（p01 秒）
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          pushBuff(state, { name: 'Feather Standby', unitId: caster.id,
            atkPct: getSkillValue(caster.rawSkill1, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 1, lv) },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },

  // ── Feather Shot（S2）
  // ■ Activates when Near Feather is summoned. Affects {p00} random enemy unit(s).
  //   Near Feather Attack: Deals {p01}% of final ATK as true damage.
  // ■ Activates when attacking with Full Charge. Affects self.
  //   Charge Damage ▲ {p02}% for {p03} shot(s).
  // p00: [1,...]
  // p01: [59.01,62.54,66.08,69.61,73.15,76.68,80.21,83.75,87.28,90.81]
  // p02: [47.27,50.91,54.54,58.18,61.82,65.45,69.09,72.73,76.36,80]
  // p03: [1,...]
  skill2: {
    triggers: [
      // P1：Near Feather 持续攻击（每 tick 推进羽翼状态，见文件头机制说明）
      {
        on: 'INTERVAL',
        opts: { seconds: 1 / TICK_RATE },
        handler(state, caster) { updateFeathers(state, caster); },
      },
      // P2：全蓄力攻击后 → 蓄力伤害 ▲ p02%，作用于其后 p03 发（回合制，下一发普攻消耗）
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          pushBuff(state, { name: 'Feather Shot', unitId: caster.id,
            chargeDamagePct: getSkillValue(caster.rawSkill2, 2, lv) / 100,
            endRounds: getSkillValue(caster.rawSkill2, 3, lv) },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },

  // ── Feather All-Range（Burst）
  // ■ Affects self.
  //   Summons 6 Near Feathers.
  //   True Damage ▲ {p00}% for {p01} sec.
  //   Charge Damage ▲ {p02}% for {p03} sec.
  // ■ Affects {p04} enemy unit(s) with the highest final DEF.
  //   Deals {p05}% of final ATK as true damage.
  // p00: [31.2,33.87,36.55,39.23,41.91,44.59,47.27,49.94,52.62,55.3]
  // p01: [10,...]
  // p02: [82.36,88.84,95.32,101.8,108.28,114.76,121.24,127.72,134.2,140.68]
  // p03: [10,...]
  // p04: [10,...]       — Boss 战单体，仅命中 1 次
  // p05: [170.32,184.73,199.14,213.55,227.96,242.38,256.79,271.2,285.61,300.02]
  //
  // 【全爆裂加成】P2 受影响（描述 as true damage，2026-10-12 已实测，规则例外）：
  //   进入全爆裂瞬间快照 sums（含 ENTER_FULL_BURST 系列 buff），享受全爆裂 +50%。
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const raw = caster.rawBurst;
          pushBuff(state, { name: 'Feather All-Range (True Damage)', unitId: caster.id,
            trueDamagePct: getSkillValue(raw, 0, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 1, lv) }, { ...state._logCtx, partIdx: 0 });
          pushBuff(state, { name: 'Feather All-Range (Charge Damage)', unitId: caster.id,
            chargeDamagePct: getSkillValue(raw, 2, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 3, lv) }, { ...state._logCtx, partIdx: 0 });
          // P1：召唤 6 只 → 补满到 6，补上的部分 10s 后消失；
          //     羽翼命中由 S2 P1 每 tick 推进并自行排入延迟命中队列（不属于 B3 爆裂技能伤害，不经 B3 延迟处理）
          const base = Math.max(1, caster.skillState.nfBase ?? BATTLE_START_FEATHERS);
          summonFeathers(state, caster, { base, temp: MAX_FEATHERS - base,
            firstLaunchTicks: BURST_FIRST_LAUNCH_TICKS });
          if (state.enemyHp <= 0) return;
          fireSkillHit(state, caster, getSkillValue(raw, 5, lv) / 100, getBuffSums(state, caster.id), 'Burst',
            { isTrueDamage: true, affectedByFullBurst: true });
        },
      },
    ],
  },
};
