/**
 * blablalink-url.js
 *
 * Generate obfuscated CDN URLs used by the NIKKE BlablaLink site
 * (sg-tools-cdn.blablalink.com). Ported from the client-side
 * obfuscation logic (`Re` / `cd` / `Sr`) so external callers can
 * construct the same URLs directly.
 *
 * Zero dependencies. Works in browsers, Node.js, Deno, etc.
 *
 * Usage:
 *   import { getRoleDataUrl, getCdnUrl } from './blablalink-url.js';
 *
 *   getRoleDataUrl(16, 'en');
 *   // => 'https://sg-tools-cdn.blablalink.com/pg-11/c8cc79fb04fb057ff8f8fa178cf7043a.json'
 *
 *   getCdnUrl('roledata/16-v2-en.json');
 *   // => same result
 */

// ---------- Configuration ----------

const DEFAULT_CDN_BASE = 'https://sg-tools-cdn.blablalink.com';

// Per-depth salts used for directory-name obfuscation.
const SALTS = [224737, 1000639, 2654435761, 2654435769, 1000621, 4294967291];

// ---------- DJB2-style rolling hash ----------
// Mirrors the site's `Tr` function: n = (n * 33 + charCode) & 0xFFFFFFFF,
// initialized to the salt. In JS, `| 0` coerces to signed Int32, which is
// exactly what `& 0xFFFFFFFF` does in the original code.

function djbHash(str, salt) {
  let n = salt | 0;
  for (let i = 0; i < str.length; i++) {
    n = (Math.imul(n, 33) + str.charCodeAt(i)) | 0;
  }
  return n;
}

function normMod(s, t) {
  // ((s % t) + t) % t, but avoids the second modulo when possible.
  const r = s % t;
  return r < 0 ? r + t : r;
}

function dirLetters(path, salt) {
  const n = normMod(djbHash(path, salt), salt);
  const hi = Math.floor(n / 26) % 26;
  const lo = n % 26;
  return String.fromCharCode(97 + hi) + String.fromCharCode(97 + lo);
}

function dirDigits(path, salt) {
  const n = normMod(djbHash(path, salt), salt);
  return String(n % 99).padStart(2, '0');
}

function dirSegment(path, salt) {
  return dirLetters(path, salt) + '-' + dirDigits(path, salt);
}

// ---------- MD5 (RFC 1321, pure JS, UTF-8 safe) ----------

