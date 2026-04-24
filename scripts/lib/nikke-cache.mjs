/**
 * Node.js file cache for per-nikke CDN data.
 *
 * Cache file  : scripts/cache/nikke_{resourceId}.json
 * Cache format: { manifest_version, data }   (data = full CDN JSON)
 *
 * Validation on read:
 *   - manifest_version === current MANIFEST_VERSION
 *   - data.resource_id === resourceId
 *   - data.name_localkey === expectedName  (if provided)
 * On any mismatch: re-fetch from CDN and overwrite cache.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname }                          from 'path';
import { fileURLToPath }                          from 'url';

import {
  DATA_URLS,
  CUBE_URLS,
  FAVORITE_ITEM_URLS,
  MANIFEST_VERSION,
} from '../../src/data/manifest.js';
import { getRoleDataUrl } from '../../src/data/blablalink-url.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', 'cache');

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a static CDN data file by key (e.g. 'attractive', 'recycleRoom', 'equipment').
 * Caches to scripts/cache/static_{key}.json.
 * @param {string} key  key from DATA_URLS
 * @returns {Promise<any>}
 */
export async function loadStaticData(key) {
  const url = DATA_URLS[key];
  if (!url) throw new Error(`[nikke-cache] No DATA_URL for key "${key}"`);
  const cachePath = join(CACHE_DIR, `static_${key}.json`);
  try {
    const raw    = readFileSync(cachePath, 'utf8');
    const cached = JSON.parse(raw);
    if (cached.manifest_version === MANIFEST_VERSION) return cached.data;
  } catch { /* cache miss */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[nikke-cache] fetch failed for key "${key}": ${res.status}`);
  const json = await res.json();
  const data = Array.isArray(json) ? json : (json.records ?? json);
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ manifest_version: MANIFEST_VERSION, data }, null, 2));
  } catch (e) {
    console.warn(`[nikke-cache] Failed to write static cache for ${key}: ${e.message}`);
  }
  return data;
}

/**
 * Load a harmony cube JSON by resource_id.
 * @param {number} resourceId
 * @returns {Promise<object>}
 */
export async function loadCubeData(resourceId) {
  const id  = Number(resourceId);
  const url = CUBE_URLS[id];
  if (!url) throw new Error(`[nikke-cache] No CUBE_URL for resource_id ${id}`);
  const cachePath = join(CACHE_DIR, `cube_${id}.json`);
  try {
    const raw    = readFileSync(cachePath, 'utf8');
    const cached = JSON.parse(raw);
    if (cached.manifest_version === MANIFEST_VERSION) return cached.data;
  } catch { /* cache miss */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[nikke-cache] CDN fetch failed for cube ${id}: ${res.status}`);
  const data = await res.json();
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ manifest_version: MANIFEST_VERSION, data }, null, 2));
  } catch (e) {
    console.warn(`[nikke-cache] Failed to write cube cache for ${id}: ${e.message}`);
  }
  return data;
}

/**
 * Load a favorite item JSON by resource_id.
 * @param {number} resourceId
 * @returns {Promise<object>}
 */
export async function loadFavItemData(resourceId) {
  const id  = Number(resourceId);
  const url = FAVORITE_ITEM_URLS[id];
  if (!url) throw new Error(`[nikke-cache] No FAVORITE_ITEM_URL for resource_id ${id}`);
  const cachePath = join(CACHE_DIR, `fav_${id}.json`);
  try {
    const raw    = readFileSync(cachePath, 'utf8');
    const cached = JSON.parse(raw);
    if (cached.manifest_version === MANIFEST_VERSION) return cached.data;
  } catch { /* cache miss */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[nikke-cache] CDN fetch failed for fav item ${id}: ${res.status}`);
  const data = await res.json();
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ manifest_version: MANIFEST_VERSION, data }, null, 2));
  } catch (e) {
    console.warn(`[nikke-cache] Failed to write fav cache for ${id}: ${e.message}`);
  }
  return data;
}

/**
 * Load nikke CDN data by resource_id, served from a local file cache.
 *
 * @param {number}  resourceId    stable new-roster resource_id
 * @param {string}  [expectedName] name_localkey to verify identity (recommended)
 * @returns {Promise<object>}     full CDN JSON for the nikke
 */
export async function loadNikkeData(resourceId, expectedName) {
  const id        = Number(resourceId);
  const cachePath = join(CACHE_DIR, `nikke_${id}.json`);

  // ── Try reading from cache ──
  try {
    const raw    = readFileSync(cachePath, 'utf8');
    const cached = JSON.parse(raw);
    const data   = cached.data;

    const versionOk = cached.manifest_version === MANIFEST_VERSION;
    const idOk      = data?.resource_id === id;
    const nameOk    = !expectedName || data?.name_localkey === expectedName;

    if (versionOk && idOk && nameOk) return data;

    // Validation failed — explain why
    const reasons = [];
    if (!versionOk) reasons.push(`manifest_version: cache="${cached.manifest_version}" vs current="${MANIFEST_VERSION}"`);
    if (!idOk)      reasons.push(`resource_id: cache=${data?.resource_id} vs expected=${id}`);
    if (!nameOk)    reasons.push(`name_localkey: cache="${data?.name_localkey}" vs expected="${expectedName}"`);
    console.warn(`[nikke-cache] Stale cache for resource_id ${id}: ${reasons.join('; ')} — re-fetching…`);
  } catch {
    // Cache miss or parse error — fetch fresh
  }

  // ── Fetch from CDN ──
  return _fetchAndCache(id, cachePath);
}

/**
 * Parse a numeric skill value from a skill detail object at a given level.
 *
 * CDN layout:
 *   detail.description_value_list[valueIdx].description_value[level-1]  ← string like "4.0"
 *
 * @param {object} detail    skill1_detail / skill2_detail / burstskill_detail from CDN
 * @param {number} valueIdx  index into description_value_list
 * @param {number} [level]   skill level 1–10 (default 10 = max)
 * @returns {number}
 */
export function getSkillValue(detail, valueIdx, level = 10) {
  const entry = detail?.description_value_list?.[valueIdx];
  if (!entry) return 0;
  const vals = entry.description_value ?? [];
  const raw  = vals[level - 1] ?? vals[vals.length - 1] ?? '0';
  return parseFloat(raw) || 0;
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function _fetchAndCache(id, cachePath) {
  const url = getRoleDataUrl(id, 'en');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`[nikke-cache] CDN fetch failed for resource_id ${id}: ${res.status}`);
  const data = await res.json();

  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ manifest_version: MANIFEST_VERSION, data }, null, 2));
  } catch (e) {
    console.warn(`[nikke-cache] Failed to write cache for ${id}: ${e.message}`);
  }

  return data;
}
