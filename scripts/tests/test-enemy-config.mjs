/**
 * 敌人配置回归测试 —— 纯函数，无 CDN，无 I/O。
 *
 * 覆盖：
 *   pickActionFields / buildEnemyConfigExport — 横向移动（lateral）导出带 endTimeS，其余类型不带
 *   parseEnemyConfig                         — lateral 类型校验（速度档、结束时间）
 *   BUILTIN_ENEMY_PRESETS                     — 内置「射击场BIGARMS」可通过导入校验、结构符合实测
 *
 * Run: node scripts/tests/test-enemy-config.mjs
 */

import { pickActionFields, buildEnemyConfigExport, parseEnemyConfig, buildEnemyPhases,
         JUMP_HITTABLE_SECS, JUMP_DURATION_SECS } from '../../src/ui/enemy-config-io.js';
import { BUILTIN_ENEMY_PRESETS, DEFAULT_ENEMY_PRESET } from '../../src/data/enemy-presets.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

const FIXED = [
  { startTimeS: 0, type: 'def',      value: 100 },
  { startTimeS: 0, type: 'core',     value: 'EXPOSED' },
  { startTimeS: 0, type: 'position', value: 30 },
];
const wrap = actions => JSON.stringify({
  format: 'nikke-enemy-config', version: 1,
  enemy: { element: 'Fire', type: 'Boss', actions },
});

section('T1: pickActionFields / 导出');
{
  eq('lateral 带 endTimeS',
    JSON.stringify(pickActionFields({ id: 9, startTimeS: 1, type: 'lateral', value: 'SLOW', endTimeS: 2 })),
    JSON.stringify({ startTimeS: 1, type: 'lateral', value: 'SLOW', endTimeS: 2 }));
  eq('其他类型不带 endTimeS / id',
    JSON.stringify(pickActionFields({ id: 4, startTimeS: 3, type: 'hidden', value: 'HIDDEN', endTimeS: 5 })),
    JSON.stringify({ startTimeS: 3, type: 'hidden', value: 'HIDDEN' }));
  const exp = buildEnemyConfigExport({ element: 'Fire', type: 'Boss',
    actions: [...FIXED, { startTimeS: 1, type: 'lateral', value: 'SLOW', endTimeS: 2 }] });
  eq('导出后可原样导入', parseEnemyConfig(JSON.stringify(exp)).ok, true);
}

section('T2: parseEnemyConfig — lateral 校验');
{
  const lat = extra => wrap([...FIXED, { startTimeS: 10, type: 'lateral', value: 'SLOW', endTimeS: 12, ...extra }]);
  eq('合法 lateral', parseEnemyConfig(lat({})).ok, true);
  eq('导入保留 endTimeS', parseEnemyConfig(lat({})).config.actions[3].endTimeS, 12);
  eq('未知速度档 → 错误', parseEnemyConfig(lat({ value: 'FAST' })).error?.key, 'enemyIo.err.lateralValue');
  eq('缺少 endTimeS → 错误', parseEnemyConfig(lat({ endTimeS: undefined })).error?.key, 'enemyIo.err.lateralEnd');
  eq('endTimeS ≤ 开始 → 错误', parseEnemyConfig(lat({ endTimeS: 10 })).error?.key, 'enemyIo.err.lateralEnd');
  eq('endTimeS > 180 → 错误', parseEnemyConfig(lat({ endTimeS: 181 })).error?.key, 'enemyIo.err.lateralEnd');
}

section('T2b: 跳起 jump — 校验与相位展开');
{
  const jmp = v => wrap([...FIXED, { startTimeS: 10, type: 'jump', value: v }]);
  eq('合法 jump', parseEnemyConfig(jmp(50)).ok, true);
  eq('距离越界 → 错误', parseEnemyConfig(jmp(101)).error?.key, 'enemyIo.err.jumpValue');
  eq('非数字 → 错误', parseEnemyConfig(jmp('HIDDEN')).error?.key, 'enemyIo.err.jumpValue');

  const phases = buildEnemyPhases([...FIXED, { startTimeS: 10, type: 'jump', value: 50 },
    { startTimeS: 20, type: 'hidden', value: 'HIDDEN' }, { startTimeS: 22, type: 'position', value: '40' }], 60);
  eq('展开：开场 30 → JUMP@600 → HIDDEN@660 → 50@711 → HIDDEN@1200 → 40@1320',
    phases.map(p => `${p.zone}@${p.startTick}`).join(','),
    '30@0,JUMP@600,HIDDEN@660,50@711,HIDDEN@1200,40@1320');
  eq('固定时长', `${JUMP_HITTABLE_SECS}/${JUMP_DURATION_SECS}`, '1/1.85');
}

section('T3: 内置预设「射击场BIGARMS」');
{
  const p = DEFAULT_ENEMY_PRESET;
  eq('默认预设即首个内置预设', p, BUILTIN_ENEMY_PRESETS[0]);
  eq('名称键', p.nameKey, 'enemy.preset.rangeBigarms');
  const exp = buildEnemyConfigExport(p.config);
  eq('通过导入校验', parseEnemyConfig(JSON.stringify(exp)).ok, true);
  const acts = p.config.actions;
  eq('跳起 5 次，无隐藏', acts.filter(a => a.type === 'jump').length + '/' + acts.filter(a => a.type === 'hidden').length, '5/0');
  eq('横向移动 23 段', acts.filter(a => a.type === 'lateral').length, 23);
  eq('仅开场一条距离', acts.filter(a => a.type === 'position').map(a => a.value).join(','), '30');
  eq('落地距离依次 20 → 50 → 40 → 20 → 50',
    acts.filter(a => a.type === 'jump').map(a => a.value).join(','), '20,50,40,20,50');
  const dyn = acts.slice(3).map(a => a.startTimeS);
  eq('动态行按时间升序', dyn.every((t, i) => i === 0 || dyn[i - 1] <= t), true);
  // 距离 50 阶段（69.27s 起）全程横向移动，直到 106.25s 隐藏
  eq('距离 50 阶段全程移动',
    acts.some(a => a.type === 'lateral' && a.startTimeS <= 70.2 && a.endTimeS === 106.25), true);
}

summary('Enemy config tests');
