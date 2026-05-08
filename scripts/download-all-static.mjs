/**
 * 下载所有 CDN 静态资源到 src/data/static/。
 *
 * 用法：node scripts/download-all-static.mjs [--force]
 *
 * 说明：
 *   - 每次请求间隔 5 秒，避免被屏蔽
 *   - 已存在的文件自动跳过（传 --force 可强制重新下载）
 *   - 下载完成后，loader.js 和 nikke-cache.mjs 优先读取本地文件，不再访问 CDN
 *
 * 目录结构：
 *   src/data/static/
 *     {key}.json             ← DATA_URLS 各静态文件（归一化为数组）
 *     cubes/{id}.json        ← CUBE_URLS
 *     favorites/{id}.json    ← FAVORITE_ITEM_URLS
 *     nikke/{id}.json        ← 每个角色详情（roledata）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname }                                       from 'path';
import { fileURLToPath }                                       from 'url';

import { DATA_URLS, CUBE_URLS, FAVORITE_ITEM_URLS } from '../src/data/manifest.js';
import { getRoleDataUrl }                            from '../src/data/blablalink-url.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(__dirname, '..', 'src', 'data', 'static');
const FORCE      = process.argv.includes('--force');
const DELAY_MS   = 5000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function save(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function downloadJson(url, label) {
  process.stdout.write(`  → ${label} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  process.stdout.write('OK\n');
  return data;
}

// ─── 1. 静态数据文件（DATA_URLS）────────────────────────────────────────────

async function downloadStaticFiles() {
  console.log('\n[1/4] 静态数据文件（DATA_URLS）');
  let first = true;
  for (const [key, url] of Object.entries(DATA_URLS)) {
    const filePath = join(STATIC_DIR, `${key}.json`);
    if (!FORCE && existsSync(filePath)) {
      console.log(`  ✓ ${key} 已存在，跳过`);
      continue;
    }
    if (!first) await sleep(DELAY_MS);
    first = false;
    const json = await downloadJson(url, key);
    // 部分文件包裹为 { version, records }，归一化为数组
    const data = Array.isArray(json) ? json : (json.records ?? json);
    save(filePath, data);
  }
}

// ─── 2. 魔方数据（CUBE_URLS）────────────────────────────────────────────────

async function downloadCubes() {
  console.log('\n[2/4] 魔方数据（CUBE_URLS）');
  let first = true;
  for (const [id, url] of Object.entries(CUBE_URLS)) {
    const filePath = join(STATIC_DIR, 'cubes', `${id}.json`);
    if (!FORCE && existsSync(filePath)) {
      console.log(`  ✓ cube/${id} 已存在，跳过`);
      continue;
    }
    if (!first) await sleep(DELAY_MS);
    first = false;
    const data = await downloadJson(url, `cube/${id}`);
    save(filePath, data);
  }
}

// ─── 3. 收藏品数据（FAVORITE_ITEM_URLS）──────────────────────────────────────

async function downloadFavorites() {
  console.log('\n[3/4] 收藏品数据（FAVORITE_ITEM_URLS）');
  let first = true;
  for (const [id, url] of Object.entries(FAVORITE_ITEM_URLS)) {
    const filePath = join(STATIC_DIR, 'favorites', `${id}.json`);
    if (!FORCE && existsSync(filePath)) {
      console.log(`  ✓ favorites/${id} 已存在，跳过`);
      continue;
    }
    if (!first) await sleep(DELAY_MS);
    first = false;
    const data = await downloadJson(url, `favorite/${id}`);
    save(filePath, data);
  }
}

// ─── 4. 每个角色详情（roledata）──────────────────────────────────────────────

async function downloadNikkes() {
  console.log('\n[4/4] 角色详情（roledata）');

  const charactersPath = join(STATIC_DIR, 'characters.json');
  if (!existsSync(charactersPath)) {
    console.error('  ✗ characters.json 不存在，请先完成步骤 1');
    return;
  }

  const characters = JSON.parse(readFileSync(charactersPath, 'utf8'));
  console.log(`  共 ${characters.length} 个角色`);

  let first = true;
  let ok = 0, skipped = 0, failed = 0;

  for (const char of characters) {
    const id       = char.resource_id;
    const name     = char.name_localkey?.name ?? `id_${id}`;
    const filePath = join(STATIC_DIR, 'nikke', `${id}.json`);

    if (!FORCE && existsSync(filePath)) {
      skipped++;
      continue;
    }

    if (!first) await sleep(DELAY_MS);
    first = false;

    const url = getRoleDataUrl(id, 'en');
    try {
      const data = await downloadJson(url, `nikke/${id} (${name})`);
      save(filePath, data);
      ok++;
    } catch (e) {
      console.error(`  ✗ nikke/${id} (${name}) 失败: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n  完成：新下载 ${ok} 个，跳过 ${skipped} 个，失败 ${failed} 个`);
}

// ─── 入口 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('开始下载 CDN 静态资源...');
  console.log(`目标目录：${STATIC_DIR}`);
  if (FORCE) console.log('（--force 模式：强制重新下载所有文件）');

  await downloadStaticFiles();
  await downloadCubes();
  await downloadFavorites();
  await downloadNikkes();

  console.log('\n全部完成。');
}

main().catch(e => {
  console.error('\n致命错误:', e.message);
  process.exit(1);
});