function utf8Encode(str) {
  if (typeof TextEncoder !== 'undefined') {
    return Array.from(new TextEncoder().encode(str));
  }
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      i++;
      const c2 = str.charCodeAt(i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

function toHexLE(n) {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * Compute MD5 of a string, returning lowercase 32-char hex.
 * @param {string} input
 * @returns {string}
 */
export function md5(input) {
  const bytes = utf8Encode(input);
  const n = bytes.length;
  const nBlocks = ((n + 8) >> 6) + 1;
  const words = new Array(nBlocks * 16).fill(0);

  for (let i = 0; i < n; i++) {
    words[i >> 2] |= bytes[i] << ((i & 3) * 8);
  }
  words[n >> 2] |= 0x80 << ((n & 3) * 8);
  words[nBlocks * 16 - 2] = n * 8;

  let a = 0x67452301 | 0;
  let b = 0xefcdab89 | 0;
  let c = 0x98badcfe | 0;
  let d = 0x10325476 | 0;

  const F = (x, y, z) => (x & y) | (~x & z);
  const G = (x, y, z) => (x & z) | (y & ~z);
  const H = (x, y, z) => x ^ y ^ z;
  const I = (x, y, z) => y ^ (x | ~z);
  const rotl = (x, s) => (x << s) | (x >>> (32 - s));
  const step = (fn, a, b, c, d, x, s, t) =>
    (rotl((a + fn(b, c, d) + x + t) | 0, s) + b) | 0;

  for (let i = 0; i < words.length; i += 16) {
    const a0 = a, b0 = b, c0 = c, d0 = d;

    // Round 1
    a = step(F, a, b, c, d, words[i +  0],  7, 0xd76aa478);
    d = step(F, d, a, b, c, words[i +  1], 12, 0xe8c7b756);
    c = step(F, c, d, a, b, words[i +  2], 17, 0x242070db);
    b = step(F, b, c, d, a, words[i +  3], 22, 0xc1bdceee);
    a = step(F, a, b, c, d, words[i +  4],  7, 0xf57c0faf);
    d = step(F, d, a, b, c, words[i +  5], 12, 0x4787c62a);
    c = step(F, c, d, a, b, words[i +  6], 17, 0xa8304613);
    b = step(F, b, c, d, a, words[i +  7], 22, 0xfd469501);
    a = step(F, a, b, c, d, words[i +  8],  7, 0x698098d8);
    d = step(F, d, a, b, c, words[i +  9], 12, 0x8b44f7af);
    c = step(F, c, d, a, b, words[i + 10], 17, 0xffff5bb1);
    b = step(F, b, c, d, a, words[i + 11], 22, 0x895cd7be);
    a = step(F, a, b, c, d, words[i + 12],  7, 0x6b901122);
    d = step(F, d, a, b, c, words[i + 13], 12, 0xfd987193);
    c = step(F, c, d, a, b, words[i + 14], 17, 0xa679438e);
    b = step(F, b, c, d, a, words[i + 15], 22, 0x49b40821);

    // Round 2
    a = step(G, a, b, c, d, words[i +  1],  5, 0xf61e2562);
    d = step(G, d, a, b, c, words[i +  6],  9, 0xc040b340);
    c = step(G, c, d, a, b, words[i + 11], 14, 0x265e5a51);
    b = step(G, b, c, d, a, words[i +  0], 20, 0xe9b6c7aa);
    a = step(G, a, b, c, d, words[i +  5],  5, 0xd62f105d);
    d = step(G, d, a, b, c, words[i + 10],  9, 0x02441453);
    c = step(G, c, d, a, b, words[i + 15], 14, 0xd8a1e681);
    b = step(G, b, c, d, a, words[i +  4], 20, 0xe7d3fbc8);
    a = step(G, a, b, c, d, words[i +  9],  5, 0x21e1cde6);
    d = step(G, d, a, b, c, words[i + 14],  9, 0xc33707d6);
    c = step(G, c, d, a, b, words[i +  3], 14, 0xf4d50d87);
    b = step(G, b, c, d, a, words[i +  8], 20, 0x455a14ed);
    a = step(G, a, b, c, d, words[i + 13],  5, 0xa9e3e905);
    d = step(G, d, a, b, c, words[i +  2],  9, 0xfcefa3f8);
    c = step(G, c, d, a, b, words[i +  7], 14, 0x676f02d9);
    b = step(G, b, c, d, a, words[i + 12], 20, 0x8d2a4c8a);

    // Round 3
    a = step(H, a, b, c, d, words[i +  5],  4, 0xfffa3942);
    d = step(H, d, a, b, c, words[i +  8], 11, 0x8771f681);
    c = step(H, c, d, a, b, words[i + 11], 16, 0x6d9d6122);
    b = step(H, b, c, d, a, words[i + 14], 23, 0xfde5380c);
    a = step(H, a, b, c, d, words[i +  1],  4, 0xa4beea44);
    d = step(H, d, a, b, c, words[i +  4], 11, 0x4bdecfa9);
    c = step(H, c, d, a, b, words[i +  7], 16, 0xf6bb4b60);
    b = step(H, b, c, d, a, words[i + 10], 23, 0xbebfbc70);
    a = step(H, a, b, c, d, words[i + 13],  4, 0x289b7ec6);
    d = step(H, d, a, b, c, words[i +  0], 11, 0xeaa127fa);
    c = step(H, c, d, a, b, words[i +  3], 16, 0xd4ef3085);
    b = step(H, b, c, d, a, words[i +  6], 23, 0x04881d05);
    a = step(H, a, b, c, d, words[i +  9],  4, 0xd9d4d039);
    d = step(H, d, a, b, c, words[i + 12], 11, 0xe6db99e5);
    c = step(H, c, d, a, b, words[i + 15], 16, 0x1fa27cf8);
    b = step(H, b, c, d, a, words[i +  2], 23, 0xc4ac5665);

    // Round 4
    a = step(I, a, b, c, d, words[i +  0],  6, 0xf4292244);
    d = step(I, d, a, b, c, words[i +  7], 10, 0x432aff97);
    c = step(I, c, d, a, b, words[i + 14], 15, 0xab9423a7);
    b = step(I, b, c, d, a, words[i +  5], 21, 0xfc93a039);
    a = step(I, a, b, c, d, words[i + 12],  6, 0x655b59c3);
    d = step(I, d, a, b, c, words[i +  3], 10, 0x8f0ccc92);
    c = step(I, c, d, a, b, words[i + 10], 15, 0xffeff47d);
    b = step(I, b, c, d, a, words[i +  1], 21, 0x85845dd1);
    a = step(I, a, b, c, d, words[i +  8],  6, 0x6fa87e4f);
    d = step(I, d, a, b, c, words[i + 15], 10, 0xfe2ce6e0);
    c = step(I, c, d, a, b, words[i +  6], 15, 0xa3014314);
    b = step(I, b, c, d, a, words[i + 13], 21, 0x4e0811a1);
    a = step(I, a, b, c, d, words[i +  4],  6, 0xf7537e82);
    d = step(I, d, a, b, c, words[i + 11], 10, 0xbd3af235);
    c = step(I, c, d, a, b, words[i +  2], 15, 0x2ad7d2bb);
    b = step(I, b, c, d, a, words[i +  9], 21, 0xeb86d391);

    a = (a + a0) | 0;
    b = (b + b0) | 0;
    c = (c + c0) | 0;
    d = (d + d0) | 0;
  }

  return toHexLE(a) + toHexLE(b) + toHexLE(c) + toHexLE(d);
}

// ---------- Path obfuscation (mirrors the site's `cd` function) ----------

/**
 * Apply the site's path-obfuscation transform. Pass it a plaintext
 * resource path (with or without leading '/') and get back the
 * obfuscated path you would append to the CDN base.
 *
 * @param {string} path
 * @returns {string}
 */
export function obfuscatePath(path) {
  const clean = path.replace(/^\/+/, '');
  const segments = clean.split('/').filter(Boolean);
  const hash = md5(clean);

  return segments
    .map((seg, i) => {
      if (i === segments.length - 1) {
        // Last segment: <md5(clean)>[.ext...]
        const parts = seg.split('.');
        parts.shift(); // drop the filename stem
        return parts.length ? `${hash}.${parts.join('.')}` : hash;
      }
      return dirSegment(clean, SALTS[i]);
    })
    .join('/');
}

// ---------- Public high-level API ----------

/**
 * Build the CDN URL for a NIKKE role-data JSON.
 *
 * @param {number|string} resourceId  NIKKE resource_id (e.g. 16).
 * @param {string} [lang='en']        Language code ('en', 'ja', 'ko', 'zh-Hant', ...).
 * @param {string} [cdnBase]          Override CDN host.
 * @returns {string}                  Full URL.
 */
export function getRoleDataUrl(resourceId, lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  const path = `roledata/${resourceId}-v2-${lang}.json`;
  return `${cdnBase}/${obfuscatePath(path)}`;
}

/**
 * Build the CDN URL for any plaintext resource path.
 *
 * @param {string} path               Plaintext path, e.g. "roledata/16-v2-en.json".
 * @param {string} [cdnBase]          Override CDN host.
 * @returns {string}                  Full URL.
 */
export function getCdnUrl(path, cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(path)}`;
}

// ---------- Character image URLs ----------
// Source: index-D5dy8iIY.js  MI_CHARACTER_URL / SM_CHARACTER_URL / FULL_CHARACTER_URL
//
// skin_index = costume_index of the equipped costume (0 = base skin, no costume).
// resource_id = the character's resource_id field (not name_code).
//
// Example: Rapi: Red Hood  resource_id=16, costume 130005 → costume_index=3
//   getSmCharacterUrl(16, 3)
//   // => 'https://sg-tools-cdn.blablalink.com/cn-45/zf-83/82830231c70562b5e080bb3d04c6d67c.webp'
//   getMiCharacterUrl(16, 3)
//   // => 'https://sg-tools-cdn.blablalink.com/uo-41/qs-83/6d37d62eee2050b18a3b858045c679e5.webp'
//   getFullCharacterUrl(16, 3)
//   // => 'https://sg-tools-cdn.blablalink.com/fw-15/lh-83/d35cefe811ed872a3ea1de6e488457ce.webp'

function pad(n, len) {
  return String(n).padStart(len, '0');
}

/**
 * Small character image (used as card thumbnail on the shiftyspad page).
 * Path template: character/si/si_c{resource_id:3}_{skin_index:2}_s.webp
 *
 * @param {number} resourceId
 * @param {number} [skinIndex=0]  costume_index of the equipped costume; 0 = base skin.
 * @param {string} [cdnBase]
 * @returns {string}
 */
export function getSmCharacterUrl(resourceId, skinIndex = 0, cdnBase = DEFAULT_CDN_BASE) {
  const path = `character/si/si_c${pad(resourceId, 3)}_${pad(skinIndex, 2)}_s.webp`;
  return `${cdnBase}/${obfuscatePath(path)}`;
}

/**
 * Medium character image.
 * Path template: character/mi/mi_c{resource_id:3}_{skin_index:2}_s.webp
 *
 * @param {number} resourceId
 * @param {number} [skinIndex=0]
 * @param {string} [cdnBase]
 * @returns {string}
 */
export function getMiCharacterUrl(resourceId, skinIndex = 0, cdnBase = DEFAULT_CDN_BASE) {
  const path = `character/mi/mi_c${pad(resourceId, 3)}_${pad(skinIndex, 2)}_s.webp`;
  return `${cdnBase}/${obfuscatePath(path)}`;
}

/**
 * Full character image.
 * Path template: character/full/c{resource_id:3}_{skin_index:2}.webp
 *
 * @param {number} resourceId
 * @param {number} [skinIndex=0]
 * @param {string} [cdnBase]
 * @returns {string}
 */
export function getFullCharacterUrl(resourceId, skinIndex = 0, cdnBase = DEFAULT_CDN_BASE) {
  const path = `character/full/c${pad(resourceId, 3)}_${pad(skinIndex, 2)}.webp`;
  return `${cdnBase}/${obfuscatePath(path)}`;
}

// ---------- Collectible (珍藏品 / Favorite Item) URLs ----------
// Source: index-D5dy8iIY.js  getFavoriteItemLevelStat / getFavoriteItemId
//
// Collectible IDs are 6-digit numbers (e.g. 201501). The locale follows the
// same shiftyspad_locale convention: 'en', 'ja', 'ko', 'zh-tw'.
//
// Examples (verified):
//   getFavoriteItemRosterUrl()
//   // => 'https://sg-tools-cdn.blablalink.com/yb-61/eaff19debcb789edef7e1e8a377e12e5.json'
//   getFavoriteItemUrl(201501, 'en')
//   // => 'https://sg-tools-cdn.blablalink.com/ux-87/nx-55/e292fae7ffdcb512fc42b913f8f40f7d.json'

/**
 * Full rarity-map roster of all collectible (favorite) items.
 * Path: equip/favorite_rare_map.json
 *
 * @param {string} [cdnBase]
 * @returns {string}
 */
export function getFavoriteItemRosterUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('equip/favorite_rare_map.json')}`;
}

/**
 * Data JSON for a single collectible (favorite) item.
 * Path template: equip/{lang}/favorite_{id}.json
 *
 * @param {number} id    6-digit collectible ID (e.g. 201501).
 * @param {string} [lang='en']  Language: 'en', 'ja', 'ko', 'zh-tw'.
 * @param {string} [cdnBase]
 * @returns {string}
 */
export function getFavoriteItemUrl(id, lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`equip/${lang}/favorite_${id}.json`)}`;
}

// ---------- Character system data JSONs ----------
// Source: index-D5dy8iIY.js  getFaceList / getNikkeList / getCharacterData / etc.

/**
 * Character face list (per-locale).
 * Path: character/{lang}/character_face_list.json
 * getCharacterFaceListUrl('en')
 * // => 'https://sg-tools-cdn.blablalink.com/ys-72/ni-31/7629adf2cf6cf36e16f9521227213943.json'
 */
export function getCharacterFaceListUrl(lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`character/${lang}/character_face_list.json`)}`;
}

