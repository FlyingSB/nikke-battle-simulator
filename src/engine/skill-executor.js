/**
 * 声明式技能执行器。
 *
 * 触发时机（on 字段）：
 *   PROGRAM_INIT        程序初始化阶段（battle.js 构建 state 后、BATTLE_START 前触发；不写入战斗日志）
 *                       仅用于将 skillState 计数器/标志位赋初值，不产生任何游戏效果
 *   BATTLE_START        战斗开始时（含"敌人出现时"，Boss 战中合并处理，见注释）
 *   ENTER_BURST_I       进入爆裂阶段 1（共享槽填满那一 tick）
 *   ENTER_BURST_II      进入爆裂阶段 2（B1 施放后，B2 施放前）
 *   ENTER_BURST_III     进入爆裂阶段 3（B2 延迟结束，B3 施放前）
 *   BURST_SKILL_USE     使用爆裂技能时（B1/B2/B3 施放时；ctx.unit = 施放单位）
 *   ENTER_FULL_BURST    进入全爆裂阶段（B3 施放完毕后）
 *   FULL_BURST_END      全爆裂阶段结束
 *   SHOT_COUNT          普通攻击 X 次（通过 onShotFired 驱动，溢出保留；ctx.unit = 射击单位）
 *   SQUAD_SHOT_COUNT    全队任意单位普通攻击时广播（onShotFired 驱动；ctx.shootingUnit = 实际射击单位）
 *   LAST_BULLET         末弹射击后（ammoLeft 降至 0；ctx.unit = 射击单位）
 *   FULL_CHARGE         全蓄力攻击时（SR/RL；ctx.unit = 射击单位）
 *   AMMO_MILESTONE      全队消耗弹药累计达到 X 发（溢出保留，由 battle.js 检测后调用）
 *   INTERVAL            全程每 X 秒触发，不限于爆裂期间（通过 onInterval 驱动；首次于 t+Xs 触发）
 *   INTERVAL_IN_BURST   全爆裂期间每 X 秒生效 1 次（通过 onIntervalInBurst 驱动）
 *   HEAL_RECEIVED       任意友军受到治疗时（ctx.unit = 受治疗单位）
 *   APPLY_SHIELD        任意友军获盾时（ctx.unit = 获盾单位；非团队触发，仅 caster === ctx.unit 的单位响应）
 *   COVER_HEAL          掩体受到治疗时（团队触发；ctx.unit 无意义；每 12 发由 Naga S1 驱动）
 *   CORE_HIT            命中敌人核心时（ctx.unit = 射击单位，ctx.isCore = true）
 *   RELOAD_END          自然装填完成（ammoLeft 恢复至 maxAmmo）时（ctx.unit = 装填单位）
 *                       不包含技能/道具补弹将弹匣填满的情况
 *   CS_BUFF_CHANGED     含 chargeSpeedPct 的 buff 被推入或过期时（ctx.unit = 受影响单位）
 *                       由 pushBuff → _trackCsChange → flushCsChanged / buff 过期清理 分派；
 *                       供需要感知自身蓄力速度变化的技能（如 Red Hood S1 P2）使用
 *
 * 作用范围（target 字段）：
 *   SELF                     自身（caster）
 *   ALL_ALLIES               全员
 *   ENEMY                    敌人（Boss 战中单体，等价于"所有敌人/最高 ATK 敌人/stage target"）
 *   BURST_CASTERS            本轮使用了爆裂技能的队员
 *   NON_BURST_CASTERS        本轮未使用爆裂技能的队员
 *   BURST_III_UNITS          爆裂阶段 3 单位（burstStep === 'Step3'）
 *   ALLIES_WITH_ELEMENT      指定属性的友军（targetOpts.element）
 *   LOWEST_ATK_BURST_III     ATK 最低的 B3 友军（排除 immuneSkillChargeSpeed 单位）
 *
 * 效果类型（effects[].type）：
 *   BUFF                施加/刷新 buff（所有持续效果均按此处理）
 *   BUFF_GLOBAL         同一条 buff 以 unitId=null 作用于全员（区别于逐人推 BUFF）
 *   DEBUFF_ENEMY        对敌人施加 debuff（enemyDamageTakenPct）
 *   SKILL_DAMAGE        技能伤害（count 次，mult 倍率）
 *   HEAL                治疗目标（pct = 占 caster.stats.hp 比例，或 flat 固定量）
 *   RELOAD_AMMO         补充弹药（pct = 占 maxAmmo 比例）
 *   REDUCE_BURST_CD     减少爆裂技能冷却时间（seconds）
 *   GRANT_BURST_GAUGE   增加共享爆裂槽（pct = 占上限比例）
 *   AMMO_EXPAND         临时扩充最大弹匣（mult, seconds）+ 立即补满弹药
 *   STUN_SELF           眩晕 caster（seconds）
 *   WEAPON_SWITCH       临时切换 caster 武器类型（hitMult, weaponType?, seconds | endRounds）
 *                       seconds：时间制到期；endRounds：回合制到期（每发射击消耗 1 回合）
 *
 * handler(state, caster, ctx)：
 *   对于无法完全声明式表达的技能，使用此逃生舱口。handler 直接操作 state。
 *
 * conditions 字段（数组，AND 逻辑；any 字段，OR 逻辑）：
 *   { type: 'NOT_COMBAT_ASSIST' }
 *   { type: 'SQUAD_HAS_BUFF', buffName }
 *   { type: 'SELF_BUFF_STACKS_GTE', buffName, stacks }
 *   { type: 'ENEMY_BUFF_STACKS_GTE', buffName, stacks }
 *   { type: 'IN_FULL_BURST' }
 *   { type: 'IS_CHARGED' }
 *   { type: 'IS_CORE_HIT' }  — ctx.hitPart === 'core'
 */

