/**
 * update-manifest.js
 *
 * Discovers per-character CDN URLs by loading each NIKKE's page on
 * blablalink.com/shiftyspad and intercepting the XHR to sg-tools-cdn.
 *
 * Usage:
 *   npm install puppeteer   (one-time)
 *   node scripts/update-manifest.js
 *
 * What it does:
 *   1. Fetches the character roster to get all resource_ids + names
 *   2. For each resource_id, opens blablalink.com/shiftyspad/nikke?nikke={id}
 *   3. Intercepts the first request to sg-tools-cdn.blablalink.com/*.json
 *   4. Updates MANIFEST_VERSION in src/data/manifest.js (audit/discovery only —
 *      per-character URLs are computed dynamically by getRoleDataUrl() in
 *      src/data/blablalink-url.js; no static NIKKE table is written back)
 *
 * Requires: Node.js 18+, puppeteer
 */

import puppeteer from 'puppeteer';
import fs        from 'fs/promises';
import path      from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST    = path.join(__dirname, '../src/data/manifest.js');
const BASE_URL    = 'https://www.blablalink.com/shiftyspad/nikke';
const CDN_PATTERN = 'sg-tools-cdn.blablalink.com';

// Must match DATA_URLS.characters in src/data/manifest.js — update both together when the CDN hash changes
const ROSTER_URL = 'https://sg-tools-cdn.blablalink.com/yl-57/hd-03/1bf030193826e243c2e195f951a4be00.json';

async function fetchRoster() {
  const res  = await fetch(ROSTER_URL);
  const data = await res.json();
  const records = data.records ?? data;
  return records
    .filter(c => c.resource_id && c.is_visible !== false)
    .map(c => ({ resource_id: c.resource_id, name: c.name_localkey?.name ?? String(c.resource_id) }));
}

async function discoverUrl(page, resourceId) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 15_000);

    // Intercept fetch() calls via page context
    await page.exposeFunction('__onCdnFetch__', url => {
      clearTimeout(timeout);
      resolve(url);
    });

    await page.evaluateOnNewDocument(() => {
      const orig = window.fetch;
      window.fetch = function(input, ...args) {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        if (url.includes('sg-tools-cdn') && url.endsWith('.json')) {
          window.__onCdnFetch__(url);
        }
        return orig.apply(this, arguments);
      };
    });

    await page.goto(`${BASE_URL}?nikke=${resourceId}&skin_index=1`, { waitUntil: 'networkidle2' })
      .catch(() => {});
  });
}

async function run() {
  console.log('Fetching character roster...');
  const nikkes = await fetchRoster();
  console.log(`Found ${nikkes.length} characters.\n`);

  const browser = await puppeteer.launch({ headless: true });
  const page    = await browser.newPage();

  // Pass cookies if needed (set BLABLALINK_COOKIE env var)
  if (process.env.BLABLALINK_COOKIE) {
    const cookies = process.env.BLABLALINK_COOKIE.split('; ').map(pair => {
      const [name, ...rest] = pair.split('=');
      return { name, value: rest.join('='), domain: '.blablalink.com' };
    });
    await page.setCookie(...cookies);
  }

  const urlMap = {};
  let failed = 0;

  for (const { resource_id, name } of nikkes) {
    try {
      process.stdout.write(`  [${resource_id}] ${name}... `);
      const cdnUrl = await discoverUrl(page, resource_id);
      urlMap[resource_id] = cdnUrl;
      console.log('✓');
    } catch {
      console.log('✗ (skipped)');
      failed++;
    }
  }

  await browser.close();

  // NOTE: NIKKE_URLS static tables were removed from manifest.js.
  // Per-character URLs are now computed dynamically by getRoleDataUrl()
  // in src/data/blablalink-url.js — no manifest write-back needed for NIKKEs.
  // This script now serves as a discovery/audit tool only.

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Update MANIFEST_VERSION only
  let src = await fs.readFile(MANIFEST, 'utf8');

  src = src.replace(
    /export const MANIFEST_VERSION = '[^']+';/,
    `export const MANIFEST_VERSION = '${today}';`,
  );

  await fs.writeFile(MANIFEST, src, 'utf8');

  console.log(`\nDiscovery complete. ${Object.keys(urlMap).length} URLs found, ${failed} failed.`);
  console.log(`Manifest version updated to: ${today}`);
  console.log('Per-character URLs are computed dynamically — no static table to update.');
}

run().catch(err => { console.error(err); process.exit(1); });
