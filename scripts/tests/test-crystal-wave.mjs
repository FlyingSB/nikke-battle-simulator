/**
 * Cinderella: Crystal Wave（515）Snipe Mode 回归 — 本地 JSON，无 CDN。
 *
 * Covers:
 *   W1 — 默认（自动战斗）：恒为 MG 形态，无 Snipe Mode 命中，Pinpoint 持续
 *   W2 — 开局切换：射击 1 发 → 主动装填（2.5s + 后摇）→ Preparation for Change → 射击 1 发 →
 *        主动装填（固定 3s + 后摇）→ 装填完成即 Snipe Mode；Destroy 替换 Pinpoint
 *   W3 — Snipe Mode 普攻：蓄力倍率 250%、Pierce、每发实际扣 1 发、每发按 40 发计入累计消耗弹药
 *   W4 — Snipe Mode 节奏：弹匣内 60t 一发；打空后装填（2.5s + 后摇）+ 对准 + 固定蓄力 1s；末弹移除 PfC
 *   W5 — S2 P5 全爆裂分支：Snipe Mode 走 p05 全体伤害，否则走 p06 核心打击
 *   W6 — Snipe Mode 弹匣以 15 发为基础重算装备词条 / 珍藏品装弹数
 *
 * Run: node scripts/tests/test-crystal-wave.mjs
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { initBattle, tick } from '../../src/engine/battle.js';
import { SKILL_TRAITS } from '../../src/data/skill-traits.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nikke515  = JSON.parse(readFileSync(join(__dirname, '../../src/data/static/nikke/515.json'), 'utf8'));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ENEMY = { maxHp: 1e15, def: 0, element: 'Electric', type: 'Boss', hasCore: false, distance: 'MID' };

// 与 store.js 组装口径一致：MG 装填 2.5s = 150t、末发后摇 / 对准期各 20cs = 12t、弹匣 300、60 RPM 起速。
function ccwUnit(overrides = {}) {
  return {
    characterId:              515,
    name:                     'Cinderella: Crystal Wave',
    element:                  'Iron',
    weaponType:               'MG',
    burstStep:                'Step3',
    _nikkeData:               nikke515,
    _computedStats:           { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 },
    baseAmmo:                 300,
    reloadTicks:              150,
    reloadRecoveryTicks:      12,
    reloadAimTicks:           12,
    fullChargeDamage:         10000,
    burstEnergyPerShot:       500,
    targetBurstEnergyPerShot: 1000,
    burstSkillCooltime:       2400,
    skillLevels:              [10, 10, 10],
    ...overrides,
  };
}

/** 逐 tick 运行到 uptoTick，返回 state（含 hitLog / ammoLog）与事件列表。 */
function run(config, uptoTick) {
  const state  = initBattle({ ...config, hitLog: true });
  const events = [];
  while (state.tick < uptoTick) {
    const r = tick(state);
    events.push(...r.events);
    if (r.over) break;
  }
  return { state, events };
}

const SNIPE_LABEL = 'S1 P1 Snipe Mode';
const unitOf  = state => state.squad.find(u => u.id === 515);
const hasBuff = (state, name) => state.buffs.some(b => b.unitId === 515 && b.name === name && b.endTick > state.tick);

// ─── W1：默认自动战斗 → 恒为 MG ──────────────────────────────────────────────

section('W1 — 默认（未开启选项）：恒为 MG 形态');
{
  const { state } = run({ squad: [ccwUnit()], enemy: ENEMY }, 60 * 30);
  const snipeHits = state.hitLog.filter(h => h.label === SNIPE_LABEL);
  const mgShots   = state.hitLog.filter(h => h.label === 'normal_shot');
  eq('无 Snipe Mode 命中', snipeHits.length, 0);
  eq('MG 普攻 > 100 发', mgShots.length > 100, true);
  eq('Pinpoint 持续', hasBuff(state, 'Pinpoint'), true);
  eq('无 Destroy',    hasBuff(state, 'Destroy'),  false);
  eq('无 Snipe Mode 哨兵 buff', hasBuff(state, 'Snipe Mode'), false);
  eq('弹匣上限仍为 MG 300', unitOf(state).maxAmmo, 300);
}

