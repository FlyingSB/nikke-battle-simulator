/**
 * Red Hood (470) — weapon switch shot count regression.
 * Pure: no CDN, no file I/O. Uses simulate() with synthetic _computedStats.
 *
 * Covers:
 *   RH1 — Red Wolf 武器切换期间，10s 内正好攻击 32 次
 *   RH2 — Burst 结束后 weaponSwitchEndTick 被清零（不再有武器切换攻击）
 *   RH3 — Red Wolf 弹匣固定 99、满弹，Bastion 补弹 / OL 装弹数不影响
 *   RH4 — 固定弹匣期间 recalcMaxAmmo 不截断 ammoLeft
 *
 * Run: node scripts/tests/test-red-hood-burst.mjs
 */

import { simulate, initBattle, tick } from '../../src/engine/battle.js';
import { initUnitMaxAmmo, recalcMaxAmmo } from '../../src/engine/battle-utils.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STATS = { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 };

const ENEMY = {
  maxHp:    1e15,
  def:      0,
  element:  'Iron',
  type:     'Boss',
  hasCore:  false,
  distance: 'NEAR',
};

let _nextId = 90000;

const _MOCK_VALS = Array(10).fill('100');
const _MOCK_SKILL_N = n => ({ description_value_list: Array.from({ length: n }, () => ({ description_value: _MOCK_VALS })) });

function dummyUnit(burstStep) {
  return {
    characterId:              _nextId++,
    name:                     `Dummy-${burstStep}`,
    element:                  'Iron',
    weaponType:               'MG',
    burstStep,
    nativeBurstStep:          burstStep,
    _nikkeData:               {},
    _computedStats:           { ...STATS },
    targetBurstEnergyPerShot: 1_000_000,  // 一枪填满分享 gauge
    burstEnergyPerShot:       500,
    burstSkillCooltime:       0,
    baseAmmo:                 30,
    reloadTicks:              120,
    shotDamageMult:           1.0,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    rateOfFire:               600,
  };
}

function redHoodUnit() {
  return {
    characterId:              470,
    name:                     'Red Hood',
    element:                  'Fire',
    weaponType:               'SR',
    burstStep:                'Step3',
    nativeBurstStep:          'Step3',
    // skill handlers 读取 rawSkill1/rawSkill2/rawBurst；提供最小 mock
    _nikkeData: {
      skill1_detail:     _MOCK_SKILL_N(10),
      skill2_detail:     _MOCK_SKILL_N(10),
      ulti_skill_detail: _MOCK_SKILL_N(10),
    },
    _computedStats:           { ...STATS },
    targetBurstEnergyPerShot: 1_000_000,
    burstEnergyPerShot:       500,
    burstSkillCooltime:       40 * 60,   // 40s，确保模拟窗口内只触发一次爆裂
    baseAmmo:                 30,
    reloadTicks:              90,        // SR 典型装填时间
    shotDamageMult:           1.0,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    rateOfFire:               120,       // SR 典型 ROF
    chargeTime:               60,        // 标准 SR 满蓄时间（ticks）
  };
}

// ─── RH1: Red Wolf 期间正好 32 次攻击 ──────────────────────────────────────────

section('RH1 — Red Wolf 武器切换：10s 内攻击次数 = 32');
{
  const squad = [
    dummyUnit('Step1'),
    dummyUnit('Step2'),
    redHoodUnit(),
  ];

  // duration=15s 足够首次爆裂完整结束（爆裂约在 tick 74 触发，持续 600 ticks）
  const r = simulate({ squad, enemy: ENEMY, duration: 15, hitLog: true });

  // 从 buffLog 定位第一次武器切换窗口，再统计该窗口内 RH 命中次数
  const wsBuff   = (r.buffLog ?? []).find(b => b.name === 'Wild Tooth (ATK)' && b.unitId === 470 && b.type === 'buff_gain');
  const wsStart  = wsBuff?.tick ?? -1;
  const wsEnd    = wsBuff?.endTick ?? -1;
  const rhHits   = (r.hitLog ?? []).filter(h => h.unitId === 470 && h.tick >= wsStart && h.tick <= wsEnd);

  eq('RH1.1  武器切换 buff 已应用',         wsBuff != null,        true);
  eq('RH1.2  Red Hood 爆裂期攻击次数 = 32', rhHits.length,         32);
}

// ─── RH2: Burst 结束后无武器切换攻击 ───────────────────────────────────────────