import { SKILL_TRAITS } from '../data/skill-traits.js';
import { pushBuff, fireSkillHit, addBurstGauge, applyHeal,
         getBuffSums, decrementRoundBuffs, TICK_RATE, BURST_GAUGE_MAX, ALL_ALLIES } from './battle-utils.js';

// 团队触发：ctx.unit 无意义，所有持有该技能的在队单位均触发
const TEAM_TRIGGERS = new Set([
  'PROGRAM_INIT',
  'BATTLE_START', 'ENTER_BURST_I', 'ENTER_BURST_II', 'ENTER_BURST_III', 'ENTER_FULL_BURST', 'FULL_BURST_END',
  'AMMO_MILESTONE', 'HEAL_RECEIVED', 'COVER_HEAL',
]);

// 根据触发定义和施放者计算 logCtx，供 applyEffects / pushBuff 使用
function buildLogCtx(caster, skillKey, tdefIdx, tdef, skill, trigger) {
  const slot       = skillKey === 'skill1' ? 'S1' : skillKey === 'skill2' ? 'S2' : 'Burst';
  const raw        = slot === 'S1' ? caster.rawSkill1 : slot === 'S2' ? caster.rawSkill2 : caster.rawBurst;
  const skillLabel = raw?.name_localkey || slot;   // || 确保空字符串也回退到 slot
  const partOffset = skill?.partOffset ?? 0;
  const partIdx    = tdef.partOverride !== undefined ? tdef.partOverride : (tdefIdx + partOffset);
  const lineIdx    = tdef.lineOverride ?? null;
  return { unitName: caster.name, skillLabel, slot, partIdx, trigger, lineIdx };
}

// ─── 条件判断 ──────────────────────────────────────────────────────────────

function checkOne(state, caster, cond, ctx) {
  switch (cond.type) {
    case 'IS_COMBAT_ASSIST':
      return !!caster.combatAssistStatus;
    case 'NOT_COMBAT_ASSIST':
      return !caster.combatAssistStatus;
    case 'SQUAD_HAS_BUFF':
      return state.buffs.some(b => b.name === cond.buffName);
    case 'SELF_BUFF_STACKS_GTE': {
      const b = state.buffs.find(b => b.name === cond.buffName && b.unitId === caster.id);
      return b && (b.stackCount ?? 1) >= cond.stacks;
    }
    case 'ENEMY_BUFF_STACKS_GTE': {
      const b = state.buffs.find(b => b.name === cond.buffName && b.unitId === null);
      return b && (b.stackCount ?? 1) >= cond.stacks;
    }
    case 'IN_FULL_BURST':
      return state.fullBurstActive;
    case 'IS_CHARGED':
      return !!ctx.isCharged;
    case 'IS_CORE_HIT':
      return ctx.hitPart === 'core';
    case 'HEALED_UNIT_IS_SELF':
      return ctx.unit?.id === caster.id;
    default:
      return true;
  }
}

