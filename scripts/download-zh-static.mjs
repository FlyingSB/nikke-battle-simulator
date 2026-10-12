/**
 * 下载繁体中文（zh-tw）CDN 数据，转换为简体中文文本补丁，写入 src/data/static/zh-CN/。
 *
 * 用法：
 *   node scripts/download-zh-static.mjs              下载缺失的繁中原始数据，再全部转换
 *   node scripts/download-zh-static.mjs --force      强制重新下载全部繁中原始数据
 *   node scripts/download-zh-static.mjs --convert    只用缓存重新转换（调整术语表后使用，不访问网络）
 *   node scripts/download-zh-static.mjs --only=513   只处理指定角色（逗号分隔），用于调试
 *   node scripts/download-zh-static.mjs --delay=3000 请求间隔毫秒（默认 3000）
 *
 * 前置：英文快照已由 scripts/download-all-static.mjs 下载（补丁以英文快照为基准做差异）。
 * 依赖：scripts/package.json 中的 opencc-js（在 scripts/ 下执行 npm install）。
 *
 * 流程：
 *   1. 繁中原始 JSON 缓存到 scripts/cache/zh-tw/（不入库）
 *   2. OpenCC 台湾正体 → 大陆简体（含词汇转换），再套用 lib/zh-cn-glossary.mjs 游戏术语表
 *   3. 与英文快照逐字段比对，只保存不同的字符串（src/data/text-patch.js 的 diffText）
 *
 * 输出：
 *   src/data/static/zh-CN/names.json          { characters, cubes, favorites }：resource_id → 简体名称
 *   src/data/static/zh-CN/nikke/{id}.json     角色文本补丁（名称、技能名与描述、代码属性）
 *   src/data/static/zh-CN/cubes/{id}.json     魔方文本补丁
 *   src/data/static/zh-CN/favorites/{id}.json 珍藏品文本补丁
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname }                                                  from 'path';
import { fileURLToPath }                                                  from 'url';
import * as OpenCC                                                        from 'opencc-js';

import { getRoleDataUrl, getNikkeListUrl, getCubeUrl, getFavoriteItemUrl } from '../src/data/blablalink-url.js';
import { diffText }                                                        from '../src/data/text-patch.js';
import { applyGlossary }                                                   from './lib/zh-cn-glossary.mjs';
import { extractEffectTerms }                                              from './lib/effect-terms.mjs';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(__dirname, '..', 'src', 'data', 'static');
const OUT_DIR    = join(STATIC_DIR, 'zh-CN');
const RAW_DIR    = join(__dirname, 'cache', 'zh-tw');

const args         = process.argv.slice(2);
const FORCE        = args.includes('--force');
const CONVERT_ONLY = args.includes('--convert');
const ONLY         = (args.find(a => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean).map(Number);
const DELAY_MS     = Number((args.find(a => a.startsWith('--delay=')) ?? '').slice(8)) || 3000;

// 各类数据中需要本地化的顶层字段（其余字段为数值或资源名，无需比对）
const NIKKE_TEXT_KEYS = ['name_localkey', 'skill1_detail', 'skill2_detail', 'ulti_skill_detail', 'element_details'];
const CUBE_TEXT_KEYS  = ['name_localkey', 'harmonycube_skill_group'];
const FAV_TEXT_KEYS   = ['name_localkey', 'collection_skill_group_data', 'favoriteitem_skill_group_data'];

// 台湾正体（含台湾惯用词）→ 大陆简体
const toSimplified = OpenCC.Converter({ from: 'twp', to: 'cn' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function save(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

// ─── 下载（带缓存） ─────────────────────────────────────────────────────────

let _requested = false;

/**
 * 读取繁中原始 JSON：缓存命中直接返回，否则限速下载并写缓存。
 * --convert 模式下缓存缺失返回 null，不访问网络。
 */
async function fetchRaw(cacheName, url, label) {
  const cachePath = join(RAW_DIR, cacheName);
  if (!FORCE && existsSync(cachePath)) return readJson(cachePath);
  if (CONVERT_ONLY) return null;
  if (_requested) await sleep(DELAY_MS);
  _requested = true;
  process.stdout.write(`  → ${label} ... `);
  const res = await fetch(url);
  if (!res.ok) {
    process.stdout.write(`HTTP ${res.status}\n`);
    return null;
  }
  const json = await res.json();
  process.stdout.write('OK\n');
  save(cachePath, json);
  return json;
}

// ─── 转换 ───────────────────────────────────────────────────────────────────

/**
 * 递归把对象中的所有字符串转为简体并套用术语表（返回新对象）。
 * 繁中原文个别描述含字面量「\n」（反斜杠 + n，而非换行符），先还原为真正的换行。
 */
function convertDeep(v) {
  if (typeof v === 'string') return applyGlossary(toSimplified(v.replace(/\\n/g, '\n')));
  if (Array.isArray(v)) return v.map(convertDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, convertDeep(x)]));
  return v;
}

