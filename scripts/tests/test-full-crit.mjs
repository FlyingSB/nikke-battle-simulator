/**
 * 百暴回归 — Miranda S2 P3 + 停火打法（config.fullCritCharIds）。
 * Pure: 无 CDN、无文件 I/O。合成单位 + initBattle / tick。
 *
 * Miranda S2 P3「Wake Up! (Crit Rate)」为 1 回合的回合制 buff：不普攻不消耗、技能同样享受。
 * 测试在进入全爆裂的 tick 结束时手动推入带 fullCritSource 标记的同名 buff（模拟 Miranda 选中目标）。
 *
 * Covers:
 *   F1 — 未开启：全爆裂期间照常射击，首发即消耗 buff
 *   F2 — 开启 + buff 在自身 + 自己轮次：全爆裂期间不射击，弹匣未满先换弹；全爆裂结束后重新前摇 + 蓄力，首发消耗 buff
 *   F3 — 开启但 Miranda 把 buff 给了别人：百暴失效，照常射击
 *   F4 — 开启 + buff 在自身但非自己轮次（本轮未施放爆裂）：照常射击
 *   F5 — 无限弹（unlimitedAmmoEndTick）期间不消耗回合，照常射击
 *
 * Run: node scripts/tests/test-full-crit.mjs
 */

import { initBattle, tick } from '../../src/engine/battle.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

