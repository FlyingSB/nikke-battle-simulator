/**
 * 数据加载器 — 始终优先读取项目内的静态快照（src/data/static/），
 * 文件缺失时回退到 CDN，CDN 结果缓存到 IndexedDB（库 nikke-sim-cache）。
 * 静态快照不进缓存：更新快照（如新增角色）后刷新页面即生效。
 *
 * 缓存曾存于 localStorage，约 5MB 配额会被数十个角色 JSON 占满，导致界面状态 / 语言设置等
 * 写入失败；现改存 IndexedDB，启动时删除 localStorage 中的旧缓存键（缓存可随时由静态文件重建）。
 *
 * 静态快照由 `node scripts/download-all-static.mjs` 生成，
 * 生成后非必要不再访问 CDN。
 */
import { DATA_URLS, CUBE_URLS, FAVORITE_ITEM_URLS, BATTLE_DATA_KEYS, MANIFEST_VERSION } from './manifest.js';
import { createIdbKv } from './idb-kv.js';

const LEGACY_LS_PREFIX = 'nikke_sim_';
const CACHE_PREFIX = `${LEGACY_LS_PREFIX}${MANIFEST_VERSION}_`;
const _cache = createIdbKv('nikke-sim-cache');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时
// 静态快照基路径：相对本模块解析，部署在子路径（如 GitHub Pages 的 /<仓库名>/）下同样可用
const LOCAL_BASE   = new URL('./static', import.meta.url).href;

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
  purgeLegacyLocalStorageCache();
  pruneOldCacheEntries();

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

/** 按 key 注入数据 — 供 Node.js 测试脚本使用，可绕过缓存与网络加载。 */
export function setData(key, value) {
  _store[key] = value;
}

/**
 * 按新花名册 resource_id 加载单个角色的详情 JSON。
 * 只读取本地静态快照（src/data/static/nikke/<id>.json），文件缺失时抛出错误。
 * 如需添加新角色，请先运行 scripts/download-all-static.mjs 下载对应快照。
 * @param {number|string} resourceId   新花名册 resource_id（例如 Little Mermaid 为 513）
 * @returns {Promise<object>}
 */
export async function loadNikke(resourceId) {
  const id    = Number(resourceId);
  const local = `${LOCAL_BASE}/nikke/${id}.json`;
  return _loadByUrl('nikke', id, null, local);
}

/**
 * 按 resource_id 加载和谐魔方 JSON。
 * 优先读取本地静态快照，缺失时回退 CDN。
 * @param {number|string} resourceId
 * @returns {Promise<object>}
 */
export async function loadCube(resourceId) {
  const id    = Number(resourceId);
  const url   = CUBE_URLS[id];
  if (!url) throw new Error(`No CDN URL for cube resource_id ${id}`);
  const local = `${LOCAL_BASE}/cubes/${id}.json`;
  return _loadByUrl('cube', id, url, local);
}

/**
 * 按 resource_id 加载珍藏品 JSON。
 * 优先读取本地静态快照，缺失时回退 CDN。
 * @param {number|string} resourceId
 * @returns {Promise<object>}
 */
export async function loadFavoriteItem(resourceId) {
  const id    = Number(resourceId);
  const url   = FAVORITE_ITEM_URLS[id] ?? null; // SSR 专属珍藏品可能无 CDN URL，本地文件优先
  const local = `${LOCAL_BASE}/favorites/${id}.json`;
  return _loadByUrl('fav', id, url, local);
}

/** 强制从 CDN 刷新单个 key。 */
export async function refreshOne(key) {
  const data = await fetchFromCDN(key);
  _store[key] = data;
  return data;
}

// ─── 内部实现 ───────────────────────────────────────────────────────────────

/**
 * 读取本地静态快照；文件不存在或读取失败时返回 null。
 * 静态快照永远优先于 IndexedDB 缓存：更新 src/data/static/ 后刷新页面即生效
 * （例如新增角色后花名册立即出现在角色选择器中），不依赖修改 MANIFEST_VERSION。
 * cache: 'no-cache' 让浏览器每次向服务器重新验证（未变更时只返回 304），避免 HTTP 缓存拿到旧快照。
 * @param {string} localPath
 * @returns {Promise<any|null>}
 */