// ─── W2 / W3 / W4：开局切换流程 ─────────────────────────────────────────────

section('W2 — 开局切换：两次主动装填后进入 Snipe Mode');
const sim = run({ squad: [ccwUnit()], enemy: ENEMY, ccwSnipeModeAtStart: true }, 60 * 60);
{
  const { state, events } = sim;
  const mgShots   = state.hitLog.filter(h => h.label === 'normal_shot').map(h => h.tick);
  const reloads   = events.filter(e => e.type === 'reload').map(e => e.tick);
  const snipeHits = state.hitLog.filter(h => h.label === SNIPE_LABEL);
  const manual    = state.ammoLog.filter(a => a.source === 'manual_reload');

  eq('切换前恰好 2 发 MG 普攻', mgShots.length, 2);
  eq('2 次主动装填', manual.length, 2);
  eq('主动装填紧随射击同 tick', manual.map(a => a.tick).join(','), mgShots.join(','));
  // 第 1 次装填：下一 tick 开始，2.5s（150t）+ 末发后摇 12t
  eq('第 1 次装填完成 = 射击 + 1 + 150 + 12', reloads[0], mgShots[0] + 163);
  // 第 2 次装填处于 Preparation for Change：固定 3s（180t）+ 末发后摇 12t
  eq('第 2 次装填完成 = 射击 + 1 + 180 + 12（固定 3s）', reloads[1], mgShots[1] + 193);
  eq('结束时处于 Snipe Mode（哨兵 buff）', hasBuff(state, 'Snipe Mode'), true);
  eq('Snipe Mode 期间 Destroy 生效', hasBuff(state, 'Destroy'),  true);
  eq('Snipe Mode 期间 Pinpoint 移除', hasBuff(state, 'Pinpoint'), false);
  eq('存在 Snipe Mode 命中', snipeHits.length > 0, true);
  // 换弹后首发 = 装填完成 + 对准期 12t + 固定蓄力 60t
  eq('首发 Snipe 射击 = 第 2 次装填完成 + 12 + 60', snipeHits[0]?.tick, reloads[1] + 72);
  eq('Snipe Mode 弹匣上限 = 15（无装弹数加成）', unitOf(state).maxAmmo, 15);
}

section('W3 — Snipe Mode 普攻：蓄力倍率、Pierce、弹药扣除与累计计数');
{
  const { state } = sim;
  const snipeHits = state.hitLog.filter(h => h.label === SNIPE_LABEL);
  const first = snipeHits[0];
  near('hitMult = 62.13%', first.hitMult, 0.6213, 1e-6);
  near('蓄力倍率 = 250%',  first.chargeMult, 2.5, 1e-6);
  eq('Pierce',            first.isPierce, true);
  eq('首发射击前弹药 15',  first.ammoBeforeShot, 15);
  eq('每发实际扣 1 发',    first.ammoLeft, 14);
  eq('日志弹匣上限 15',    first.maxAmmo, 15);
  eq('全部 Snipe 命中均为扣 1 发',
     snipeHits.every(h => h.ammoBeforeShot - h.ammoLeft === 1), true);
  // 累计消耗弹药：2 发 MG + 每发 Snipe 按「Expends ammo」40 发计
  eq('totalAmmoFired = 2 + 40 × Snipe 发数', state.totalAmmoFired, 2 + 40 * snipeHits.length);
}