/**
 * Full nikke list (per-locale). Note: the directory uses lowercase lang (l_lang),
 * while the filename uses the original casing (e.g. 'zh-TW' vs 'zh-tw').
 * For non-Chinese locales both are identical.
 * Path: character/{lang.toLowerCase()}/nikke_list_{lang}_v2.json
 * getNikkeListUrl('en')
 * // => 'https://sg-tools-cdn.blablalink.com/yl-57/hd-03/1bf030193826e243c2e195f951a4be00.json'
 */
export function getNikkeListUrl(lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  const lLang = lang.toLowerCase();
  return `${cdnBase}/${obfuscatePath(`character/${lLang}/nikke_list_${lang}_v2.json`)}`;
}

/** Path: character/character_avatar_map.json
 *  // => 'https://sg-tools-cdn.blablalink.com/kw-85/7548a00f7a945550ddf0958a80abce46.json' */
export function getCharacterAvatarMapUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('character/character_avatar_map.json')}`;
}

/** Path: character/character_id_map.json
 *  // => 'https://sg-tools-cdn.blablalink.com/kx-19/bc64a706accd3c7ec1f9a9f2afd8f1bc.json' */
export function getCharacterIdMapUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('character/character_id_map.json')}`;
}

/** Path: character/character_skill_map.json
 *  // => 'https://sg-tools-cdn.blablalink.com/pv-80/4c2e6af2b69d78bafbf1aa4f0c267adc.json' */
