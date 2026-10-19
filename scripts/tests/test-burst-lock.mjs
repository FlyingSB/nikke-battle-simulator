/**
 * 爆裂施放者锁定（config.burstLocks，UI 槽位左上角爆裂阶段按钮）回归测试。
 * 纯逻辑：无 CDN、无文件 I/O，使用合成单位逐 tick 运行 initBattle / tick。
 *
 * 覆盖：
 *   BL0 — 无锁定：按站位从左到右（对照）
 *   BL1 — 锁定 B1：站位靠右的 B1 也始终由其施放
 *   BL2 — 锁定 B1 冷却中：等待（不由其他 B1 接替），冷却未好则阶段超时
 *   BL3 — 爆裂 3 奇数轮 / 偶数轮分别锁定
 *   BL4 — 仅锁定奇数轮：偶数轮按站位自动选择
 *   BL5 — 特殊选项优先：Red Hood b1odd 的奇数轮仍由 Red Hood 施放 B1
 *   BL6 — 锁定 B2
 *
 * Run: node scripts/tests/test-burst-lock.mjs
 */

import { initBattle, tick } from '../../src/engine/battle.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

const STATS = { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 };
const ENEMY = { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', hasCore: false, distance: 'NEAR' };
const _MOCK_SKILL_N = n => ({ description_value_list: Array.from({ length: n }, () => ({ description_value: Array(10).fill('100') })) });

function unit(id, name, burstStep, cdSecs = 0) {
  return {
    characterId:              id,
    name,
    element:                  'Iron',
    weaponType:               'MG',
    burstStep,
    nativeBurstStep:          burstStep,
    _nikkeData:               {},
    _computedStats:           { ...STATS },
    targetBurstEnergyPerShot: 1_000_000,  // 一枪填满共享槽
    burstEnergyPerShot:       500,
    burstSkillCooltime:       cdSecs * 60,
    baseAmmo:                 30,
    reloadTicks:              120,
    shotDamageMult:           1.0,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    rateOfFire:               600,
  };
}

function redHood() {
  return {
    ...unit(470, 'Red Hood', 'Step3'),
    weaponType: 'SR', rateOfFire: 120, chargeTime: 60, reloadTicks: 90,
    _nikkeData: { skill1_detail: _MOCK_SKILL_N(10), skill2_detail: _MOCK_SKILL_N(10), ulti_skill_detail: _MOCK_SKILL_N(10) },
  };
}

// 逐 tick 运行，按轮次收集 B1 / B2 / B3 施放者（含轮次序号）与阶段超时次数
function run(squad, extra, secs = 60) {
  const s = initBattle({ squad, enemy: ENEMY, duration: secs, ...extra });
  const rounds = [];
  let timeouts = 0;
  const KEY = { burst_i: 'b1', burst_ii: 'b2', burst_iii: 'b3' };
  for (let t = 0; t < secs * 60; t++) {
    const { events, over } = tick(s);
    for (const e of events) {
      if (e.type === 'burst_timeout') timeouts++;
      if (e.type === 'burst_i') rounds.push({ cycle: s.burstCycleCount });
      if (KEY[e.type] && rounds.length) rounds[rounds.length - 1][KEY[e.type]] = e.unitName;
    }
    if (over) break;
  }
  return { rounds, timeouts };
}

const base = () => [unit(1, 'B1a', 'Step1'), unit(2, 'B1b', 'Step1'), unit(3, 'B2', 'Step2'),
  unit(4, 'B3a', 'Step3'), unit(5, 'B3b', 'Step3')];

section('BL0 — 无锁定：按站位从左到右');
{
  const { rounds } = run(base(), {});
  eq('BL0.1  B1 均为 B1a', rounds.length > 3 && rounds.every(r => r.b1 === 'B1a'), true);
  eq('BL0.2  B3 均为 B3a', rounds.every(r => (r.b3 ?? 'B3a') === 'B3a'), true);
}

section('BL1 — 锁定 B1（站位靠右）');
{
  const { rounds } = run(base(), { burstLocks: { s1: 2 } });
  eq('BL1.1  B1 均为 B1b', rounds.length > 3 && rounds.every(r => r.b1 === 'B1b'), true);
}

section('BL2 — 锁定 B1 冷却中：等待而不由其他 B1 接替');
{
  // B1b 冷却 30s：第 1 轮全爆裂结束后仍在冷却中，阶段 1 等待 10s 超时
  const squad = [unit(1, 'B1a', 'Step1'), unit(2, 'B1b', 'Step1', 30), unit(3, 'B2', 'Step2'), unit(4, 'B3', 'Step3')];
  const locked = run(squad, { burstLocks: { s1: 2 } }, 90);
  eq('BL2.1  B1 从不由 B1a 施放', locked.rounds.length > 1 && locked.rounds.every(r => r.b1 === 'B1b'), true);
  eq('BL2.2  冷却未好时阶段超时',  locked.timeouts > 0, true);
  const auto = run(squad, {}, 90);
  eq('BL2.3  未锁定时由 B1a 施放（对照）', auto.rounds.every(r => r.b1 === 'B1a'), true);
}

section('BL3 — 爆裂 3 奇数轮 / 偶数轮分别锁定');
{
  const { rounds } = run(base(), { burstLocks: { s3odd: 5, s3even: 4 } });
  eq('BL3.1  至少 4 轮', rounds.length >= 4, true);
  eq('BL3.2  奇数轮 B3b / 偶数轮 B3a',
    rounds.every(r => r.b3 === (r.cycle % 2 === 1 ? 'B3b' : 'B3a')), true);
}

section('BL4 — 仅锁定奇数轮');
{
  const { rounds } = run(base(), { burstLocks: { s3odd: 5 } });
  eq('BL4.1  奇数轮 B3b / 偶数轮按站位 B3a',
    rounds.length >= 4 && rounds.every(r => r.b3 === (r.cycle % 2 === 1 ? 'B3b' : 'B3a')), true);
}

section('BL5 — 特殊选项优先（Red Hood 奇数轮 B1）');
{
  const squad = [unit(1, 'B1a', 'Step1'), unit(2, 'B1b', 'Step1'), unit(3, 'B2', 'Step2'),
    unit(4, 'B3a', 'Step3'), { ...redHood(), burstSkillCooltime: 0 }];
  const { rounds } = run(squad, { rhBurstMode: 'b1odd', burstLocks: { s1: 2 } });
  eq('BL5.1  奇数轮 Red Hood / 偶数轮锁定的 B1b',
    rounds.length >= 4 && rounds.every(r => r.b1 === (r.cycle % 2 === 1 ? 'Red Hood' : 'B1b')), true);
  // 锁定带策略的单位（Red Hood）无效：由特殊选项决定，其余轮次自动选择
  const r2 = run(squad, { rhBurstMode: 'b1odd', burstLocks: { s1: 470 } }).rounds;
  eq('BL5.2  锁定 Red Hood 被特殊选项覆盖：偶数轮自动 B1a',
    r2.length >= 4 && r2.every(r => r.b1 === (r.cycle % 2 === 1 ? 'Red Hood' : 'B1a')), true);
}

section('BL6 — 锁定 B2');
{
  const squad = [unit(1, 'B1', 'Step1'), unit(2, 'B2a', 'Step2'), unit(3, 'B2b', 'Step2'), unit(4, 'B3', 'Step3')];
  const { rounds } = run(squad, { burstLocks: { s2: 3 } });
  eq('BL6.1  B2 均为 B2b', rounds.length > 3 && rounds.every(r => r.b2 === 'B2b'), true);
}

summary('Burst caster lock tests');
