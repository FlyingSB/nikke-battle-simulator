import { pushBuff, applyHeal, TICK_RATE, pushHoT, ALL_ALLIES } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Prika  (resource_id: 601)
export default {

  // ── Let's Get the Show Started
  // ■ Activates when attacking with Full Charge. Affects all allies.
  //   Projectile Explosion Damage ▲ {p00}% for {p01=3} sec.
  //   Pierce Damage ▲ {p02}% for {p03=3} sec.
  //   ATK ▲ {p04}% of the caster's ATK for {p05=3} sec.
  // ■ Activates only while in Performance status. Affects self. (passive; not modeled as separate trigger)
  //   Potency of HP restored ▲ {p06}% continuously. Gains Pierce continuously.
  //
  // group_id: 26011
  // p00 Projectile Explosion Damage ▲%: [11.82, 12.72, 13.63, 14.54, 15.45, 16.36, 17.27, 18.18, 19.09, 20]
  // p01 duration (const): [3, ...]
  // p02 Pierce Damage ▲%: [7.73, 8.33, 8.92, 9.52, 10.11, 10.71, 11.3, 11.9, 12.49, 13.09]
  // p03 duration (const): [3, ...]
  // p04 ATK ▲%（基于施放者 ATK）: [11.11, 12.09, 13.08, 14.07, 15.06, 16.04, 17.03, 18.02, 19.01, 20]
  // p05 duration (const): [3, ...]
  // p06 Potency of HP restored ▲%（Performance 中生效；burst HoT 计算时已折算）:
  //     [29.5, 31.77, 34.03, 36.3, 38.57, 40.84, 43.11, 45.38, 47.65, 49.92]
  skill1: {
    groupId: 26011,
    triggers: [
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv      = caster.skillLevels[0];
          const endTick = state.tick + TICK_RATE * 3;

          // 全队：Projectile Explosion Damage ▲ p00% + Pierce Damage ▲ p02% 3s（合并）
          const projExpPct = getSkillValue(caster.rawSkill1, 0, lv) / 100;
          const piercePct = getSkillValue(caster.rawSkill1, 2, lv) / 100;
          pushBuff(state, { name: 'Let\'s Get the Show Started P1', unitId: null,
            projectileExplosionDamagePct: projExpPct, pierceDamagePct: piercePct, endTick });

          // 全队：ATK ▲（p04% × 施放者 ATK）flat 3s
          const atkPct  = getSkillValue(caster.rawSkill1, 4, lv) / 100;
          const atkFlat = Math.round(caster.stats.atk * atkPct);
          pushBuff(state, { name: 'Let\'s Get the Show Started P1 L4', unitId: null, atkFlat, endTick });
        },
      },
    ],
  },

  // ── One More Song!
  // ■ Activates at the beginning of Full Burst. Affects self.
  //   Max HP ▲ {p00}% for {p01=10} sec.
  // ■ Encore — Activates when Sing Along takes effect while Prika is in Performance status.
  //   Effect 1: Affects the Sing Along initiator. Assigned Part: Singing (continuous; not modeled).
  //   Effect 2: Affects all allies. Performance duration ▲ {p02=21} sec.
  //   Effect 3: Affects all allies. Attack Damage ▲ {p03}% for {p04=10} sec.
  //   Effect 4: Affects self. Cooldown of Burst Skill ▲ {p05=21} sec (not modeled).
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
          pushBuff(state, { name: 'One More Song! P1 L1', unitId: caster.id,
            maxHpPct, endTick: state.tick + TICK_RATE * 10 });
        },
      },
      // P2（Encore）：Mint（resource_id 600）在队且 Prika 处于 Performance 状态时，
      // 以 ENTER_BURST_III 代理"Sing Along 生效"（Mint 为 B2，其 burst 在 B3 进入前触发）
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const ss            = caster.skillState;
          const inPerformance = (ss.prika_performanceEndTick ?? 0) > state.tick;
          if (!inPerformance) return false;

          // "Sing Along takes effect" = Mint（600）在本次 burst 序列中刚刚触发了 Sing Along。
          // Mint 的 BURST_SKILL_USE 先于 ENTER_BURST_III 在同一 tick 内执行，
          // 其 burst handler 会将 mint_singAlongEndTick 设为 state.tick + TICK_RATE * 10。
          // 若 Sing Along 是上一轮遗留的，该值会偏小，条件不成立。
          const mint = state.squad.find(u => u.id === 600);
          if (!mint) return false;
          const singAlongJustActivated = (mint.skillState.mint_singAlongEndTick ?? 0) === state.tick + TICK_RATE * 10;
          if (!singAlongJustActivated) return false;

          const lv      = caster.skillLevels[1];
          const endTick = state.tick + TICK_RATE * 10;

          // Effect 2：Performance 延长 21s（HoT + Charge Damage buff 同步延长）
          const oldEndTick = ss.prika_performanceEndTick;
          ss.prika_performanceEndTick += TICK_RATE * 21;

          // 延长所有队友的 Performance Charge Damage buff 到期时间
          for (const b of state.buffs) {
            if (b.name === 'Get Ready for an Amazing Show!') b.endTick = ss.prika_performanceEndTick;
          }

          // 追加 21 次 HoT（紧接原结束 tick 之后逐秒触发）
          for (const u of state.squad) {
            for (let i = 1; i <= 21; i++) {
              state.pendingHoTs.push({ fireTick: oldEndTick + i * TICK_RATE, targetId: u.id, amount: ss.prika_hotAmount });
            }
          }

          // Effect 3：全队 Attack Damage ▲ p03% 10s
          const atkDmgPct = getSkillValue(caster.rawSkill2, 3, lv) / 100;
          pushBuff(state, { name: 'One More Song! P2 L3', unitId: null,
            attackDamagePct: atkDmgPct, endTick });
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

          // Effect 1：HoT — p00% × Prika 最终 Max HP / s × 25s
          // S1 在 Performance 中提升恢复效能 p06%（Performance 随此 burst 立即生效，预折算进 amount）
          const hotPct     = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const potencyPct = getSkillValue(caster.rawSkill1, 6, caster.skillLevels[0]) / 100;
          const amount     = Math.round(caster.stats.hp * hotPct * (1 + potencyPct));
          ss.prika_hotAmount = amount; // 供 Encore 延长时复用
          pushHoT(state, ALL_ALLIES, amount, duration);

          // Effect 2：全队 Charge Damage ▲ p04% 25s
          const chargeDmgPct = getSkillValue(caster.rawBurst, 4, lv) / 100;
          pushBuff(state, { name: 'Get Ready for an Amazing Show!', unitId: null,
            chargeDamagePct: chargeDmgPct, endTick: state.tick + TICK_RATE * duration });
        },
      },
    ],
  },
};