function checkConditions(state, caster, tdef, ctx) {
  const all = tdef.conditions ?? [];
  for (const c of all) {
    if (!checkOne(state, caster, c, ctx)) return false;
  }
  const any = tdef.any ?? [];
  if (any.length > 0 && !any.some(c => checkOne(state, caster, c, ctx))) return false;
  return true;
}

// ─── 作用范围解析 ──────────────────────────────────────────────────────────

function resolveTargets(state, caster, target, targetOpts) {
  switch (target) {
    case 'SELF':              return [caster];
    case 'ALL_ALLIES':        return state.squad;
    case 'ENEMY':             return ['__enemy__'];  // Boss 战单体，见文件头注释
    case 'BURST_CASTERS':     return state.squad.filter(u => state.burstCastersThisRotation?.has(u.id));
    case 'NON_BURST_CASTERS': return state.squad.filter(u => !state.burstCastersThisRotation?.has(u.id));
    case 'BURST_III_UNITS':   return state.squad.filter(u => u.burstStep === 'Step3');
    case 'ALLIES_WITH_ELEMENT':
      return state.squad.filter(u => u.element === (targetOpts?.element));
    case 'LOWEST_ATK_BURST_III': {
      const cands = state.squad.filter(u => u.burstStep === 'Step3' && !u.immuneSkillChargeSpeed);
      if (!cands.length) return [];
      const minAtk = Math.min(...cands.map(u => u.stats.atk));
      return [cands.find(u => u.stats.atk === minAtk)];
    }
    default: return [];
  }
}

// ─── 效果应用 ──────────────────────────────────────────────────────────────

