import { pushBuff, acquireFocusLock, releaseFocusLock, TICK_RATE } from '../../engine/battle-utils.js';
import { executeSkillTriggers } from '../../engine/skill-executor.js';

// Bunny Mode 共享机制（Guilty: Mighty Bunny 404 / Sin: Swift Bunny 405）。
//
// ■ 两种互斥形态：Bunny Mode: Stance / Bunny Mode: Engage（永久、不可移除）。
// ■ S1：战斗开始时、以及「满蓄后继续按住 ≥p 秒」时切换形态（Stance → Engage，否则 → Stance）。
//   自动战斗中 SR 满蓄即松手，不会触发按住切换 → 默认仅战斗开始切换一次，恒为 Stance。
//   UI 选项「切换兔兔模式：出击」（config.bunnyEngageAtStart → unit.bunnyEngageAtStart，执行者优先级
//   Sin > Guilty，见 battle.js）按手动打法模拟：第一次攻击满蓄后多按住 p 秒 → 切换到 Engage，
//   本发照常以全蓄力打出（切换不打断全蓄力）。按住期间 Focus 必须在该角色身上（占用 Focus，
//   原 Focus 角色失去 Focus、无法速充），本发击发时释放。
// ■ 本单位进入 Engage → 处于 Stance 的友军一并进入 Engage；进入 Stance 同理。
// ■ 形态变化后派发 BUNNY_MODE_CHANGED（ctx.unit = 变化单位），由各角色 S2 刷新形态效果 buff。
//
// 注：与 persona-shared.js 相同，存在仅运行时调用的循环导入（skill-executor ↔ skill-traits）。

export const BUNNY_STANCE = 'Stance';
export const BUNNY_ENGAGE = 'Engage';

const MODE_BUFF_NAME = {
  [BUNNY_STANCE]: 'Bunny Mode: Stance',
  [BUNNY_ENGAGE]: 'Bunny Mode: Engage',
};

/** 当前形态（未进入任何形态时为 null） */
export function getBunnyMode(unit) {
  return unit.skillState.bunnyMode ?? null;
}

/** 进入指定形态，并带动处于另一形态的友军一同切换。 */
export function enterBunnyMode(state, unit, mode) {
  if (getBunnyMode(unit) === mode) return;
  unit.skillState.bunnyMode = mode;

  const modeNames = Object.values(MODE_BUFF_NAME);
  state.buffs = state.buffs.filter(b => !(b.unitId === unit.id && modeNames.includes(b.name)));
  // 形态哨兵 buff（无数值字段），仅用于战斗日志展示当前形态
  pushBuff(state, { name: MODE_BUFF_NAME[mode], unitId: unit.id, endTick: Infinity });

  // executeSkillTriggers 结束时会清空 state._logCtx，保存并恢复外层日志上下文
  const outerLogCtx = state._logCtx;
  executeSkillTriggers(state, 'BUNNY_MODE_CHANGED', { unit });
  state._logCtx = outerLogCtx;

  const otherMode = mode === BUNNY_STANCE ? BUNNY_ENGAGE : BUNNY_STANCE;
  for (const ally of state.squad) {
    if (ally.id !== unit.id && getBunnyMode(ally) === otherMode) enterBunnyMode(state, ally, mode);
  }
}

/** S1「Initiates a new Bunny Mode based on the current mode」 */
export function toggleBunnyMode(state, unit) {
  enterBunnyMode(state, unit, getBunnyMode(unit) === BUNNY_STANCE ? BUNNY_ENGAGE : BUNNY_STANCE);
}

/**
 * PROGRAM_INIT：开启开局切换（unit.bunnyEngageAtStart）时占用 Focus，并让第一次攻击满蓄后多按住 holdSecs 秒。
 * 引擎在 PROGRAM_INIT 之后按 chargeHoldTicks 重新排定首发（见 battle.js）。
 * @param {number} holdSecs 「Full Charge is maintained for X or more seconds」的 X
 */
export function setupBunnySwitchAtStart(state, unit, holdSecs) {
  if (!unit.bunnyEngageAtStart || !acquireFocusLock(state, unit)) return;
  unit.skillState.bunnyHoldSwitchPending = true;
  unit.chargeHoldTicks = Math.round(holdSecs * TICK_RATE);
}

/** FULL_CHARGE_HELD：按住满蓄到点 → 切换形态（带动友军），释放 Focus。 */
export function onBunnyFullChargeHeld(state, unit) {
  if (!unit.skillState.bunnyHoldSwitchPending) return;
  unit.skillState.bunnyHoldSwitchPending = false;
  toggleBunnyMode(state, unit);
  releaseFocusLock(state, unit);
}

/**
 * 按形态替换 S2 的形态效果 buff：移除两种形态 buff，再推入当前形态对应的一种。
 * @param {object} buffs  { [BUNNY_STANCE]: buffObj, [BUNNY_ENGAGE]: buffObj }（不含 unitId / endTick）
 */
export function applyBunnyModeBuff(state, unit, buffs) {
  const names = Object.values(buffs).map(b => b.name);
  state.buffs = state.buffs.filter(b => !(b.unitId === unit.id && names.includes(b.name)));
  const buff = buffs[getBunnyMode(unit)];
  if (buff) pushBuff(state, { ...buff, unitId: unit.id, endTick: Infinity });
}
