/**
 * 主动 S2（CDN skill2_table = CharacterSkill）的冷却推进工具。
 *
 * CDN 不提供主动技能冷却时间，由各技能文件人工填写（来源写在文件头注释）。
 * 约定（同 Centi 80.js / Snow White 220.js）：战斗开始先进入冷却，冷却结束立即施放并重新进入冷却。
 *
 * 「Cooldown of Skill 2 ▼ X%」（如 Arcana S1 P1 The Magician）：buff 字段 skill2CooldownReductionPct，
 * 生效期间冷却按 1 / (1 − X%) 倍速推进（等价于冷却时长 × (1 − X%)），多个来源相加，上限 99%。
 */

// 当前作用于 unit 的 S2 冷却缩减比例（buff 字段 skill2CooldownReductionPct 之和）
function skill2CooldownReduction(state, unit) {
  let pct = 0;
  for (const b of state.buffs) {
    if (b.unitId !== null && b.unitId !== unit.id) continue;
    if (b.endTick !== Infinity && b.endTick <= state.tick) continue;
    pct += (b.skill2CooldownReductionPct ?? 0) * (b.stacks ?? 1);
  }
  return Math.min(0.99, pct);
}

/**
 * 每 tick 调用一次：推进 S2 冷却，冷却完成时返回 true 并重置进度（调用方随即施放 S2）。
 * @param {object} state
 * @param {object} caster
 * @param {string} key        skillState 中保存冷却进度的键（每角色唯一）
 * @param {number} cdTicks    基础冷却时长（tick）
 * @returns {boolean} 本 tick 是否施放
 */
export function tickSkill2Cooldown(state, caster, key, cdTicks) {
  const st = caster.skillState;
  st[key] = (st[key] ?? 0) + 1 / (1 - skill2CooldownReduction(state, caster));
  if (st[key] < cdTicks) return false;
  st[key] = 0;
  return true;
}
