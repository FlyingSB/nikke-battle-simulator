/**
 * B3 爆裂直接伤害 — 延迟与加成行为回归测试。
 *
 * 默认规则（描述 as damage / as Burst Skill damage）：爆裂3直接伤害不受全爆裂加成（50%）影响，
 * 也不受任何"进入全爆裂时"生效的 buff 影响。引擎实现：
 *   - B3 施放者爆裂技能的即时 fireSkillHit 自动转为延迟命中，并预捕获施放时 sums 与 buff 明细
 *   - 所有延迟命中统一后移 0.05s（技能延迟从进入全爆裂起算），并标记 suppressFullBurst
 *
 * 非默认角色（描述 as additional damage，且已实测）：
 *   - Rapi: Red Hood (16)：进入全爆裂后 0.1s，获得 50% 加成和 ENTER_FULL_BURST buff
 *   - Liberalio (262)：进入全爆裂后 0.97s，获得 50% 加成和 ENTER_FULL_BURST buff
 *   - Cinderella Beautiful 加成 (511)：pendingFireInBurstHits + sums:null，获得两者
 * 实测例外（描述 as damage / as true damage 但受影响）：
 *   - Elegg: Boom and Shock (502)：进入全爆裂后 0.2s 起，获得两者及 S2 P1 Ghostbuster ATK ▲
 *   - Ein (391) Burst P2（as true damage）：进入全爆裂时命中，获得两者
 * 按规则判定（未实测）：Laplace: Ultimate Hero (103) Burst P3、Sin: Swift Bunny (405) Burst P3
 *   affectedByFullBurst 命中若早于进入全爆裂到期，引擎兜底推迟到 enterFullBurst 结算。
 *
 * Run: node scripts/tests/test-burst-timing.mjs
 */

import { SKILL_TRAITS } from '../../src/data/skill-traits.js';
import { TICK_RATE } from '../../src/engine/battle-utils.js';
import { simulate, initBattle, tick } from '../../src/engine/battle.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

// ── 公共 helpers ───────────────────────────────────────────────────────────────

function makeState(overrides = {}) {
  return {
    tick: 0,
    buffs: [],
    squad: [],
    enemyHp: 1e12,
    enemyDef: 0,
    enemyDamageTakenPct: 0,
    fullBurstActive: false,
    burstGauge: 0,
    burstPhase: 0,
    pendingFireInBurstHits: [],
    pendingSkillHits: [],
    buffLog: null,
    hitLog: null,
    burstEnergyLog: null,
    ...overrides,
  };
}

// 构造 10 元素 description_value_list，lv10（index 9）填入目标值，其余为 '0'
function makeSkillDetail(...lv10Values) {
  return {
    description_value_list: lv10Values.map(v => ({
      description_value: Array.from({ length: 10 }, (_, i) => i === 9 ? String(v) : '0'),
    })),
  };
}

function makeCaster(id, name, extra = {}) {
  return {
    id,
    name,
    weaponType: 'SR',
    element: 'Electric',
    equipAtkPct: 0,
    totalDamage: 0,
    unitHp: 1_000_000,
    burstEnergyPerShot: 16667,
    skillLevels: [10, 10, 10],
    stats: { atk: 100_000, hp: 1_000_000, critRate: 0.15, critDmg: 0.50 },
    skillState: {},
    ...extra,
  };
}

// ── Rapi: Red Hood (16) — 非默认：获得 50% 加成 + ENTER_FULL_BURST buff ─────────

