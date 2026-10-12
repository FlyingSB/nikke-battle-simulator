import { pushBuff, reloadMagazinePct, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Tove  (resource_id: 192)
// SSR 珍藏品: Fire Starter（id: 201101）

// Temporary Modification 叠层 buff（S1 P2 L2）：层数即 buff.stacks，过期即叠层归零
const TEMP_MOD_BUFF = 'Temporary Modification';
// S2 两段效果：仅在 Temporary Modification 满层时存在
const S2_BUFF_NAMES = ['Modification Successful (Crit Rate)', 'Modification Successful (Attack Speed)'];

// S2 效果由 S1 handler 推入，日志归属需显式改为 S2 槽位
function s2LogCtx(state, caster, partIdx) {
  return { ...state._logCtx, skillLabel: caster.rawSkill2?.name_localkey || 'S2', slot: 'S2', partIdx, lineIdx: null };
}

export default {

  // ── Emergency-Crafted Bullets（SSR：Fire Starter 201101，skill_change_slot=1）
  // ■ Activates after {p00} normal attack(s). Affects self.
  //   Emergency-Crafted Bullets: Reload {p01}% of the magazine.
  // ■ Activates during Emergency-Crafted Bullets. Affects all allies.
  //   Temporary Modification: Max Ammunition Capacity ▲ {p02},
  //   stacks up to {p03=3} times, lasts {p04=5} sec.
  //   Critical Damage ▲ {p05}% for {p06=5} sec.
  //
  // SSR group_id: 121921
  // p00 shot threshold: [25,25,20,20,20,15,15,15,10,10]
  // p01 reload%: [3.13,3.37,3.62,3.86,4.1,4.34,4.58,4.82,5.06,5.31]
  // p02 Max Ammo ▲ 每层（flat）: [1,1,1,1,1,2,2,2,2,2]
  // p03 max stacks (const): [3,...]
  // p04 duration (const): [5,...]
  // p05 Crit Damage ▲%: [2.96,3.21,3.47,3.72,3.97,4.23,4.48,4.73,4.99,5.24]
  // p06 duration (const): [5,...]
  //
  // S2（Modification Successful）效果在叠满时由本处 handler 驱动。
  // [TODO 基础技能]: 非 SSR 版 Tove 技能未建模
  skill1: {
    groupId: 121921,
    triggers: [
      {
        on: 'SHOT_COUNT',
        opts: { every: 1 },
        handler(state, caster) {
          const favS1 = caster.ssrFavSkills?.skill1;
          if (!favS1) return;
          const lv  = favS1._activeSkillLevel ?? 10;

          // 手动计数（threshold 随等级变化，不能用 opts.every 静态编码）
          const thr = getSkillValue(favS1, 0, lv);
          const ss  = caster.skillState;
          ss.tv_s1_shots = (ss.tv_s1_shots ?? 0) + 1;
          if (ss.tv_s1_shots < thr) return;
          ss.tv_s1_shots -= thr;

          const reloadPct     = getSkillValue(favS1, 1, lv) / 100;
          const ammoPerStack  = getSkillValue(favS1, 2, lv);   // 每层弹容量 +1 / +2
          const maxStacks     = getSkillValue(favS1, 3, lv);   // 3
          const tempModDur    = getSkillValue(favS1, 4, lv);   // 5 sec
          const critDamagePct = getSkillValue(favS1, 5, lv) / 100;
          const critDmgDur    = getSkillValue(favS1, 6, lv);   // 5 sec

          // P2 L2：Temporary Modification 全队 Max Ammo ▲（每次 +1 层，刷新持续时间；过期则整体消失）
          pushBuff(state, { name: TEMP_MOD_BUFF, unitId: null, maxAmmoFlat: ammoPerStack,
            stackLimit: maxStacks, endTick: state.tick + TICK_RATE * tempModDur },
            { ...state._logCtx, partIdx: 1, lineIdx: 1 });

          // P1：自身补弹 round(p01% × maxAmmo)，按本次 Temporary Modification 扩容后的上限计算（补满则取消装填）。
          // 实测（Lv10 5.31%，基础弹匣 60）：第 10/20/30 发分别补 3/3/4 发 = round(62/64/66 × 5.31%)；
          // 按扩容前上限（60/62/64）只能得到 3/3/3。
          reloadMagazinePct(state, caster, reloadPct, 'tv_s1_reload');

          // P2 L3：全队 Crit Damage ▲
          pushBuff(state, { name: 'Emergency-Crafted Bullets', unitId: null, critDamagePct,
            endTick: state.tick + TICK_RATE * critDmgDur },
            { ...state._logCtx, partIdx: 1, lineIdx: 2 });

          // S2：仅在叠满时激活（持续效果，由 skill2 BUFF_EXPIRE 在叠层归零时移除）
          const tempMod = state.buffs.find(b => b.name === TEMP_MOD_BUFF && b.unitId === null);
          if ((tempMod?.stacks ?? 0) < maxStacks) return;
          const favS2 = caster.ssrFavSkills?.skill2;
          if (!favS2) return;
          if (state.buffs.some(b => b.name === S2_BUFF_NAMES[0])) return;   // 已激活
          const lv2       = favS2._activeSkillLevel ?? 10;
          const crPct     = getSkillValue(favS2, 0, lv2) / 100;
          const atkSpdPct = getSkillValue(favS2, 1, lv2) / 100;
          pushBuff(state, { name: S2_BUFF_NAMES[0], unitId: null, critRatePct: crPct, endTick: Infinity },
            s2LogCtx(state, caster, 0));
          pushBuff(state, { name: S2_BUFF_NAMES[1], unitId: null, atkSpeedPct: atkSpdPct,
            weaponFilter: 'SG', endTick: Infinity },
            s2LogCtx(state, caster, 1));
        },
      },
    ],
  },

  // ── Modification Successful（SSR：Fire Starter 201101，skill_change_slot=2）
  // ■ Only activates when Temporary Modification is fully stacked. Affects all allies.
  //   Critical Rate ▲ {p00}% continuously.
  // ■ Only activates when Temporary Modification is fully stacked. Affects all SG allies.
  //   Attack Speed ▲ {p01}% continuously.
  //
  // SSR group_id: 121922
  // p00 Crit Rate ▲%: [5.27,5.81,6.34,6.87,7.41,7.94,8.47,9.01,9.54,10.08]
  // p01 Attack Speed ▲%: [24.96,26.88,28.8,30.72,32.64,34.56,36.48,38.4,40.32,42.24]
  //
  // 激活由 S1 handler 在叠满时驱动；此处负责取消：
  // 叠层只增不减，实战中仅在 Temporary Modification 过期（叠层归零）时不再满层。
  skill2: {
    groupId: 121922,
    triggers: [
      {
        on: 'BUFF_EXPIRE',
        handler(state, caster, ctx) {
          if (ctx.buffName !== TEMP_MOD_BUFF || ctx.buffUnitId !== null) return false;
          if (!caster.ssrFavSkills?.skill2) return false;
          const removed = state.buffs.filter(b => S2_BUFF_NAMES.includes(b.name));
          if (removed.length === 0) return false;
          state.buffs = state.buffs.filter(b => !S2_BUFF_NAMES.includes(b.name));
          if (state.buffLog) {
            for (const b of removed)
              state.buffLog.push({ type: 'buff_expire', tick: state.tick, name: b.name, unitId: b.unitId });
          }
        },
      },
    ],
  },

  // ── Miracle of Makeshifts（SSR：Fire Starter 201101，skill_change_slot=3）
  // ■ Affects all allies.
  //   Miracle of Makeshifts: ATK ▲ {p00}% of caster's ATK.
  //   Mirrors the stack count of Temporary Modification for {p01=15} sec.
  // ■ Affects all shotgun-wielding allies.
  //   Miracle of Makeshifts: ATK ▲ {p02}% of caster's ATK.
  //   Mirrors the stack count of Temporary Modification for {p03=15} sec.
  //
  // SSR group_id: 111923
  // p00 ATK% of caster（全队，每层）: [1.37,1.47,1.58,1.68,1.79,1.9,2,2.11,2.21,2.32]
  // p01 duration (const): [15,...]
  // p02 ATK% of caster（SG 额外，每层）: [14.31,15.41,16.51,17.61,18.71,19.81,20.91,22.01,23.11,24.21]
  // p03 duration (const): [15,...]
  //
  // 全队 flat ATK = caster.atk × p00% × Temporary Modification 层数
  // SG 友军额外 flat ATK = caster.atk × p02% × 层数
  burst: {
    groupId: 111923,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const favBurst = caster.ssrFavSkills?.burst;
          if (!favBurst) return false;
          const lv      = favBurst._activeSkillLevel ?? 10;
          const allPct  = getSkillValue(favBurst, 0, lv) / 100;
          const sgPct   = getSkillValue(favBurst, 2, lv) / 100;
          const endTick = state.tick + TICK_RATE * getSkillValue(favBurst, 1, lv);

          const tempMod = state.buffs.find(b => b.name === TEMP_MOD_BUFF && b.unitId === null);
          const stacks  = tempMod?.stacks ?? 0;
          if (stacks <= 0) return false;

          const casterAtk = caster.stats.atk;

          // P1：全队 ATK ▲（flat，基于施法者 ATK）
          pushBuff(state, { name: 'Miracle of Makeshifts P1 (ATK)', unitId: null,
            atkFlat: casterAtk * allPct * stacks, multiplier: stacks, endTick },
            { ...state._logCtx, partIdx: 0 });

          // P2：SG 友军额外 ATK ▲
          pushBuff(state, { name: 'Miracle of Makeshifts P2 (ATK)', unitId: null,
            atkFlat: casterAtk * sgPct * stacks, multiplier: stacks, weaponFilter: 'SG', endTick },
            { ...state._logCtx, partIdx: 1 });
        },
      },
    ],
  },
};