export function getCharacterSkillMapUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('character/character_skill_map.json')}`;
}

/** Path: character/CharacterLevelTable.json
 *  // => 'https://sg-tools-cdn.blablalink.com/dv-15/e8b9e7f748f8734b2848842b47bf1cb2.json' */
export function getCharacterLevelTableUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('character/CharacterLevelTable.json')}`;
}

/** Path: character/RecycleResearchStatTable.json
 *  // => 'https://sg-tools-cdn.blablalink.com/eu-96/258f853112b1d6f69d1508e12918ff3b.json' */
export function getRecycleResearchUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('character/RecycleResearchStatTable.json')}`;
}

/** Path: character/AttractiveLevelTable.json
 *  // => 'https://sg-tools-cdn.blablalink.com/qe-66/cb6bd83fc9f961e0975612b760fbef8e.json' */
export function getAttractiveLevelTableUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('character/AttractiveLevelTable.json')}`;
}

/** Path: character/scene_characeter_list_v2.json (sic — typo in original)
 *  // => 'https://sg-tools-cdn.blablalink.com/ug-00/452950b7851009edecb261bf5ee0c236.json' */
export function getSceneCharacterListUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('character/scene_characeter_list_v2.json')}`;
}

// ---------- Equip system ----------
// Source: index-D5dy8iIY.js  getEquipData / getCubeByCubeId / getEquipOptions

/**
 * Equipment table (per-locale).
 * Path: equip/ItemEquipTable-{lang}.json
 * getEquipItemTableUrl('en')
 * // => 'https://sg-tools-cdn.blablalink.com/yu-75/6677291d48d5ac3804d5e7a194df7085.json'
 */
export function getEquipItemTableUrl(lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`equip/ItemEquipTable-${lang}.json`)}`;
}

