/**
 * 数据加载器 — 从 CDN 拉取数据并缓存到 localStorage。
 * 后续加载时优先返回缓存，并在后台刷新。
 */
import { DATA_URLS, CUBE_URLS, FAVORITE_ITEM_URLS, BATTLE_DATA_KEYS, MANIFEST_VERSION } from './manifest.js';
import { getRoleDataUrl } from './blablalink-url.js';

const CACHE_PREFIX = `nikke_sim_${MANIFEST_VERSION}_`;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时

/** @type {Record<string, any>} */
const _store = {};

/**
 * 加载所有战斗所需的数据文件。
 * @param {(key: string, done: number, total: number) => void} onProgress
 * @returns {Promise<Record<string, any>>}
 */
export async function loadAllData(onProgress) {
  const keys = BATTLE_DATA_KEYS;
  let done = 0;

  await Promise.all(keys.map(async (key) => {
    _store[key] = await loadOne(key);
    done++;
    onProgress?.(key, done, keys.length);
  }));

  return _store;
}

/** 按 key 获取已加载的数据（在 loadAllData 完成之后）。 */
export function getData(key) {
  return _store[key];
}

/** 按 key 注入数据 — 供 Node.js 测试脚本使用，可绕过 localStorage。 */
export function setData(key, value) {
  _store[key] = value;
}

/**
 * 按新花名册 resource_id 加载单个角色的详情 JSON。
 * URL 由 getRoleDataUrl() 动态计算，无需维护静态映射表。
 * TODO: 多语言支持只实现了 'en'，其他语言留待后续扩展。
 * @param {number|string} resourceId   新花名册 resource_id（例如 Little Mermaid 为 513）
 * @returns {Promise<object>}
 */
export async function loadNikke(resourceId) {
  const id  = Number(resourceId);
  const url = getRoleDataUrl(id, 'en');
  return _loadByUrl('nikke', id, url);
}

/**
 * 按 resource_id 加载和谐魔方 JSON。
 * @param {number|string} resourceId
 * @returns {Promise<object>}
 */
export async function loadCube(resourceId) {
  const id  = Number(resourceId);
  const url = CUBE_URLS[id];
  if (!url) throw new Error(`No CDN URL for cube resource_id ${id}`);
  return _loadByUrl('cube', id, url);
}

/**
 * 按 resource_id 加载收藏品 JSON。
 * @param {number|string} resourceId
 * @returns {Promise<object>}
 */
export async function loadFavoriteItem(resourceId) {
  const id  = Number(resourceId);
  const url = FAVORITE_ITEM_URLS[id];
  if (!url) throw new Error(`No CDN URL for favorite item resource_id ${id}`);
  return _loadByUrl('fav', id, url);
}

/** 强制从 CDN 刷新单个 key。 */
export async function refreshOne(key) {
  const data = await fetchFromCDN(key);
  _store[key] = data;
  return data;
}

// ─── 内部实现 ───────────────────────────────────────────────────────────────

/** 通用加载器，按 prefix/id 缓存并 fetch 指定 URL。调用方负责传入 Number 类型的 resourceId。 */
async function _loadByUrl(prefix, resourceId, url) {
  const cacheKey = CACHE_PREFIX + `${prefix}_${resourceId}`;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL_MS) return data;
    }
  } catch { /* 忽略 */ }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${prefix} ${id}: ${res.status}`);
  const data = await res.json();

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* 存储已满 */ }

  return data;
}

async function loadOne(key) {
  const cached = readCache(key);
  if (cached) {
    // 若过期则后台刷新
    if (isCacheStale(key)) {
      fetchFromCDN(key).then(data => writeCache(key, data)).catch(() => {});
    }
    return cached;
  }
  const data = await fetchFromCDN(key);
  writeCache(key, data);
  return data;
}

async function fetchFromCDN(key) {
  const url = DATA_URLS[key];
  if (!url) throw new Error(`Unknown data key: ${key}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${key}: ${res.status}`);
  const json = await res.json();
  // 部分文件将数据包裹为 { version, records }；统一归一化为数组
  return Array.isArray(json) ? json : (json.records ?? json);
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data } = JSON.parse(raw);
    return data;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      data,
      ts: Date.now(),
    }));
  } catch (e) {
    // localStorage 已满 — 清理旧条目后重试
    clearOldCacheEntries();
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* 静默放弃 */ }
  }
}

function isCacheStale(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return true;
    const { ts } = JSON.parse(raw);
    return Date.now() - ts > CACHE_TTL_MS;
  } catch {
    return true;
  }
}

function clearOldCacheEntries() {
  const prefix = 'nikke_sim_';
  Object.keys(localStorage)
    .filter(k => k.startsWith(prefix) && !k.startsWith(CACHE_PREFIX))
    .forEach(k => localStorage.removeItem(k));
}