function applyEffects(state, caster, targets, effects, ctx, logCtx = null) {
  for (const eff of effects) {
    const statVal = typeof eff.stat === 'function' ? eff.stat(caster, state, ctx) : (eff.stat ?? {});
    const endTick = typeof eff.duration === 'number'
      ? state.tick + TICK_RATE * eff.duration
      : Infinity;

    switch (eff.type) {
      case 'BUFF':
        for (const t of targets) {
          if (t === '__enemy__') continue;
          pushBuff(state, { name: eff.name, unitId: t.id, endTick, ...statVal }, logCtx);
        }
        break;

      case 'BUFF_GLOBAL':
        // unitId=null：作为全队 buff 推入，区别于逐人推入（用于 Crown S1 之外的全员效果）
        pushBuff(state, { name: eff.name, unitId: null, endTick, ...statVal }, logCtx);
        break;

      case 'DEBUFF_ENEMY': {
        const val = typeof eff.damageTakenPct === 'function'
          ? eff.damageTakenPct(caster, state)
          : eff.damageTakenPct;
        state.enemyDamageTakenPct += val;
        if (logCtx) {
          state.pendingSkillEvents?.push({
            type: 'skill_trigger', tick: state.tick,
            unitName: logCtx.unitName, skillLabel: logCtx.skillLabel, slot: logCtx.slot,
            partIdx: logCtx.partIdx, trigger: logCtx.trigger ?? '',
            lineIdx: logCtx.lineIdx ?? null,
            target: '敌人',
            gaugeAfter: state.burstGauge,
          });
        }
        break;
      }

      case 'SKILL_DAMAGE': {
        const sums  = ctx.sums ?? getBuffSums(state, caster.id);
        const count = eff.count ?? 1;
        const mult  = typeof eff.mult === 'function' ? eff.mult(caster, state, ctx) : eff.mult;
        const opts  = eff.opts ?? {};
        for (let h = 0; h < count && state.enemyHp > 0; h++) {
          fireSkillHit(state, caster, mult, sums, eff.label, opts);
        }
        break;
      }

      case 'HEAL': {
        const amount = typeof eff.amount === 'function'
          ? eff.amount(caster, state)
          : (eff.pct ? Math.round(caster.stats.hp * eff.pct) : (eff.flat ?? 0));
        // targets === state.squad 时为全体队友，合并为单条日志
        const isAllAllies = targets === state.squad;
        if (logCtx && isAllAllies) {
          state.pendingSkillEvents?.push({
            type: 'skill_trigger', tick: state.tick,
            unitName: logCtx.unitName, skillLabel: logCtx.skillLabel, slot: logCtx.slot,
            partIdx: logCtx.partIdx, trigger: logCtx.trigger ?? '',
            lineIdx: logCtx.lineIdx ?? null,
            target: '全体队友',
            gaugeAfter: state.burstGauge,
          });
        }
        for (const t of targets) {
          if (t === '__enemy__') continue;
          applyHeal(state, t, amount);
          if (logCtx && !isAllAllies) {
            state.pendingSkillEvents?.push({
              type: 'skill_trigger', tick: state.tick,
              unitName: logCtx.unitName, skillLabel: logCtx.skillLabel, slot: logCtx.slot,
              partIdx: logCtx.partIdx, trigger: logCtx.trigger ?? '',
              lineIdx: logCtx.lineIdx ?? null,
              target: t.name,
              gaugeAfter: state.burstGauge,
            });
          }
          // 分派 HEAL_RECEIVED（Crown S2 等通过此触发响应）
          executeSkillTriggers(state, 'HEAL_RECEIVED', { unit: t });
        }
        break;
      }

      case 'RELOAD_AMMO':
        for (const t of targets) {
          if (t === '__enemy__') continue;
          const pct        = typeof eff.pct === 'function' ? eff.pct(caster, t, state) : eff.pct;
          const ammoBefore = t.ammoLeft;
          t.ammoLeft = Math.min(t.maxAmmo, t.ammoLeft + Math.floor(t.maxAmmo * pct));
          if (eff.cancelReloadIfFull && t.ammoLeft >= t.maxAmmo && t.reloadTick > 0) t.reloadTick = 0;
          if (state.ammoLog && t.ammoLeft !== ammoBefore)
            state.ammoLog.push({ tick: state.tick, unitId: t.id, unitName: t.name,
              delta: t.ammoLeft - ammoBefore, ammoAfter: t.ammoLeft, maxAmmo: t.maxAmmo,
              source: eff.label ?? 'skill_reload' });
        }
        break;

      case 'REDUCE_BURST_CD': {
        const reductionTicks = Math.round(TICK_RATE * eff.seconds);
        for (const t of targets) {
          if (t === '__enemy__') continue;
          t.burstCdRemaining = Math.max(0, t.burstCdRemaining - reductionTicks);
        }
        if (state.buffLog && reductionTicks > 0)
          state.buffLog.push({ type: 'cd_reduction', tick: state.tick,
            name: eff.label ?? 'cd_reduction', unitId: null, reductionTicks });
        break;
      }

      case 'GRANT_BURST_GAUGE': {
        const energy = Math.round(eff.pct * BURST_GAUGE_MAX);
        addBurstGauge(state, caster.name, eff.label ?? 'skill_gauge', energy);
        break;
      }

      case 'AMMO_EXPAND':
        for (const t of targets) {
          if (t === '__enemy__') continue;
          const ammoBefore = t.ammoLeft;
          // maxAmmoPct = mult - 1；pushBuff 触发 recalcMaxAmmo，更新 t.maxAmmo
          pushBuff(state, { name: eff.label ?? 'ammo_expand', unitId: t.id,
            maxAmmoPct: (eff.mult ?? 1) - 1, endTick: state.tick + TICK_RATE * eff.seconds });
          t.ammoLeft   = t.maxAmmo;  // AMMO_EXPAND：扩充并装满
          t.reloadTick = 0;
          if (state.ammoLog)
            state.ammoLog.push({ tick: state.tick, unitId: t.id, unitName: t.name,
              delta: t.ammoLeft - ammoBefore, ammoAfter: t.ammoLeft, maxAmmo: t.maxAmmo,
              source: eff.label ?? 'ammo_expand' });
        }
        break;

      case 'STUN_SELF':
        caster.skillState.stunnedUntilTick = state.tick + TICK_RATE * eff.seconds;
        break;

      case 'WEAPON_SWITCH':
        caster.skillState.weaponSwitchHitMult        = eff.hitMult;
        caster.skillState.weaponSwitchType           = eff.weaponType ?? null;
        // 支持时间制（seconds）或回合制（endRounds）两种到期方式
        caster.skillState.weaponSwitchEndTick        = eff.endRounds !== undefined
          ? Infinity
          : state.tick + TICK_RATE * eff.seconds;
        caster.skillState.weaponSwitchRoundsLeft     = eff.endRounds ?? 0;
        // unlimitedAmmo: true → 武器替换期间弹药不消耗（如 Moran burst）
        caster.skillState.weaponSwitchUnlimitedAmmo  = eff.unlimitedAmmo ?? false;
        break;
    }
  }
}

