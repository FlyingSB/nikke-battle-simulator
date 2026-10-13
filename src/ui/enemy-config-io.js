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
//       { "startTimeS": 10, "type": "hidden",  "value": "HIDDEN" },
//       { "startTimeS": 12, "type": "lateral", "value": "SLOW", "endTimeS": 15 },  // 横向移动区间
//       { "startTimeS": 30, "type": "jump",    "value": 20 }                       // 跳起（固定 1.85s），落地距离 20
//     ]
//   }
// }
// 命中参数（core0 / d0 / hitCoef / sgHitRate）属于模拟选项，不随敌人配置导出；
// 旧文件中若带有这些字段（含已移除的 rlCoreRate），导入时忽略。

export const ENEMY_CONFIG_FORMAT  = 'nikke-enemy-config';
export const ENEMY_CONFIG_VERSION = 1;

const ELEMENTS        = ['Fire', 'Water', 'Wind', 'Electric', 'Iron'];
const ACTION_TYPES    = ['def', 'core', 'position', 'hidden', 'lateral', 'jump'];
const CORE_VALUES     = ['EXPOSED', 'PROTECTED', 'PARTS_CORE', 'NONE'];
// 横向移动速度档（目前仅「慢」）
export const LATERAL_SPEEDS = ['SLOW'];

/**
 * 「跳起」行动固定时长（射击场 BIGARMS 实测，dev/game-data.md）：
 *   [0, 1s)     起跳：全队停止攻击，敌人仍可被已打出的技能命中（引擎区段 JUMP）
 *   [1s, 1.85s) 空中 1–1.7s + 落地 1.7–1.85s：完全不可攻击，DoT 仍造成伤害（引擎区段 HIDDEN）
 *   1.85s       行动结束，敌人落在目标距离（value）
 */
export const JUMP_HITTABLE_SECS = 1;
export const JUMP_DURATION_SECS = 1.85;

/**
 * 由敌人行动构建引擎相位表（startTick 升序）：
 *   position → 距离；hidden → HIDDEN；jump → JUMP @0 / HIDDEN @1s / 目标距离 @1.85s。
 * 数字字符串统一转数字（引擎 phaseToDistance 再把旧 NEAR/MID/FAR 标签映射为默认距离）。
 * @param {{ startTimeS: number|string, type: string, value: * }[]} actions
 * @param {number} tickRate
 * @returns {{ startTick: number, zone: number|string }[]}
 */
export function buildEnemyPhases(actions, tickRate) {
  const toTick = s => Math.round(Number(s) * tickRate);
  const toZone = v => ((typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) ? Number(v) : v);
  const phases = [];
  for (const a of actions) {
    if (a.type === 'position') phases.push({ startTick: toTick(a.startTimeS), zone: toZone(a.value) });
    else if (a.type === 'hidden') phases.push({ startTick: toTick(a.startTimeS), zone: 'HIDDEN' });
    else if (a.type === 'jump') {
      const t0 = Number(a.startTimeS);
      phases.push({ startTick: toTick(t0), zone: 'JUMP' });
      phases.push({ startTick: toTick(t0 + JUMP_HITTABLE_SECS), zone: 'HIDDEN' });
      phases.push({ startTick: toTick(t0 + JUMP_DURATION_SECS), zone: toZone(a.value) });
    }
  }
  // 同一 tick 保持行动顺序（Array.prototype.sort 稳定）
  return phases.sort((x, y) => x.startTick - y.startTick);
}
const FIXED_TYPES     = ['def', 'core', 'position'];
const MAX_START_TIME  = 180;
const MAX_DISTANCE    = 100;

/**
 * 取行动的可序列化字段（不含内部 id）：{ startTimeS, type, value }，横向移动额外带 endTimeS。
 * 导出、预设保存共用。
 * @param {{ startTimeS: number, type: string, value: *, endTimeS?: number }} a
 */
export function pickActionFields({ startTimeS, type, value, endTimeS }) {
  return type === 'lateral' ? { startTimeS, type, value, endTimeS } : { startTimeS, type, value };
}

/**
 * 由当前敌人状态构建导出对象（不含内部 id / _nextId）。
 * @param {{ element: string, type: string,
 *           actions: { startTimeS: number, type: string, value: *, endTimeS?: number }[] }} enemy
 */
export function buildEnemyConfigExport(enemy) {
  return {
    format:  ENEMY_CONFIG_FORMAT,
    version: ENEMY_CONFIG_VERSION,
    enemy: {
      element: enemy.element,
      type:    enemy.type,
      actions: enemy.actions.map(pickActionFields),
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
    case 'jump':
      return isFiniteNum(a.value) && a.value >= 0 && a.value <= MAX_DISTANCE
        ? null : fail('enemyIo.err.jumpValue', { row });
    case 'lateral':
      if (!LATERAL_SPEEDS.includes(a.value)) return fail('enemyIo.err.lateralValue', { row });
      return isFiniteNum(a.endTimeS) && a.endTimeS > a.startTimeS && a.endTimeS <= MAX_START_TIME
        ? null : fail('enemyIo.err.lateralEnd', { row });
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
      actions: e.actions.map(pickActionFields),
    },
  };
}