section('Rapi: Red Hood (16) — 延迟 0.1s，获得全爆裂加成与 ENTER_FULL_BURST buff');
{
  const burstTrigger = SKILL_TRAITS[16]?.burst?.triggers
    .find(t => t.on === 'BURST_SKILL_USE' && t.handler.toString().includes('pendingSkillHits'));

  eq('有 BURST_SKILL_USE → pendingSkillHits 的 handler', !!burstTrigger, true);

  const src = burstTrigger?.handler?.toString() ?? '';
  eq('handler 含 0.1 * TICK_RATE', src.includes('0.1 * TICK_RATE'), true);
  eq('handler 不含 burstSkillDamage（获得 50% 加成）', src.includes('burstSkillDamage'), false);
  eq('handler 不预捕获 sums（获得 ENTER_FULL_BURST buff）', src.includes('sumsSnap'), false);
  eq('opts 含 affectedByFullBurst: true', src.includes('affectedByFullBurst: true'), true);

  // 调用 handler 验证 fireTick
  const state  = makeState();
  const caster = makeCaster(16, 'Rapi: Red Hood', {
    combatAssistStatus: false,
    rawBurst:  makeSkillDetail(0, 0, 0, 0, 2808, 421.2),
    rawSkill2: makeSkillDetail(0, 0, 0, 0, 150.72),
    skillState: {
      rapiShotCount: 0,
      rapiProjectileThreshold: 120,
      rapiProjectileAttachMult: 2.5072,
      rapiProjectileExplosionMult: 2.006,
      rapiPendingProjectileCount: 0,
    },
  });
  state.squad = [caster];
  state.tick  = 100;

  burstTrigger.handler(state, caster, {});

  const hit = state.pendingSkillHits[0];
  eq('pendingSkillHits 有 1 个命中', state.pendingSkillHits.length, 1);
  eq('fireTick = tick + round(0.1 × 60) = 106', hit?.fireTick, 100 + Math.round(0.1 * TICK_RATE));
  eq('opts.affectedByFullBurst = true', hit?.opts?.affectedByFullBurst, true);
  eq('sums 字段未预捕获（获得 ENTER_FULL_BURST buff）', hit?.sums, undefined);
}

// ── Drake SSR fav (101) — 默认：直接命中，无延迟 ─────────────────────────────────

section('Drake SSR fav (101) — 直接命中，无标记（默认结算，引擎 burstSkillFiring 自动抑制加成）');
{
  const burstTrigger = SKILL_TRAITS[101]?.burst?.triggers
    .find(t => t.on === 'BURST_SKILL_USE');

  eq('有 BURST_SKILL_USE handler', !!burstTrigger, true);

  const src = burstTrigger?.handler?.toString() ?? '';
  eq('handler 不含 burstSkillDamage（默认结算无需标记）', src.includes('burstSkillDamage'), false);
  eq('handler 不使用 pendingSkillHits', src.includes('pendingSkillHits'), false);
  eq('handler 不使用 pendingFireInBurstHits', src.includes('pendingFireInBurstHits'), false);

  // 调用验证：需要 ssrFavSkills，无命中入队列
  const state  = makeState();
  const caster = makeCaster(101, 'Drake', {
    ssrFavSkills: {
      burst: Object.assign(makeSkillDetail(3009.6, 72.18, 0, 31.68), { _activeSkillLevel: 10 }),
    },
  });
  state.squad = [caster];

  burstTrigger.handler(state, caster, {});

  eq('无 pendingSkillHits 入队', state.pendingSkillHits.length, 0);
  eq('无 pendingFireInBurstHits 入队', state.pendingFireInBurstHits.length, 0);
}

// ── Privaty SSR fav (170) — 默认：直接命中，无延迟 ───────────────────────────────

section('Privaty SSR fav (170) — 直接命中，无标记（默认结算，引擎 burstSkillFiring 自动抑制加成）');
{
  const burstTrigger = SKILL_TRAITS[170]?.burst?.triggers
    .find(t => t.on === 'BURST_SKILL_USE');

  eq('有 BURST_SKILL_USE handler', !!burstTrigger, true);

  const src = burstTrigger?.handler?.toString() ?? '';
  eq('handler 不含 burstSkillDamage（默认结算无需标记）', src.includes('burstSkillDamage'), false);
  eq('handler 不使用 pendingSkillHits', src.includes('pendingSkillHits'), false);
  eq('handler 不使用 pendingFireInBurstHits', src.includes('pendingFireInBurstHits'), false);

  // 调用验证
  const state  = makeState({ pvDesignatedTargetEndTick: 0 });
  const caster = makeCaster(170, 'Privaty', {
    ssrFavSkills: {
      burst: Object.assign(makeSkillDetail(1407.64, 0, 0, 0, 130.0), { _activeSkillLevel: 10 }),
    },
  });
  state.squad = [caster];

  burstTrigger.handler(state, caster, {});

  eq('无 pendingSkillHits 入队', state.pendingSkillHits.length, 0);
  eq('无 pendingFireInBurstHits 入队', state.pendingFireInBurstHits.length, 0);
}