// ─── 公开 API ───────────────────────────────────────────────────────────────

/**
 * 在指定触发时机执行 SKILL_TRAITS 中所有匹配的技能。
 *
 * @param {object} state
 * @param {string} trigger   触发名称
 * @param {object} [ctx]     上下文：{ unit, sums, isCharged, hitPart }
 */
export function executeSkillTriggers(state, trigger, ctx = {}) {
  const isTeamTrigger = TEAM_TRIGGERS.has(trigger);
  const scopedUnit    = ctx.unit ?? null;

  // 先收集所有匹配的触发器，按 priority 升序排序后再执行（默认 priority=0）
  const pending = [];

  for (const [ridStr, charSkills] of Object.entries(SKILL_TRAITS)) {
    const caster = state.squad.find(u => u.id === Number(ridStr));
    if (!caster) continue;

    for (const skillKey of ['skill1', 'skill2', 'burst']) {
      const skill = charSkills[skillKey];
      if (!skill?.triggers) continue;

      for (const [tdefIdx, tdef] of skill.triggers.entries()) {
        if (tdef.on !== trigger) continue;
        if (!isTeamTrigger && scopedUnit && scopedUnit.id !== caster.id) continue;
        if (!checkConditions(state, caster, tdef, ctx)) continue;
        pending.push({ caster, skillKey, tdefIdx, tdef, skill });
      }
    }
  }

  if (pending.some(p => p.tdef.priority !== undefined)) {
    pending.sort((a, b) => (a.tdef.priority ?? 0) - (b.tdef.priority ?? 0));
  }

  for (const { caster, skillKey, tdefIdx, tdef, skill } of pending) {
    const logCtx = buildLogCtx(caster, skillKey, tdefIdx, tdef, skill, trigger);

    if (tdef.handler) {
      state._logCtx = logCtx;
      ctx.logCtx = logCtx;
      tdef.handler(state, caster, ctx);
      state._logCtx = null;
    } else {
      const targets = resolveTargets(state, caster, tdef.target, tdef.targetOpts);
      applyEffects(state, caster, targets, tdef.effects ?? [], ctx, logCtx);
    }
  }
}

/**
 * 仅触发当前单位的 SHOT_COUNT 技能（不递减回合 buff、不处理 LAST_BULLET 等）。
 *
 * 专用于 Zwei 爆裂双重命中机制：第一次命中后、第二次命中前触发一次普通攻击计数，
 * 让 S1 P2 在第一次和第二次命中之间生效，同时不对回合制 buff 进行额外消耗。
 *
 * @param {object} state
 * @param {object} unit      射击单位
 * @param {object} shotCtx   { sums, isCharged, isCore, ammoAfterShot }
 */
export function fireShotCountTriggers(state, unit, shotCtx) {
  const rid = String(unit.id);
  const charSkills = SKILL_TRAITS[rid];
  if (!charSkills) return;
  const ctx = { unit, ...shotCtx };
  for (const [skillKey, skill] of [['skill1', charSkills.skill1], ['skill2', charSkills.skill2], ['burst', charSkills.burst]]) {
    if (!skill?.triggers) continue;
    for (const [tdefIdx, tdef] of skill.triggers.entries()) {
      if (tdef.on !== 'SHOT_COUNT') continue;
      const counterKey = tdef.opts?.counterKey ?? `shotCount_${skillKey}`;
      unit.skillState[counterKey] = (unit.skillState[counterKey] ?? 0) + 1;
      const every = tdef.opts?.every ?? 1;
      if (unit.skillState[counterKey] < every) continue;
      unit.skillState[counterKey] -= every;
      if (!checkConditions(state, unit, tdef, ctx)) continue;
      const logCtx = buildLogCtx(unit, skillKey, tdefIdx, tdef, skill, 'SHOT_COUNT');
      if (tdef.handler) {
        state._logCtx = logCtx;
        ctx.logCtx = logCtx;
        tdef.handler(state, unit, ctx);
        state._logCtx = null;
      } else {
        applyEffects(state, unit, resolveTargets(state, unit, tdef.target, tdef.targetOpts), tdef.effects ?? [], ctx, logCtx);
      }
    }
  }
}

