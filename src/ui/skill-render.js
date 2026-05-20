/**
 * 技能描述渲染器 — 将 CDN 技能文本转为带样式的 HTML。
 *
 * 占位符格式：
 *   {description_value_01}  → 按技能等级取 description_value_list[0].description_value[lv-1]
 *   <word_group=N>text</word_group>  → <span style="color:#FA8030">text</span>
 *   <color=#XXXXXX>text</color>  → <span style="color:#XXXXXX">text</span>
 *   \n → <br>
 */

/**
 * @param {string} desc              description_localkey 原始字符串
 * @param {Array}  valueList         description_value_list 数组
 * @param {number} skillLevel        1–10
 * @returns {string}                 安全 HTML 字符串
 */
export function renderSkillDesc(desc, valueList, skillLevel) {
  if (!desc) return '';
  const lv = Math.max(1, Math.min(10, skillLevel ?? 1));

  let out = desc;

  // {description_value_NN} → 实际数值
  out = out.replace(/\{description_value_(\d+)\}/g, (_, numStr) => {
    const idx = parseInt(numStr, 10) - 1; // 1-based → 0-based
    const vals = valueList?.[idx]?.description_value;
    if (!vals) return '?';
    const raw = vals[lv - 1] ?? vals[vals.length - 1] ?? '?';
    return `<span class="skill-val">${raw}</span>`;
  });

  // <word_group=N>text</word_group> → 橙色参数
  out = out.replace(/<word_group[^>]*>([\s\S]*?)<\/word_group>/g,
    (_, inner) => `<span class="skill-param">${inner}</span>`
  );

  // <color=#XXXXXX>text</color> → 着色
  out = out.replace(/<color=(#[0-9A-Fa-f]{6})>([\s\S]*?)<\/color>/g,
    (_, color, inner) => `<span style="color:${color}">${inner}</span>`
  );

  // 换行
  out = out.replace(/\n/g, '<br>');

  return out;
}
