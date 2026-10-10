/**
 * 繁中（台服）→ 简中游戏术语表：OpenCC 只做字形与通用词汇转换，
 * 台服与国服在游戏术语上的用词差异在此补充。由 scripts/download-zh-static.mjs 使用。
 *
 * 规则按顺序整体替换（字符串字面量，非正则）；修改后运行
 *   node scripts/download-zh-static.mjs --convert
 * 即可离线重新生成补丁。
 */

/** @type {Array<[string, string]>} [OpenCC 转换后的文本, 目标简中术语] */
export const ZH_CN_GLOSSARY = [
  ['内核', '核心'],   // Core：台服「內核」，与本项目界面（命中核心 / 暴露核心）统一
  // Anchor: Innocent Maid S1「1次」：台服漏了「获得」（实为 Incoming Healing，受到的治疗量）
  ['1次：【体力恢复量', '1次：【获得体力恢复量'],
];

/**
 * 对已转为简体的字符串套用术语表。
 * @param {string} text
 * @returns {string}
 */
export function applyGlossary(text) {
  return ZH_CN_GLOSSARY.reduce((s, [from, to]) => s.split(from).join(to), text);
}