section('W4 — Snipe Mode 节奏与 Preparation for Change 移除');
{
  const { state, events } = sim;
  const snipeTicks = state.hitLog.filter(h => h.label === SNIPE_LABEL).map(h => h.tick);
  const reloads    = events.filter(e => e.type === 'reload').map(e => e.tick);
  const gaps = snipeTicks.slice(1).map((t, i) => t - snipeTicks[i]);
  eq('Snipe 发数 ≥ 16（跨越一次装填）', snipeTicks.length >= 16, true);
  // 弹匣内固定蓄力 1s → 60t 一发；第 15 发打空 → 1 + 150 + 12 装填 → 12 对准 → 60 蓄力 = 235t
  eq('前 14 个发间 = 60t（弹匣内）', gaps.slice(0, 14).join(','), Array(14).fill(60).join(','));
  eq('第 15 → 16 发间 = 235t（1 + 150 + 12 + 12 + 60）', gaps[14], 235);
  eq('Snipe 弹匣打空后常规装填完成 = 末发 + 163', reloads[2], snipeTicks[14] + 163);
  // 第 15 发为末弹 → PfC 移除；装填完成 → PfC 重新授予
  const lastReloadLater = reloads.at(-1) > snipeTicks.at(-1);
  eq('Preparation for Change 状态与「最近一次装填晚于最近一次射击」一致',
     hasBuff(state, 'Preparation for Change'), lastReloadLater);
  eq('结束时仍为 Snipe Mode（装填未触发切回）', hasBuff(state, 'Snipe Mode'), true);
}

// ─── W5：S2 P5 全爆裂分支 ───────────────────────────────────────────────────

section('W5 — S2 P5：Snipe Mode / 非 Snipe Mode 分支');
{
  const p5 = SKILL_TRAITS[515].skill2.triggers.find(t => t.on === 'ENTER_FULL_BURST');
  eq('S2 有 ENTER_FULL_BURST 触发器', !!p5, true);

  // 两分支统一标签 'S2 P5' → 解析为「Mode Swap P5」；以命中部位与倍率区分分支
  const mk = (snipe) => {
    const state = initBattle({ squad: [ccwUnit()], enemy: { ...ENEMY, hasCore: true }, hitLog: true });
    const u = unitOf(state);
    state.burstCastersThisRotation = new Set([515]);
    state.tick = 100;
    if (snipe) Object.assign(u.skillState, { ccw_snipeActive: true, weaponSwitchEndTick: Infinity });
    p5.handler(state, u, {});
    return { u, hits: state.hitLog.filter(h => h.label === 'Mode Swap P5') };
  };
  const sn = mk(true);
  eq('Snipe Mode → Mode Swap P5 命中 1 次',  sn.u.skillDamageCount?.['Mode Swap P5'], 1);
  near('Snipe Mode → 倍率 p05 = 1189.66%',   sn.hits[0]?.hitMult, 11.8966, 1e-6);
  eq('Snipe Mode → 非核心打击（全体伤害）',   sn.hits[0]?.isCore, false);
  const mg = mk(false);
  eq('非 Snipe Mode → Mode Swap P5 命中 1 次', mg.u.skillDamageCount?.['Mode Swap P5'], 1);
  near('非 Snipe Mode → 倍率 p06 = 833.79%',   mg.hits[0]?.hitMult, 8.3379, 1e-6);
  eq('非 Snipe Mode → 核心打击',               mg.hits[0]?.isCore, true);
}

// ─── W6：Snipe Mode 弹匣按 15 发基础重算装弹数效果 ──────────────────────────

section('W6 — Snipe Mode 弹匣以 15 发为基础重算装备词条装弹数');
{
  // 装备词条装弹数 +50%：MG 300 → 450；Snipe Mode 15 + round(15 × 0.5) = 23
  const unit = ccwUnit({
    _computedStats: { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0, equipMaxAmmoPct: 0.5 },
  });
  const { state } = run({ squad: [unit], enemy: ENEMY, ccwSnipeModeAtStart: true }, 60 * 20);
  const u = unitOf(state);
  const snipeHits = state.hitLog.filter(h => h.label === SNIPE_LABEL);
  eq('MG 形态首发日志弹匣上限 450', state.hitLog.find(h => h.label === 'normal_shot')?.maxAmmo, 450);
  eq('Snipe Mode 弹匣上限 23', u.maxAmmo, 23);
  eq('Snipe 首发射击前弹药 23', snipeHits[0]?.ammoBeforeShot, 23);
  eq('Snipe 首发日志弹匣上限 23', snipeHits[0]?.maxAmmo, 23);
}

summary('Cinderella: Crystal Wave Snipe Mode tests');