section('RH2 — Burst 结束后 Red Hood 回归普通 SR 射击节奏（非武器切换）');
{
  const squad = [
    dummyUnit('Step1'),
    dummyUnit('Step2'),
    redHoodUnit(),
  ];

  const r = simulate({ squad, enemy: ENEMY, duration: 30, hitLog: true });

  const wsBuff2      = (r.buffLog ?? []).find(b => b.name === 'Wild Tooth (ATK)' && b.unitId === 470 && b.type === 'buff_gain');
  const wsStart2     = wsBuff2?.tick    ?? -1;
  const wsEnd2       = wsBuff2?.endTick ?? -1;
  const burstRhHits  = (r.hitLog ?? []).filter(h => h.unitId === 470 && h.tick >= wsStart2 && h.tick <= wsEnd2);
  const afterRhHits  = (r.hitLog ?? []).filter(h => h.unitId === 470 && h.tick > wsEnd2);

  eq('RH2.1  爆裂期攻击次数 = 32',        burstRhHits.length,        32);
  eq('RH2.2  爆裂结束后仍有普通攻击',     afterRhHits.length > 0,    true);
}

// ─── RH3: Red Wolf 弹匣固定 99、满弹，不受 Bastion 补弹 / 装弹数效果影响 ─────────

section('RH3 — Red Wolf 切换武器弹匣固定 99，不受装弹数效果影响');
{
  // Bastion 方块 mock：每 1 发补 5 发（未修复时会把 99 发弹匣截断到原武器上限）
  const rh = {
    ...redHoodUnit(),
    _computedStats: { ...STATS, equipMaxAmmoPct: 0.5 },   // OL 装弹数 +50% → 原武器上限 45
    _cubeData: {
      harmonycube_skill_group: [{
        description_localkey:   'Reload when firing',
        description_value_list: [{ description_value: ['1'] }, { description_value: ['5'] }],
      }],
      level1: [1],
    },
    cubeLevel: 0,
  };
  const squad = [dummyUnit('Step1'), dummyUnit('Step2'), rh];
  const r = simulate({ squad, enemy: ENEMY, duration: 15, hitLog: true });

  const wsBuff  = (r.buffLog ?? []).find(b => b.name === 'Wild Tooth (ATK)' && b.unitId === 470 && b.type === 'buff_gain');
  const wsHits  = (r.hitLog ?? []).filter(h => h.unitId === 470
    && h.tick >= (wsBuff?.tick ?? -1) && h.tick <= (wsBuff?.endTick ?? -1));
  const ammoSeq = wsHits.map(h => h.ammoBeforeShot);

  eq('RH3.1  切换后首发前弹药 = 99（满弹）',       ammoSeq[0],                               99);
  eq('RH3.2  切换期间弹匣上限显示 = 99',           wsHits.every(h => h.maxAmmo === 99),      true);
  eq('RH3.3  每发严格 -1（无补弹、无截断）',       ammoSeq.every((a, i) => a === 99 - i),    true);
}

// ─── RH4: 切换期间 recalcMaxAmmo 不截断固定弹匣 ──────────────────────────────

section('RH4 — isWeaponSwitchAmmoFixed / recalcMaxAmmo');
{
  const buffs = [{ name: 'Ammo Down', unitId: 1, maxAmmoPct: -0.5, endTick: Infinity }];
  const mk = fixed => {
    const u = { id: 1, baseAmmo: 30, stats: {}, skillState: {
      weaponSwitchFixedAmmo: fixed, weaponSwitchMaxAmmo: 99, weaponSwitchEndTick: 200 } };
    initUnitMaxAmmo(u, 30);
    u.ammoLeft = 99;
    return u;
  };
  const stateFor = (u, tick = 100) => ({ tick, buffs, squad: [u] });

  const fixedUnit = mk(true);
  recalcMaxAmmo(stateFor(fixedUnit), fixedUnit);
  eq('RH4.1  固定弹匣：原武器上限仍更新为 15',  fixedUnit.maxAmmo,  15);
  eq('RH4.2  固定弹匣：ammoLeft 保持 99',       fixedUnit.ammoLeft, 99);

  const normalUnit = mk(false);
  recalcMaxAmmo(stateFor(normalUnit), normalUnit);
  eq('RH4.3  非固定弹匣：ammoLeft 截断到 15',   normalUnit.ammoLeft, 15);

  const expired = mk(true);
  recalcMaxAmmo(stateFor(expired, 201), expired);
  eq('RH4.4  切换结束后恢复截断',               expired.ammoLeft,   15);
}

// ─── RH5–RH8: 爆裂用法（config.rhBurstMode）──────────────────────────────────