const ENEMY = { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', hasCore: false, distance: 'NEAR' };
const STATS = { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 };
let _nextId = 93000;

function baseUnit(overrides) {
  return {
    characterId: _nextId++, name: `FC-${_nextId}`, element: 'Iron', burstStep: 'Step3',
    _nikkeData: {}, _computedStats: STATS, burstSkillCooltime: 0, coreDmgIncrement: 0,
    fullChargeDamage: 10000, reloadFraction: 1.0, shotDamageMult: 1.0,
    targetBurstEnergyPerShot: 0, burstEnergyPerShot: 0,
    ...overrides,
  };
}

/** UP 型 SR（B3）：前摇 12、后摇 12、蓄力 60、弹匣 6、装填 90；每发充能 25 万（4 发充满）。 */
const sr = (overrides = {}) => baseUnit({
  weaponType: 'SR', rateOfFire: 60, baseAmmo: 6, reloadTicks: 90,
  chargeTimeTicks: 60, foreswingTicks: 12, backswingTicks: 12,
  fullChargeDamage: 25000, targetBurstEnergyPerShot: 250_000, ...overrides,
});
const filler = step => baseUnit({ weaponType: 'AR', rateOfFire: 600, baseAmmo: 999, reloadTicks: 60, burstStep: step });

const BUFF_NAME = 'Wake Up! (Crit Rate)';

/**
 * 逐 tick 运行到首次全爆裂结束后 300t。进入全爆裂的 tick 结束时给 targetOf() 推入 Miranda S2 P3 buff。
 * @returns {{ state, fbFrom, fbEnd, shotsOf, events }}
 */
function run(squad, { fullCritCharIds = [], targetOf, beforeTick } = {}) {
  const state  = initBattle({ squad, enemy: ENEMY, hitLog: true, fullCritCharIds });
  const events = [];
  let fbFrom = null, fbEnd = null;
  while (state.tick < 60 * 60) {
    beforeTick?.(state);
    const r = tick(state);
    events.push(...r.events);
    if (fbFrom == null && state.fullBurstActive) {
      fbFrom = state.tick;
      state.buffs.push({ name: BUFF_NAME, unitId: targetOf(), critRatePct: 0.85,
        roundsLeft: 1, endTick: Infinity, stacks: 1, fullCritSource: true });
    }
    if (fbFrom != null && fbEnd == null && !state.fullBurstActive) fbEnd = state.tick;
    if (fbEnd != null && state.tick >= fbEnd + 300) break;
  }
  const shotsOf = id => state.hitLog.filter(h => h.unitId === id && h.label === 'normal_shot');
  return { state, fbFrom, fbEnd, shotsOf, events };
}

const hasBuff = (state, id) => state.buffs.some(b => b.unitId === id && b.name === BUFF_NAME && b.roundsLeft > 0);

section('F1 — 未开启：全爆裂期间照常射击');
{
  const b3 = sr();
  const { state, fbFrom, fbEnd, shotsOf } = run([filler('Step1'), filler('Step2'), b3],
    { targetOf: () => b3.characterId });
  eq('全爆裂期间有射击', shotsOf(b3.characterId).some(s => s.tick > fbFrom && s.tick < fbEnd), true);
  eq('buff 已被普攻消耗', hasBuff(state, b3.characterId), false);
}

section('F2 — 开启：自己轮次全爆裂期间停火、先换弹，结束后重新蓄力');
{
  const b3 = sr();
  const id = b3.characterId;
  let buffAtFbEnd = null;
  const { state, fbFrom, fbEnd, shotsOf, events } = run([filler('Step1'), filler('Step2'), b3], {
    fullCritCharIds: [id], targetOf: () => id,
    beforeTick: s => { if (s.fullBurstActive && s.tick + 1 >= s.fullBurstTick) buffAtFbEnd = hasBuff(s, id); },
  });
  const shots = shotsOf(id);
  eq('全爆裂期间（进入 tick 之后）不射击', shots.some(s => s.tick > fbFrom && s.tick < fbEnd), false);
  const ammoAtFb = shots.filter(s => s.tick <= fbFrom).at(-1)?.ammoLeft;
  eq('进入全爆裂时弹匣未满', ammoAtFb < 6, true);
  eq('全爆裂期间完成一次换弹',
     events.some(e => e.type === 'reload' && e.tick > fbFrom && e.tick < fbEnd), true);
  eq('全爆裂结束前 buff 仍保留', buffAtFbEnd, true);
  const next = shots.find(s => s.tick >= fbEnd);
  eq('结束后首发 = 全爆裂结束 + 前摇 12 + 蓄力 60', next?.tick, fbEnd + 72);
  eq('首发弹匣满（6 → 5）', next?.ammoLeft, 5);
  eq('首发后 buff 被消耗', hasBuff(state, id), false);
}

section('F3 — Miranda 把 buff 给了别人：百暴失效');
{
  const b1 = filler('Step1');
  const b3 = sr();
  const { fbFrom, fbEnd, shotsOf } = run([b1, filler('Step2'), b3],
    { fullCritCharIds: [b3.characterId], targetOf: () => b1.characterId });
  eq('全爆裂期间照常射击', shotsOf(b3.characterId).some(s => s.tick > fbFrom && s.tick < fbEnd), true);
}

section('F4 — 非自己轮次（本轮未施放爆裂）：照常射击');
{
  const b3a = sr();
  const b3b = sr();   // 排在 b3a 之后、b3a 爆裂 CD 为 0 → 本轮由 b3a 施放
  const { fbFrom, fbEnd, shotsOf } = run([filler('Step1'), filler('Step2'), b3a, b3b],
    { fullCritCharIds: [b3b.characterId], targetOf: () => b3b.characterId });
  eq('全爆裂期间照常射击', shotsOf(b3b.characterId).some(s => s.tick > fbFrom && s.tick < fbEnd), true);
}

section('F5 — 无限弹期间照常射击（不消耗回合）');
{
  const b3 = sr();
  const id = b3.characterId;
  let buffAtFbEnd = null;
  const { fbFrom, fbEnd, shotsOf } = run([filler('Step1'), filler('Step2'), b3], {
    fullCritCharIds: [id], targetOf: () => id,
    beforeTick: s => {
      const u = s.squad.find(x => x.id === id);
      if (s.fullBurstActive && u.skillState.unlimitedAmmoEndTick == null) u.skillState.unlimitedAmmoEndTick = s.fullBurstTick;
      if (s.fullBurstActive && s.tick + 1 >= s.fullBurstTick) buffAtFbEnd = hasBuff(s, id);
    },
  });
  eq('全爆裂期间照常射击', shotsOf(id).some(s => s.tick > fbFrom && s.tick < fbEnd), true);
  eq('无限弹射击不消耗 buff', buffAtFbEnd, true);
}

summary('百暴回归（Miranda S2 P3 停火打法）');
