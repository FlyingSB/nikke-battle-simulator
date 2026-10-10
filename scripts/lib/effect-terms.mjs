/**
 * 从技能描述中自动配对「英文具名效果 ↔ 简体具名效果」，供战斗日志 Buff 名翻译。
 * 由 scripts/download-zh-static.mjs 使用，结果写入角色 / 珍藏品补丁的 _terms 字段。
 *
 * 规则（两种语言的描述按 ■ 分段，段数相同时逐段配对）：
 *   - 英文：行首「Name: …」形式的效果名，及「Changes the weapon in use: X」中的 X；
 *   - 简体：「【名称：…】」形式的效果名，及「【变更使用武器：X】」中的 X；
 *   - 只有同一段内两边数量完全相同时才按顺序配对，否则整段放弃（宁缺毋滥）。
 * 计数 / 阶段 / 通用说明类标签（Once、Stage 1、Function、Additional Effect …）不是效果名，予以排除。
 */

const EN_STOP_PATTERNS = [
  'Charge Time', 'Damage', 'Full Charge Damage', 'Max Ammunition Capacity', 'Removal Condition',
  'Deactivation condition', 'Changes the weapon in use', 'Amount', 'Function', 'Effect( \\d+)?',
  'Additional [Ee]ffect.*', 'First Damage', 'Normal Damage', 'Pellet Count', 'Attack Interval',
  'Once', 'Twice', '\\w+ [Tt]imes', 'Stage \\d+.*', 'When used in .*', 'Projectile .* Damage',
  'Marked Target \\d+',
];
const EN_STOP = new RegExp(`^(?:${EN_STOP_PATTERNS.join('|')})$`);

const ZH_STOP = /^(?:蓄力时间|伤害|全蓄力伤害|最大装弹数|额外效果\d*|解除条件|效果\d*)$/;
const ZH_WEAPON_CHANGE = '变更使用武器';

/** 去掉 word_group 标签，color 标签视为换行（效果名常位于 color 块开头） */
const _strip = s => s.replace(/<\/?word_group[^>]*>/g, '').replace(/<\/?color[^>]*>/g, '\n');
const _parts = d => (d ?? '').split('■').filter(s => s.trim());

function _enNames(part) {
  const out = [];
  for (const line of _strip(part).split('\n')) {
    const weapon = line.match(/Changes the weapon in use: ([^\n.]+)/);
    if (weapon) { out.push(weapon[1].trim()); continue; }
    // 去掉「Effect 2: Affects self. 」这类前缀，效果名常跟在其后（如 Anis: Star 的 My Own Star）
    const body = line.trim().replace(/^Effect \d+: /, '').replace(/^Affects [^.:]*\. /, '');
    const m = body.match(/^([A-Z][^:：.]{0,45}?): /);
    if (m && !EN_STOP.test(m[1].trim())) out.push(m[1].trim());
  }
  return out;
}

function _zhNames(part) {
  const out = [];
  for (const m of _strip(part).matchAll(/【([^：【】]{1,24})：([^】]*)】/g)) {
    if (m[1] === ZH_WEAPON_CHANGE) out.push(m[2].trim());
    else if (!ZH_STOP.test(m[1])) out.push(m[1].trim());
  }
  return out;
}

/**
 * 配对一组技能（英文 / 已转简体）中的具名效果。
 * @param {Array<object|undefined>} enSkills  英文技能详情（含 description_localkey）
 * @param {Array<object|undefined>} zhSkills  对应的简体技能详情（顺序一致）
 * @returns {Record<string, string>}  英文效果名 → 简体；同名以先出现者为准
 */
export function extractEffectTerms(enSkills, zhSkills) {
  const terms = {};
  enSkills.forEach((en, si) => {
    const enParts = _parts(en?.description_localkey);
    const zhParts = _parts(zhSkills[si]?.description_localkey);
    if (enParts.length !== zhParts.length) return;
    enParts.forEach((p, pi) => {
      const a = _enNames(p);
      const b = _zhNames(zhParts[pi]);
      if (!a.length || a.length !== b.length) return;
      a.forEach((name, i) => { if (!(name in terms) && name !== b[i]) terms[name] = b[i]; });
    });
  });
  return terms;
}
