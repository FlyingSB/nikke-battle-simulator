// ─── 敌人配置导入 / 导出 ──────────────────────────────────────────────────────
// 纯函数模块（无 DOM / Alpine 依赖）：构建导出 JSON、解析并严格校验导入 JSON。
//
// 文件格式（version 1）：
// {
//   "format":  "nikke-enemy-config",
//   "version": 1,
//   "enemy": {
//     "element": "Iron",                 // Fire / Water / Wind / Electric / Iron
//     "type":    "Boss",
//     "actions": [                        // 前 3 条固定：def / core / position，时间为 0
//       { "startTimeS": 0, "type": "def",      "value": 100 },
//       { "startTimeS": 0, "type": "core",     "value": "EXPOSED" },
//       { "startTimeS": 0, "type": "position", "value": 35 },
//       { "startTimeS": 10, "type": "hidden",  "value": "HIDDEN" }
//     ]
//   }
// }
// 命中参数（core0 / d0 / hitCoef / rlCoreRate / sgHitRate）属于模拟选项，不随敌人配置导出；
// 旧文件中若带有这些字段，导入时忽略。

export const ENEMY_CONFIG_FORMAT  = 'nikke-enemy-config';
export const ENEMY_CONFIG_VERSION = 1;

const ELEMENTS        = ['Fire', 'Water', 'Wind', 'Electric', 'Iron'];
const ACTION_TYPES    = ['def', 'core', 'position', 'hidden'];
const CORE_VALUES     = ['EXPOSED', 'PROTECTED', 'PARTS_CORE', 'NONE'];
const FIXED_TYPES     = ['def', 'core', 'position'];
const MAX_START_TIME  = 180;
const MAX_DISTANCE    = 100;

/**
 * 由当前敌人状态构建导出对象（不含内部 id / _nextId）。
 * @param {{ element: string, type: string,
 *           actions: { startTimeS: number, type: string, value: * }[] }} enemy
 */
export function buildEnemyConfigExport(enemy) {
  return {
    format:  ENEMY_CONFIG_FORMAT,
    version: ENEMY_CONFIG_VERSION,
    enemy: {
      element: enemy.element,
      type:    enemy.type,
      actions: enemy.actions.map(({ startTimeS, type, value }) => ({ startTimeS, type, value })),
    },
  };
}

const isFiniteNum = v => typeof v === 'number' && Number.isFinite(v);
const fail = (key, params = {}) => ({ ok: false, error: { key, params } });

/** 校验单条行动值；合法返回 null，否则返回错误。 */
function validateActionValue(a, row) {
  switch (a.type) {
    case 'def':
      return isFiniteNum(a.value) && a.value >= 0 ? null : fail('enemyIo.err.defValue', { row });
    case 'core':
      return CORE_VALUES.includes(a.value) ? null : fail('enemyIo.err.coreValue', { row });
    case 'position':
      return isFiniteNum(a.value) && a.value >= 0 && a.value <= MAX_DISTANCE
        ? null : fail('enemyIo.err.positionValue', { row });
    default: // hidden
      return a.value === 'HIDDEN' ? null : fail('enemyIo.err.hiddenValue', { row });
  }
}

/** 校验行动列表；合法返回 null，否则返回错误。 */
function validateActions(actions) {
  if (!Array.isArray(actions) || actions.length < FIXED_TYPES.length) {
    return fail('enemyIo.err.actions');
  }
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const row = i + 1;
    if (!a || typeof a !== 'object') return fail('enemyIo.err.actionShape', { row });
    if (!ACTION_TYPES.includes(a.type)) return fail('enemyIo.err.actionType', { row });
    if (!isFiniteNum(a.startTimeS) || a.startTimeS < 0 || a.startTimeS > MAX_START_TIME) {
      return fail('enemyIo.err.startTime', { row });
    }
    // 前 3 条为固定初始行：类型依次为 def / core / position，时间必须为 0
    if (i < FIXED_TYPES.length && (a.type !== FIXED_TYPES[i] || a.startTimeS !== 0)) {
      return fail('enemyIo.err.fixedRow', { row, type: FIXED_TYPES[i] });
    }
    const valueErr = validateActionValue(a, row);
    if (valueErr) return valueErr;
  }
  return null;
}

/**
 * 解析并校验导入文本。全部校验通过才返回配置，调用方据此决定是否覆盖当前状态。
 * @param {string} text
 * @returns {{ ok: true, config: object } | { ok: false, error: { key: string, params: object } }}
 */
export function parseEnemyConfig(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('enemyIo.err.json');
  }
  if (!data || typeof data !== 'object' || data.format !== ENEMY_CONFIG_FORMAT) {
    return fail('enemyIo.err.format');
  }
  if (data.version !== ENEMY_CONFIG_VERSION) {
    return fail('enemyIo.err.version', { v: String(data.version) });
  }
  const e = data.enemy;
  if (!e || typeof e !== 'object') return fail('enemyIo.err.format');
  if (!ELEMENTS.includes(e.element)) return fail('enemyIo.err.element');
  if (typeof e.type !== 'string' || e.type === '') return fail('enemyIo.err.enemyType');

  const actionsErr = validateActions(e.actions);
  if (actionsErr) return actionsErr;

  return {
    ok: true,
    config: {
      element: e.element,
      type:    e.type,
      actions: e.actions.map(({ startTimeS, type, value }) => ({ startTimeS, type, value })),
    },
  };
}
