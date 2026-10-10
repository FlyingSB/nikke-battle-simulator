import { pushBuff, fireSkillHit, getBuffSums, setMaxHpBuffValue, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Laplace: Ultimate Hero  (resource_id: 103)
//
// 武器：Rocket Launcher（DOWN_Charge，charge 1s，弹匣 120，RPM 300，装填 2.5s，FC 250%）。
// DOWN_Charge 型 RL：每次蓄力完成打出 1 发全蓄力攻击（同 Cinderella 模式）。

// ── S1 P1 / S2 阶段共享：按当前最终 MaxHP 重算「HP→ATK」flat buff。
// 最终 MaxHP 包含所有来源的 maxHpPct / maxHpFlat（含 S2 Over Energy 阶段与外部 buff）；
// S2 阶段推进时调用以刷新。
function recalcHpToAtk(state, caster) {
  const sums    = getBuffSums(state, caster.id);
  const finalHp = caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
  const pct     = getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]) / 100;
  const atkFlat = Math.round(finalHp * pct);
  const existing = state.buffs.find(b => b.name === 'Electric Power, Fully Full Charge!' && b.unitId === caster.id);
  if (existing) existing.atkFlat = atkFlat;
  else pushBuff(state, { name: 'Electric Power, Fully Full Charge!', unitId: caster.id, atkFlat, endTick: Infinity });
}

// 武器切换（Electric Power 模式）是否激活
function epActive(state, caster) {
  return (caster.skillState.weaponSwitchEndTick ?? 0) > 0
    && state.tick <= caster.skillState.weaponSwitchEndTick;
}