// ── Helm SSR fav (352) — 默认：延迟 1.05s ──────────────────────────────────────

section('Helm SSR fav (352) — 延迟 1.05s，默认（无标记，sums 预捕获，引擎自动 suppressFullBurst）');
{
  const burstTrigger = SKILL_TRAITS[352]?.burst?.triggers
    .find(t => t.on === 'BURST_SKILL_USE');

  eq('有 BURST_SKILL_USE handler', !!burstTrigger, true);

  const src = burstTrigger?.handler?.toString() ?? '';
  eq('handler 不含 burstSkillDamage（引擎自动抑制）', src.includes('burstSkillDamage'), false);
  eq('handler 含 pendingSkillHits', src.includes('pendingSkillHits'), true);
  eq('handler 含 1.05 * TICK_RATE', src.includes('1.05 * TICK_RATE'), true);
  eq('handler 预捕获 sums（sumsSnap）', src.includes('sumsSnap'), true);

  // 调用验证
  const state  = makeState();
  const caster = makeCaster(352, 'Helm', {
    ssrFavSkills: {
      burst: Object.assign(makeSkillDetail(8236.8, 54.45, 0, 158.4), { _activeSkillLevel: 10 }),
    },
  });
  state.squad = [caster];
  state.tick  = 200;

  burstTrigger.handler(state, caster, {});

  const hit = state.pendingSkillHits[0];
  eq('pendingSkillHits 有 1 个命中', state.pendingSkillHits.length, 1);
  eq('fireTick = tick + round(1.05 × 60) = 263', hit?.fireTick, 200 + Math.round(1.05 * TICK_RATE));
  eq('opts.burstSkillDamage 未设置（引擎 suppressFullBurst 负责）', hit?.opts?.burstSkillDamage, undefined);
  eq('opts.affectedByFullBurst 未设置（默认结算）', hit?.opts?.affectedByFullBurst, undefined);
  eq('sums 已预捕获（非 undefined）', hit?.sums !== undefined, true);
}

// ── Scarlet (222) — 默认：延迟 1.38s ───────────────────────────────────────────

section('Scarlet (222) — 延迟 1.38s，默认（无标记，sums 预捕获，引擎自动 suppressFullBurst）');
{
  // Burst P2 contains pendingSkillHits（P1 是 HP<50% 的 Crit Rate buff）
  const burstTrigger = SKILL_TRAITS[222]?.burst?.triggers
    .find(t => t.on === 'BURST_SKILL_USE' && t.handler?.toString().includes('pendingSkillHits'));

  eq('有 BURST_SKILL_USE handler', !!burstTrigger, true);

  const src = burstTrigger?.handler?.toString() ?? '';
  eq('handler 不含 burstSkillDamage（引擎自动抑制）', src.includes('burstSkillDamage'), false);
  eq('handler 含 pendingSkillHits', src.includes('pendingSkillHits'), true);
  eq('handler 含 1.38 * TICK_RATE', src.includes('1.38 * TICK_RATE'), true);

  // 调用验证
  const state  = makeState();
  const caster = makeCaster(222, 'Scarlet', {
    rawBurst: makeSkillDetail(0, 19.57, 0, 849.15),
    unitHp: 900_000,  // HP 90%，不触发 Crit Rate buff（< 50% 才触发）
  });
  state.squad = [caster];
  state.tick  = 300;

  burstTrigger.handler(state, caster, {});

  const hit = state.pendingSkillHits[0];
  eq('pendingSkillHits 有 1 个命中', state.pendingSkillHits.length, 1);
  eq('fireTick = tick + round(1.38 × 60) = 383', hit?.fireTick, 300 + Math.round(1.38 * TICK_RATE));
  eq('opts.burstSkillDamage 未设置（引擎 suppressFullBurst 负责）', hit?.opts?.burstSkillDamage, undefined);
  eq('opts.affectedByFullBurst 未设置（默认结算）', hit?.opts?.affectedByFullBurst, undefined);
  eq('sums 已预捕获（非 undefined）', hit?.sums !== undefined, true);
  near('burst 倍率 lv10 = 8.4915', hit?.mult ?? 0, 8.4915, 0.0001);
}