/**
 * 每发射击后调用。处理 SHOT_COUNT 触发（溢出保留），以及
 * LAST_BULLET / FULL_CHARGE / CORE_HIT 触发。
 *
 * @param {object} state
 * @param {object} unit      射击单位
 * @param {object} shotCtx   { sums, isCharged, hitPart, ammoAfterShot }
 * @param {object} [opts]    可选标志
 *   skipShotCount      {boolean}  跳过 SHOT_COUNT 触发（已由 fireShotCountTriggers 处理）
 *   skipRoundDecrement {boolean}  跳过 decrementRoundBuffs（已在双重命中第一次命中后手动调用）
 */
export function onShotFired(state, unit, shotCtx, opts = {}) {
  // 全队命中计数（供依赖全队命中数的技能使用，如 Elegg: Boom and Shock S1）
  state.squadShotCount = (state.squadShotCount ?? 0) + 1;

  // SQUAD_SHOT_COUNT：每次任意单位普通攻击后，对所有在队伍中的角色广播
  for (const [ridStr, charSkills] of Object.entries(SKILL_TRAITS)) {
    const caster = state.squad?.find(u => String(u.id) === ridStr);
    if (!caster) continue;
    for (const skillKey of ['skill1', 'skill2', 'burst']) {
      const skill = charSkills[skillKey];
      if (!skill?.triggers) continue;
      for (const [tdefIdx, tdef] of skill.triggers.entries()) {
        if (tdef.on !== 'SQUAD_SHOT_COUNT') continue;
        if (tdef.handler) {
          const logCtx = buildLogCtx(caster, skillKey, tdefIdx, tdef, skill, 'SQUAD_SHOT_COUNT');
          state._logCtx = logCtx;
          tdef.handler(state, caster, { shootingUnit: unit });
          state._logCtx = null;
        }
      }
    }
  }

  const rid = String(unit.id);
  const charSkills = SKILL_TRAITS[rid];
  if (!charSkills) return;

  const ctx = { unit, ...shotCtx };

  for (const skillKey of ['skill1', 'skill2', 'burst']) {
    const skill = charSkills[skillKey];
    if (!skill?.triggers) continue;

    for (const [tdefIdx, tdef] of skill.triggers.entries()) {
      switch (tdef.on) {

        case 'SHOT_COUNT': {
          // skipShotCount：双重命中已通过 fireShotCountTriggers 处理，跳过以避免重复触发。
          if (opts.skipShotCount) break;
          const counterKey = tdef.opts?.counterKey ?? `shotCount_${skillKey}`;
          unit.skillState[counterKey] = (unit.skillState[counterKey] ?? 0) + 1;
          const every = tdef.opts?.every ?? 1;
          if (unit.skillState[counterKey] < every) break;
          unit.skillState[counterKey] -= every;  // 溢出保留
          if (!checkConditions(state, unit, tdef, ctx)) break;
          {
            const logCtx = buildLogCtx(unit, skillKey, tdefIdx, tdef, skill, 'SHOT_COUNT');
            if (tdef.handler) {
              state._logCtx = logCtx;
              ctx.logCtx = logCtx;
              tdef.handler(state, unit, ctx);
              state._logCtx = null;
            } else {
              applyEffects(state, unit, resolveTargets(state, unit, tdef.target, tdef.targetOpts), tdef.effects ?? [], ctx, logCtx);
            }
          }
          break;
        }

        case 'LAST_BULLET': {
          if (shotCtx.ammoAfterShot !== 0) break;
          if (!checkConditions(state, unit, tdef, ctx)) break;
          {
            const logCtx = buildLogCtx(unit, skillKey, tdefIdx, tdef, skill, 'LAST_BULLET');
            if (tdef.handler) {
              state._logCtx = logCtx;
              ctx.logCtx = logCtx;
              tdef.handler(state, unit, ctx);
              state._logCtx = null;
            } else {
              applyEffects(state, unit, resolveTargets(state, unit, tdef.target, tdef.targetOpts), tdef.effects ?? [], ctx, logCtx);
            }
          }
          break;
        }

        case 'FULL_CHARGE': {
          if (!shotCtx.isCharged) break;
          if (!checkConditions(state, unit, tdef, ctx)) break;
          {
            const logCtx = buildLogCtx(unit, skillKey, tdefIdx, tdef, skill, 'FULL_CHARGE');
            if (tdef.handler) {
              state._logCtx = logCtx;
              ctx.logCtx = logCtx;
              tdef.handler(state, unit, ctx);
              state._logCtx = null;
            } else {
              applyEffects(state, unit, resolveTargets(state, unit, tdef.target, tdef.targetOpts), tdef.effects ?? [], ctx, logCtx);
            }
          }
          break;
        }

        case 'CORE_HIT':
          if (shotCtx.hitPart !== 'core') break;
          if (!checkConditions(state, unit, tdef, ctx)) break;
          {
            const logCtx = buildLogCtx(unit, skillKey, tdefIdx, tdef, skill, 'CORE_HIT');
            if (tdef.handler) {
              state._logCtx = logCtx;
              ctx.logCtx = logCtx;
              tdef.handler(state, unit, ctx);
              state._logCtx = null;
            } else {
              applyEffects(state, unit, resolveTargets(state, unit, tdef.target, tdef.targetOpts), tdef.effects ?? [], ctx, logCtx);
            }
          }
          break;
      }
    }
  }
  // skipRoundDecrement：双重命中已在第一次命中后手动调用 decrementRoundBuffs，跳过以避免重复消耗。
  if (!opts.skipRoundDecrement) decrementRoundBuffs(state, unit.id);
  // Weapon switch round-based expiry: decrement per shot, deactivate on exhaustion
  if ((unit.skillState?.weaponSwitchRoundsLeft ?? 0) > 0) {
    unit.skillState.weaponSwitchRoundsLeft--;
    if (unit.skillState.weaponSwitchRoundsLeft <= 0) {
      unit.skillState.weaponSwitchEndTick = 0;
      // 武器切换结束后的 backswing 封锁（如 Snow White burst 90 ticks）
      const bsTicks = unit.skillState.weaponSwitchBackswingTicks ?? 0;
      if (bsTicks > 0)
        unit.skillState.weaponSwitchPostBackswingEndTick = state.tick + bsTicks;
    }
  }
}

