/**
 * dump-skill-descriptions.mjs
 *
 * 对 SKILL_TRAITS 中所有建模角色，取随机技能等级，输出：
 *   1. 游戏原始技能描述（CDN description_localkey，数值已填入对应等级）
 *   2. 模型读取的参数清单（getSkillValue paramIndex → 实际值，标注动态/硬编码状态）
 *
 * 用法：node scripts/dump-skill-descriptions.mjs [seed]
 *   seed 为可选整数（0–99），用于固定随机等级，便于复现。
 *   省略 seed 则每次运行均取新随机值。
 *
 * 输出：tmp/skill-desc-review.md
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

// ─── 随机种子（线性同余，仅用于生成等级） ───────────────────────────────────────
const seedArg = parseInt(process.argv[2] ?? '', 10);
let _rng = isNaN(seedArg) ? Date.now() : (seedArg * 1_000_003 + 42);
function randInt(min, max) {
  _rng = (_rng * 1664525 + 1013904223) & 0x7fffffff;
  return min + (_rng % (max - min + 1));
}
function lvl() { return randInt(1, 10); }

// ─── 从 CDN 静态快照加载角色数据 ─────────────────────────────────────────────
function loadNikke(id) {
  const p = join(ROOT, 'src/data/static/nikke', `${id}.json`);
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return null; }
}

// ─── 辅助：按等级从 description_value_list 取值（浮点字符串） ──────────────────
function sv(detail, paramIdx, skillLv) {
  const raw = detail?.description_value_list?.[paramIdx]?.description_value?.[skillLv - 1];
  return raw != null ? parseFloat(raw) : null;
}

// ─── 辅助：将 CDN description_localkey 的占位符替换为实际值 ────────────────────
function fillDesc(desc, detail, skillLv) {
  if (!desc) return '（无描述）';
  let s = desc.replace(/<color[^>]*>/g, '').replace(/<\/color>/g, '');
  s = s.replace(/\{description_value_(\d+)\}/g, (_, num) => {
    const idx = parseInt(num, 10) - 1;
    const val = sv(detail, idx, skillLv);
    return val != null ? String(val) : `{p${idx}?}`;
  });
  return s;
}

// ─── 辅助：构建"模型参数"行 ──────────────────────────────────────────────────
function paramLine(label, detail, paramIdx, skillLv, opts = {}) {
  const val = sv(detail, paramIdx, skillLv);
  const displayVal = val != null
    ? (opts.raw ? `${val}` : `${val}%`)
    : '（无 CDN 数据）';
  return `  · param[${paramIdx}] ${label.padEnd(28)} = ${displayVal}`;
}

function hardcoded(label, value) {
  return `  · [硬编码] ${label.padEnd(26)} = ${value}  ⚠️ 待动态化`;
}

function todo(label) {
  return `  · [TODO] ${label}  （未建模）`;
}

// ─── 角色数据表 ──────────────────────────────────────────────────────────────
const CHARACTERS = [
  // ── 15 · Anis: Sparkling Summer ──────────────────────────────────────────
  {
    id: 15, name: 'Anis: Sparkling Summer', burstStep: 'B3', weapon: 'SG',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        paramLine('ATK% (caster ATK flat)',     data.skill1_detail, 0, lvS1),
        paramLine('ATK 持续时间(s)',              data.skill1_detail, 1, lvS1, { raw: true }),
        paramLine('Reload Speed%',              data.skill1_detail, 2, lvS1),
        paramLine('ReloadSpd 持续时间(s)',        data.skill1_detail, 3, lvS1, { raw: true }),
      ],
      skill2: [
        paramLine('Skill Damage%',             data.skill2_detail, 0, lvS2),
        paramLine('Parts Damage%',             data.skill2_detail, 1, lvS2),
      ],
      burst: [
        paramLine('Max Ammo 降幅%',             data.ulti_skill_detail, 0, lvB),
        paramLine('Reload Speed%',             data.ulti_skill_detail, 2, lvB),
        paramLine('Elem Adv ATK Damage%',      data.ulti_skill_detail, 4, lvB),
      ],
    }),
  },

  // ── 16 · Rapi: Red Hood ──────────────────────────────────────────────────
  {
    id: 16, name: 'Rapi: Red Hood', burstStep: 'B3', weapon: 'MG',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        '  [CA 场景]',
        paramLine('CD 减少(sec)',               data.skill1_detail, 1, lvS1, { raw: true }),
        paramLine('Attack Damage%',            data.skill1_detail, 6, lvS1),
        '  [非 CA 场景]',
        paramLine('ATK%',                      data.skill1_detail, 2, lvS1),
        paramLine('Interruption Parts Dmg%',   data.skill1_detail, 4, lvS1),
        todo('CA: Explosion Radius (未建模)'),
      ],
      skill2: [
        paramLine('Hit Mult%',                 data.skill2_detail, 1, lvS2),
        paramLine('Attach Passive +%',         data.skill2_detail, 4, lvS2),
        todo('Explosion Mult (独立计算)'),
      ],
      burst: [
        '  [CA B1 场景]',
        paramLine('ATK flat%',                 data.ulti_skill_detail, 2, lvB),
        '  [Stage3 场景]',
        paramLine('Burst Hit%',                data.ulti_skill_detail, 4, lvB),
        paramLine('Burst Attach Bonus+%',      data.ulti_skill_detail, 5, lvB),
      ],
    }),
  },

  // ── 82 · Liter ───────────────────────────────────────────────────────────
  {
    id: 82, name: 'Liter', burstStep: 'B1', weapon: 'SMG',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        hardcoded('FB CD减少 1st (sec)', '2.34'),
        hardcoded('FB CD减少 2nd (sec)', '+2.70'),
        hardcoded('FB CD减少 3rd+ (sec)', '+3.17'),
        '  [每次 Burst 使用累计]',
        paramLine('Max Ammo% (T1, 5s)',        data.skill1_detail, 3, lvS1),
        paramLine('Crit Damage% (T2, 5s)',     data.skill1_detail, 5, lvS1),
        paramLine('ATK% (T3, 5s)',             data.skill1_detail, 7, lvS1),
      ],
      skill2: [
        todo('Cover HP 回复 2 名友军（无受伤模型）'),
      ],
      burst: [
        hardcoded('ATK% 全员 5s', '66%  ⚠️ 待动态化 (effects 声明)'),
      ],
    }),
  },

  // ── 183 · Maiden: Ice Rose ───────────────────────────────────────────────
  {
    id: 183, name: 'Maiden: Ice Rose', burstStep: 'B3', weapon: 'RL',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        todo('B1 进入 → MP=0 初始化 (S2 inline)'),
        todo('全爆裂 → MP+1 (S2 inline)'),
        '  [每 6 次 FC → Max HP buff 叠层]',
        paramLine('Max HP% per stack',         data.skill1_detail, 2, lvS1),
        paramLine('持续时间(s)',                data.skill1_detail, 3, lvS1, { raw: true }),
      ],
      skill2: [
        '  [S2 inline 于 S1 触发：Electric 友军]',
        paramLine('Elem Adv ATK Damage%',      data.skill2_detail, 0, lvS2),
        paramLine('ATK flat% (of Maiden ATK)', data.skill2_detail, 2, lvS2),
        '  [S2 Part3：每次 FC → 技能伤害]',
        paramLine('Skill Damage%',             data.skill2_detail, 9, lvS2),
        '  [S2 Part2 inline 于 Burst]',
        paramLine('Self Elem Adv ATK Dmg%',    data.skill2_detail, 4, lvS2),
        paramLine('Self ATK flat% (of HP)',    data.skill2_detail, 6, lvS2),
      ],
      burst: [
        '  [每 MP 点 × hit]',
        paramLine('Hit Mult% per MP',          data.ulti_skill_detail, 2, lvB),
        hardcoded('HP 系数 (固定 10%)', '10%  (计入 extraAtkFlat)'),
      ],
    }),
  },

  // ── 191 · Alice ──────────────────────────────────────────────────────────
  {
    id: 191, name: 'Alice', burstStep: 'B3', weapon: 'SR',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        paramLine('Charge Time 减少% (flat)',  data.skill1_detail, 1, lvS1),
        paramLine('Charge Damage%',           data.skill1_detail, 3, lvS1),
      ],
      skill2: [
        todo('HP > 80% → Pierce (穿透未建模)'),
        todo('HP < 80% → Life Steal (未建模)'),
      ],
      burst: [
        paramLine('Charge Speed%',            data.ulti_skill_detail, 0, lvB),
        paramLine('ATK%',                     data.ulti_skill_detail, 2, lvB),
      ],
    }),
  },

  // ── 223 · Nayuta ─────────────────────────────────────────────────────────
  {
    id: 223, name: 'Nayuta', burstStep: 'B2', weapon: 'SMG',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        todo('Indomitability 9s (蓄力切换未建模)'),
        '  [S1 Part2：每次 Memory Absorption 触发，全员 5s]',
        paramLine('Core Damage%',              data.skill1_detail, 2, lvS1),
        paramLine('ATK flat% (of Nayuta ATK)', data.skill1_detail, 4, lvS1),
        paramLine('自身 HP 回复%',              data.skill1_detail, 7, lvS1),
        '  [S1 Part3：Memory Incineration FC → 技能伤害，inline 于 Burst]',
        hardcoded('Hit Mult', '5.3046  (1.50+3.8046)'),
      ],
      skill2: [
        '  [每 3s +1 层（上限 30）]',
        paramLine('Hit Rate% per stack',       data.skill2_detail, 8, lvS2),
        '  [Stage 1 (≥2层)]',
        paramLine('ATK% (永久)',               data.skill2_detail, 5, lvS2),
        '  [Stage 2 (≥10层)]',
        paramLine('Attack Damage% (永久)',     data.skill2_detail, 7, lvS2),
        '  [Stage 3 (=30层)]',
        paramLine('Core Damage% (永久)',       data.skill2_detail, 3, lvS2),
      ],
      burst: [
        paramLine('Attack Damage% 全员 15s',   data.ulti_skill_detail, 0, lvB),
        paramLine('Burst Hit%',                data.ulti_skill_detail, 4, lvB),
        '  [Memory Incineration 武器切换 10s]',
        paramLine('Weapon Switch Hit%',        data.ulti_skill_detail, 2, lvB),
        hardcoded('FC 倍率', '250% (固定)'),
        hardcoded('攻击间隔', '19 ticks/shot (实测 32次/10s)'),
      ],
    }),
  },

  // ── 225 · Scarlet: Black Shadow ──────────────────────────────────────────
  {
    id: 225, name: 'Scarlet: Black Shadow', burstStep: 'B3', weapon: 'RL',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        '  [计数器 0-9；每 3/6/9 步触发]',
        paramLine('Dmg Mult% @ step 3',       data.skill1_detail, 1, lvS1),
        paramLine('Dmg Mult% @ step 6',       data.skill1_detail, 2, lvS1),
        paramLine('Dmg Mult% @ step 9',       data.skill1_detail, 3, lvS1),
        hardcoded('Burst 模式步进', '+3/shot (固定机制)'),
      ],
      skill2: [
        hardcoded('Ammo 扩充倍率', '×1.6 (CDN 参数，待确认 paramIndex)'),
      ],
      burst: [
        paramLine('ATK%',                     data.ulti_skill_detail, 1, lvB),
        paramLine('Charge Damage%',           data.ulti_skill_detail, 3, lvB),
      ],
    }),
  },

  // ── 262 · Liberalio ──────────────────────────────────────────────────────
  {
    id: 262, name: 'Liberalio', burstStep: 'B3', weapon: 'SR',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        '  [T1：FB 入场 → 自身 ATK% 3s]',
        paramLine('ATK%',                     data.skill1_detail, 0, lvS1),
        '  [T2：FC 命中核心 → Attack Damage% 60s 刷新]',
        paramLine('Attack Damage%',           data.skill1_detail, 2, lvS1),
        '  [T3：FC 命中 → 5× 技能伤害]',
        paramLine('Each Skill Hit%',          data.skill1_detail, 4, lvS1),
        '  [T4：FB → ATK 最低 B3 Charge Time 减少%]',
        paramLine('Charge Time 减少%',        data.skill1_detail, 5, lvS1),
      ],
      skill2: [
        '  [首次 FC → Raging Current 永久]',
        paramLine('Attack Damage%',           data.skill2_detail, 0, lvS2),
      ],
      burst: [
        paramLine('Attack Damage% 10s',       data.ulti_skill_detail, 0, lvB),
        paramLine('Burst Hit%',               data.ulti_skill_detail, 2, lvB),
        hardcoded('延迟', '0.97s (固定)'),
      ],
    }),
  },

  // ── 330 · Crown ──────────────────────────────────────────────────────────
  {
    id: 330, name: 'Crown', burstStep: 'B2', weapon: 'MG',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        '  [爆裂施放者：ATK flat + Reload Speed]',
        paramLine('ATK flat% (of Crown ATK)', data.skill1_detail, 0, lvS1),
        paramLine('Reload Speed%',            data.skill1_detail, 2, lvS1),
        '  [非施放者：DEF flat + Reload Speed（同上 RS）]',
        paramLine('DEF flat% (of Crown DEF)', data.skill1_detail, 4, lvS1),
      ],
      skill2: [
        '  [每 43 发 +1 层；满 20 层触发]',
        paramLine('HP 回复% (自身)',           data.skill2_detail, 5, lvS2),
        paramLine('Attack Damage% 全员 7s',   data.skill2_detail, 6, lvS2),
        hardcoded('触发层数', '20 层 (固定)'),
      ],
      burst: [
        paramLine('Attack Damage% 全员 15s',  data.ulti_skill_detail, 0, lvB),
        paramLine('Shield% (of Crown HP)',    data.ulti_skill_detail, 2, lvB),
      ],
    }),
  },

  // ── 354 · Mast: Romantic Maid ────────────────────────────────────────────
  {
    id: 354, name: 'Mast: Romantic Maid', burstStep: 'B2', weapon: 'MG',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        '  [B1 入场 +1 Drunken (上限3)；首层触发全员永久 buff]',
        paramLine('Crit Rate%',               data.skill1_detail, 2, lvS1),
        paramLine('ATK flat% (of Mast ATK)', data.skill1_detail, 3, lvS1),
        hardcoded('Hit Rate 自身降幅', '-20% (固定，debuff，无 DPS 影响)'),
      ],
      skill2: [
        '  [B3 入场，Drunken≥1 → 全员 ×stacks 10s]',
        paramLine('Distributed Damage% per stack', data.skill2_detail, 0, lvS2),
        paramLine('Reload Speed% per stack',  data.skill2_detail, 2, lvS2),
        '  [Hangover：3层满 → 全爆裂结束自身眩晕 10s + 清层]',
      ],
      burst: [
        paramLine('Crit Damage% (无条件)',    data.ulti_skill_detail, 0, lvB),
        paramLine('Attack Damage% (无条件)', data.ulti_skill_detail, 2, lvB),
        paramLine('ATK flat% per stack',     data.ulti_skill_detail, 4, lvB),
      ],
    }),
  },

  // ── 355 · Anchor: Innocent Maid ──────────────────────────────────────────
  {
    id: 355, name: 'Anchor: Innocent Maid', burstStep: 'B2', weapon: 'RL',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        '  [S1 Part1："前效重复触发" FB 入场]',
        todo('T1：HP Recovery Potency ▲% (治疗系统未建模)'),
        paramLine('T2：Distributed Damage% 10s', data.skill1_detail, 2, lvS1),
        '  T3：移除 1 层 Drunken (机制)',
        '  [S1 Part2：同队友存在 → 自身 HoT ×8 轮 (1s 间隔)]',
        paramLine('HoT per tick%',             data.skill1_detail, 5, lvS1),
      ],
      skill2: [
        '  ["前效重复触发" 全爆裂结束]',
        paramLine('T1：Hit Rate%',             data.skill2_detail, 0, lvS2),
        paramLine('T2：ATK flat% (of Anchor)', data.skill2_detail, 2, lvS2),
        paramLine('T3：Reload Speed%',         data.skill2_detail, 4, lvS2),
      ],
      burst: [
        paramLine('ATK flat% (of Anchor ATK)', data.ulti_skill_detail, 3, lvB),
        paramLine('HP 回复% (全员即时)',        data.ulti_skill_detail, 2, lvB),
        todo('过量治疗储存 (未建模)'),
      ],
    }),
  },

  // ── 511 · Cinderella ─────────────────────────────────────────────────────
  {
    id: 511, name: 'Cinderella', burstStep: 'B3', weapon: 'RL',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        '  [S1 Part1：B3 入场 → ATK flat = X% × finalMaxHP]',
        paramLine('ATK flat% (of final MaxHP)', data.skill1_detail, 0, lvS1),
        '  [S1 Part2：FC → Charge Speed ▲100% → reload 后移除]',
        hardcoded('CS boost', '100% (固定机制)'),
        '  [S1 Part3：FC → 附加技能伤害]',
        paramLine('Skill Hit%',                data.skill1_detail, 3, lvS1),
      ],
      skill2: [
        '  [Beautiful：每 3s +1 层（上限12，永久）]',
        paramLine('Max HP% per stack',         data.skill2_detail, 1, lvS2),
        hardcoded('层数上限 / 间隔', '12层 / 3s (固定)'),
      ],
      burst: [
        '  [10 × Part1 命中，每发追加 stacks × Part2]',
        paramLine('Part1 Burst Hit% ×10',      data.ulti_skill_detail, 0, lvB),
        paramLine('Part2 Beautiful Bonus%',    data.ulti_skill_detail, 2, lvB),
      ],
    }),
  },

  // ── 513 · Little Mermaid ─────────────────────────────────────────────────
  {
    id: 513, name: 'Little Mermaid', burstStep: 'B1', weapon: 'SMG',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        '  [T1：FB 入场 → 全员 Attack Damage%]',
        paramLine('Attack Damage%',            data.skill1_detail, 1, lvS1),
        '  [全爆裂结束 → 全员 CD 减少]',
        paramLine('CD 减少(sec)',               data.skill1_detail, 0, lvS1, { raw: true }),
        '  [每 400 发 → 爆裂槽 ▲X%]',
        paramLine('Gauge Boost%',              data.skill1_detail, 4, lvS1),
      ],
      skill2: [
        '  [Bubble：战斗开始 → 敌人承伤 ▲X%]',
        paramLine('Enemy Damage Taken%',       data.skill2_detail, 0, lvS2),
        '  [Bubble Wave：FB 期间每 1s → 4× 技能伤害]',
        paramLine('Wave Hit% (×4)',            data.skill2_detail, 4, lvS2),
        '  [Barrage：每 500 发 → 10× 技能伤害]',
        paramLine('Barrage Hit% (×10)',        data.skill2_detail, 7, lvS2),
        hardcoded('弹药里程碑', '400 / 500 发 (固定)'),
      ],
      burst: [
        paramLine('Attack Damage% (全员)',     data.ulti_skill_detail, 0, lvB),
        paramLine('Ammo 补弹%',               data.ulti_skill_detail, 2, lvB),
        paramLine('ATK flat% (of LM ATK)',    data.ulti_skill_detail, 3, lvB),
      ],
    }),
  },

  // ── 470 · Red Hood ───────────────────────────────────────────────────────
  {
    id: 470, name: 'Red Hood', burstStep: 'AllStep(→B3)', weapon: 'SR',
    buildParams: (data, lvS1, lvS2, lvB) => ({
      skill1: [
        '  [每次 FC → CS 叠层（×stacks，上限10层，5s刷新）]',
        paramLine('CS% per stack',             data.skill1_detail, 0, lvS1),
        hardcoded('超量 CS → ChargeDmg', '×240% 超量部分 (固定)'),
      ],
      skill2: [
        todo('Pierce (穿透机制未建模)'),
        todo('Beast Cage DEF buff (未建模)'),
        todo('The Last Howl LifeSteal (未建模)'),
        '  [Red Wolf 释放时 → inline 于 Burst]',
        paramLine('ATK% (S2 inline burst)',    data.skill2_detail, 4, lvS2),
      ],
      burst: [
        '  [Red Wolf]',
        paramLine('Charge Speed%',             data.ulti_skill_detail, 9, lvB),
        paramLine('Weapon Switch Hit%',        data.ulti_skill_detail, 6, lvB),
        hardcoded('FC 倍率', '250% (固定)'),
        hardcoded('攻击间隔', '19 ticks/shot (实测 32次/10s)'),
        todo('Beast Cage B1 / The Last Howl B2 (AllStep 完整循环未建模)'),
      ],
    }),
  },
];

// ─── 生成报告 ─────────────────────────────────────────────────────────────
const now = new Date().toLocaleString('zh-CN', { hour12: false });
const seedDisplay = isNaN(seedArg)
  ? `随机 (本次初始=${_rng})`
  : `固定 seed=${seedArg}`;

const lines = [
  `# NIKKE 技能数值对比报告`,
  ``,
  `**生成时间：** ${now}  `,
  `**随机种子：** ${seedDisplay}  `,
  `**复现：** \`node scripts/dump-skill-descriptions.mjs ${isNaN(seedArg) ? '<seed>' : seedArg}\``,
  ``,
  `> **标注说明**  `,
  `> · \`param[N]\` = CDN \`description_value_list[N]\`（0-indexed）— 已动态化  `,
  `> · \`[硬编码]\` ⚠️ = 当前仍为常量，待动态化  `,
  `> · \`[TODO]\` = 技能效果已知但未建模  `,
  ``,
  `---`,
  ``,
];

for (const char of CHARACTERS) {
  const data = loadNikke(char.id);
  if (!data) {
    lines.push(`## ${char.id} · ${char.name}（JSON 文件缺失，跳过）`, ``);
    continue;
  }

  const lvS1 = lvl(), lvS2 = lvl(), lvB = lvl();
  lines.push(`## ${char.id} · ${char.name}（${char.burstStep} · ${char.weapon}）`);
  lines.push(`**随机等级：** S1=${lvS1}  S2=${lvS2}  Burst=${lvB}`);
  lines.push(``);

  const params = char.buildParams(data, lvS1, lvS2, lvB);

  const sections = [
    { key: 'skill1', detail: data.skill1_detail, lv: lvS1, label: 'S1' },
    { key: 'skill2', detail: data.skill2_detail, lv: lvS2, label: 'S2' },
    { key: 'burst',  detail: data.ulti_skill_detail, lv: lvB, label: 'Burst' },
  ];

  for (const sec of sections) {
    const d = sec.detail;
    lines.push(`### ${sec.label} · ${d?.name_localkey ?? '（无名称）'}（Lv.${sec.lv}）`);
    lines.push(`**游戏描述（Lv.${sec.lv}）：**`);
    lines.push(`\`\`\``);
    lines.push(fillDesc(d?.description_localkey, d, sec.lv));
    lines.push(`\`\`\``);
    lines.push(`**模型参数：**`);
    (params[sec.key] ?? []).forEach(l => lines.push(l));
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
}

// ─── 写出文件 ─────────────────────────────────────────────────────────────
mkdirSync(join(ROOT, 'tmp'), { recursive: true });
const outPath = join(ROOT, 'tmp/skill-desc-review.md');
writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`✓ 已写出 → ${outPath}`);
console.log(`  共 ${CHARACTERS.length} 个角色`);
