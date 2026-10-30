import { pushBuff, fireSkillHit, getBuffSums, setMaxHpBuffValue, isBuffActiveFor,
         TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Laplace: Ultimate Hero  (resource_id: 103)
//
// 武器：Rocket Launcher（DOWN_Charge，charge 1s，弹匣 120，RPM 300，装填 2.5s，FC 250%）。
// DOWN_Charge 型 RL：每次蓄力完成打出 1 发全蓄力攻击（同 Cinderella 模式）。

// Electric Power, Fully Full Charge 射速：CDN 无切换武器数据，按实测换算 RPM
// （实测：切换后 8.35s 内攻击约 199 次 → ≈ 1430 RPM，约 2.5 tick / 发）
const EP_MEASURED_SHOTS = 199;
const EP_MEASURED_SECS  = 8.35;
const EP_RATE_OF_FIRE   = Math.round(EP_MEASURED_SHOTS * 60 / EP_MEASURED_SECS);
const EP_SHOT_LABEL     = 'S1 P3 Electric Power, Fully Full Charge';
const EP_WEAPON_TYPE    = 'Special';   // 非标准武器类型（不是 RL）

/**
 * Electric Power 弹匣容量：「max ammunition effects refresh when the weapon in use changes」。
 * 实测：切换时应用所有最大装弹数增加效果（装备词条 / 珍藏品 / Wingman 魔方 / 技能），
 * 但不受减少效果影响（如 Privaty S1）→ 只累加当前生效的正值 maxAmmoPct / maxAmmoFlat。
 */
function epMaxAmmo(state, caster, baseAmmo) {
  let pct = 0, flat = 0;
  for (const b of state.buffs) {
    if (!isBuffActiveFor(state, b, caster)) continue;
    const k = b.stacks ?? 1;
    if ((b.maxAmmoPct  ?? 0) > 0) pct  += b.maxAmmoPct  * k;
    if ((b.maxAmmoFlat ?? 0) > 0) flat += b.maxAmmoFlat * k;
  }
  return baseAmmo + Math.round(baseAmmo * pct) + flat;
}

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
  // Electric Power 建模：以回合制武器切换实现 —
  //   · 弹匣 = p06 + 所有最大装弹数增加效果（不含减少效果，见 epMaxAmmo），切换时满弹；
  //   · 按实测射速 EP_RATE_OF_FIRE 连发（非蓄力攻击：不吃蓄力伤害、不触发全蓄力类效果），
  //     每发 p05% ATK、穿透；不是 RL，不受发射体爆炸伤害加成；
  //   · 固定弹匣（weaponSwitchFixedAmmo）：Bastion 魔方补弹不触发，期间装弹数增减与补弹效果不作用；
  //   · 无法换弹（weaponSwitchNoReload）：停止攻击（敌人隐藏 / 百暴）本应附带换弹，
  //     此武器则保持当前子弹数直接空闲。
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

          const epAmmo = epMaxAmmo(state, caster, getSkillValue(caster.rawSkill1, 5, lv));  // 120 + 增加效果

          const ammoBefore  = caster.ammoLeft;
          caster.ammoLeft   = epAmmo;
          caster.reloadTick = 0;
          caster.backswingReloadTick = 0;
          caster.shotAccumulator     = 0;
          if (state.ammoLog)
            state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
              delta: epAmmo - ammoBefore, ammoAfter: epAmmo, maxAmmo: epAmmo,
              source: 'Electric Power, Fully Full Charge' });

          Object.assign(caster.skillState, {
            weaponSwitchHitMult:          getSkillValue(caster.rawSkill1, 4, lv) / 100,
            weaponSwitchMaxAmmo:          epAmmo,
            weaponSwitchFixedAmmo:        true,
            // 非 RL：不是发射体爆炸攻击（不受 Projectile Explosion Damage 加成）、不走 RL 弹道核心判定。
            // 实际武器类型未知，用非标准类型名：非蓄力、非霰弹，切换武器核心率按引擎缺省（必中核心）
            weaponSwitchType:             EP_WEAPON_TYPE,
            weaponSwitchEndTick:          Infinity,
            // 本次触发所在的 RL 射击会在 onShotFired 末尾消耗 1 回合，+1 抵消，保证实际打满 epAmmo 发
            weaponSwitchRoundsLeft:       epAmmo + 1,
            weaponSwitchChargeTimeTicks:  0,
            weaponSwitchRateOfFire:       EP_RATE_OF_FIRE,
            weaponSwitchFullChargeDamage: null,
            weaponSwitchUnlimitedAmmo:    false,
            weaponSwitchPierce:           true,
            // 无法换弹（武器自身属性）：停止攻击（敌人隐藏 / 百暴）时保持当前子弹数直接空闲
            weaponSwitchNoReload:         true,
            // 命中标签：描述给出武器名（skill-modeling-guide §2 优先级 1）
            weaponSwitchLabel:            EP_SHOT_LABEL,
          });
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
          // 阶段推进只提升 Max HP 上限，不回复当前 HP（引擎统一处理）
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
