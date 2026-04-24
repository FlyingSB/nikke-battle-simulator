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

export { DEFAULT_CDN_BASE };