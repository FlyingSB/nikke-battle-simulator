/**
 * 简体中文游戏文本加载器 — 读取 scripts/download-zh-static.mjs 生成的 src/data/static/zh-CN/。
 *
 * 只用于界面显示：引擎始终使用英文数据，这里返回的是叠加了中文文本的「显示用副本」。
 * 文件缺失（尚未运行下载脚本）时静默回退为英文，不影响模拟。
 */
import { applyTextPatch } from './text-patch.js';

// 相对本模块解析，与 loader.js 的 LOCAL_BASE 一致（支持子路径部署）
const ZH_BASE = new URL('./static/zh-CN', import.meta.url).href;

const EMPTY_NAMES = Object.freeze({ characters: {}, cubes: {}, favorites: {} });

let _namesPromise = null;
/** @type {Map<string, Promise<object|null>>} */
const _patchCache = new Map();

async function _fetchJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * 名称表：{ characters, cubes, favorites }，键为 resource_id，值为简体名称。
 * @returns {Promise<{characters: Record<string,string>, cubes: Record<string,string>, favorites: Record<string,string>}>}
 */
export function loadZhNames() {
  _namesPromise ??= _fetchJson(`${ZH_BASE}/names.json`).then(d => ({ ...EMPTY_NAMES, ...(d ?? {}) }));
  return _namesPromise;
}

/**
 * 单个对象的中文文本补丁。
 * @param {'nikke'|'cubes'|'favorites'} kind
 * @param {number|string} id  角色 / 魔方为 resource_id，珍藏品为珍藏品 id
 * @returns {Promise<object|null>}
 */
export function loadZhPatch(kind, id) {
  const key = `${kind}/${Number(id)}`;
  if (!_patchCache.has(key)) _patchCache.set(key, _fetchJson(`${ZH_BASE}/${key}.json`));
  return _patchCache.get(key);
}

/**
 * 叠加中文文本，返回显示用副本（不修改英文原数据）；无补丁时返回 null。
 * 补丁附带的具名效果对照表（英文效果名 → 简体）保留在副本的 _terms 字段，供战斗日志翻译 Buff 名。
 * @param {object|null} base
 * @param {object|null} patch
 * @returns {object|null}
 */
export function localizeData(base, patch) {
  if (!base || !patch) return null;
  const out = applyTextPatch(base, patch);
  return patch._terms ? { ...out, _terms: patch._terms } : out;
}
