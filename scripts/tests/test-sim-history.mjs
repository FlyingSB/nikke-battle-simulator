/**
 * 模拟结果记录（src/ui/sim-history.js）回归测试 —— 纯函数，内存 storage，无 I/O。
 *
 * 覆盖：
 *   buildHistoryRecord — 队伍配置与结果按下标配对、只保留总伤害（无技能构成）、队伍快照
 *   addHistoryRecord   — 新记录置顶、上限截断、不修改原数组
 *   sanitizeHistory / mergeHistory / readLegacyHistory — 校验、合并去重、旧版 localStorage 迁移读取
 * IndexedDB 读写（loadHistory / saveHistory）仅在浏览器中运行，不在此测试。
 *
 * Run: node scripts/tests/test-sim-history.mjs
 */

import {
  SIM_HISTORY_KEY, SIM_HISTORY_MAX,
  buildHistoryRecord, addHistoryRecord, sanitizeHistory, mergeHistory, readLegacyHistory,
} from '../../src/ui/sim-history.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

function memStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

const squadConfig = [
  { characterId: 10, name: 'Alpha', position: 0, classType: 'Attacker',  element: 'Fire',  weaponType: 'AR', burstStep: 'Step1', isFocus: false },
  { characterId: 20, name: 'Beta',  position: 2, classType: 'Supporter', element: 'Water', weaponType: 'SR', burstStep: 'Step3', isFocus: true  },
];
const result = {
  iterations: 30, totalDamage: 300, burstCount: 5.5,
  units: [
    { id: 0, name: 'Alpha', totalDamage: 100, skillDamage: { 'Normal Attack': 100 } },
    { id: 1, name: 'Beta',  totalDamage: 200, skillDamage: { 'Burst': 200 } },
  ],
};

// ── T1: buildHistoryRecord ────────────────────────────────────────────────
section('T1: buildHistoryRecord');
{
  const rec = buildHistoryRecord({ squadConfig, result, enemy: { element: 'Iron', type: 'Boss' }, level: 400, now: 1000 });
  eq('createdAt', rec.createdAt, 1000);
  eq('iterations', rec.iterations, 30);
  eq('totalDamage', rec.totalDamage, 300);
  eq('burstCount', rec.burstCount, 5.5);
  eq('level', rec.level, 400);
  eq('enemy element', rec.enemy.element, 'Iron');
  eq('units length', rec.units.length, 2);
  eq('unit[1] characterId', rec.units[1].characterId, 20);
  eq('unit[1] position', rec.units[1].position, 2);
  eq('unit[1] burstStep', rec.units[1].burstStep, 'Step3');
  eq('unit[1] isFocus', rec.units[1].isFocus, true);
  eq('unit[1] totalDamage', rec.units[1].totalDamage, 200);
  eq('no skill breakdown stored', 'skillDamage' in rec.units[0], false);
  eq('id is string', typeof rec.id, 'string');
  eq('no team snapshot by default', 'team' in rec, false);

  const team = [{ resourceId: 10, skills: [10, 10, 10] }, { resourceId: null }];
  const withTeam = buildHistoryRecord({ squadConfig, result, enemy: {}, level: 1, team, focusSlot: 1, now: 1 });
  eq('team snapshot stored', withTeam.team[0].resourceId, 10);
  eq('focusSlot stored', withTeam.focusSlot, 1);
}

// ── T2: addHistoryRecord ──────────────────────────────────────────────────
section('T2: addHistoryRecord');
{
  const list = [{ id: 'a' }, { id: 'b' }];
  const next = addHistoryRecord(list, { id: 'c' });
  eq('newest first', next[0].id, 'c');
  eq('original untouched', list.length, 2);

  let big = [];
  for (let i = 0; i < SIM_HISTORY_MAX + 5; i++) big = addHistoryRecord(big, { id: `r${i}` });
  eq('capped at max', big.length, SIM_HISTORY_MAX);
  eq('keeps latest', big[0].id, `r${SIM_HISTORY_MAX + 4}`);
  eq('drops oldest', big[big.length - 1].id, 'r5');
}

// ── T3: sanitizeHistory / readLegacyHistory ───────────────────────────────
section('T3: sanitize & legacy read');
{
  const rec = buildHistoryRecord({ squadConfig, result, enemy: { element: 'Fire' }, level: 1, now: 42 });
  eq('invalid entries dropped', sanitizeHistory([rec, { id: 1 }, null, 'x']).length, 1);
  eq('non-array → []', sanitizeHistory({ a: 1 }).length, 0);
  eq('undefined → []', sanitizeHistory(undefined).length, 0);

  const legacy = readLegacyHistory(memStorage({ [SIM_HISTORY_KEY]: JSON.stringify([rec]) }));
  eq('legacy round-trip length', legacy.length, 1);
  eq('legacy unit damage', legacy[0].units[0].totalDamage, 100);
  eq('legacy empty storage → []', readLegacyHistory(memStorage()).length, 0);
  eq('legacy no storage → []', readLegacyHistory(undefined).length, 0);

  // 损坏 JSON 预期会打印 console.error，临时静音
  const logError = console.error;
  console.error = () => {};
  eq('legacy corrupt JSON → []', readLegacyHistory(memStorage({ [SIM_HISTORY_KEY]: '{oops' })).length, 0);
  console.error = logError;
}

// ── T4: mergeHistory ──────────────────────────────────────────────────────
section('T4: mergeHistory');
{
  const r = (id, t) => ({ id, createdAt: t, units: [] });
  const a = [r('x', 30), r('y', 10)];
  const b = [r('y', 10), r('z', 20)];
  const m = mergeHistory(a, b);
  eq('dedupe by id', m.length, 3);
  eq('sorted newest first', m.map(x => x.id).join(','), 'x,z,y');
  eq('inputs untouched', a.length + b.length, 4);
  eq('capped', mergeHistory(a, b, 2).length, 2);
}

summary('SimHistory');