export default {

  // ── Electric Power, Fully Full Charge!
  // ■ Activates at the start of battle. Affects self.
  // ATK ▲ {p01}% of the skill user's final max HP continuously.
  // ■ Activates when performing a Full Charge attack. Affects self.
  // Warm Up: Charge Speed ▲ {p02}% continuously. Stacks up to {p03} times.
  // ■ Activates when Warm Up is at max stacks. Removes stacks and affects self.
  // Changes the weapon in use: Electric Power, Fully Full Charge
  //   Damage: {p05}% of final ATK / Max Ammo: {p06}（弹匣刷新）/ 弹尽解除 / Pierce
  // ■ Activates when Electric Power, Fully Full Charge ends. Affects self.
  // Removes {p07}% of ammo.
  // p01: [1.69 … 4.05]     （最终 MaxHP → ATK flat %）
  // p02: [5 … 10]          （Warm Up 每层蓄力速度 ▲%）
  // p03: [5,...]           （Warm Up 层数上限）
  // p05: [2.64 … 9.45]     （Electric Power 每发伤害 %ATK）
  // p06: [120,...]         （Electric Power 弹匣容量）
  // p07: [100,...]         （模式结束移除弹药 %）
  //
  // Electric Power 建模：以回合制武器切换实现 — 120 发、每发 p05% ATK（FC 倍率固定 100%）、
  //   穿透、发间按基础武器 RPM=300（12 ticks）。弹匣容量与基础武器同为 120，
  //   模式期间实弹同步消耗至 0，结束时弹药恰好为空 → P4「移除 100% 弹药」为涌现行为，
  //   随后进入自然装填（2.5s），无需单独触发器。
  skill1: {
    groupId: 21031,
    triggers: [
      // S1 P1：战斗开始 → ATK ▲ p01%×最终 MaxHP 永久（S2 阶段推进时刷新）。
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          recalcHpToAtk(state, caster);
        },
      },

      // S1 P2：全蓄力攻击（Electric Power 模式期间不触发）→ Warm Up 蓄速 ▲ p02% 叠层，上限 p03=5。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (epActive(state, caster)) return;
          const lv = caster.skillLevels[0];
          pushBuff(state, { name: 'Warm Up', unitId: caster.id,
            chargeSpeedPct: getSkillValue(caster.rawSkill1, 1, lv) / 100,
            stackLimit: getSkillValue(caster.rawSkill1, 2, lv), endTick: Infinity });
        },
      },

      // S1 P3：Warm Up 满层 → 移除层数，切换武器进入 Electric Power 模式。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (epActive(state, caster)) return;
          const lv        = caster.skillLevels[0];
          const maxStacks = getSkillValue(caster.rawSkill1, 2, lv);
          const warmUp    = state.buffs.find(b => b.name === 'Warm Up' && b.unitId === caster.id);
          if (!warmUp || (warmUp.stacks ?? 1) < maxStacks) return;
          state.buffs.splice(state.buffs.indexOf(warmUp), 1);

          const epAmmo  = getSkillValue(caster.rawSkill1, 5, lv);           // 120
          const epTicks = Math.round(TICK_RATE * 60 / caster.rateOfFire);   // 300 RPM → 12t

          caster.ammoLeft   = epAmmo;
          caster.reloadTick = 0;

          caster.skillState.weaponSwitchHitMult          = getSkillValue(caster.rawSkill1, 4, lv) / 100;
          caster.skillState.weaponSwitchMaxAmmo          = epAmmo;
          caster.skillState.weaponSwitchType             = 'RL';
          caster.skillState.weaponSwitchEndTick          = Infinity;
          // 本次触发所在的 RL 射击会在 onShotFired 末尾消耗 1 回合，+1 抵消，保证实际打满 120 发
          caster.skillState.weaponSwitchRoundsLeft       = epAmmo + 1;
          caster.skillState.weaponSwitchChargeTimeTicks  = epTicks;
          caster.skillState.weaponSwitchFullChargeDamage = 10000;  // 每发伤害即 p05%，无 FC 倍率
          caster.skillState.weaponSwitchUnlimitedAmmo    = false;
          caster.skillState.weaponSwitchPierce           = true;

          caster.chargeTick = state.tick + epTicks;
          // 本发 RL 射击不计入 S2 的 Electric Power 攻击计数
          caster.skillState.luh_skipEpCount = true;
        },
      },
    ],
  },

  // ── Over Energy
  // ■ Activates after performing {p08} normal attacks while in the Electric Power, Fully Full
  //   Charge state. Affects self.
  // Over Energy ▲ {p09}% continuously, up to {p01}%.
  // ■ Activates when Over Energy reaches {p01}%. Resets Over Energy and affects self.
  // Advances to the next Over Energy stage（各阶段效果向下兼容累加）:
  //   Stage 1: Max HP ▲ {p02}% / Stage 2: ▲ {p03}% / Stage 3: ▲ {p04}% / Stage 4: ▲ {p05}%
  // ■ Activates when entering Burst Stage 3. Affects self.
  // Attack Damage ▲ {p06}% for {p07} sec.
  // p01: [100,...]         （Over Energy 能量上限）
  // p02: [1.18 … 2]        （Stage 1 Max HP ▲%）
  // p03: [1.77 … 3]        （Stage 2 Max HP ▲%）
  // p04: [4.13 … 7]        （Stage 3 Max HP ▲%）
  // p05: [6.2 … 10.5]      （Stage 4 Max HP ▲%）
  // p06: [30.81 … 52.14]   （进入爆裂阶段 3 攻击伤害 ▲%）
  // p07: [10,...]          （持续秒数）
  // p08: [12,...]          （Electric Power 模式攻击次数阈值）
  // p09: [5,...]           （每次 Over Energy 能量 ▲%）
  //
  // 阶段以 4 为上限（描述仅列出 4 个阶段）；满阶后能量不再累积。
  // Max HP 提升会同步刷新 S1 P1 的 HP→ATK flat buff。
  skill2: {
    groupId: 21032,
    triggers: [
      // S2 P1+P2：Electric Power 模式期间每 p08=12 次攻击 → 能量 +p09%；满 p01=100% → 阶段 +1。
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'luh_rawShots' },
        handler(state, caster) {
          const st = caster.skillState;
          // 触发 Electric Power 的那发 RL 射击不计数
          if (st.luh_skipEpCount) { st.luh_skipEpCount = false; return; }
          if (!epActive(state, caster)) return;

          const lv   = caster.skillLevels[1];
          const need = getSkillValue(caster.rawSkill2, 7, lv);   // 12
          st.luh_epShots = (st.luh_epShots ?? 0) + 1;
          if (st.luh_epShots < need) return;
          st.luh_epShots -= need;

          if ((st.luh_stage ?? 0) >= 4) return;  // 满阶后不再累积
          const cap = getSkillValue(caster.rawSkill2, 0, lv);    // 100
          st.luh_energy = (st.luh_energy ?? 0) + getSkillValue(caster.rawSkill2, 8, lv);
          if (st.luh_energy < cap) return;
          st.luh_energy -= cap;
          st.luh_stage   = (st.luh_stage ?? 0) + 1;

          // 阶段 N 的 Max HP ▲ = p02..p0(N+1) 累加
          let hpPct = 0;
          for (let i = 1; i <= st.luh_stage; i++) hpPct += getSkillValue(caster.rawSkill2, i, lv);
          // 阶段推进增加的 Max HP 同步回复当前 HP（描述未写 without restoring HP）
          const buff = state.buffs.find(b => b.name === 'Over Energy (Max HP)' && b.unitId === caster.id);
          if (buff) setMaxHpBuffValue(state, buff, { maxHpPct: hpPct / 100 });
          else pushBuff(state, { name: 'Over Energy (Max HP)', unitId: caster.id,
            maxHpPct: hpPct / 100, endTick: Infinity });
          recalcHpToAtk(state, caster);
        },
      },

      // S2 P3：进入爆裂阶段 3 → 自身攻击伤害 ▲ p06% 10s。
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const lv  = caster.skillLevels[1];
          const end = state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 6, lv);
          pushBuff(state, { name: 'Over Energy (Attack Damage)', unitId: caster.id,
            attackDamagePct: getSkillValue(caster.rawSkill2, 5, lv) / 100, endTick: end });
        },
      },
    ],
  },

  // ── Regenerative Energy Armament: Mjolnir
  // ■ Affects self.
  // ATK ▲ {p01}% for {p02} sec.
  // ■ Affects all enemies.
  // Deals {p03}% of final ATK as Burst Skill damage.
  // ■ Activates when the skill user is at stage 1 or higher of Over Energy.
  //   Affects the enemy nearest to the crosshair.
  // Deals {p04}% of final ATK x Over Energy stage as additional damage.
  // p01: [37.44 … 63.36]   （ATK ▲%，10s）
  // p02: [10,...]
  // p03: [1745.45 … 2953.84]（爆裂技能伤害 %ATK）
  // p04: [552.36 … 934.76] （追加伤害 %ATK × Over Energy 阶段）
  burst: {
    groupId: 11033,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv     = caster.skillLevels[2];
          const atkPct = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const end10  = state.tick + TICK_RATE * getSkillValue(caster.rawBurst, 1, lv);
          // 先施加自身 ATK ▲，使本次爆裂伤害享受该加成。
          // 爆裂技能唯一的效果段（P2/P3 为伤害）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Regenerative Energy Armament: Mjolnir', unitId: caster.id, atkPct, endTick: end10 },
            { ...state._logCtx, partIdx: null });

          if (state.enemyHp <= 0) return;
          const sums = getBuffSums(state, caster.id);
          fireSkillHit(state, caster, getSkillValue(caster.rawBurst, 2, lv) / 100, sums, 'Burst P2');

          // Over Energy 阶段 ≥1 → 追加 p04% × 阶段数附加伤害（阶段数按施放时刻确定）。
          // 【全爆裂加成】受影响（描述 as additional damage；未实测，按 skill-modeling-guide §2.1 规则判定）：
          //   引擎将其推迟到进入全爆裂（ENTER_FULL_BURST 之后）结算，sums 取进入全爆裂瞬间快照
          const stage = caster.skillState.luh_stage ?? 0;
          if (stage >= 1 && state.enemyHp > 0) {
            fireSkillHit(state, caster,
              getSkillValue(caster.rawBurst, 3, lv) / 100 * stage, sums, 'Burst P3',
              { affectedByFullBurst: true });
          }
        },
      },
    ],
  },
};