// 逐 tick 运行并按轮次收集 B1 / B2 / B3 施放者名字：[{ b1, b2, b3 }, ...]
function runRotations(squad, rhBurstMode, ticks = 60 * 60) {
  const s = initBattle({ squad, enemy: ENEMY, duration: 60, rhBurstMode });
  const rounds = [];
  const KEY = { burst_i: 'b1', burst_ii: 'b2', burst_iii: 'b3' };
  for (let t = 0; t < ticks; t++) {
    const { events, over } = tick(s);
    for (const e of events) {
      if (e.type === 'burst_i') rounds.push({});
      if (KEY[e.type] && rounds.length) rounds[rounds.length - 1][KEY[e.type]] = e.unitName;
    }
    if (over) break;
  }
  return { state: s, rounds };
}

const named = (u, name) => ({ ...u, name });

section('RH5 — Red Hood 作为 B1（奇数轮 / 偶数轮）');
for (const [mode, rhRound] of [['b1odd', i => i % 2 === 0], ['b1even', i => i % 2 === 1]]) {
  const squad = [
    named(dummyUnit('Step1'), 'B1'),
    named(dummyUnit('Step2'), 'B2'),
    named(dummyUnit('Step3'), 'B3'),
    { ...redHoodUnit(), burstSkillCooltime: 0 },
  ];
  const { state, rounds } = runRotations(squad, mode);
  const rh = state.squad.find(u => u.id === 470);
  eq(`RH5.1  ${mode}：Red Hood 爆裂阶段为 Step1`, rh.burstStep, 'Step1');
  eq(`RH5.2  ${mode}：至少 4 轮`,                 rounds.length >= 4, true);
  eq(`RH5.3  ${mode}：B1 施放者按轮次奇偶交替`,
    rounds.every((r, i) => r.b1 === (rhRound(i) ? 'Red Hood' : 'B1')), true);
  eq(`RH5.4  ${mode}：Red Hood 不参与 B2 / B3`,
    rounds.every(r => r.b2 === 'B2' && (r.b3 ?? 'B3') === 'B3'), true);
}

// 真实 40s 冷却：首次 B1 的冷却 ▼40s 使下一轮冷却已就绪，仍必须等到自己的轮次
for (const [mode, rhRound, nextIdx] of [['b1odd', i => i % 2 === 0, 1], ['b1even', i => i % 2 === 1, 2]]) {
  const squad = [
    named(dummyUnit('Step1'), 'B1'),
    named(dummyUnit('Step2'), 'B2'),
    named(dummyUnit('Step3'), 'B3'),
    redHoodUnit(),
  ];
  const { rounds } = runRotations(squad, mode, 60 * 120);
  eq(`RH5.5  ${mode}（40s 冷却）：Red Hood 仅在自己的轮次施放 B1`,
    rounds.length >= 6 && rounds.every((r, i) => r.b1 !== 'Red Hood' || rhRound(i)), true);
  eq(`RH5.6  ${mode}（40s 冷却）：首次 B1 后的下一轮（冷却已就绪）仍不施放`,
    rounds[nextIdx]?.b1, 'B1');
}

