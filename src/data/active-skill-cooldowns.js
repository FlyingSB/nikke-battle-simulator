/**
 * 主动技能（CDN skill1_table / skill2_table = CharacterSkill）冷却时间表，单位：秒。
 *
 * CDN 不提供主动技能的冷却时间，在此人工填写（来源见各技能文件头注释）。
 * 技能文件（src/data/skills/*.js）与界面技能栏共用此表，修改冷却只需改这里。
 * 爆裂技能冷却由 CDN ulti_skill_detail.skill_cooltime_list 提供，不在此表。
 *
 * 键：resource_id → { skill1?: 秒, skill2?: 秒 }
 */
export const ACTIVE_SKILL_COOLDOWN_SEC = {
  80:  { skill2: 9  },  // Centi — prydwen.gg / nikke.gg
  82:  { skill2: 15 },  // Liter
  220: { skill2: 15 },  // Snow White
  231: { skill2: 15 },  // Isabel — prydwen.gg / nikke.gg
  353: { skill2: 4  },  // Helm: Aquamarine
  832: { skill2: 10 },  // Mari — 游戏内实测
  861: { skill2: 15 },  // Takina — nikke.gg
};

/**
 * 取主动技能冷却（秒）；未登记时返回 null。
 * @param {number|string} resourceId
 * @param {'skill1'|'skill2'} skillKey
 * @returns {number|null}
 */
export function getActiveSkillCooldownSec(resourceId, skillKey) {
  return ACTIVE_SKILL_COOLDOWN_SEC[resourceId]?.[skillKey] ?? null;
}