async function fetchLocalStatic(localPath) {
  try {
    const res = await fetch(localPath, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // 静态文件不存在或网络错误：由调用方回退到缓存 / CDN
  }
}

/**
 * 通用加载器：本地静态文件 → IndexedDB 缓存（仅存 CDN 回退结果）→ CDN。
 * @param {string}        prefix      缓存键前缀（'nikke' | 'cube' | 'fav'）
 * @param {number}        resourceId  资源 ID（Number 类型）
 * @param {string}        url         CDN fallback URL
 * @param {string|null}   [localPath] 本地静态快照 URL（可选）
 */
async function _loadByUrl(prefix, resourceId, url, localPath) {
  const cacheKey = CACHE_PREFIX + `${prefix}_${resourceId}`;

  // 1. 本地静态快照（由 download-all-static.mjs 生成）
  if (localPath) {
    const local = await fetchLocalStatic(localPath);
    if (local !== null) return local;
  }

  // 2. IndexedDB 缓存（此前从 CDN 拉取的结果）
  const entry = await readCache(cacheKey);
  if (entry && !isStale(entry)) return entry.data;

  // 3. CDN fallback（url 为 null 时说明仅有本地文件，本地已缺失则报错）
  if (!url) throw new Error(`No local file or CDN URL for ${prefix} ${resourceId}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${prefix} ${resourceId}: ${res.status}`);
  const data = await res.json();
  writeCache(cacheKey, data);
  return data;
}

async function loadOne(key) {
  // 1. 本地静态快照（已归一化为数组）——始终优先，保证花名册等更新后刷新即生效
  const local = await fetchLocalStatic(`${LOCAL_BASE}/${key}.json`);
  if (local !== null) return local;

  // 2. IndexedDB 缓存（此前从 CDN 拉取的结果），过期则后台刷新
  const cacheKey = CACHE_PREFIX + key;
  const entry = await readCache(cacheKey);
  if (entry) {
    if (isStale(entry)) {
      fetchFromCDN(key)
        .then(data => writeCache(cacheKey, data))
        .catch(err => console.error(`[数据缓存] 后台刷新 ${key} 失败（继续使用旧缓存）:`, err));
    }
    return entry.data;
  }

  // 3. CDN
  const data = await fetchFromCDN(key);
  writeCache(cacheKey, data);
  return data;
}

/** 刷新单个 key：本地静态快照优先，缺失时访问 CDN */
async function fetchFromCDN(key) {
  const local = await fetchLocalStatic(`${LOCAL_BASE}/${key}.json`);
  if (local !== null) return local;

  const url = DATA_URLS[key];
  if (!url) throw new Error(`Unknown data key: ${key}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${key}: ${res.status}`);
  const json = await res.json();
  // 部分文件将数据包裹为 { version, records }；统一归一化为数组
  return Array.isArray(json) ? json : (json.records ?? json);
}

// ─── IndexedDB 缓存 ──────────────────────────────────────────────────────────
// 条目格式：{ data, ts }（ts = 写入时间，毫秒）。缓存失败不影响加载（数据照常返回），但会报错便于排查。

/** 读取缓存条目；缺失或读取失败时返回 null */
async function readCache(cacheKey) {
  try {
    const entry = await _cache.get(cacheKey);
    return entry && typeof entry === 'object' && 'data' in entry ? entry : null;
  } catch (err) {
    console.error(`[数据缓存] 读取 ${cacheKey} 失败:`, err);
    return null;
  }
}

/** 后台写入缓存（不阻塞加载） */
function writeCache(cacheKey, data) {
  _cache.set(cacheKey, { data, ts: Date.now() })
    .catch(err => console.error(`[数据缓存] 写入 ${cacheKey} 失败:`, err));
}

function isStale(entry) {
  return !(Date.now() - entry.ts < CACHE_TTL_MS);
}

/** 删除其他 manifest 版本的缓存条目（游戏更新后旧数据作废） */
function pruneOldCacheEntries() {
  _cache.keys()
    .then(keys => Promise.all(keys
      .filter(k => typeof k === 'string' && !k.startsWith(CACHE_PREFIX))
      .map(k => _cache.del(k))))
    .catch(err => console.error('[数据缓存] 清理旧版本缓存失败:', err));
}

/** 删除旧版存在 localStorage 中的缓存（迁移到 IndexedDB 前的遗留，释放 localStorage 配额） */
function purgeLegacyLocalStorageCache() {
  if (typeof localStorage === 'undefined') return;
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(LEGACY_LS_PREFIX))
      .forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.error('[数据缓存] 清理 localStorage 旧缓存失败:', err);
  }
}