section('RH6 — Red Hood 第 1 轮爆裂 1 + 按顺序爆裂 3 / 第 2 轮爆裂 1 + 偶数轮爆裂 3');
{
  // 三名 B3 各 40s 冷却按站位轮换；Red Hood 在最右
  const squad = [
    named(dummyUnit('Step1'), 'B1'),
    named(dummyUnit('Step2'), 'B2'),
    named({ ...dummyUnit('Step3'), burstSkillCooltime: 40 * 60 }, 'B3a'),
    named({ ...dummyUnit('Step3'), burstSkillCooltime: 40 * 60 }, 'B3b'),
    redHoodUnit(),
  ];
  const r1 = runRotations(squad, 'b1r1b3', 60 * 90).rounds;
  eq('RH6.1  b1r1b3：第 1 轮 B1 = Red Hood',              r1[0]?.b1, 'Red Hood');
  eq('RH6.2  b1r1b3：第 1 轮 B3 按站位 = B3a',            r1[0]?.b3, 'B3a');
  eq('RH6.3  b1r1b3：其余各轮 B1 均为其他角色',           r1.length > 2 && r1.slice(1).every(r => r.b1 === 'B1'), true);
  eq('RH6.4  b1r1b3：之后 Red Hood 按站位施放 B3',        r1.slice(1).some(r => r.b3 === 'Red Hood'), true);

  // b1r2b3even：两名冷却为 0 的 B3 位于左侧，Red Hood 仍在偶数轮无视站位施放 B3
  const evenSquad = cd => [
    named(dummyUnit('Step1'), 'B1'),
    named(dummyUnit('Step2'), 'B2'),
    named(dummyUnit('Step3'), 'B3a'),
    named(dummyUnit('Step3'), 'B3b'),
    { ...redHoodUnit(), burstSkillCooltime: cd },
  ];
  const r2 = runRotations(evenSquad(0), 'b1r2b3even', 60 * 90).rounds;
  const isEven = i => i % 2 === 1;   // 下标 1 = 第 2 轮
  eq('RH6.5  b1r2b3even：第 1 轮 B1 = 其他角色',          r2[0]?.b1, 'B1');
  eq('RH6.6  b1r2b3even：第 2 轮 B1 + B3 均为 Red Hood',  `${r2[1]?.b1}/${r2[1]?.b3}`, 'Red Hood/Red Hood');
  eq('RH6.7  b1r2b3even：第 2 轮以外 B1 均为其他角色',
    r2.length > 4 && r2.every((r, i) => i === 1 || r.b1 === 'B1'), true);
  eq('RH6.8  b1r2b3even：偶数轮 B3 = Red Hood，奇数轮 = 站位最左 B3a',
    r2.every((r, i) => r.b3 === (isEven(i) ? 'Red Hood' : 'B3a')), true);

  // 真实 40s 冷却：奇数轮即使冷却就绪也不施放 B3；偶数轮冷却未就绪时由其他 B3 按站位施放
  const r2cd = runRotations(evenSquad(40 * 60), 'b1r2b3even', 60 * 120).rounds;
  eq('RH6.9  b1r2b3even（40s 冷却）：Red Hood 仅在偶数轮施放 B3',
    r2cd.length > 6 && r2cd.every((r, i) => r.b3 !== 'Red Hood' || isEven(i)), true);
  eq('RH6.10 b1r2b3even（40s 冷却）：第 2 轮 B3 = Red Hood', r2cd[1]?.b3, 'Red Hood');

  // Red Hood 是最左侧的 B3：B1 那一轮的 B3 也由她施放（Beast Cage 冷却 ▼40s 后就绪）
  const left = [
    named(dummyUnit('Step1'), 'B1'),
    named(dummyUnit('Step2'), 'B2'),
    redHoodUnit(),
    named({ ...dummyUnit('Step3'), burstSkillCooltime: 40 * 60 }, 'B3a'),
  ];
  const r3 = runRotations(left, 'b1r1b3', 60 * 30).rounds;
  eq('RH6.11 b1r1b3 且 Red Hood 在左：第 1 轮 B1 + B3 均为 Red Hood',
    `${r3[0]?.b1}/${r3[0]?.b3}`, 'Red Hood/Red Hood');
}

section('RH7 — 默认（作为 B3）不参与 B1');
{
  const squad = [
    named(dummyUnit('Step1'), 'B1'),
    named(dummyUnit('Step2'), 'B2'),
    { ...redHoodUnit(), burstSkillCooltime: 0 },
  ];
  const { rounds } = runRotations(squad, 'b3');
  eq('RH7.1  B1 均为其他角色',  rounds.length > 0 && rounds.every(r => r.b1 === 'B1'), true);
  eq('RH7.2  B3 均为 Red Hood', rounds.every(r => (r.b3 ?? 'Red Hood') === 'Red Hood'), true);
}

section('RH8 — Beast Cage：全员 ATK ▲ 施放者 ATK，自身冷却 ▼40s（每场一次）');
{
  const squad = [
    named(dummyUnit('Step2'), 'B2'),
    named(dummyUnit('Step3'), 'B3'),
    redHoodUnit(),
  ];
  const r  = simulate({ squad, enemy: ENEMY, duration: 15, hitLog: true, rhBurstMode: 'b1odd' });
  const bc = (r.buffLog ?? []).find(b => b.name === 'Beast Cage (ATK)' && b.type === 'buff_gain');
  eq('RH8.1  Beast Cage (ATK) buff 已应用', bc != null, true);

  const { state, rounds } = runRotations(squad, 'b1odd', 60 * 3);
  const rh = state.squad.find(u => u.id === 470);
  eq('RH8.2  首轮 B1 = Red Hood',           rounds[0]?.b1, 'Red Hood');
  eq('RH8.3  首次 B1 后冷却 ▼40s → 0',      rh.burstCdRemaining, 0);
  eq('RH8.4  ▼40s 已标记为本场已使用',       rh.skillState.rhBeastCageCdUsed, true);
}

summary('Red Hood weapon switch shot count tests');
