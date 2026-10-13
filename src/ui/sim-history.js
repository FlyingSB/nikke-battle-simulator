/**
 * 模拟结果记录：每次模拟完成后保存一条精简摘要（队伍组成 + 各角色总伤害 + 队伍配置快照），
 * 最多保留最近 SIM_HISTORY_MAX 条，持久化到 IndexedDB（见下方「IndexedDB 持久化」）。
 *
 * 不含技能伤害构成与战斗日志；队伍配置快照使单条约 6KB，100 条约 600KB。
 * 记录构建 / 合并 / 校验为纯函数，可在 Node 中测试；IndexedDB 读写仅在浏览器中运行。
 */

import { createIdbKv } from '../data/idb-kv.js';

/** 旧版（localStorage）记录的键，仅用于迁移 */
export const SIM_HISTORY_KEY = 'nikke-sim-history-v1';
export const SIM_HISTORY_MAX = 100;

/**
 * 由一次模拟的输入配置与平均结果构建记录。
 * result.units 与 squadConfig 同序（引擎按 config.squad 顺序建队），按下标配对。
 *
 * team / focusSlot：模拟启动时 5 个槽位的完整配置快照（store._slotSnapshot 格式），
 * 用于在记录弹窗中点击整行恢复队伍；缺省时记录只能按角色与站位重建。
 *
 * @param {{ squadConfig: object[], result: object, enemy: { element: string, type: string },
 *           level: number, team?: object[], focusSlot?: number|null, now?: number }} input
 * @returns {object} 记录
 */
export function buildHistoryRecord({ squadConfig, result, enemy, level, team, focusSlot = null, now = Date.now() }) {
  const units = (result?.units ?? []).map((u, i) => {
    const cfg = squadConfig[i] ?? {};
    return {
      characterId: cfg.characterId ?? null,
      name:        cfg.name ?? u.name,
      position:    cfg.position ?? i,
      classType:   cfg.classType ?? null,
      element:     cfg.element ?? null,
      weaponType:  cfg.weaponType ?? u.weaponType ?? null,
      burstStep:   cfg.burstStep ?? null,
      isFocus:     !!cfg.isFocus,
      totalDamage: Number(u.totalDamage) || 0,
    };
  });
  return {
    id:          `sim_${now}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt:   now,
    iterations:  result?.iterations ?? 1,
    totalDamage: Number(result?.totalDamage) || 0,
    burstCount:  Number(result?.burstCount) || 0,
    level,
    enemy:       { element: enemy?.element ?? null, type: enemy?.type ?? null },
    units,
    ...(Array.isArray(team) ? { team, focusSlot } : {}),
  };
}

/** 新记录置顶并截断到上限，返回新数组（不修改原数组） */
export function addHistoryRecord(list, record, max = SIM_HISTORY_MAX) {
  return [record, ...list].slice(0, max);
}

/** 粗略校验单条记录结构，丢弃损坏条目 */
function isValidRecord(r) {
  return r && typeof r === 'object'
    && typeof r.id === 'string'
    && Number.isFinite(r.createdAt)
    && Array.isArray(r.units);
}

/** 校验并规整读取到的数据：非数组 → []，丢弃损坏条目，截断到上限 */
export function sanitizeHistory(parsed) {
  return Array.isArray(parsed) ? parsed.filter(isValidRecord).slice(0, SIM_HISTORY_MAX) : [];
}

/** 合并两份记录：按 id 去重，按时间从新到旧排序并截断到上限（不修改入参） */
export function mergeHistory(a, b, max = SIM_HISTORY_MAX) {
  const byId = new Map();
  for (const r of [...a, ...b]) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()].sort((x, y) => y.createdAt - x.createdAt).slice(0, max);
}

/** 读取旧版保存在 localStorage 中的记录（迁移用）；缺失或损坏时返回 [] */
export function readLegacyHistory(storage) {
  try {
    const raw = storage?.getItem(SIM_HISTORY_KEY);
    return raw ? sanitizeHistory(JSON.parse(raw)) : [];
  } catch (err) {
    console.error('旧版模拟记录读取失败，已忽略：', err);
    return [];
  }
}

// ── IndexedDB 持久化 ─────────────────────────────────────────────────────────
// localStorage 配额小（曾被 CDN 缓存占满导致写入失败），记录含队伍配置快照，故存 IndexedDB。
// 整个记录数组存为单个值：100 条约数百 KB，整体读写简单且原子。

const _idb    = createIdbKv('nikke-sim-history');
const IDB_KEY = 'records';

/**
 * 写入 IndexedDB；失败时返回 false（记录仍保留在内存中）。
 * 先转为纯 JSON 数据：Alpine 响应式代理无法被结构化克隆。
 */
export async function saveHistory(list) {
  try {
    await _idb.set(IDB_KEY, JSON.parse(JSON.stringify(list)));
    return true;
  } catch (err) {
    console.error('模拟记录保存失败：', err);
    return false;
  }
}

/**
 * 读取记录；首次运行时把旧版 localStorage 中的记录迁移进来（迁移写入成功后删除旧键）。
 * IndexedDB 不可用时回退为只读旧版记录。
 * @param {Storage} [legacyStorage]  旧版记录所在的 storage（浏览器中为 localStorage）
 */
export async function loadHistory(legacyStorage) {
  const legacy = readLegacyHistory(legacyStorage);
  try {
    let list = sanitizeHistory(await _idb.get(IDB_KEY));
    if (legacy.length) {
      list = mergeHistory(list, legacy);
      if (await saveHistory(list)) legacyStorage.removeItem(SIM_HISTORY_KEY);
    }
    return list;
  } catch (err) {
    console.error('模拟记录读取失败（IndexedDB 不可用），仅显示旧版记录：', err);
    return legacy;
  }
}
