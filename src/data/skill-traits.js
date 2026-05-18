/**
 * 技能属性注册表（SKILL_TRAITS）+ 角色静态属性覆盖表（CHARACTER_TRAITS）。
 *
 * SKILL_TRAITS 键为 resource_id（number 字符串形式）。
 * 每个条目包含 skill1 / skill2 / burst，每个技能含 triggers 数组。
 * 触发器结构、条件写法、作用范围、效果类型见 src/engine/skill-executor.js 文件头。
 *
 * 技能数值从角色 CDN 数据按实际技能等级读取。
 * handler(state, caster, ctx) 为逃生舱口，直接操作 state，等价于内联代码。
 *
 * [TODO] 标注的技能未实现，已记录在此文件中。
 */

export { CHARACTER_TRAITS, getCharacterTraits } from './character-traits.js';

// ─── 旧 group_id 查询接口（保留向后兼容；引擎不再依赖） ─────────────────────

export const SKILL_TRAITS_BY_GROUP = {};
export function getSkillTraits(groupId) { return SKILL_TRAITS_BY_GROUP[groupId] ?? null; }
export function hasSkillTrait(groupId, trait) { const t = getSkillTraits(groupId); return t != null && t[trait] === true; }
export function hasSkillTag(groupId, tag) { const t = getSkillTraits(groupId); return t?.tags?.includes(tag) ?? false; }

import s15  from './skills/15.js';
import s16  from './skills/16.js';
import s18  from './skills/18.js';
import s32  from './skills/32.js';
import s82  from './skills/82.js';
import s183 from './skills/183.js';
import s191 from './skills/191.js';
import s223 from './skills/223.js';
import s225 from './skills/225.js';
import s262 from './skills/262.js';
import s281 from './skills/281.js';
import s330 from './skills/330.js';
import s352 from './skills/352.js';
import s354 from './skills/354.js';
import s355 from './skills/355.js';
import s470 from './skills/470.js';
import s220 from './skills/220.js';
import s511 from './skills/511.js';
import s101 from './skills/101.js';
import s513 from './skills/513.js';
import s835 from './skills/835.js';
import s471 from './skills/471.js';
import s270 from './skills/270.js';
import s271 from './skills/271.js';
import s234 from './skills/234.js';
import s102 from './skills/102.js';
import s162 from './skills/162.js';
import s170 from './skills/170.js';
import s192 from './skills/192.js';
import s272 from './skills/272.js';
import s17  from './skills/17.js';
import s450 from './skills/450.js';
import s222 from './skills/222.js';
import s315 from './skills/315.js';
import s851 from './skills/851.js';
import s75  from './skills/75.js';

export const SKILL_TRAITS = {
   15: s15,
   16: s16,
   18: s18,
   32: s32,
   82: s82,
  183: s183,
  191: s191,
  223: s223,
  225: s225,
  262: s262,
  281: s281,
  330: s330,
  352: s352,
  354: s354,
  355: s355,
  470: s470,
  220: s220,
  511: s511,
  513: s513,
  101: s101,
  835: s835,
  471: s471,
  270: s270,
  271: s271,
  234: s234,
  102: s102,
  162: s162,
  170: s170,
  192: s192,
  272: s272,
   17: s17,
  450: s450,
  222: s222,
  315: s315,
  851: s851,
   75: s75,
};
