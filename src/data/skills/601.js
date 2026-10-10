import { pushBuff, applyHeal, TICK_RATE, pushHoT, ALL_ALLIES, getFinalMaxHp } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Prika  (resource_id: 601)

// S1 P2 Performance 期间的自身 buff（治疗效能 + Pierce 合并，混合类型不加类型后缀 → 「技能名 Pn」）
const PERFORMANCE_POTENCY = 'Let\'s Get the Show Started P2';

export default {

  // ── Let's Get the Show Started
  // ■ Activates when attacking with Full Charge. Affects all allies.
  //   Projectile Explosion Damage ▲ {p00}% for {p01=3} sec.
  //   Pierce Damage ▲ {p02}% for {p03=3} sec.
  //   ATK ▲ {p04}% of the caster's ATK for {p05=3} sec.
  // ■ Activates only while in Performance status. Affects self.
  //   Outgoing Healing ▲ {p06}% continuously. Gains Pierce continuously.
  //   绑定于 Performance：治疗效能 + Pierce 合并为一条自身 buff，随 Performance 开始 / 延长
  //   （爆裂 handler 与 Encore）推入并同步到期。
  //
  // group_id: 26011
  // p00 Projectile Explosion Damage ▲%: [11.82, 12.72, 13.63, 14.54, 15.45, 16.36, 17.27, 18.18, 19.09, 20]
  // p01 duration (const): [3, ...]
  // p02 Pierce Damage ▲%: [7.73, 8.33, 8.92, 9.52, 10.11, 10.71, 11.3, 11.9, 12.49, 13.09]
  // p03 duration (const): [3, ...]
  // p04 ATK ▲%（基于施放者 ATK）: [11.11, 12.09, 13.08, 14.07, 15.06, 16.04, 17.03, 18.02, 19.01, 20]
  // p05 duration (const): [3, ...]
  // p06 Outgoing Healing ▲%（Performance 中生效，作用于 Prika 作为治疗者的所有治疗）:
  //     [29.5, 31.77, 34.03, 36.3, 38.57, 40.84, 43.11, 45.38, 47.65, 49.92]
  skill1: {
    groupId: 26011,
    triggers: [
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv      = caster.skillLevels[0];
          const endTick = state.tick + TICK_RATE * 3;

          // 全队：Projectile Explosion Damage ▲ p00% + Pierce Damage ▲ p02% + ATK ▲（p04% × 施放者 ATK）3s
          // 三项同目标同时长且不在同一乘区，合并为一条 buff；混合类型不加类型后缀 → 「技能名 Pn」
          const projExpPct = getSkillValue(caster.rawSkill1, 0, lv) / 100;
          const piercePct  = getSkillValue(caster.rawSkill1, 2, lv) / 100;
          const atkPct     = getSkillValue(caster.rawSkill1, 4, lv) / 100;
          const atkFlat    = Math.round(caster.stats.atk * atkPct);
          pushBuff(state, { name: 'Let\'s Get the Show Started P1', unitId: null,
            projectileExplosionDamagePct: projExpPct, pierceDamagePct: piercePct, atkFlat, endTick });
        },
      },
    ],
  },

  // ── One More Song!
  // ■ Activates at the beginning of Full Burst. Affects self.
  //   Max HP ▲ {p00}% for {p01=10} sec.
  // ■ Encore — Activates when Sing Along takes effect while Prika is in Performance status.
  //   Effect 1: Affects the Sing Along initiator. Assigned Part: Singing (continuous).
  //   Effect 2: Affects all allies. Performance duration ▲ {p02=21} sec.
  //   Effect 3: Affects all allies. Attack Damage ▲ {p03}% for {p04=10} sec.
  //   Effect 4: Affects self. Cooldown of Burst Skill ▲ {p05=21} sec.
  //
  // group_id: 26012
  // p00 Max HP ▲%: [11.8, 12.71, 13.62, 14.53, 15.44, 16.34, 17.25, 18.16, 19.07, 19.98]
  // p01 duration (const): [10, ...]
  // p02 Performance duration ▲ sec (const): [21, ...]
  // p03 Attack Damage ▲%: [14.29, 15.48, 16.67, 17.86, 19.05, 20.24, 21.43, 22.62, 23.81, 25.01]
  // p04 duration (const): [10, ...]
  // p05 Burst CD ▲ sec (const): [21, ...]
  skill2: {
    groupId: 26012,
    triggers: [
      // P1：进入全爆裂 → 自身 Max HP ▲ p00% 10s
      {
        on: 'ENTER_FULL_BURST',
        handler(state, caster) {
          const lv       = caster.skillLevels[1];
          const maxHpPct = getSkillValue(caster.rawSkill2, 0, lv) / 100;
          pushBuff(state, { name: 'One More Song!', unitId: caster.id,
            maxHpPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // P2（Encore）：Sing Along 生效时（SING_ALONG，由 Mint 600 爆裂技能推入 Sing Along 后立即派发），
      // 若 Prika 处于 Performance 状态则结算。时序早于 ENTER_BURST_III：
      // Mint 爆裂（切换 Assigned Part → Sing Along）→ Encore → 进入阶段 3（Mint S2 据 Singing 生效）
      {
        on: 'SING_ALONG',
        handler(state, caster, ctx) {
          const ss            = caster.skillState;
          const inPerformance = (ss.prika_performanceEndTick ?? 0) > state.tick;
          if (!inPerformance) return false;

          const lv        = caster.skillLevels[1];
          const endTick   = state.tick + TICK_RATE * 10;
          const initiator = ctx.unit;

          // Effect 1：合唱施放者获得 Assigned Part: Singing（持续）；与 Dancing 互斥，覆盖 Mint 爆裂刚赋予的 Dancing
          state.buffs = state.buffs.filter(b => !(b.unitId === initiator.id &&
            (b.name === 'Assigned Part: Dancing' || b.name === 'Assigned Part: Singing')));
          pushBuff(state, { name: 'Assigned Part: Singing', unitId: initiator.id, endTick: Infinity });

          // Effect 2：Performance 延长 21s（HoT + Charge Damage buff 同步延长）
          const oldEndTick = ss.prika_performanceEndTick;
          ss.prika_performanceEndTick += TICK_RATE * 21;

          // 延长所有队友的 Performance Charge Damage buff 与自身 S1 P2 治疗效能 buff 的到期时间
          for (const b of state.buffs) {
            if (b.name === 'Performance' || b.name === PERFORMANCE_POTENCY) b.endTick = ss.prika_performanceEndTick;
          }

          // 追加 21 次 HoT（紧接原结束 tick 之后逐秒触发；casterId 使每次按当时的治疗效能计算）
          for (const u of state.squad) {
            for (let i = 1; i <= 21; i++) {
              state.pendingHoTs.push({ fireTick: oldEndTick + i * TICK_RATE, targetId: u.id,
                amount: ss.prika_hotAmount, casterId: caster.id });
            }
          }

          // Effect 3：全队 Attack Damage ▲ p03% 10s
          const atkDmgPct = getSkillValue(caster.rawSkill2, 3, lv) / 100;
          pushBuff(state, { name: 'Encore', unitId: null,
            attackDamagePct: atkDmgPct, endTick });

          // Effect 4：自身爆裂冷却 ▲ p05 秒（直接累加到剩余冷却上，冷却已就绪时从 0 起算）
          const cdIncreaseTicks = Math.round(getSkillValue(caster.rawSkill2, 5, lv) * TICK_RATE);
          caster.burstCdRemaining += cdIncreaseTicks;
        },
      },
    ],
  },

  // ── Get Ready for an Amazing Show!
  // ■ Affects all allies. Performance (25 sec, cannot be removed):
  //   Effect 1: Restores {p00}% of the caster's final max HP as HP every 1 sec for {p01=25} sec.
  //   Effect 2: Charge Damage ▲ {p04}% for {p05=25} sec.
  //
  // group_id: 16013
  // p00 HP recovery %/sec: [1.79, 1.93, 2.07, 2.21, 2.34, 2.48, 2.62, 2.76, 2.9, 3.04]
  // p01 duration (const): [25, ...]
  // p04 Charge Damage ▲%: [13.88, 15.12, 16.35, 17.59, 18.82, 20.06, 21.29, 22.53, 23.76, 25]
  // p05 duration (const): [25, ...]
  burst: {
    groupId: 16013,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const ss       = caster.skillState;
          const lv       = caster.skillLevels[2];
          const duration = 25;

          // Performance 持续 25s（Encore 可延长）
          ss.prika_performanceEndTick = state.tick + TICK_RATE * duration;

          // S1 P2：Performance 期间自身治疗效能 ▲ p06% + Pierce（随 Performance 立即生效，日志归属 S1 P2）
          const potencyPct = getSkillValue(caster.rawSkill1, 6, caster.skillLevels[0]) / 100;
          pushBuff(state, { name: PERFORMANCE_POTENCY, unitId: caster.id, pierce: true,
            healPotencyPct: potencyPct, endTick: ss.prika_performanceEndTick },
            { ...state._logCtx, skillLabel: caster.rawSkill1?.name_localkey ?? 'S1', slot: 'S1', partIdx: 1, lineIdx: null });

          // Effect 1：HoT — p00% × Prika 最终 Max HP / s × 25s（每次触发按当时治疗效能放大）
          const hotPct     = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const amount     = Math.round(getFinalMaxHp(state, caster) * hotPct);  // "caster's final max HP"
          ss.prika_hotAmount = amount; // 供 Encore 延长时复用
          pushHoT(state, ALL_ALLIES, amount, duration, null, caster);

          // Effect 2：全队 Charge Damage ▲ p04% 25s
          const chargeDmgPct = getSkillValue(caster.rawBurst, 4, lv) / 100;
          pushBuff(state, { name: 'Performance', unitId: null,
            chargeDamagePct: chargeDmgPct, endTick: state.tick + TICK_RATE * duration });
        },
      },
    ],
  },
};
