/**
 * 扫描技能文件中的 Buff 名 / 命中标签，找出在中文界面下仍显示英文的词，
 * 生成（或增量更新）人工译名表 src/ui/locales/zh-game-terms.js。
 *
 * 用法：node scripts/list-untranslated-terms.mjs
 *
 * 流程：
 *   1. 对每个 src/data/skills/<id>.js，用该角色的「英文 → 简体」名称表（角色名、技能名、
 *      自动配对的具名效果 _terms）+ 珍藏品 / 魔方技能名 + 已填写的人工译名，翻译文件中的显示文本；
 *   2. 翻译后仍残留的英文片段（去掉 P3 / L2 等段号）即为待翻译词，按角色分组写入译名表；
 *   3. 译名表中已填写的译名保留；不再出现的已填词条移到文件末尾「其他」分组，不会丢失。
 *
 * 只扫描字面量；模板字符串中的 ${…} 动态部分忽略，只取其固定文字。
 * 前置：已运行 scripts/download-zh-static.mjs 生成 src/data/static/zh-CN/。
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname }                                       from 'path';
import { fileURLToPath, pathToFileURL }                        from 'url';

import { applyTextPatch }                  from '../src/data/text-patch.js';
import { createNameMap, displayGameText }  from '../src/ui/game-text.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, '..');
const SKILLS_DIR = join(ROOT, 'src', 'data', 'skills');
const STATIC_DIR = join(ROOT, 'src', 'data', 'static');
const ZH_DIR     = join(STATIC_DIR, 'zh-CN');
const TERMS_FILE = join(ROOT, 'src', 'ui', 'locales', 'zh-game-terms.js');

const readJson   = p => JSON.parse(readFileSync(p, 'utf8'));
const readJsonIf = p => (existsSync(p) ? readJson(p) : null);

// 显示文本中可保留英文的通用词（武器 / 属性缩写、爆裂阶段等，不需要翻译）
const KEEP_ENGLISH = new Set(['ATK', 'DEF', 'HP', 'AR', 'SMG', 'SR', 'MG', 'SG', 'RL', 'Burst', 'Full Burst', 'I', 'II', 'III']);

// ─── 名称表 ─────────────────────────────────────────────────────────────────

function skillPair(en, zh) {
  return [en?.name_localkey, zh?.name_localkey];
}

/** 某角色的名称对：角色名、三个技能名、自动配对的具名效果 */
function characterPairs(id) {
  const en    = readJsonIf(join(STATIC_DIR, 'nikke', `${id}.json`));
  const patch = readJsonIf(join(ZH_DIR, 'nikke', `${id}.json`));
  if (!en || !patch) return [];
  const zh = applyTextPatch(en, patch);
  return [
    [en.name_localkey, zh.name_localkey],
    ...['skill1_detail', 'skill2_detail', 'ulti_skill_detail'].map(k => skillPair(en[k], zh[k])),
    ...Object.entries(patch._terms ?? {}),
  ];
}

/** 所有角色共用的名称对：珍藏品与魔方的技能名、珍藏品具名效果 */
function sharedPairs() {
  const pairs = [];
  for (const [dir, key] of [['favorites', 'collection_skill_group_data'], ['cubes', 'harmonycube_skill_group']]) {
    for (const file of readdirSync(join(STATIC_DIR, dir))) {
      const en    = readJson(join(STATIC_DIR, dir, file));
      const patch = readJsonIf(join(ZH_DIR, dir, file));
      if (!patch) continue;
      const zh = applyTextPatch(en, patch);
      (en[key] ?? []).forEach((s, i) => pairs.push(skillPair(s, zh[key]?.[i])));
      (en.favoriteitem_skill_group_data ?? []).forEach((e, i) => pairs.push(skillPair(e?.info, zh.favoriteitem_skill_group_data?.[i]?.info)));
      pairs.push(...Object.entries(patch._terms ?? {}));
    }
  }
  return pairs;
}

// ─── 提取显示文本 ───────────────────────────────────────────────────────────

const STR = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\])*)\1`;
const PATTERNS = [
  // pushBuff / buffLog / 触发器配置中的显示名
  new RegExp(String.raw`\b(?:name|label|skillLabel|buffName|weaponSwitchLabel)\s*:\s*` + STR, 'g'),
  // 常量形式的名称（如 const SNIPE_BUFF_NAME = 'Snipe Mode'）
  new RegExp(String.raw`const\s+[A-Z0-9_]*(?:NAME|LABEL)[A-Z0-9_]*\s*=\s*` + STR, 'g'),
  // 带槽位前缀的命中标签（'S2 P2 Projectile Attachment'）
  new RegExp(String.raw`(['"\x60])((?:S1|S2|Burst)(?: P\d+)? [^'"\x60\n]+)\1`, 'g'),
];

/** 与 store.formatHitLabel 一致：去掉槽位前缀，只留名称部分 */
function toDisplay(label) {
  const m = label.match(/^(?:S\d+|Burst)(?: P\d+)? (.+)$/);
  return m && !/^L\d+$/.test(m[1]) ? m[1] : label;
}

function extractTexts(source) {
  const out = new Set();
  for (const re of PATTERNS) {
    for (const m of source.matchAll(re)) {
      // 还原源码转义（Agent\'s → Agent's）；模板字符串的动态部分替换为分隔符，只分析固定文字
      const text = m[2].replace(/\\(.)/g, '$1').replace(/\$\{[^}]*\}/g, ' | ').trim();
      if (text && /[A-Za-z]/.test(text) && !/^[A-Z0-9_]+$/.test(text)) out.add(toDisplay(text));
    }
  }
  return [...out];
}

