import { pushBuff, applyHeal, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Mint  (resource_id: 600)
export default {

  // ── Here I Go!
  // ■ Activates when attacking with Full Charge while in Assigned Part: Singing status. Affects all allies.
  //   Singing Effect: ATK ▲ {p00}% of the caster's ATK for {p01=3} sec.
  //
  // ■ Activates when attacking with Full Charge while in Assigned Part: Dancing status. Affects all allies.
  //   Dancing Effect: Constantly recovers {p02}% of the caster's final Max HP every 1 sec for {p03=3} sec.
  //
  // group_id: 26001
  // p00 ATK ▲%（基于施放者 ATK）: [25.01, 27.23, 29.45, 31.68, 33.9, 36.12, 38.35, 40.57, 42.79, 45.02]
  // p01 ATK duration (const): [3, ...]
  // p02 HP recovery%/sec: [1.06, 1.14, 1.22, 1.3, 1.39, 1.47, 1.55, 1.63, 1.71, 1.8]
  // p03 HP recovery duration (const): [3, ...]
  skill1: {
    groupId: 26001,
    triggers: [
      {
        on: 'PROGRAM_INIT',
        handler(state, caster) {
          caster.skillState.mint_isSinging        = false;
          caster.skillState.mint_isDancing        = false;
          caster.skillState.mint_singAlongEndTick = 0;
        },
      },
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const ss = caster.skillState;
          const lv = caster.skillLevels[0];

          if (ss.mint_isSinging) {
            // Singing：全队 ATK ▲（按 Mint 自身 ATK 的 p00% 换算为 flat 值）3s
            const atkPct  = getSkillValue(caster.rawSkill1, 0, lv) / 100;
            const atkFlat = Math.round(caster.stats.atk * atkPct);
            const endTick = state.tick + TICK_RATE * 3;
            for (const u of state.squad) {
              pushBuff(state, { name: `mint_s1_singing_atk_${u.id}`, unitId: u.id, atkFlat, endTick });
            }
          } else if (ss.mint_isDancing) {
            // Dancing：全队持续 HP 回复（p02% × caster MaxHP / s × 3s）
            const pct    = getSkillValue(caster.rawSkill1, 2, lv) / 100;
            const amount = Math.round(caster.stats.hp * pct);
            for (const u of state.squad) {
              for (let i = 1; i <= 3; i++) {
                state.pendingHoTs.push({ fireTick: state.tick + i * TICK_RATE, targetId: u.id, amount });
              }
            }
          }
        },
      },
    ],
  },

  // ── Fantastic Performance!
  // ■ Activates when entering Burst Stage 3 while not in Sing Along status. Affects self.
  //   Cancels Assigned Part: Singing. Cancels Assigned Part: Dancing.
  // ■ Activates when entering Burst Stage 3 while in Assigned Part: Singing status. Affects all allies.
  //   Critical Rate ▲ {p00}% for {p01=10} sec.
  //   Projectile Explosion Damage ▲ {p02}% for {p03=10} sec.
  //   Pierce Damage ▲ {p04}% for {p05=10} sec.
  //
  // group_id: 26002
  // p00 Critical Rate ▲%: [11.39, 12.34, 13.29, 14.24, 15.19, 16.14, 17.09, 18.04, 18.99, 19.94]
  // p01 duration (const): [10, ...]
  // p02 Projectile Explosion Damage ▲%: [29.55, 31.82, 34.09, 36.36, 38.63, 40.91, 43.18, 45.45, 47.72, 50]
  // p03 duration (const): [10, ...]
  // p04 Pierce Damage ▲%: [19.34, 20.82, 22.31, 23.79, 25.28, 26.77, 28.26, 29.74, 31.23, 32.72]
  // p05 duration (const): [10, ...]
  //
  // 触发时序：Mint 是 B2，BURST_SKILL_USE（B2）先于 ENTER_BURST_III 触发，
  // 因此 S2 看到的是 burst 已切换后的状态（isSinging 已更新）。
  // Sing Along（10s buff）在 burst 施放时立即激活，ENTER_BURST_III 检查时必然有效，
  // "not in Sing Along" branch 仅在异常场景（首次爆裂前意外触发）时执行，通常为空操作。
  skill2: {
    groupId: 26002,
    triggers: [
      {
        on: 'ENTER_BURST_III',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const ss = caster.skillState;

          // Branch 1：Sing Along 未激活时清除 Singing/Dancing（容错重置）
          const singAlongActive = (ss.mint_singAlongEndTick ?? 0) > state.tick;
          if (!singAlongActive && !ss.mint_isSinging) {
            ss.mint_isSinging = false;
            ss.mint_isDancing = false;
            return false;
          }

          // Branch 2：Singing 状态 → 全队 Crit Rate ▲ + Projectile Explosion Damage ▲ + Pierce Damage ▲
          if (!ss.mint_isSinging) return false;

          const lv      = caster.skillLevels[1];
          const endTick = state.tick + TICK_RATE * 10;

          const critRate = getSkillValue(caster.rawSkill2, 0, lv) / 100;
          const projExp  = getSkillValue(caster.rawSkill2, 2, lv) / 100;
          const pierce   = getSkillValue(caster.rawSkill2, 4, lv) / 100;

          pushBuff(state, { name: 'mint_s2_critRate', unitId: null, critRateBonus: critRate, endTick });
          pushBuff(state, { name: 'mint_s2_projExp',  unitId: null, projectileExplosionDamagePct: projExp, endTick });
          pushBuff(state, { name: 'mint_s2_pierce',   unitId: null, pierceDamagePct: pierce, endTick });
        },
      },
    ],
  },

  // ── Let's Sing Together!
  // ■ Affects self. Only one Assigned Part applied according to Mint's current status.
  //   Status 1: If in Dancing status → gains Singing (continuous).
  //   Status 2: If not in Dancing status → gains Dancing (continuous).
  // ■ Affects all allies. Sing Along:
  //   Attack Damage ▲ {p00}% for {p01=10} sec.
  //   Max Ammunition Capacity ▲ {p02}% for {p03=10} sec.
  //   Critical Damage ▲ {p04}% for {p05=10} sec.
  //
  // group_id: 16003
  // p00 Attack Damage ▲%: [16.67, 18.16, 19.64, 21.12, 22.6, 24.09, 25.57, 27.05, 28.53, 30.02]
  // p01 duration (const): [10, ...]
  // p02 Max Ammunition Capacity ▲%: [23.64, 25.45, 27.27, 29.09, 30.91, 32.72, 34.54, 36.36, 38.18, 40]
  // p03 duration (const): [10, ...]
  // p04 Critical Damage ▲%: [25.02, 27.25, 29.47, 31.7, 33.92, 36.15, 38.37, 40.6, 42.82, 45.05]
  // p05 duration (const): [10, ...]
  burst: {
    groupId: 16003,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        logTargets: 'ALL_ALLIES',
        handler(state, caster) {
          const ss      = caster.skillState;
          const lv      = caster.skillLevels[2];
          const endTick = state.tick + TICK_RATE * 10;

          // 切换 Singing/Dancing 状态（Dancing → Singing；其他 → Dancing）
          if (ss.mint_isDancing) {
            ss.mint_isDancing = false;
            ss.mint_isSinging = true;
          } else {
            ss.mint_isSinging = false;
            ss.mint_isDancing = true;
          }
          ss.mint_singAlongEndTick = endTick;

          // Sing Along：全队 Attack Damage ▲ p00% + Crit Damage ▲ p04% 10s
          const atkDmgPct  = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const critDmgPct = getSkillValue(caster.rawBurst, 4, lv) / 100;
          pushBuff(state, { name: 'mint_burst_atkDmg',  unitId: null, attackDamagePct: atkDmgPct,  endTick });
          pushBuff(state, { name: 'mint_burst_critDmg', unitId: null, critDmgBonus:    critDmgPct, endTick });

          // Max Ammunition Capacity ▲ p02% 10s：逐人扩充并立即补满至新上限
          const ammoPct = getSkillValue(caster.rawBurst, 2, lv) / 100;
          for (const u of state.squad) {
            const ammoFlat   = Math.round(u.baseAmmo * ammoPct);
            const ammoBefore = u.ammoLeft;
            pushBuff(state, { name: `mint_burst_maxAmmo_${u.id}`, unitId: u.id, maxAmmoFlat: ammoFlat, endTick });
            const expandedMax = u.maxAmmo + ammoFlat;
            u.ammoLeft        = expandedMax;
            u.reloadTick      = 0;
            if (state.ammoLog && u.ammoLeft !== ammoBefore)
              state.ammoLog.push({ tick: state.tick, unitId: u.id, unitName: u.name,
                delta: u.ammoLeft - ammoBefore, ammoAfter: u.ammoLeft, maxAmmo: expandedMax,
                source: 'mint_burst_maxAmmo' });
          }
        },
      },
    ],
  },
};
