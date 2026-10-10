/**
 * 文本补丁 — 本地化数据的「差异覆盖」格式。
 *
 * 引擎始终使用英文 CDN 数据（部分逻辑会解析英文描述文本），
 * 其他语言只保存与英文快照不同的字符串叶子，显示时再叠加到英文数据上。
 *
 * 补丁格式：与原对象同构的嵌套对象，只含差异字符串；
 * 数组以「英文数组下标」为键（{ "0": {...}, "3": "..." }），
 * 元素为带 id 的对象时按 id 对齐，避免两种语言数组顺序不同时错位。
 *
 * 本文件为纯函数，浏览器与 Node 脚本（scripts/download-zh-static.mjs）共用。
 */

/** 数组元素是否可按 id 对齐 */
function _hasIds(arr) {
  return arr.length > 0 && arr.every(v => v && typeof v === 'object' && v.id != null);
}

/**
 * 生成 target 相对 base 的文本补丁。
 * @param {*} base    英文原数据
 * @param {*} target  本地化数据（结构与 base 相同）
 * @returns {*}       补丁；无差异时返回 undefined
 */
export function diffText(base, target) {
  if (typeof base === 'string' || typeof target === 'string') {
    return typeof base === 'string' && typeof target === 'string' && base !== target ? target : undefined;
  }
  if (Array.isArray(base) && Array.isArray(target)) {
    const byId = _hasIds(base) && _hasIds(target)
      ? new Map(target.map(v => [String(v.id), v]))
      : null;
    const out = {};
    base.forEach((v, i) => {
      const t = byId ? byId.get(String(v.id)) : target[i];
      const d = diffText(v, t);
      if (d !== undefined) out[i] = d;
    });
    return Object.keys(out).length ? out : undefined;
  }
  if (base && target && typeof base === 'object' && typeof target === 'object') {
    const out = {};
    for (const k of Object.keys(base)) {
      const d = diffText(base[k], target[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/**
 * 将补丁叠加到 base 上，返回新对象（只复制补丁涉及的路径，其余结构共享，不修改 base）。
 * @param {*} base
 * @param {*} patch
 * @returns {*}
 */
export function applyTextPatch(base, patch) {
  if (patch == null) return base;
  if (typeof patch === 'string') return typeof base === 'string' || base == null ? patch : base;
  if (base == null || typeof base !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, p] of Object.entries(patch)) {
    if (k in out) out[k] = applyTextPatch(out[k], p);
  }
  return out;
}