/**
 * 从显示文本中取出「名称」部分作为译名键：去掉括号内的类型词（已由 BUFF_TYPE_ZH 翻译）、
 * P3 / L2 段号与 ×n 倍率；模板字符串的动态部分把文本切成多段，每段单独成为候选。
 */
function nameKeys(text) {
  return text.split(' | ')
    .map(seg => seg
      // 只去掉末尾的类型括号；名称中间的括号是名称本身（如 'Starfish (Shaped) Omurice'）
      .replace(/(?:\s*\([^()]*\))+\s*$/, '')
      .replace(/(?:^|\s)(?:[PL]\d+|\*\d+|×\d+)(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(seg => /[A-Za-z]{2,}/.test(seg) && !KEEP_ENGLISH.has(seg));
}

/** 翻译后是否仍残留英文单词（可保留的缩写除外） */
function hasEnglishLeft(translated) {
  const words = translated.match(/[A-Za-z][A-Za-z'’]*/g) ?? [];
  return words.some(w => !KEEP_ENGLISH.has(w));
}

// ─── 译名表读写 ─────────────────────────────────────────────────────────────

async function loadExisting() {
  if (!existsSync(TERMS_FILE)) return {};
  const mod = await import(pathToFileURL(TERMS_FILE).href);
  return mod.default ?? {};
}

const q = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function renderTermsFile(groups, extras) {
  const lines = [
    '/**',
    ' * 战斗日志游戏文本人工译名表（英文 → 简体），中文界面下优先于自动翻译。',
    ' *',
    ' * 由 node scripts/list-untranslated-terms.mjs 生成并增量更新：列出技能文件中',
    ' * 自动翻译后仍含英文的完整名称（已去掉括号类型词与 P/L 段号）。在右侧填写中文即可生效；留空则继续显示英文。',
    ' * 重新运行脚本会保留已填写的译名。键按整词匹配，对所有角色生效。',
    ' */',
    'export default {',
  ];
  for (const { title, entries } of groups) {
    if (!entries.length) continue;
    lines.push(`  // ── ${title}`);
    for (const [en, zh] of entries) lines.push(`  ${q(en)}: ${q(zh)},`);
  }
  if (extras.length) {
    lines.push('  // ── 其他（技能文件中已不再出现，或手工添加）');
    for (const [en, zh] of extras) lines.push(`  ${q(en)}: ${q(zh)},`);
  }
  lines.push('};', '');
  return lines.join('\n');
}

// ─── 入口 ───────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(join(ZH_DIR, 'names.json'))) {
    console.error('缺少 src/data/static/zh-CN/，请先运行 node scripts/download-zh-static.mjs');
    process.exit(1);
  }
  const existing = await loadExisting();
  const filled   = Object.entries(existing).filter(([, zh]) => zh);
  const names    = readJson(join(ZH_DIR, 'names.json')).characters;
  const roster   = Object.fromEntries(readJson(join(STATIC_DIR, 'characters.json')).map(c => [c.resource_id, c.name_localkey?.name]));
  const shared   = sharedPairs();

  const files = readdirSync(SKILLS_DIR).filter(f => f.endsWith('.js'))
    .sort((a, b) => (parseInt(a, 10) || Infinity) - (parseInt(b, 10) || Infinity));
  const allCharPairs = files.filter(f => /^\d+\.js$/.test(f)).flatMap(f => characterPairs(parseInt(f, 10)));

  const seen = new Set();
  const groups = [];
  for (const file of files) {
    const id = /^\d+\.js$/.test(file) ? parseInt(file, 10) : null;
    // 共享文件（bunny-shared.js 等）用所有角色的名称表
    const map = createNameMap([...filled, ...(id ? characterPairs(id) : allCharPairs), ...shared]);
    const entries = [];
    for (const text of extractTexts(readFileSync(join(SKILLS_DIR, file), 'utf8'))) {
      for (const key of nameKeys(text)) {
        if (seen.has(key)) continue;
        // 已填写的译名视为已翻译，但仍保留在原分组中便于对照
        if (!existing[key] && !hasEnglishLeft(displayGameText(key, 'zh', map))) continue;
        seen.add(key);
        entries.push([key, existing[key] ?? '']);
      }
    }
    const title = id ? `${id} ${roster[id] ?? ''}（${names[id] ?? '无简体名'}）` : `${file}（共享）`;
    groups.push({ title, entries });
  }
  const extras = Object.entries(existing).filter(([en]) => !seen.has(en));

  writeFileSync(TERMS_FILE, renderTermsFile(groups, extras));
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  const todo  = groups.reduce((n, g) => n + g.entries.filter(([, zh]) => !zh).length, 0);
  console.log(`已写入 ${TERMS_FILE}`);
  console.log(`待翻译 ${todo} 个（共 ${total} 个，另有 ${extras.length} 个其他词条）`);
}

main().catch(e => {
  console.error('致命错误:', e.message);
  process.exit(1);
});