/**
 * 全蓄力击发之前调用（battle.js line-1033 getBuffSums 之前）。
 * 处理 DURING_FULL_CHARGE 触发——此时机比 FULL_CHARGE 更早，推入的 buff 可被本次普攻的 getBuffSums 读到。
 */
export function fireDuringFullChargeTriggers(state, unit) {
  const rid = String(unit.id);
  const charSkills = SKILL_TRAITS[rid];
  if (!charSkills) return;

  const ctx = { unit, isCharged: true };

  for (const skillKey of ['skill1', 'skill2', 'burst']) {
    const skill = charSkills[skillKey];
    if (!skill?.triggers) continue;
    for (const [tdefIdx, tdef] of skill.triggers.entries()) {
      if (tdef.on !== 'DURING_FULL_CHARGE') continue;
      if (!checkConditions(state, unit, tdef, ctx)) continue;
      const logCtx = buildLogCtx(unit, skillKey, tdefIdx, tdef, skill, 'DURING_FULL_CHARGE');
      if (tdef.handler) {
        state._logCtx = logCtx;
        ctx.logCtx = logCtx;
        tdef.handler(state, unit, ctx);
        state._logCtx = null;
      } else {
        applyEffects(state, unit, resolveTargets(state, unit, tdef.target, tdef.targetOpts), tdef.effects ?? [], ctx, logCtx);
      }
    }
  }
}

/**
 * 每 tick 调用。处理全程 INTERVAL 触发（不限于爆裂期间）。
 * 首次触发延迟一个步长（t+Ns），保持精确步长节奏，不漂移。
 */
