/**
 * 手写技能属性注册表。
 *
 * CDN 技能数据（skill1_detail / skill2_detail / ulti_skill_detail）仅包含数值与描述文本，
 * 不含底层机制标记（如"可命中核心"）。本模块补全这些无法从 CDN 推导的静态属性。
 *
 * 键：skill_detail.group_id（整数）。group_id 跨技能等级不变，因此是稳定标识符。
 * 可通过 detail.skill1?.group_id、detail.skill2?.group_id、detail.burst?.group_id 读取。
 *
 * 使用方式：
 *   import { getSkillTraits } from '../data/skill-traits.js';
 *   const traits = getSkillTraits(unit.detail.skill2?.group_id);
 *   if (traits?.canHitCore) { ... }
 */

/**
 * @typedef {object} SkillTraits
 * @property {boolean}  [canHitCore] - 此技能的命中可以瞄准/命中核心部位
 * @property {string[]} [tags]       - 机制标签（如 'projectile'、'attachment'、'explosion'）
 */

/**
 * 技能属性注册表。
 * 键为 group_id（number），值为 SkillTraits。
 *
 * 当前为空——数据将在下一步从现有硬编码逻辑迁移填入。
 *
 * @type {Record<number, SkillTraits>}
 */
export const SKILL_TRAITS = {
  // 按 resource_id 分组，每角色三条：skill1 / skill2 / burst
  // 例：
  //   25132: { canHitCore: true, tags: ['projectile', 'attachment'] },  // Rapi:RH S2
};

/**
 * 查询指定 group_id 的技能属性。
 * 未注册的技能返回 null（视为"无特殊机制"）。
 *
 * @param {number|null|undefined} groupId
 * @returns {SkillTraits|null}
 */
export function getSkillTraits(groupId) {
  if (groupId == null) return null;
  return SKILL_TRAITS[groupId] ?? null;
}

/**
 * 检查技能是否具有指定布尔属性，未注册时返回 false。
 *
 * @param {number|null|undefined} groupId
 * @param {keyof SkillTraits} trait
 * @returns {boolean}
 */
export function hasSkillTrait(groupId, trait) {
  const t = getSkillTraits(groupId);
  return t != null && t[trait] === true;
}

/**
 * 检查技能是否含有指定标签，未注册时返回 false。
 *
 * @param {number|null|undefined} groupId
 * @param {string} tag
 * @returns {boolean}
 */
export function hasSkillTag(groupId, tag) {
  const t = getSkillTraits(groupId);
  return t?.tags?.includes(tag) ?? false;
}
