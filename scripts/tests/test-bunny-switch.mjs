/**
 * Bunny Mode 开局切换回归（Guilty: Mighty Bunny 404 / Sin: Swift Bunny 405）— 本地 JSON，无 CDN。
 *
 * UI 选项「切换兔兔模式：出击」（config.bunnyEngageAtStart）：执行者（Sin > Guilty）第一次攻击满蓄后
 * 多按住 1s 切换到 Engage，本发照常全蓄力打出。按住期间 Focus 被执行者占用（state.focusLockUnitId）：
 * 原 Focus 角色无 Focus 全蓄力充能倍率、无法速充；Cinderella: Crystal Wave 切枪流程同样占用 Focus。
 *
 * Covers:
 *   K1 — 默认（保持架势）：首发 @72，恒为 Stance
 *   K2 — 切换（仅 Sin）：首发 @132 全蓄力、击发即 Engage（Guilty 被带动）、Focus 释放、之后正常节奏
 *   K3 — 执行者优先级：Sin 与 Guilty 同队 → Sin 按住，Guilty 首发照常 @72（仍 Stance）
 *   K4 — 仅 Guilty：Guilty 按住，首发全蓄力即 Engage 分支（S2 P1 真实伤害）
 *   K5 — 速充角色：切换期间全蓄力且无 Focus 充能倍率；释放后恢复 Focus 与速充
 *   K6 — Cinderella: Crystal Wave 切枪：等待兔子切换完成才开始主动装填，切枪期间占用 Focus
 *
 * Run: node scripts/tests/test-bunny-switch.mjs
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { initBattle, tick } from '../../src/engine/battle.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadNikke = id => JSON.parse(readFileSync(join(__dirname, `../../src/data/static/nikke/${id}.json`), 'utf8'));
const NIKKE = { 404: loadNikke(404), 405: loadNikke(405), 515: loadNikke(515) };

const ENEMY = { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', hasCore: false, distance: 'NEAR' };
const STATS = { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 };

/** UP 型 SR：前摇 12、后摇 12、蓄力 60 → 首发 @72、发间 84。 */
function srUnit(characterId, overrides = {}) {
  return {
    characterId, name: `SR-${characterId}`, element: 'Iron', weaponType: 'SR', burstStep: 'Step3',
    _nikkeData: NIKKE[characterId] ?? {}, _computedStats: STATS, skillLevels: [10, 10, 10],
    rateOfFire: 60, baseAmmo: 60, reloadTicks: 120, chargeTimeTicks: 60, foreswingTicks: 12, backswingTicks: 12,
    fullChargeDamage: 25000, fullChargeBurstEnergy: 30000, targetBurstEnergyPerShot: 0, burstEnergyPerShot: 0,
    burstSkillCooltime: 2400, reloadFraction: 1.0, shotDamageMult: 1.0, coreDmgIncrement: 0,
    ...overrides,
  };
}

function ccwUnit() {
  return {
    characterId: 515, name: 'Cinderella: Crystal Wave', element: 'Iron', weaponType: 'MG', burstStep: 'Step3',
    _nikkeData: NIKKE[515], _computedStats: STATS, skillLevels: [10, 10, 10],
    baseAmmo: 300, reloadTicks: 150, reloadRecoveryTicks: 12, reloadAimTicks: 12,
    fullChargeDamage: 10000, burstEnergyPerShot: 0, targetBurstEnergyPerShot: 0, burstSkillCooltime: 2400,
  };
}

/** 逐 tick 运行到 uptoTick；onTick(state) 在每 tick 结束后调用。 */
function run(config, uptoTick, onTick) {
  const state  = initBattle({ ...config, enemy: ENEMY, hitLog: true });
  while (state.tick < uptoTick) {
    const r = tick(state);
    onTick?.(state);
    if (r.over) break;
  }
  return state;
}

const unitOf  = (state, id) => state.squad.find(u => u.id === id);
const shotsOf = (state, id) => state.hitLog.filter(h => h.unitId === id && h.label === 'normal_shot');

section('K1 — 默认：保持架势');
{
  const state = run({ squad: [srUnit(405)] }, 300);
  eq('Sin 首发 @72', shotsOf(state, 405)[0].tick, 72);
  eq('恒为 Stance', unitOf(state, 405).skillState.bunnyMode, 'Stance');
  eq('无 Focus 占用', state.focusLockUnitId, null);
}

