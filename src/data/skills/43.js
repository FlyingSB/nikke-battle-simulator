import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

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
      //   伤害计算在 onShotFired 之前，FULL_CHARGE handler 在射击后触发：
      //   因此"消耗"逻辑放在 handler 开头（清除上一发穿透状态），再按计数重新激活。
      {
        on: 'FULL_CHARGE',
        logTargets: 'SELF',
        handler(state, caster) {
          // 上一发是穿透发 → 消耗穿透标志
          if (caster.skillState.pierceActive) {
            caster.skillState.pierceActive = false;
          }
          caster.skillState.dkw_s1_fcCount = (caster.skillState.dkw_s1_fcCount ?? 0) + 1;
          if (caster.skillState.dkw_s1_fcCount % 3 === 0) {
            caster.skillState.pierceActive = true;
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
            pushBuff(state, { name: 'dkw_s1_pierceDmg', unitId: u.id,
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
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const lv = caster.skillLevels[1];
          caster.skillState.dkw_fcCount = (caster.skillState.dkw_fcCount ?? 0) + 1;
          const cnt = caster.skillState.dkw_fcCount;

          // 每 5 次全蓄力：全员攻击伤害 ▲ p03% 10s（同名 buff 刷新）
          if (cnt % 5 === 0) {
            const atkDmgPct = getSkillValue(caster.rawSkill2, 3, lv) / 100;
            pushBuff(state, { name: 'dkw_s2_atkDmg', unitId: null,
              attackDamagePct: atkDmgPct, endTick: state.tick + TICK_RATE * 10 });
          }

          // 每 8 次全蓄力：全员爆裂冷却 ▼ p01s
          if (cnt % 8 === 0) {
            const cdSec = getSkillValue(caster.rawSkill2, 1, lv);
            const reductionTicks = Math.round(TICK_RATE * cdSec);
            for (const u of state.squad) {
              u.burstCdRemaining = Math.max(0, u.burstCdRemaining - reductionTicks);
            }
            if (state.buffLog)
              state.buffLog.push({ type: 'cd_reduction', tick: state.tick,
                name: 'dkw_s2_cdReduction', unitId: null, reductionTicks });
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
  //   [TODO] Wipe Out 部件命中（hit parts）→ 核心伤害加成：引擎缺少 hit-parts 事件，待引擎支持后建模。
  //   Allies that hit the body: ATK ▲ {p03}% of caster's ATK for {p04=10} sec.
  //   [简化] 单 Boss 场景中友军必然命中 Body；全爆裂使用时直接对全员施加 ATK Flat 加成。
  //
  // group_id: 10433
  // p00 Burst skill damage%: [159.12, 171.36, 183.6, 195.84, 208.08, 220.32, 232.56, 244.8, 257.04, 269.28]
  // p01 Core damage▲% (part hit): [9.6, 10.34, 11.08, 11.82, 12.56, 13.3, 14.04, 14.78, 15.52, 16.26]  — 不建模
  // p02 Wipe Out duration (const): [10, ...]
  // p03 ATK▲% of caster's ATK (body hit): [7.2, 7.76, 8.31, 8.87, 9.42, 9.97, 10.53, 11.08, 11.64, 12.19]
  // p04 body hit buff duration (const): [10, ...]
  burst: {
    groupId: 10433,
    triggers: [
      // Burst 伤害：p00% of final ATK
      {
        on: 'BURST_SKILL_USE',
        logTargets: null,
        target: 'ENEMY',
        effects: [
          {
            type: 'SKILL_DAMAGE',
            mult: (caster) => getSkillValue(caster.rawBurst, 0, caster.skillLevels[2]) / 100,
            label: 'Burst',
          },
        ],
      },
      // Wipe Out body hit：全员 ATK ▲ p03% of caster's ATK（flat）10s
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const lv      = caster.skillLevels[2];
          const atkPct  = getSkillValue(caster.rawBurst, 3, lv) / 100;
          const atkFlat = Math.round(caster.stats.atk * atkPct);
          const end     = state.tick + TICK_RATE * 10;
          pushBuff(state, { name: 'dkw_burst_wipeOut_atkFlat', unitId: null,
            atkFlat, endTick: end });
        },
      },
    ],
  },
};