// ── Liberalio (262) — 非默认：获得 50% 加成 + ENTER_FULL_BURST buff ──────────────

section('Liberalio (262) — 延迟 0.97s，获得全爆裂加成与 ENTER_FULL_BURST buff');
{
  const burstTrigger = SKILL_TRAITS[262]?.burst?.triggers
    .find(t => t.on === 'BURST_SKILL_USE' && t.handler.toString().includes('pendingSkillHits'));

  eq('有 BURST_SKILL_USE → pendingSkillHits 的 handler', !!burstTrigger, true);

  const src = burstTrigger?.handler?.toString() ?? '';
  eq('handler 含 0.97 * TICK_RATE', src.includes('0.97 * TICK_RATE'), true);
  eq('handler 不含 burstSkillDamage（获得 50% 加成）', src.includes('burstSkillDamage'), false);
  eq('handler 不预捕获 sums（获得 ENTER_FULL_BURST buff）', src.includes('sumsSnap'), false);
  eq('opts 含 affectedByFullBurst: true', src.includes('affectedByFullBurst: true'), true);
}

// ── Cinderella 主爆裂 (511) — 默认：直接 fireSkillHit，burstSkillDamage:true ──────

section('Cinderella 主爆裂 (511) — 直接 fireSkillHit，无标记（默认结算），label=Burst P1');
{
  const src = SKILL_TRAITS[511]?.burst?.triggers
    .find(t => t.on === 'BURST_SKILL_USE')?.handler?.toString() ?? '';

  eq('主爆裂不含 burstSkillDamage（默认结算）', src.includes('burstSkillDamage'), false);
  eq('主爆裂 label = Burst P1', src.includes('Burst P1'), true);
  eq('主爆裂不使用 pendingSkillHits', src.includes('pendingSkillHits'), false);
}

// ── Cinderella Beautiful 加成 (511) — 非默认：pendingFireInBurstHits + sums:null ─

section('Cinderella Beautiful 加成 (511) — pendingFireInBurstHits，sums:null，无 burstSkillDamage');
{
  const src = SKILL_TRAITS[511]?.burst?.triggers
    .find(t => t.on === 'BURST_SKILL_USE')?.handler?.toString() ?? '';

  eq('Beautiful 加成使用 pendingFireInBurstHits', src.includes('pendingFireInBurstHits'), true);
  eq('Beautiful 加成 sums: null', src.includes('sums: null'), true);
}

// ── Maiden: Ice Rose (183) — 默认：延迟 0.73s + 0.1s 间隔 ───────────────────────

