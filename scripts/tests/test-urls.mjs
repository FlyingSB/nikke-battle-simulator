/**
 * test-urls.mjs
 *
 * Regression tests for the dynamic URL generation algorithm in
 * src/data/blablalink-url.js.
 *
 * Reads scripts/fixtures/nikke-urls-golden.json as the reference snapshot.
 * To regenerate the fixture, restore NIKKE_URLS_BY_ROSTER_ID from git history
 * and run the bootstrap script, or export the map manually.
 *
 * Run: node scripts/test-urls.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { eq, section, summary } from '../lib/test-harness.mjs';
import { getRoleDataUrl } from '../../src/data/blablalink-url.js';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '../fixtures');
const GOLDEN_PATH = join(FIXTURE_DIR, 'nikke-urls-golden.json');
const CDN_BASE    = 'https://sg-tools-cdn.blablalink.com';

// ---------------------------------------------------------------------------
// Load golden fixture
// ---------------------------------------------------------------------------

if (!existsSync(GOLDEN_PATH)) {
  console.error(`[ERROR] Golden fixture not found: ${GOLDEN_PATH}`);
  console.error('Restore it from git: git show HEAD:scripts/fixtures/nikke-urls-golden.json > scripts/fixtures/nikke-urls-golden.json');
  process.exit(1);
}

const goldenMap = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')); // { [resourceId: string]: url }

// ---------------------------------------------------------------------------
// U1 — Single-point snapshot
// ---------------------------------------------------------------------------

section('U1 — Single-point snapshot (resource_id 16)');

eq('getRoleDataUrl(16, "en") matches golden', getRoleDataUrl(16, 'en'), goldenMap['16']);

// ---------------------------------------------------------------------------
// U2 — Full golden-fixture comparison (core regression guarantee)
//
// For every id in the golden fixture the algorithm must produce the same URL.
// This is the contract that allows safe deletion of the static table.
// ---------------------------------------------------------------------------

section('U2 — Full golden fixture comparison (all known resource_ids)');

const allIds   = Object.keys(goldenMap);
let u2Failures = 0;

for (const idStr of allIds) {
  const expected = goldenMap[idStr];
  const got      = getRoleDataUrl(Number(idStr), 'en');
  if (got !== expected) {
    console.log(`  [FAIL] resource_id ${idStr}:`);
    console.log(`         got      ${got}`);
    console.log(`         expected ${expected}`);
    u2Failures++;
  }
}

eq('Golden fixture is non-empty', allIds.length > 0, true);
if (u2Failures === 0) {
  eq(`All ${allIds.length} resource_ids match golden fixture`, true, true);
} else {
  eq(`${u2Failures} resource_id(s) did NOT match golden fixture`, false, true);
}

// ---------------------------------------------------------------------------
// U3 — lang parameter participates in the hash
// ---------------------------------------------------------------------------

section('U3 — Different lang codes produce different URLs');

const urlEn     = getRoleDataUrl(16, 'en');
const urlZhHant = getRoleDataUrl(16, 'zh-Hant');
const urlZhHans = getRoleDataUrl(16, 'zh-Hans');

eq('en !== zh-Hant',        urlEn === urlZhHant,     false);
eq('en !== zh-Hans',        urlEn === urlZhHans,     false);
eq('zh-Hant !== zh-Hans',   urlZhHant === urlZhHans, false);

// ---------------------------------------------------------------------------
// U4 — Arbitrary resource_id returns a valid-shaped URL
// ---------------------------------------------------------------------------

section('U4 — Arbitrary resource_id returns valid-shaped URL');

const url513  = getRoleDataUrl(513, 'en');
const url9999 = getRoleDataUrl(9999, 'en');

eq('getRoleDataUrl(513) starts with CDN base',  url513.startsWith(CDN_BASE),  true);
eq('getRoleDataUrl(513) ends with .json',       url513.endsWith('.json'),      true);
eq('getRoleDataUrl(9999) starts with CDN base', url9999.startsWith(CDN_BASE), true);
eq('getRoleDataUrl(9999) ends with .json',      url9999.endsWith('.json'),     true);

// ---------------------------------------------------------------------------
// U5 — Extreme resource_id does not throw
// ---------------------------------------------------------------------------

section('U5 — Extreme resource_id (999999) does not throw');

let u5Error  = null;
let u5Result;
try {
  u5Result = getRoleDataUrl(999999, 'en');
} catch (e) {
  u5Error = e;
}

eq('getRoleDataUrl(999999) does not throw',       u5Error,                   null);
eq('getRoleDataUrl(999999) returns a string',     typeof u5Result,           'string');
eq('getRoleDataUrl(999999) starts with CDN base', u5Result?.startsWith(CDN_BASE), true);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

summary('URL algorithm tests');
