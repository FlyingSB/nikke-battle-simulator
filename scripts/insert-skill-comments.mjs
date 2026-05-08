/**
 * insert-skill-comments.mjs
 *
 * 从静态 JSON 中提取技能描述（保留原始占位符 {description_value_01} 等），
 * 以注释形式插入 src/data/skill-traits.js 各 skill1 / skill2 / burst 块之前，
 * 并附上各占位符的10级数值数列。
 *
 * 用法：node scripts/insert-skill-comments.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

function loadNikke(id) {
  const p = join(ROOT, 'src/data/static/nikke', `${id}.json`);
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return null; }
}

function stripColor(s) {
  return (s ?? '').replace(/<color[^>]*>/g, '').replace(/<\/color>/g, '').trimEnd();
}

// 从描述文本中提取出现的占位符编号（1-indexed，如 "01"、"02"）
function extractPlaceholders(desc) {
  const nums = new Set();
  for (const m of desc.matchAll(/\{description_value_(\d+)\}/g)) nums.add(m[1]);
  return [...nums].sort();
}

// 生成插入在 skillKey 之前的注释块（不含末尾换行）
function makeCommentBlock(detail, indent) {
  if (!detail) return null;

  const skillName = detail.name_localkey ?? '（无名称）';
  const rawDesc   = detail.description_localkey ?? '';
  const cleanDesc = stripColor(rawDesc);

  const lines = [];
  lines.push(`${indent}// ── ${skillName}`);

  // 描述文本逐行
  for (const row of cleanDesc.split('\n')) {
    lines.push(`${indent}// ${row}`);
  }

  // 占位符数值数组
  const placeholders = extractPlaceholders(cleanDesc);
  if (placeholders.length > 0) {
    for (const numStr of placeholders) {
      const idx = parseInt(numStr, 10) - 1;  // 文本 01 → 数组 index 0
      const arr = detail.description_value_list?.[idx]?.description_value;
      const valStr = arr ? arr.join(', ') : '（无数据）';
      lines.push(`${indent}// p${numStr}: [${valStr}]`);
    }
  }

  return lines.join('\n');
}

// ── 主逻辑：逐行处理 skill-traits.js ──────────────────────────────────────

const filePath   = join(ROOT, 'src/data/skill-traits.js');
const original   = readFileSync(filePath, 'utf8');
const inputLines = original.split('\n');
const output     = [];

// 匹配 "  <id>: {" 形式的角色块开头（2空格缩进）
const reCharBlock = /^  (\d+): \{/;
// 匹配 "    skill1: {" / "    skill2: {" / "    burst: {" （4空格缩进，行首）
const reSkillLine = /^(    )(skill1|skill2|burst): \{/;

let currentCharId = null;
let currentData   = null;

const SKILL_KEY_MAP = {
  skill1: 'skill1_detail',
  skill2: 'skill2_detail',
  burst:  'ulti_skill_detail',
};

// 已插入注释的 (charId, skillKey) 组合，避免重复插入
const inserted = new Set();

for (let i = 0; i < inputLines.length; i++) {
  const line = inputLines[i];

  // 检测角色块开头
  const charMatch = line.match(reCharBlock);
  if (charMatch) {
    currentCharId = parseInt(charMatch[1], 10);
    currentData   = loadNikke(currentCharId);
  }

  // 检测 skill1 / skill2 / burst 行
  const skillMatch = line.match(reSkillLine);
  if (skillMatch && currentCharId != null && currentData) {
    const indent   = skillMatch[1];   // "    "
    const skillKey = skillMatch[2];   // "skill1" | "skill2" | "burst"
    const uid      = `${currentCharId}:${skillKey}`;

    if (!inserted.has(uid)) {
      inserted.add(uid);
      const detailKey = SKILL_KEY_MAP[skillKey];
      const block = makeCommentBlock(currentData[detailKey], indent);
      if (block) {
        output.push(block);
      }
    }
  }

  output.push(line);
}

const result = output.join('\n');
writeFileSync(filePath, result, 'utf8');
console.log(`✓ 已插入注释，共处理 ${inserted.size} 个技能块`);
console.log(`  插入详情：`);
for (const uid of inserted) console.log(`    ${uid}`);