section('Maiden: Ice Rose (183) — 首击 0.73s，间隔 0.1s，默认（无标记，sums 预捕获，引擎自动 suppressFullBurst）');
{
  const burstTrigger = SKILL_TRAITS[183]?.burst?.triggers
    .find(t => t.on === 'BURST_SKILL_USE');

  eq('有 BURST_SKILL_USE handler', !!burstTrigger, true);

  const src = burstTrigger?.handler?.toString() ?? '';
  eq('handler 不含 burstSkillDamage（引擎自动抑制）', src.includes('burstSkillDamage'), false);
  eq('handler 含 pendingSkillHits', src.includes('pendingSkillHits'), true);
  eq('handler 含 0.73 * TICK_RATE', src.includes('0.73 * TICK_RATE'), true);
  eq('handler 含 0.1 * TICK_RATE（间隔）', src.includes('0.1 * TICK_RATE'), true);
  eq('handler 预捕获 sums（sums: preSums）', src.includes('sums: preSums'), true);

  // 调用验证（3 点 MP）
  const state  = makeState();
  const caster = makeCaster(183, 'Maiden: Ice Rose', {
    rawSkill1: makeSkillDetail(1, 0, 6.34),
    rawSkill2: makeSkillDetail(40.9, 0, 20.9, 0, 31.68, 0, 3.2),
    rawBurst:  makeSkillDetail(1, 10, 1372.8),
    equipAtkPct:  0.2,
    equipAtkFlat: 5_000,
    skillState: { iceroseMP: 3, iceroseChargeCount: 0 },
  });
  state.squad = [caster];
  state.tick  = 0;
  // 施放前已有的 buff：ATK buff（计入最终 ATK）+ Max HP buff（计入最终 MaxHP）
  state.buffs.push({ name: 'test_atk',   unitId: caster.id, atkPct: 0.5, atkFlat: 30_000, endTick: Infinity });
  state.buffs.push({ name: 'test_maxhp', unitId: caster.id, maxHpPct: 0.5, maxHpFlat: 200_000, endTick: Infinity });

  // 按引擎顺序执行全部 BURST_SKILL_USE 触发器（P1 爆裂命中 → P2 S2 Part2 自身 buff）
  for (const t of SKILL_TRAITS[183].burst.triggers.filter(t => t.on === 'BURST_SKILL_USE')) {
    t.handler(state, caster, {});
  }

  const hits = state.pendingSkillHits;
  eq('iceroseMP=3 → 3 个命中', hits.length, 3);

  const firstDelay = Math.round(0.73 * TICK_RATE);
  const interval   = Math.round(0.1 * TICK_RATE);
  eq('第 1 击 fireTick', hits[0]?.fireTick, firstDelay);
  eq('第 2 击 fireTick', hits[1]?.fireTick, firstDelay + interval);
  eq('第 3 击 fireTick', hits[2]?.fireTick, firstDelay + 2 * interval);

  eq('所有命中 burstSkillDamage 未设置（引擎 suppressFullBurst 负责）', hits.every(h => h.opts?.burstSkillDamage === undefined), true);
  eq('所有命中 sums 已预捕获（非 undefined）', hits.every(h => h.sums !== undefined), true);
  eq('消耗全部 MP → iceroseMP = 0', caster.skillState.iceroseMP, 0);

  // 公式：(最终 ATK + 最终 MaxHP × 10%) × 1372.8%
  //   最终 MaxHP = 1,000,000 × 1.5 + 200,000 = 1,700,000 → 10% = 170,000
  //   最终 ATK：atkPct = 装备 0.2 + buff 0.5，atkFlat = 装备 5,000 + buff 30,000
  const h0 = hits[0];
  near('倍率 = 1372.8%', h0?.mult, 13.728, 1e-9);
  eq('extraAtkFlat = 最终 MaxHP × 10%', h0?.opts?.extraAtkFlat, 170_000);
  near('sums.atkPct 含装备与 buff（最终 ATK）', h0?.sums?.atkPct, 0.7, 1e-9);
  eq('sums.atkFlat 含装备与 buff（最终 ATK）', h0?.sums?.atkFlat, 35_000);
  eq('extraAtkFlatLabel 标注 MaxHP 项', h0?.opts?.extraAtkFlatLabel, '最终 MaxHP × 10%');
  // 伤害明细快照：与预捕获 sums 同时刻，含施放前 ATK buff，不含之后推入的 S2 Part2
  const bdNames = (h0?.opts?.preBuffBreakdown ?? []).map(b => b.name);
  eq('preBuffBreakdown 含施放前 ATK buff', bdNames.includes('test_atk'), true);
  eq('preBuffBreakdown 不含 S2 Part2', bdNames.some(n => n.startsWith('Blessings Upon You P2')), false);
  // S2 Part2 在爆裂伤害确定后才推入：其 elemAdv 不应出现在预捕获 sums 中
  eq('S2 Part2 已推入', state.buffs.some(b => b.name === 'Blessings Upon You (Elem Adv Damage)'), true);
  near('预捕获 sums 不含 S2 Part2 优越加成', h0?.sums?.elementAdvantagePct ?? 0, 0, 1e-9);
  // S2 Part2 L3：ATK ▲ 3.2% × 最终 MaxHP（1,700,000）
  eq('S2 Part2 L3 atkFlat = 3.2% × 最终 MaxHP',
    state.buffs.find(b => b.name === 'Blessings Upon You P2 (ATK)')?.atkFlat, Math.round(1_700_000 * 0.032));
}