/**
 * Single Cube data JSON.
 * Path: equip/{lang}/cube_{id}.json
 * getCubeUrl(1000303, 'en')
 * // => 'https://sg-tools-cdn.blablalink.com/qx-26/gm-26/c30913a016dcc8bd2f8159eb25293d09.json'
 */
export function getCubeUrl(id, lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`equip/${lang}/cube_${id}.json`)}`;
}

/**
 * Equip option table (per-locale).
 * Path: equip/equip_option_table_v2-{lang}.json
 * getEquipOptionTableUrl('en')
 * // => 'https://sg-tools-cdn.blablalink.com/bl-25/e76520be5092c3795fa92b8555f3e1c3.json'
 */
export function getEquipOptionTableUrl(lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`equip/equip_option_table_v2-${lang}.json`)}`;
}

// ---------- Story / Scene ----------
// Source: index-D5dy8iIY.js  getAttractSceneData / getSceneList / etc.

/**
 * Character attract (bond story) scene data.
 * Path: attractscene/{sceneId}-{lang}.json
 * TODO: confirm sceneId format (appears to be a numeric ID)
 */
export function getAttractSceneUrl(sceneId, lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`attractscene/${sceneId}-${lang}.json`)}`;
}

/**
 * Archive (story event) list.
 * Path: archive/{lang}/archive_list_{lang}.json
 */
export function getArchiveListUrl(lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`archive/${lang}/archive_list_${lang}.json`)}`;
}