section('K2 — 切换（仅 Sin）：首发多按住 1s 切换 Engage');
{
  const modeAt = {};
  const lockAt = {};
  const state = run({ squad: [srUnit(405), srUnit(404, { name: 'Guilty' })], bunnyEngageAtStart: true }, 400,
    s => { modeAt[s.tick] = unitOf(s, 404).skillState.bunnyMode; lockAt[s.tick] = s.focusLockUnitId; });
  const sin = shotsOf(state, 405);
  eq('Sin 首发 @132（72 + 按住 60）', sin[0].tick, 132);
  eq('首发为全蓄力（非速充、真实伤害）', sin[0].chargeRatio === undefined && sin[0].isTrueDamage === true, true);
  eq('第 2 发 @216（正常发间 84）', sin[1].tick, 216);
  eq('按住期间 Sin 占用 Focus', lockAt[100], 405);
  eq('击发后释放 Focus', lockAt[132], null);
  eq('Guilty 在切换前为 Stance', modeAt[131], 'Stance');
  eq('Guilty 被带动进入 Engage', modeAt[132], 'Engage');
  eq('Sin 为 Engage', unitOf(state, 405).skillState.bunnyMode, 'Engage');
}

section('K3 — 执行者优先级：Sin > Guilty');
{
  const state = run({ squad: [srUnit(404), srUnit(405)], bunnyEngageAtStart: true }, 300);
  eq('Sin 首发 @132（执行切换）', shotsOf(state, 405)[0].tick, 132);
  eq('Guilty 首发照常 @72', shotsOf(state, 404)[0].tick, 72);
  const g72 = state.hitLog.find(h => h.unitId === 404 && h.tick === 72 && h.label !== 'normal_shot');
  eq('Guilty 首发时仍为 Stance（S2 P2 追加伤害）', g72?.label, 'Can I Take These Off...? P2');
}

section('K4 — 仅 Guilty：Guilty 执行切换');
{
  const state = run({ squad: [srUnit(404)], bunnyEngageAtStart: true }, 300);
  eq('Guilty 首发 @132', shotsOf(state, 404)[0].tick, 132);
  const g = state.hitLog.find(h => h.unitId === 404 && h.tick === 132 && h.label !== 'normal_shot');
  eq('首发全蓄力即走 Engage 分支（S2 P1 真实伤害）', g?.label, 'Can I Take These Off...? P1');
}

section('K5 — 速充 Focus 角色：切换期间全蓄力、无 Focus 充能倍率');
{
  const qc = srUnit(92001, { isFocus: true, targetBurstEnergyPerShot: 10_000 });
  const state = run({ squad: [qc, srUnit(405)], bunnyEngageAtStart: true, quickChargeMode: 'always' }, 300);
  const shots = shotsOf(state, 92001);
  eq('首发 @72 全蓄力（非速充）', shots[0].tick === 72 && shots[0].chargeRatio === undefined, true);
  eq('首发无 Focus 充能倍率（1 万）', shots[0].gaugeAfter, 10_000);
  eq('第 2 发 @156 仍为全蓄力（排定于切换期间）', shots[1].tick === 156 && shots[1].chargeRatio === undefined, true);
  eq('第 2 发 Focus 已归还（充能 ×3）', shots[1].gaugeAfter - shots[0].gaugeAfter, 30_000);
  eq('之后恢复速充（@171，蓄力比例 13/60）', shots[2].tick === 171 && shots[2].chargeRatio === 13 / 60, true);
}

section('K6 — Cinderella 切枪：等待兔子切换完成后占用 Focus');
{
  const lockAt = {};
  const state = run({ squad: [ccwUnit(), srUnit(405)], bunnyEngageAtStart: true, ccwSnipeModeAtStart: true },
    60 * 20, s => { lockAt[s.tick] = s.focusLockUnitId; });
  const manual = state.ammoLog.filter(a => a.unitId === 515 && a.source === 'manual_reload');
  eq('2 次主动装填', manual.length, 2);
  eq('第 1 次主动装填在 Sin 切换（@132）之后', manual[0].tick >= 132, true);
  eq('切枪期间 Cinderella 占用 Focus', lockAt[manual[1].tick], 515);
  eq('进入 Snipe Mode 后释放 Focus', state.focusLockUnitId, null);
  eq('已进入 Snipe Mode', unitOf(state, 515).skillState.ccw_snipeActive, true);
}

summary('BunnySwitch');
