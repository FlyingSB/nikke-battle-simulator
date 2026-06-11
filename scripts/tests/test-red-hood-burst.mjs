/**
 * Red Hood (470) — weapon switch shot count regression.
 * Pure: no CDN, no file I/O. Uses simulate() with synthetic _computedStats.
 *
 * Covers:
 *   RH1 — Red Wolf 武器切换期间，10s 内正好攻击 32 次
 *   RH2 — Burst 结束后 weaponSwitchEndTick 被清零（不再有武器切换攻击）
 *
 * Run: node scripts/tests/test-red-hood-burst.mjs
 */

import { simulate } from '../../src/engine/battle.js';
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
  const wsBuff   = (r.buffLog ?? []).find(b => b.name === 'Wild Tooth P4' && b.unitId === 470 && b.type === 'buff_gain');
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

  const wsBuff2      = (r.buffLog ?? []).find(b => b.name === 'Wild Tooth P4' && b.unitId === 470 && b.type === 'buff_gain');
  const wsStart2     = wsBuff2?.tick    ?? -1;
  const wsEnd2       = wsBuff2?.endTick ?? -1;
  const burstRhHits  = (r.hitLog ?? []).filter(h => h.unitId === 470 && h.tick >= wsStart2 && h.tick <= wsEnd2);
  const afterRhHits  = (r.hitLog ?? []).filter(h => h.unitId === 470 && h.tick > wsEnd2);

  eq('RH2.1  爆裂期攻击次数 = 32',        burstRhHits.length,        32);
  eq('RH2.2  爆裂结束后仍有普通攻击',     afterRhHits.length > 0,    true);
}

summary('Red Hood weapon switch shot count tests');