/**
 * 只取指定顶层字段，生成「简体 vs 英文」文本补丁；
 * skillsOf 给出时，从两种语言的技能描述中配对具名效果，写入补丁的 _terms 字段。
 * @param {object} en
 * @param {object} zhTw
 * @param {string[]} keys
 * @param {(o: object) => Array<object|undefined>} [skillsOf]
 */
function buildPatch(en, zhTw, keys, skillsOf) {
  const pick  = o => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
  const zh    = convertDeep(pick(zhTw));
  const patch = diffText(pick(en), zh) ?? {};
  if (skillsOf) {
    const terms = extractEffectTerms(skillsOf(en), skillsOf(zh));
    if (Object.keys(terms).length) patch._terms = terms;
  }
  return patch;
}

const nikkeSkills = o => [o.skill1_detail, o.skill2_detail, o.ulti_skill_detail];
const favSkills   = o => [
  ...(o.collection_skill_group_data ?? []),
  ...(o.favoriteitem_skill_group_data ?? []).map(e => e?.info),
];

// ─── 各类数据 ───────────────────────────────────────────────────────────────

/** 角色花名册名称：nikke_list_zh-TW_v2.json → { resource_id: 简体名 } */
async function processRosterNames() {
  console.log('\n[1/4] 角色花名册名称');
  const list = await fetchRaw('nikke_list.json', getNikkeListUrl('zh-TW'), 'nikke_list (zh-TW)');
  if (!list) throw new Error('繁中花名册缺失（--convert 模式需先完整下载一次）');
  return Object.fromEntries(list.map(c => [c.resource_id, convertDeep(c.name_localkey?.name ?? '')]).filter(([, n]) => n));
}

async function processNikkes() {
  console.log('\n[2/4] 角色技能文本');
  const ids = readdirSync(join(STATIC_DIR, 'nikke'))
    .map(f => Number(f.replace(/\.json$/, '')))
    .filter(id => !ONLY.length || ONLY.includes(id))
    .sort((a, b) => a - b);
  let ok = 0, missing = 0;
  for (const id of ids) {
    const zh = await fetchRaw(`nikke/${id}.json`, getRoleDataUrl(id, 'zh-tw'), `nikke/${id}`);
    if (!zh) { missing++; continue; }
    const en = readJson(join(STATIC_DIR, 'nikke', `${id}.json`));
    save(join(OUT_DIR, 'nikke', `${id}.json`), buildPatch(en, zh, NIKKE_TEXT_KEYS, nikkeSkills));
    ok++;
  }
  console.log(`  完成：${ok} 个，缺失 ${missing} 个`);
}

/** 魔方：CDN 文件 id（如 1000301）取自英文快照的 id 字段，输出按 resource_id（如 10001）存放 */
async function processCubes(names) {
  console.log('\n[3/4] 魔方');
  for (const file of readdirSync(join(STATIC_DIR, 'cubes'))) {
    const en  = readJson(join(STATIC_DIR, 'cubes', file));
    const rid = file.replace(/\.json$/, '');
    const zh  = await fetchRaw(`cubes/${en.id}.json`, getCubeUrl(en.id, 'zh-tw'), `cube/${en.id}`);
    if (!zh) continue;
    const patch = buildPatch(en, zh, CUBE_TEXT_KEYS);
    save(join(OUT_DIR, 'cubes', `${rid}.json`), patch);
    if (patch.name_localkey) names[rid] = patch.name_localkey;
  }
}

async function processFavorites(names) {
  console.log('\n[4/4] 珍藏品');
  for (const file of readdirSync(join(STATIC_DIR, 'favorites'))) {
    const id = file.replace(/\.json$/, '');
    const en = readJson(join(STATIC_DIR, 'favorites', file));
    const zh = await fetchRaw(`favorites/${id}.json`, getFavoriteItemUrl(id, 'zh-tw'), `favorite/${id}`);
    if (!zh) continue;
    const patch = buildPatch(en, zh, FAV_TEXT_KEYS, favSkills);
    save(join(OUT_DIR, 'favorites', `${id}.json`), patch);
    if (patch.name_localkey) names[id] = patch.name_localkey;
  }
}

// ─── 入口 ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`繁中数据 → 简体文本补丁（输出：${OUT_DIR}）`);
  if (CONVERT_ONLY) console.log('（--convert：仅使用缓存，不访问网络）');

  const characters = await processRosterNames();
  await processNikkes();
  if (ONLY.length) return; // 调试模式只处理指定角色，不改写 names.json

  const cubes = {}, favorites = {};
  await processCubes(cubes);
  await processFavorites(favorites);
  save(join(OUT_DIR, 'names.json'), { characters, cubes, favorites });
  console.log('\n全部完成。');
}

main().catch(e => {
  console.error('\n致命错误:', e.message);
  process.exit(1);
});
