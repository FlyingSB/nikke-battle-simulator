import { getBuffSums } from '../../engine/battle-utils.js';
import { executeSkillTriggers } from '../../engine/skill-executor.js';

// Persona 联动角色（Queen (Makoto) 870 / Yukiko 871 …）共享机制。
//
// ■ Persona 状态：各角色 S1 于战斗开始获得「Persona - XXX」永久 buff，buff 上带
//   personaState: true 标记（非数值字段，getBuffSums 忽略）。
// ■ 1 More：爆裂技能在「存在风压代码敌人」时对自身生效；生效时派发 ONE_MORE 触发，
//   由同一角色的 S1/S2 响应（分摊伤害、Baton Pass / Follow Up 等）。
// ■ Follow Up：Yukiko S2 施加给队友的 buff；生效时对受益者派发 FOLLOW_UP 触发
//   （如 Queen (Makoto) S1 P4 分摊伤害）。
//
// 注：skill-executor ↔ skill-traits ↔ 本模块存在循环导入；executeSkillTriggers 仅在
// 运行时调用（函数声明在模块实例化阶段即已绑定），不影响加载顺序。

/** 单位是否处于 Persona 状态 */
export function isInPersonaState(state, unit) {
  return state.buffs.some(b => b.personaState && b.unitId === unit.id);
}

/** 敌方是否存在风压代码敌人（Boss 战单体） */
export function hasWindCodeEnemy(state) {
  return state.enemyElement === 'Wind';
}

/**
 * 「standard Burst N allies (except the skill user) in the Persona state」目标筛选。
 * standard Burst N：burstStep 严格等于 StepN（不含 StepFull 全阶段角色）。
 */
export function personaAlliesOfStep(state, caster, step) {
  return state.squad.filter(u => u.id !== caster.id
    && u.burstStep === `Step${step}`
    && isInPersonaState(state, u));
}

/** 施法者最终 MaxHP（基础面板 × (1 + maxHpPct) + maxHpFlat） */
export function finalMaxHp(state, unit) {
  const sums = getBuffSums(state, unit.id);
  return unit.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
}

/**
 * 派发 Persona 事件（ONE_MORE / FOLLOW_UP），ctx.unit = 生效单位。
 * executeSkillTriggers 执行完会把 state._logCtx 置空；此处保存并恢复外层 handler 的日志上下文，
 * 使调用方在派发之后继续 pushBuff 时仍归属到原技能。
 */
export function dispatchPersonaEvent(state, trigger, unit) {
  const outerLogCtx = state._logCtx;
  executeSkillTriggers(state, trigger, { unit });
  state._logCtx = outerLogCtx;
}
