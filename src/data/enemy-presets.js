// ─── 内置敌人配置预设 ────────────────────────────────────────────────────────
// 随项目发布、不可删除 / 改名的敌人配置。首个预设同时作为新用户的默认敌人配置。
// 行动格式与敌人配置导出一致：{ startTimeS, type, value }；横向移动额外带 endTimeS（[start, end) 区间）。

/**
 * 射击场 BIGARMS（联盟射击场训练目标）。
 * 实测（2026-10-13，Anis: Star 单人，无全爆裂暂停，录像第 604 帧开战）：帧号 − 604 后 / 60 得秒数。
 *   · 隐藏：31.77 / 67.43 / 106.25 / 141.93 / 174.48s，各约 1.8s；174.48s 之后战斗实质结束。
 *   · 距离：开场 30 → 20 → 50 → 40 → 20（每次隐藏结束时切换）。
 *   · 横向移动（慢）：23 段，距离 50 阶段全程移动。
 */
const LATERAL_SLOW_SPANS = [
  [0, 2.95], [6.48, 6.95], [10.47, 12.9], [16.4, 16.87], [20.38, 22.78], [26.32, 26.78],
  [30.3, 31.77], [34.52, 35.48], [39.15, 46.48], [49.82, 57.43], [60.92, 67.43],
  [70.2, 106.25], [108.93, 115.03], [118.55, 126], [129.5, 136.97], [140.68, 141.93],
  [144.7, 145.68], [149.18, 149.67], [153.18, 155.57], [159.05, 159.57], [163.1, 165.5],
  [169.02, 169.5], [173, 174.48],
];

const RANGE_BIGARMS_ACTIONS = [
  { startTimeS: 0,      type: 'def',      value: 100 },
  { startTimeS: 0,      type: 'core',     value: 'EXPOSED' },
  { startTimeS: 0,      type: 'position', value: 30 },
  { startTimeS: 31.77,  type: 'hidden',   value: 'HIDDEN' },
  { startTimeS: 33.57,  type: 'position', value: 20 },
  { startTimeS: 67.43,  type: 'hidden',   value: 'HIDDEN' },
  { startTimeS: 69.27,  type: 'position', value: 50 },
  { startTimeS: 106.25, type: 'hidden',   value: 'HIDDEN' },
  { startTimeS: 108.08, type: 'position', value: 40 },
  { startTimeS: 141.93, type: 'hidden',   value: 'HIDDEN' },
  { startTimeS: 143.77, type: 'position', value: 20 },
  { startTimeS: 174.48, type: 'hidden',   value: 'HIDDEN' },
  ...LATERAL_SLOW_SPANS.map(([s, e]) => ({ startTimeS: s, type: 'lateral', value: 'SLOW', endTimeS: e })),
];

/** 前 3 条固定行（def / core / position @0）在前，其余按时间升序（同一时刻保持原顺序）。 */
function orderActions(actions) {
  return [...actions.slice(0, 3), ...actions.slice(3).sort((a, b) => a.startTimeS - b.startTimeS)];
}

export const BUILTIN_ENEMY_PRESETS = Object.freeze([
  {
    id:      'builtin_range_bigarms',
    nameKey: 'enemy.preset.rangeBigarms',
    builtin: true,
    config: {
      element: 'Fire',
      type:    'Boss',
      actions: orderActions(RANGE_BIGARMS_ACTIONS),
    },
  },
]);

/** 默认敌人配置（新用户 / 无存档时使用）。 */
export const DEFAULT_ENEMY_PRESET = BUILTIN_ENEMY_PRESETS[0];
