/**
 * test-i18n.mjs — 界面多语言与简体中文游戏文本回归测试（无网络）。
 *
 *   I1  界面词典：zh / en 键名一致、插值参数一致
 *   I2  文本补丁：diffText / applyTextPatch 往返、按 id 对齐、不修改原数据
 *   I3  日志游戏文本翻译：名称替换整词匹配、括号类型词、引擎中文常量译英
 *   I4  zh-CN 静态数据：已建模角色均有简体名与补丁，技能描述 ■ 段数与英文一致
 *   I5  具名效果配对：抽查已知角色的 _terms
 *
 * 前置：src/data/static/zh-CN/ 已由 scripts/download-zh-static.mjs 生成。
 * Run: node scripts/tests/test-i18n.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';

import { eq, section, summary }              from '../lib/test-harness.mjs';
import { dictKeys, translate }               from '../../src/ui/i18n.js';
import { diffText, applyTextPatch }          from '../../src/data/text-patch.js';
import { localizeData }                      from '../../src/data/locale-loader.js';
import { createNameMap, displayGameText, BUFF_TYPE_ZH } from '../../src/ui/game-text.js';
import { MODELED_IDS }                       from '../../src/data/skill-traits.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(__dirname, '../../src/data/static');
const ZH_DIR     = join(STATIC_DIR, 'zh-CN');
const readJson   = p => JSON.parse(readFileSync(p, 'utf8'));

// ─── I1 界面词典 ──────────────────────────────────────────────────────────────
section('I1 界面词典 zh / en 键名与插值参数一致');
{
  const zhKeys = new Set(dictKeys('zh'));
  const enKeys = new Set(dictKeys('en'));
  const onlyZh = [...zhKeys].filter(k => !enKeys.has(k));
  const onlyEn = [...enKeys].filter(k => !zhKeys.has(k));
  eq('仅中文有的键', onlyZh.join(','), '');
  eq('仅英文有的键', onlyEn.join(','), '');

  const params = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  const mismatched = [...zhKeys].filter(k => enKeys.has(k)
    && params(translate('zh', k)) !== params(translate('en', k)));
  eq('插值参数不一致的键', mismatched.join(','), '');

  eq('插值', translate('en', 'slot.slotN', { n: 3 }), 'Slot 3');
  eq('缺失键回退为键名', translate('en', 'no.such.key'), 'no.such.key');
}

// ─── I2 文本补丁 ──────────────────────────────────────────────────────────────
section('I2 文本补丁往返');
{
  const en = {
    id: 1, name_localkey: 'Calm', atk: [1, 2],
    skills: [{ id: 10, name_localkey: 'A' }, { id: 11, name_localkey: 'B', icon: 'x' }],
  };
  // 中文数组顺序与英文相反：应按 id 对齐
  const zh = {
    id: 1, name_localkey: '平常心', atk: [1, 2],
    skills: [{ id: 11, name_localkey: '乙', icon: 'x' }, { id: 10, name_localkey: '甲' }],
  };
  const patch = diffText(en, zh);
  eq('补丁只含差异字符串', JSON.stringify(patch), JSON.stringify({ name_localkey: '平常心', skills: { 0: { name_localkey: '甲' }, 1: { name_localkey: '乙' } } }));
  const merged = applyTextPatch(en, patch);
  eq('叠加后名称', merged.name_localkey, '平常心');
  eq('叠加后按 id 对齐（skills[0]）', merged.skills[0].name_localkey, '甲');
  eq('叠加保留非文本字段', merged.skills[1].icon, 'x');
  eq('原数据未被修改', en.skills[0].name_localkey, 'A');
  eq('无差异返回 undefined', diffText(en, en), undefined);

  const loc = localizeData(en, { ...patch, _terms: { Calm: '平常心' } });
  eq('localizeData 保留 _terms', loc._terms.Calm, '平常心');
  eq('localizeData 无补丁返回 null', localizeData(en, null), null);
}

// ─── I3 日志游戏文本翻译 ──────────────────────────────────────────────────────
section('I3 日志游戏文本翻译');
{
  const map = createNameMap([
    ['Calm Depths', '平静深渊'],
    ['Decoy', '诱饵'],
    ['Little Mermaid', '小美人鱼'],
  ]);
  // 类型词期望值读取 BUFF_TYPE_ZH，调整用词不影响本测试
  eq('技能名 + 段号 + 类型词', displayGameText('Calm Depths P3 (ATK)', 'zh', map), `平静深渊 P3（${BUFF_TYPE_ZH.ATK}）`);
  eq('多类型词（最长优先）', displayGameText('Decoy (Elem Adv Damage)', 'zh', map), `诱饵（${BUFF_TYPE_ZH['Elem Adv Damage']}）`);
  eq('整词匹配：不替换单词内部', displayGameText('Decoys', 'zh', map), 'Decoys');
  eq('未知名称保持原样', displayGameText('Unknown Buff', 'zh', map), 'Unknown Buff');
  eq('引擎内置 buff 名', displayGameText('OL Ammo', 'zh', map), '装备词条（最大装弹数）');
  eq('中文常量在中文界面不变', displayGameText('全体队友', 'zh', map), '全体队友');
  eq('引擎常量中文显示走词典（爆裂槽）', displayGameText('爆裂槽', 'zh', map), translate('zh', 'target.burstGauge'));
  eq('英文界面：全体队友', displayGameText('全体队友', 'en', null), 'All allies');
  eq('英文界面：普通攻击', displayGameText('普通攻击', 'en', null), 'Normal Attack');
  eq('英文界面：武器友军', displayGameText('AR 友军', 'en', null), 'AR allies');
  eq('英文界面：英文 buff 名不变', displayGameText('Calm Depths P3 (ATK)', 'en', null), 'Calm Depths P3 (ATK)');

  // 人工译名在前（先出现者优先），且完整名称按最长匹配覆盖部分自动翻译
  const manual = createNameMap([
    ['Maximum Super Firepower', '最大超级火力'],
    ['Super Firepower', '火力全开'],
    ['Empty Entry', ''],
  ]);
  eq('人工译名完整覆盖', displayGameText('Maximum Super Firepower (ATK)', 'zh', manual), `最大超级火力（${BUFF_TYPE_ZH.ATK}）`);
  eq('空译名被忽略', displayGameText('Empty Entry', 'zh', manual), 'Empty Entry');
}

// ─── I4 zh-CN 静态数据 ────────────────────────────────────────────────────────
section('I4 zh-CN 静态数据完整性');
if (!existsSync(join(ZH_DIR, 'names.json'))) {
  console.error('  [FAIL] 缺少 src/data/static/zh-CN/names.json，请先运行 node scripts/download-zh-static.mjs');
  process.exit(1);
}
{
  const names = readJson(join(ZH_DIR, 'names.json'));
  const modeled = [...MODELED_IDS];
  const noName  = modeled.filter(id => !names.characters[id]);
  const noPatch = modeled.filter(id => !existsSync(join(ZH_DIR, 'nikke', `${id}.json`)));
  eq('已建模角色均有简体名', noName.join(','), '');
  eq('已建模角色均有文本补丁', noPatch.join(','), '');
  eq('魔方简体名数量', Object.keys(names.cubes).length, 17);

  // 技能 tooltip 按 ■ 段高亮：中文描述段数必须与英文一致
  const countParts = d => (d ?? '').split('■').filter(s => s.trim()).length;
  const partMismatch = [];
  for (const id of modeled) {
    const enPath = join(STATIC_DIR, 'nikke', `${id}.json`);
    const zhPath = join(ZH_DIR, 'nikke', `${id}.json`);
    if (!existsSync(enPath) || !existsSync(zhPath)) continue;
    const en = readJson(enPath);
    const zh = applyTextPatch(en, readJson(zhPath));
    for (const k of ['skill1_detail', 'skill2_detail', 'ulti_skill_detail']) {
      if (countParts(en[k]?.description_localkey) !== countParts(zh[k]?.description_localkey)) partMismatch.push(`${id}.${k}`);
    }
  }
  eq('技能描述 ■ 段数与英文一致', partMismatch.join(','), '');

  // 简体转换：不应残留常见繁体字
  const sample = JSON.stringify(readJson(join(ZH_DIR, 'nikke', '515.json')));
  eq('无残留繁体（攻擊/傷害/時）', /攻擊|傷害|時/.test(sample), false);
}

// ─── I5 具名效果配对 ──────────────────────────────────────────────────────────
section('I5 具名效果自动配对');
{
  const ccw = readJson(join(ZH_DIR, 'nikke', '515.json'))._terms ?? {};
  eq('Cinderella: Crystal Wave — Snipe Mode', ccw['Snipe Mode'], '狙击模式');
  eq('Cinderella: Crystal Wave — Preparation for Change', ccw['Preparation for Change'], '切换准备');
  const mast = readJson(join(ZH_DIR, 'nikke', '354.json'))._terms ?? {};
  eq('Mast: Romantic Maid — Drunken', mast.Drunken, '醉意');
}

summary('I18n');