export function onInterval(state) {
  for (const [ridStr, charSkills] of Object.entries(SKILL_TRAITS)) {
    const caster = state.squad.find(u => u.id === Number(ridStr));
    if (!caster) continue;

    for (const skillKey of ['skill1', 'skill2', 'burst']) {
      const skill = charSkills[skillKey];
      if (!skill?.triggers) continue;

      for (const [tdefIdx, tdef] of skill.triggers.entries()) {
        if (tdef.on !== 'INTERVAL') continue;

        const intervalTicks = Math.round((tdef.opts?.seconds ?? 1) * TICK_RATE);
        const lastKey       = `intervalBattleLast_${skillKey}`;
        // 首次：记录当前 tick，令第一次触发在 t+Ns
        if (caster.skillState[lastKey] == null) caster.skillState[lastKey] = state.tick;
        if (state.tick - caster.skillState[lastKey] < intervalTicks) continue;
        caster.skillState[lastKey] += intervalTicks;

        const ctx = { unit: caster, sums: getBuffSums(state, caster.id) };
        if (!checkConditions(state, caster, tdef, ctx)) continue;
        const logCtx = buildLogCtx(caster, skillKey, tdefIdx, tdef, skill, 'INTERVAL');
        if (tdef.handler) {
          state._logCtx = logCtx;
          ctx.logCtx = logCtx;
          tdef.handler(state, caster, ctx);
          state._logCtx = null;
        } else {
          applyEffects(state, caster, resolveTargets(state, caster, tdef.target, tdef.targetOpts), tdef.effects ?? [], ctx, logCtx);
        }
      }
    }
  }
}

/**
 * 自然装填到满时调用（ammoLeft 恢复至 maxAmmo）。处理 RELOAD_END 触发。
 * 不包含技能/道具补弹将弹匣填满的情况。
 */
export function onReloadEnd(state, unit) {
  const rid = String(unit.id);
  const charSkills = SKILL_TRAITS[rid];
  if (!charSkills) return;
  const ctx = { unit };
  for (const skillKey of ['skill1', 'skill2', 'burst']) {
    const skill = charSkills[skillKey];
    if (!skill?.triggers) continue;
    for (const [tdefIdx, tdef] of skill.triggers.entries()) {
      if (tdef.on !== 'RELOAD_END') continue;
      if (!checkConditions(state, unit, tdef, ctx)) continue;
      const logCtx = buildLogCtx(unit, skillKey, tdefIdx, tdef, skill, 'RELOAD_END');
      if (tdef.handler) {
        state._logCtx = logCtx;
        ctx.logCtx = logCtx;
        tdef.handler(state, unit, ctx);
        state._logCtx = null;
      } else {
        applyEffects(state, unit, resolveTargets(state, unit, tdef.target, tdef.targetOpts), tdef.effects ?? [], ctx, logCtx);
      }
    }
  }
}

/**
 * 全爆裂期间在 tick() 顶层调用。处理 INTERVAL_IN_BURST 触发。
 * 保持精确步长节奏，不漂移。
 */
export function onIntervalInBurst(state) {
  if (!state.fullBurstActive) return;

  for (const [ridStr, charSkills] of Object.entries(SKILL_TRAITS)) {
    const caster = state.squad.find(u => u.id === Number(ridStr));
    if (!caster) continue;

    for (const skillKey of ['skill1', 'skill2', 'burst']) {
      const skill = charSkills[skillKey];
      if (!skill?.triggers) continue;

      for (const [tdefIdx, tdef] of skill.triggers.entries()) {
        if (tdef.on !== 'INTERVAL_IN_BURST') continue;

        const intervalTicks = Math.round((tdef.opts?.seconds ?? 1) * TICK_RATE);
        const lastKey       = `intervalLast_${skillKey}`;
        // 每次全爆裂开始时重置，确保立即触发首次效果
        if (caster.skillState[lastKey] == null || caster.skillState[lastKey] < state.fullBurstStartTick) {
          caster.skillState[lastKey] = state.tick - intervalTicks;
        }
        if (state.tick - caster.skillState[lastKey] < intervalTicks) continue;
        caster.skillState[lastKey] += intervalTicks;

        const ctx = { unit: caster, sums: getBuffSums(state, caster.id) };
        if (!checkConditions(state, caster, tdef, ctx)) continue;
        const logCtx = buildLogCtx(caster, skillKey, tdefIdx, tdef, skill, 'INTERVAL_IN_BURST');
        if (tdef.handler) {
          state._logCtx = logCtx;
          ctx.logCtx = logCtx;
          tdef.handler(state, caster, ctx);
          state._logCtx = null;
        } else {
          applyEffects(state, caster, resolveTargets(state, caster, tdef.target, tdef.targetOpts), tdef.effects ?? [], ctx, logCtx);
        }
      }
    }
  }
}