/**
 * Main scene list.
 * Path: scene/{lang}/scene_list_{lang}.json
 */
export function getSceneListUrl(lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`scene/${lang}/scene_list_${lang}.json`)}`;
}

/**
 * Sudden (interception/event) scene list.
 * Path: scene/{lang}/sudden_list_{lang}.json
 */
export function getSuddenListUrl(lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`scene/${lang}/sudden_list_${lang}.json`)}`;
}

/**
 * Individual scene detail.
 * Path: scene/{lang}/scene_detail_{n}_{lang}.json
 * TODO: confirm what n represents (scene numeric ID)
 */
export function getSceneDetailUrl(n, lang = 'en', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`scene/${lang}/scene_detail_${n}_${lang}.json`)}`;
}

/**
 * Voice ID map for a scene.
 * Path: scene/voice_map/{n}.json
 * TODO: confirm what n represents
 */
export function getVoiceMapUrl(n, cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`scene/voice_map/${n}.json`)}`;
}

// ---------- Image resources ----------
// Source: index-D5dy8iIY.js  ICONS_URL / BG_URL / ACTIVITY_BANNER_URL

/**
 * Generic icon image.
 * Path: icon/{subPath}/{name}.webp
 * subPath may contain slashes (e.g. 'Character/Rapi').
 * TODO: subPath and name format unconfirmed — ('Character','icn_char_0001_s') returned 404
 */
