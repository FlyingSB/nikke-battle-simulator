/**
 * Data loader — fetches CDN data and caches in localStorage.
 * On subsequent loads, serves from cache and background-refreshes.
 */
import { DATA_URLS, BATTLE_DATA_KEYS, MANIFEST_VERSION } from './manifest.js';

const CACHE_PREFIX = `nikke_sim_${MANIFEST_VERSION}_`;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** @type {Record<string, any>} */
const _store = {};

/**
 * Load all battle-required data files.
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

/** Get already-loaded data by key (after loadAllData resolves). */
export function getData(key) {
  return _store[key];
}

/** Force refresh a single key from CDN. */
export async function refreshOne(key) {
  const data = await fetchFromCDN(key);
  _store[key] = data;
  return data;
}

// ─── internals ───────────────────────────────────────────────────────────────

async function loadOne(key) {
  const cached = readCache(key);
  if (cached) {
    // Background refresh if stale
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
  // Some files wrap data in { version, records }; normalize to array
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
    // localStorage full — clear old entries and retry
    clearOldCacheEntries();
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* give up silently */ }
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
