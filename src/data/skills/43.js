import { pushBuff, isPartsHit, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: D: Killer Wife  (resource_id: 43)
export default {

  // ── Calm Sniping
  // ■ Activates when attacking with Full Charge for {p00=3} time(s). Affects self.
  //   Gain Pierce for 1 shot.
  // ■ Activates when entering Full Burst. Affects all allies with a Sniper Rifle.
  //   Pierce Damage ▲ {p01}% for {p02=10} sec.
  //
  // group_id: 20431
  // p00 trigger count (const): [3, ...]
  // p01 Pierce Damage▲%: [8, 8.62, 9.24, 9.85, 10.47, 11.08, 11.7, 12.32, 12.93, 13.55]
  // p02 duration (const): [10, ...]
  skill1: {
    groupId: 20431,
    triggers: [
      // S1 Part 1: 每 3 次全蓄力 → 自身下一发获得穿透（Pierce）。
      //   FULL_CHARGE 在射击后触发，推入 endRounds:1 的 pierce buff，
      //   buff 随下一发实弹命中自动消耗。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          caster.skillState.dkw_s1_fcCount = (caster.skillState.dkw_s1_fcCount ?? 0) + 1;
          if (caster.skillState.dkw_s1_fcCount % 3 === 0) {
            pushBuff(state, { name: 'Calm Sniping P1', unitId: caster.id, pierce: true, endRounds: 1 });
          }
        },
      },
      // S1 Part 2: 进入全爆裂 → 队内所有 SR 友军 Pierce Damage ▲ p01% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv  = caster.skillLevels[0];
          const pct = getSkillValue(caster.rawSkill1, 1, lv) / 100;
          const end = state.tick + TICK_RATE * 10;
          for (const u of state.squad) {
            if (u.weaponType !== 'SR') continue;
            pushBuff(state, { name: 'Calm Sniping P2', unitId: u.id,
              pierceDamagePct: pct, endTick: end });
          }
        },
      },
    ],
  },

  // ── Assault Formation
  // ■ Activates when attacking with Full Charge for {p00=8} time(s). Affects all allies.
  //   Cooldown of Burst Skill ▼ {p01} sec.
  // ■ Activates when attacking with Full Charge for {p02=5} time(s). Affects all allies.
  //   Attack damage ▲ {p03}% for {p04=10} sec.
  //
  // group_id: 20432
  // p00 trigger count 1 (const): [8, ...]
  // p01 Burst CD reduction: [4.13, 4.45, 4.77, 5.09, 5.4, 5.72, 6.04, 6.36, 6.68, 7]
  // p02 trigger count 2 (const): [5, ...]
  // p03 Attack damage▲%: [2.99, 3.22, 3.45, 3.68, 3.91, 4.14, 4.37, 4.6, 4.83, 5.06]
  // p04 duration (const): [10, ...]
  skill2: {
    groupId: 20432,
    triggers: [
      // S2: 累计全蓄力次数计数；每 5 次给全员攻击伤害加成，每 8 次减少全员爆裂冷却
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          caster.skillState.dkw_fcCount = (caster.skillState.dkw_fcCount ?? 0) + 1;
          const cnt = caster.skillState.dkw_fcCount;

          // 每 5 次全蓄力：全员攻击伤害 ▲ p03% 10s（同名 buff 刷新）
          if (cnt % 5 === 0) {
            const atkDmgPct = getSkillValue(caster.rawSkill2, 3, lv) / 100;
            pushBuff(state, { name: 'Assault Formation', unitId: null,
              attackDamagePct: atkDmgPct, endTick: state.tick + TICK_RATE * 10 },
              { ...state._logCtx, partIdx: 1 });
          }

          // 每 8 次全蓄力：全员爆裂冷却 ▼ p01s
          if (cnt % 8 === 0) {
            const cdSec = getSkillValue(caster.rawSkill2, 1, lv);
            const reductionTicks = Math.round(TICK_RATE * cdSec);
            for (const u of state.squad) {
              u.burstCdRemaining = Math.max(0, u.burstCdRemaining - reductionTicks);
            }
          }
        },
      },
    ],
  },

  // ── Kill the Target
  // ■ Affects the enemy nearest to the crosshair.
  //   Deals {p00}% of final ATK as additional damage.
  //   Inflicts Wipe Out on the target for {p02=10} sec.
  // ■ Activates when allies' normal attack hits a certain area of the target afflicted with Wipe Out.
  //   Allies that hit parts: Damage dealt when attacking core ▲ {p01}% for {p02=10} sec.
  //   Allies that hit the body: ATK ▲ {p03}% of caster's ATK for {p04=10} sec.
  //
  // group_id: 10433
  // p00 Burst skill damage%: [159.12, 171.36, 183.6, 195.84, 208.08, 220.32, 232.56, 244.8, 257.04, 269.28]
  // p01 Core damage▲% (part hit): [9.6, 10.34, 11.08, 11.82, 12.56, 13.3, 14.04, 14.78, 15.52, 16.26]
  // p02 Wipe Out duration (const): [10, ...]
  // p03 ATK▲% of caster's ATK (body hit): [7.2, 7.76, 8.31, 8.87, 9.42, 9.97, 10.53, 11.08, 11.64, 12.19]
  // p04 body hit buff duration (const): [10, ...]
  burst: {
    groupId: 10433,
    triggers: [
      // Burst 伤害：p00% of final ATK
      {
        on: 'BURST_SKILL_USE',
        target: 'ENEMY',
        effects: [
          {
            type: 'SKILL_DAMAGE',
            mult: (caster) => getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100,
            label: 'Burst',
          },
        ],
      },
      // Wipe Out：对敌人施加 debuff 标记，持续 p02=10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          pushBuff(state, { name: 'Wipe Out', unitId: null,
            endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // Wipe Out 效果：Wipe Out 活跃期间友军每次命中，DKW 为其施加对应 buff。
      //   命中零件 → 该友军 Core Damage ▲ p01% 10s
      //   命中躯体 → 该友军 ATK ▲ p03% of DKW's ATK（flat）10s
      {
        on: 'SQUAD_SHOT_COUNT',
        handler(state, caster, ctx) {
          if (!state.buffs.some(b => b.name === 'Wipe Out' && b.unitId === null && b.endTick > state.tick)) return;
          const u   = ctx.shootingUnit;
          const lv  = caster.skillLevels[2];
          const end = state.tick + TICK_RATE * 10;
          // 零件核心敌人的核心命中同样算命中零件
          if (isPartsHit(state, ctx.hitPart)) {
            pushBuff(state, { name: 'Kill the Target (parts)', unitId: u.id,
              coreDamagePct: getSkillValue(caster.rawBurst, 1, lv) / 100, endTick: end },
              { ...state._logCtx, partIdx: 1, lineIdx: 2 });
          } else {
            pushBuff(state, { name: 'Kill the Target (body)', unitId: u.id,
              atkFlat: Math.round(caster.stats.atk * getSkillValue(caster.rawBurst, 3, lv) / 100), endTick: end },
              { ...state._logCtx, partIdx: 1, lineIdx: 3 });
          }
        },
      },
    ],
  },
};