// ── 端到端：B3 直接伤害从进入全爆裂开始计时（FULL_BURST_ENTRY_DELAY = 0.05s）─────────
// 技能文件中的延迟均指「进入全爆裂后」：命中 tick = B3 施放 tick + 3 + 技能延迟。

const E2E_DELAY = Math.round(0.05 * TICK_RATE);
const E2E_STATS = { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 };
const E2E_ENEMY = { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', hasCore: false, distance: 'NEAR' };
const mockSkill = n => ({ description_value_list: Array.from({ length: n },
  () => ({ description_value: Array(10).fill('100') })) });

function e2eUnit(characterId, name, burstStep, extra = {}) {
  return {
    characterId, name, element: 'Iron', weaponType: 'MG', burstStep, nativeBurstStep: burstStep,
    _nikkeData: { skill1_detail: mockSkill(10), skill2_detail: mockSkill(10), ulti_skill_detail: mockSkill(10) },
    _computedStats: { ...E2E_STATS },
    targetBurstEnergyPerShot: 1_000_000, burstEnergyPerShot: 500, burstSkillCooltime: 0,
    baseAmmo: 30, reloadTicks: 120, shotDamageMult: 1.0, coreDmgIncrement: 0,
    fullChargeDamage: 10000, reloadFraction: 1.0, rateOfFire: 600,
    ...extra,
  };
}
const e2eSquad = b3 => [
  e2eUnit(91001, 'Dummy-B1', 'Step1', { _nikkeData: {} }),
  e2eUnit(91002, 'Dummy-B2', 'Step2', { _nikkeData: {} }),
  b3,
];
const firstTick = (log, type) => log.find(e => e.type === type)?.tick;

section('E2E — Rapi: Red Hood (16)：进入全爆裂后 0.1s 命中，享受全爆裂补正');
{
  const r = simulate({ squad: e2eSquad(e2eUnit(16, 'Rapi: Red Hood', 'Step3')),
    enemy: E2E_ENEMY, duration: 30, hitLog: true });
  const b3Tick = firstTick(r.log, 'burst_iii');
  const fbTick = firstTick(r.log, 'full_burst');
  const hit    = r.hitLog.find(h => h.unitId === 16 && h.label === 'Burst' && h.tick >= b3Tick);
  eq('进入全爆裂 = B3 + 3t', fbTick - b3Tick, E2E_DELAY);
  eq('命中 tick = B3 + 3 + 6', hit?.tick, b3Tick + E2E_DELAY + Math.round(0.1 * TICK_RATE));
  eq('命中享受全爆裂补正（isFullBurst）', hit?.isFullBurst, true);
}

section('E2E — Rapi: Red Hood (16)：sums 取进入全爆裂瞬间快照，之后推入的 buff 不计入');
{
  const state = initBattle({ squad: e2eSquad(e2eUnit(16, 'Rapi: Red Hood', 'Step3')),
    enemy: E2E_ENEMY, duration: 30, hitLog: true });
  let fbTick = null;
  while (state.tick < 60 * 5) {
    const { events } = tick(state);
    if (fbTick == null && events.some(e => e.type === 'full_burst')) {
      fbTick = events.find(e => e.type === 'full_burst').tick;
      state.buffs.push({ name: 'LateProbe', unitId: 16, atkPct: 1.0, endTick: Infinity });
    }
    if (fbTick != null && state.tick > fbTick + 10) break;
  }
  const hit = state.hitLog.find(h => h.unitId === 16 && h.label === 'Burst' && h.tick > fbTick);
  eq('命中存在（进入全爆裂后 0.1s）', hit?.tick, fbTick + Math.round(0.1 * TICK_RATE));
  eq('不含进入全爆裂后才推入的 buff', (hit?.buffBreakdown ?? []).some(b => b.name === 'LateProbe'), false);
  eq('享受全爆裂补正', hit?.isFullBurst, true);
}

section('E2E — Noir (271)：默认即时 B3 伤害改在进入全爆裂时命中，不受全爆裂补正');
{
  const r = simulate({ squad: e2eSquad(e2eUnit(271, 'Noir', 'Step3', { weaponType: 'SG' })),
    enemy: E2E_ENEMY, duration: 30, hitLog: true });
  const b3Tick = firstTick(r.log, 'burst_iii');
  const hit    = r.hitLog.find(h => h.unitId === 271 && h.label === 'Burst' && h.tick >= b3Tick);
  eq('施放当 tick 无 Burst 命中', r.hitLog.some(h => h.unitId === 271 && h.label === 'Burst' && h.tick === b3Tick), false);
  eq('命中 tick = B3 + 3', hit?.tick, b3Tick + E2E_DELAY);
  eq('不受全爆裂补正', hit?.isFullBurst, false);
  eq('伤害 > 0', (hit?.damage ?? 0) > 0, true);
}

section('E2E — Elegg: Boom and Shock (502)：进入全爆裂后 0.2s 起命中，享受全爆裂补正与 S2 P1（已实测）');
{
  const r = simulate({ squad: e2eSquad(e2eUnit(502, 'Elegg: Boom and Shock', 'Step3', { element: 'Water' })),
    enemy: E2E_ENEMY, duration: 30, hitLog: true });
  const b3Tick = firstTick(r.log, 'burst_iii');
  const hits   = r.hitLog.filter(h => h.unitId === 502 && h.label.startsWith('Burst') && h.tick >= b3Tick
    && h.tick <= b3Tick + E2E_DELAY + 12 * 13);
  eq('首击 tick = B3 + 3 + 12', hits[0]?.tick, b3Tick + E2E_DELAY + Math.round(0.2 * TICK_RATE));
  eq('所有命中享受全爆裂补正', hits.length > 0 && hits.every(h => h.isFullBurst), true);
  eq('命中 buff 明细含 S2 P1 Ghostbuster', (hits[0]?.buffBreakdown ?? []).some(b => b.name === 'Ghostbuster'), true);
}

section('E2E — Elegg (502)：进入全爆裂瞬间快照；S1 属性优势 buff 先计入快照再移除');
{
  const ELEM_ADV = 'Hello Ghost (Elem Adv Damage)';
  const state = initBattle({ squad: e2eSquad(e2eUnit(502, 'Elegg: Boom and Shock', 'Step3', { element: 'Water' })),
    enemy: E2E_ENEMY, duration: 30, hitLog: true });
  const elegg = state.squad.find(u => u.id === 502);
  // 7 幽灵（≥4，持有属性优势 buff）→ 爆裂非 13 模式幽灵 ▼6 → 1（<4，buff 应在快照后移除）
  elegg.skillState.ebs_ghostCount = 7;
  state.buffs.push({ name: ELEM_ADV, unitId: 502, elementAdvantagePct: 0.35, endTick: Infinity });
  let b3Tick = null, fbTick = null, buffAfterFb = null;
  while (state.tick < 60 * 5) {
    const { events } = tick(state);
    if (b3Tick == null && events.some(e => e.type === 'burst_iii')) {
      b3Tick = events.find(e => e.type === 'burst_iii').tick;
      eq('施放后、进入全爆裂前 buff 仍在', state.buffs.some(b => b.name === ELEM_ADV), true);
    }
    if (fbTick == null && events.some(e => e.type === 'full_burst')) {
      fbTick = events.find(e => e.type === 'full_burst').tick;
      buffAfterFb = state.buffs.some(b => b.name === ELEM_ADV);
      // 进入全爆裂之后才推入的 buff 不应计入快照
      state.buffs.push({ name: 'LateProbe', unitId: 502, atkPct: 1.0, endTick: Infinity });
    }
    if (fbTick != null && state.tick > fbTick + 12 * 7) break;
  }
  const hits = state.hitLog.filter(h => h.unitId === 502 && h.label.startsWith('Burst') && h.tick > fbTick);
  eq('6 次命中', hits.length, 6);
  eq('进入全爆裂后属性优势 buff 已移除', buffAfterFb, false);
  eq('所有命中 buff 明细含属性优势 buff（快照计入）',
    hits.every(h => h.buffBreakdown.some(b => b.name === ELEM_ADV)), true);
  eq('所有命中不含进入全爆裂后才推入的 buff', hits.every(h => !h.buffBreakdown.some(b => b.name === 'LateProbe')), true);
  eq('所有命中 atkPct 相同（同一快照）', new Set(hits.map(h => h.atkPct)).size, 1);
  eq('所有命中享受全爆裂补正', hits.every(h => h.isFullBurst), true);
}

section('E2E — Ein (391)：B3 延迟命中的 buff 明细按命中属性快照（真实伤害列出 True Damage ▲，不列蓄力伤害）');
{
  const r = simulate({ squad: e2eSquad(e2eUnit(391, 'Ein', 'Step3', { weaponType: 'SR' })),
    enemy: E2E_ENEMY, duration: 30, hitLog: true });
  for (const label of ['Burst', 'S2 P1 Near Feather Attack']) {
    const hit = r.hitLog.find(h => h.unitId === 391 && h.label === label
      && (h.buffBreakdown ?? []).some(b => b.name === 'Feather All-Range (True Damage)'));
    const bd  = hit?.buffBreakdown ?? [];
    eq(`${label}：明细含 True Damage ▲ 且 trueDamagePct > 0`,
      (bd.find(b => b.name === 'Feather All-Range (True Damage)')?.trueDamagePct ?? 0) > 0, true);
    eq(`${label}：明细不含蓄力伤害 buff`, bd.some(b => (b.chargeDamagePct ?? 0) !== 0
      || b.name === 'Feather All-Range (Charge Damage)' || b.name === 'Feather Shot'), false);
  }
  // Burst P2（as true damage）实测受全爆裂系列效果影响：进入全爆裂时命中，享受全爆裂补正
  const b3Tick = firstTick(r.log, 'burst_iii');
  const p2 = r.hitLog.find(h => h.unitId === 391 && h.label === 'Burst' && h.tick >= b3Tick);
  eq('Burst P2 命中 tick = 进入全爆裂（B3 + 3）', p2?.tick, b3Tick + E2E_DELAY);
  eq('Burst P2 享受全爆裂补正', p2?.isFullBurst, true);
}

section('E2E — 兜底：affectedByFullBurst 命中早于进入全爆裂到期 → 推迟到进入全爆裂时结算');
{
  const state = initBattle({ squad: e2eSquad(e2eUnit(271, 'Noir', 'Step3', { weaponType: 'SG' })),
    enemy: E2E_ENEMY, duration: 30, hitLog: true });
  let b3Tick = null, fbTick = null;
  while (fbTick == null && state.tick < 60 * 30) {
    const { events } = tick(state);
    if (b3Tick == null && events.some(e => e.type === 'burst_iii')) {
      b3Tick = events.find(e => e.type === 'burst_iii').tick;
      const noir = state.squad.find(u => u.id === 271);
      state.pendingSkillHits.push({ fireTick: b3Tick + 2, caster: noir, mult: 1, label: 'FallbackProbe',
        opts: { affectedByFullBurst: true } });
    }
    if (events.some(e => e.type === 'full_burst')) fbTick = events.find(e => e.type === 'full_burst').tick;
  }
  const probe = state.hitLog.find(h => h.label === 'FallbackProbe');
  eq('探针命中存在', !!probe, true);
  eq('探针命中 tick = 进入全爆裂 tick', probe?.tick, fbTick);
  eq('探针命中享受全爆裂补正', probe?.isFullBurst, true);
}

// ─────────────────────────────────────────────────────────────────────────────
summary('B3 爆裂直接伤害延迟与加成行为测试');
