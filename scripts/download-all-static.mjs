/**
 * 下载所有 CDN 静态资源到 src/data/static/。
 *
 * 用法：node scripts/download-all-static.mjs [--force]
 *
 * 说明：
 *   - 每次请求间隔 5 秒，避免被屏蔽
 *   - 已存在的文件自动跳过（传 --force 可强制重新下载）；花名册 characters.json 例外，每次都刷新，
 *     新角色的详情随后在步骤 4 自动补齐，结束时列出新增角色与后续步骤
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

// 花名册每次都重新下载（只有一个请求），新角色才能进入 characters.json → 角色选择器
const ALWAYS_REFRESH_KEYS = new Set(['characters']);

/** 读取当前花名册的 resource_id 集合（文件不存在时为空集） */
function readRosterIds() {
  const p = join(STATIC_DIR, 'characters.json');
  if (!existsSync(p)) return new Set();
  return new Set(JSON.parse(readFileSync(p, 'utf8')).map(c => c.resource_id));
}

async function downloadStaticFiles() {
  console.log('\n[1/4] 静态数据文件（DATA_URLS）');
  let first = true;
  for (const [key, url] of Object.entries(DATA_URLS)) {
    const filePath = join(STATIC_DIR, `${key}.json`);
    if (!FORCE && !ALWAYS_REFRESH_KEYS.has(key) && existsSync(filePath)) {
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

  const oldIds = readRosterIds();
  await downloadStaticFiles();
  await downloadCubes();
  await downloadFavorites();
  await downloadNikkes();

  reportNewCharacters(oldIds);
  console.log('\n全部完成。');
}

/** 列出本次新增的角色，并提示让其出现在角色选择器所需的后续步骤 */
function reportNewCharacters(oldIds) {
  const roster = JSON.parse(readFileSync(join(STATIC_DIR, 'characters.json'), 'utf8'));
  const added  = roster.filter(c => !oldIds.has(c.resource_id) && c.is_visible !== false);
  if (added.length === 0) {
    console.log('\n花名册无新增角色。');
    return;
  }
  console.log(`\n花名册新增 ${added.length} 个角色：`);
  for (const c of added) console.log(`  + ${c.resource_id}  ${c.name_localkey?.name ?? ''}`);
  console.log([
    '',
    '后续步骤（角色选择器只允许选择已建模角色）：',
    '  1. node scripts/download-character-images.mjs   # 头像',
    '  2. node scripts/download-zh-static.mjs           # 简体中文名 / 技能文本',
    '  3. 新建 src/data/skills/<id>.js 并在 src/data/skill-traits.js 注册（SKILL_TRAITS）',
    '  4. docs/data-catalog.md 增加角色行；运行 node scripts/list-untranslated-terms.mjs',
    '  5. 浏览器刷新页面即可（静态快照不走 IndexedDB 缓存，无需改 MANIFEST_VERSION）',
  ].join('\n'));
}

main().catch(e => {
  console.error('\n致命错误:', e.message);
  process.exit(1);
});