export function getIconUrl(subPath, name, cdnBase = DEFAULT_CDN_BASE) {
  const clean = subPath.replace(/^\//, '');
  return `${cdnBase}/${obfuscatePath(`icon/${clean}/${name}.webp`)}`;
}

/**
 * Background image.
 * Path: background/{subPath}/{name}.webp
 * TODO: verify exact subPath values used in practice
 */
export function getBackgroundUrl(subPath, name, cdnBase = DEFAULT_CDN_BASE) {
  const clean = subPath.replace(/^\//, '');
  return `${cdnBase}/${obfuscatePath(`background/${clean}/${name}.webp`)}`;
}

/**
 * Activity / event banner.
 * Path: schedule/banner/{name}.webp
 */
export function getActivityBannerUrl(name, cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`schedule/banner/${name}.webp`)}`;
}

/**
 * Season Pass logo banner.
 * Path: icon/Logo/pass/{name}.webp
 */
export function getSeasonPassBannerUrl(name, cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`icon/Logo/pass/${name}.webp`)}`;
}

// ---------- Spine animations ----------
// Source: index-D5dy8iIY.js  GET_SPINE_URL
//
// Returns { atlas, skel } — two URLs needed to load the Spine skeleton.
// type: 'stand' (lobby idle) | 'battle' | others
// combat: only used when type !== 'stand' (e.g. 'aim', 'attack')
// avif: pass true if the client supports AVIF (affects atlas filename only)
//
// Stand path:  spine/stand/c{id:3}/{skin:2}/c{id:3}_{skin:2}[_avif].atlas.txt
//              spine/stand/c{id:3}/{skin:2}/c{id:3}_{skin:2}.skel.bytes
// Battle path: spine/{type}/c{id:3}/{skin:2}/{combat}/c{id:3}_{combat}_{skin:2}[_avif].atlas.txt
//              spine/{type}/c{id:3}/{skin:2}/{combat}/c{id:3}_{combat}_{skin:2}.skel.bytes

/**
 * @param {number} resourceId
 * @param {number} [skinIndex=0]
 * @param {string} [type='stand']   'stand' | 'battle' | ...
 * @param {string} [combat='aim']   Only used when type !== 'stand'
 * @param {boolean} [avif=false]
 * @param {string} [cdnBase]
 * @returns {{ atlas: string, skel: string }}
 */
export function getSpineUrl(resourceId, skinIndex = 0, type = 'stand', combat = 'aim', avif = false, cdnBase = DEFAULT_CDN_BASE) {
  const id = pad(resourceId, 3);
  const skin = pad(skinIndex, 2);
  const avifSuffix = avif ? '_avif' : '';
  const name = type === 'stand' ? `c${id}_${skin}` : `c${id}_${combat}_${skin}`;
  const base = type === 'stand'
    ? `spine/${type}/c${id}/${skin}/${name}`
    : `spine/${type}/c${id}/${skin}/${combat}/${name}`;
  return {
    atlas: `${cdnBase}/${obfuscatePath(`${base}${avifSuffix}.atlas.txt`)}`,
    skel:  `${cdnBase}/${obfuscatePath(`${base}.skel.bytes`)}`,
  };
}

// ---------- Voice ----------
// Source: index-D5dy8iIY.js  GET_VOICE_URL

/**
 * Character voice clip.
 * Path: voice/{cvLang}/{speechId}.{format}
 * TODO: confirm cvLang values (likely 'jp', 'kr', 'en', etc.) and speechId format
 */
export function getVoiceUrl(cvLang, speechId, format = 'wav', cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath(`voice/${cvLang}/${speechId}.${format}`)}`;
}

// ---------- Other data JSONs ----------

/** Path: guild/guild_emblem.json */
export function getGuildEmblemUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('guild/guild_emblem.json')}`;
}

/** Path: raid/raid_list.json
 *  // => 'https://sg-tools-cdn.blablalink.com/rm-58/a7f993363fe3e2df8a4a7e579decc872.json' */
export function getRaidListUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('raid/raid_list.json')}`;
}

/** Path: stage/stage_list.json */
export function getStageListUrl(cdnBase = DEFAULT_CDN_BASE) {
  return `${cdnBase}/${obfuscatePath('stage/stage_list.json')}`;
}

export { DEFAULT_CDN_BASE };