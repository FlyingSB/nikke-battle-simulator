import { pushBuff, getBuffSums, addBurstGauge, setMaxHpBuffValue,
         TICK_RATE, BURST_GAUGE_MAX } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Maxwell: Ordinary Mechanic  (resource_id: 105)
//
// 武器：Sniper Rifle（UP 型，charge 1s，弹匣 6，装填 2s，FC 250%）。爆裂阶段 Step2，
// change_burst_step=Step3（施放爆裂后转入阶段 3 位置，引擎按 CDN 字段自动处理）。

export default {

  // ── Sequential Limit Release
  // ■ Activates when performing a Full Charge attack. Affects all allies.
  // Max HP ▲ {p01}% of the skill user's max HP continuously. Stacks up to {p02} times.
  // ■ Activates when entering Burst Stage {p03}. Affects all allies.
  // Attack Damage ▲ {p04}% for {p05} sec.
  // p01: [0.5 … 1]         （每层 Max HP flat，%施法者 MaxHP）
  // p02: [30,...]          （层数上限）
  // p03: [3,...]           （爆裂阶段号）
  // p04: [6.25 … 10]       （攻击伤害 ▲%）
  // p05: [5,...]           （持续秒数）
  //
  // p01 描述为「skill user's max HP」（非 final）→ 每层数值取施法者基础最终面板 MaxHP
  // （caster.stats.hp，不含战斗内 buff），避免自身 MaxHP buff 造成递归放大。
  // 层数手动维护并将「层数 × 每层」写入各队员 buff 的 maxHpFlat（stacks 恒 1），
  // 保证各层数值一致。
  skill1: {
    groupId: 21051,
    triggers: [
      // S1 P1：全蓄力攻击 → 全队 Max HP flat 叠层，上限 p02=30。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv    = caster.skillLevels[0];
          const limit = getSkillValue(caster.rawSkill1, 1, lv);
          const st    = caster.skillState;
          if ((st.mom_hpStacks ?? 0) >= limit) return;
          st.mom_hpStacks = (st.mom_hpStacks ?? 0) + 1;

          const perStack = Math.round(
            caster.stats.hp * getSkillValue(caster.rawSkill1, 0, lv) / 100);
          const flat = perStack * st.mom_hpStacks;
          // 已有 buff 直接改写数值；尚无 buff 的单位合并为一次 unitIds 推入
          const missing = [];
          for (const t of state.squad) {
            const existing = state.buffs.find(b =>
              b.name === 'Sequential Limit Release (Max HP)' && b.unitId === t.id);
            if (existing) setMaxHpBuffValue(state, existing, { maxHpFlat: flat });
            else missing.push(t.id);
          }
          pushBuff(state, { name: 'Sequential Limit Release (Max HP)', unitIds: missing,
            maxHpFlat: flat, endTick: Infinity });
        },
      },

      // S1 P2：进入爆裂阶段 3 → 全队攻击伤害 ▲ p04% 5s。
      {
        on: 'ENTER_BURST_III',
        handler(state, caster) {
          const lv  = caster.skillLevels[0];
          const end = state.tick + TICK_RATE * getSkillValue(caster.rawSkill1, 4, lv);
          pushBuff(state, { name: 'Sequential Limit Release (Attack Damage)', unitId: null,
            attackDamagePct: getSkillValue(caster.rawSkill1, 3, lv) / 100, endTick: end });
        },
      },
    ],
  },

  // ── Output Switching Sequence
  // ■ Activates when using Burst Skill. Affects all allies.
  // ATK ▲ {p01}% of the skill user's final max HP for {p02} sec.
  // ■ Activates when using Burst Skill. Affects self.
  // Overcurrent: ATK ▲ {p05}% continuously. Up to {p06} stages in total.
  // ■ Activates when performing a Full Charge attack. Affects all allies.
  // Fills Burst Gauge by {p07}%.
  // p01: [0.5 … 1]         （最终 MaxHP → 全队 ATK flat %）
  // p02: [15,...]          （持续秒数）
  // p05: [15 … 30]         （Overcurrent 每阶 ATK ▲%）
  // p06: [5,...]           （Overcurrent 阶段上限）
  // p07: [3.58 … 7.15]     （爆裂槽填充 %）
  skill2: {
    groupId: 21052,
    triggers: [
      // S2 P1+P2：使用爆裂技能 → 全队 ATK flat（p01%×最终 MaxHP）15s；自身 Overcurrent +1 阶。
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv      = caster.skillLevels[1];
          const sums    = getBuffSums(state, caster.id);
          const finalHp = caster.stats.hp * (1 + sums.maxHpPct) + (sums.maxHpFlat ?? 0);
          const atkFlat = Math.round(finalHp * getSkillValue(caster.rawSkill2, 0, lv) / 100);
          const end15   = state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 1, lv);
          pushBuff(state, { name: 'Output Switching Sequence', unitId: null,
            atkFlat, endTick: end15 });

          pushBuff(state, { name: 'Overcurrent', unitId: caster.id,
            atkPct: getSkillValue(caster.rawSkill2, 4, lv) / 100,
            stackLimit: getSkillValue(caster.rawSkill2, 5, lv), endTick: Infinity });
        },
      },

      // S2 P3：全蓄力攻击 → 全体填充共享爆裂槽 p07%。
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const lv       = caster.skillLevels[1];
          const gaugePct = getSkillValue(caster.rawSkill2, 6, lv) / 100;
          addBurstGauge(state, caster.name, 'mom_s2_gauge',
            Math.round(gaugePct * BURST_GAUGE_MAX));
        },
      },
    ],
  },

  // ── Matis UberBuster
  // ■ Affects self.
  // Changes the weapon in use: Matis UberBuster（蓄力时间按 Overcurrent 阶段固定）
  //   Stage ≤1: {p09}s / Stage 2: {p01}s / Stage 3: {p02}s / Stage 4: {p03}s / Stage ≥5: {p04}s
  //   Damage: {p05}% of final ATK / Full Charge Damage: 300% / Max Ammo: {p06} / Pierce
  // ■ Affects all allies.
  // Attack Damage ▲ {p07}% for {p08} sec.
  // p01: [2.5,...] / p02: [2,...] / p03: [1.5,...] / p04: [0.4,...] / p09: [3,...]（各阶段蓄力秒数）
  // p05: [175 … 350]       （UberBuster 伤害 %ATK；全蓄力 = ×3）
  // p06: [1,...]           （弹匣容量）
  // p07: [12.5 … 25]       （全队攻击伤害 ▲%，10s）
  // p08: [10,...]
  //
  // 执行顺序：S2 的 BURST_SKILL_USE 先于 burst 触发（executor 按 skill1→skill2→burst 迭代），
  // 因此本手内 Overcurrent 已 +1 —— 首次爆裂即为 Stage 1（蓄力 3s）。
  // 击发 1 发后回合制切换结束，弹药归零 → 自然装填（同 102 Maxwell Pierce Shot 模式）。
  burst: {
    groupId: 11053,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];
          const oc = state.buffs.find(b => b.name === 'Overcurrent' && b.unitId === caster.id);
          const stage = oc ? (oc.stacks ?? 1) : 0;
          const chargeSec = stage <= 1 ? getSkillValue(caster.rawBurst, 8, lv)   // 3s
            : stage === 2 ? getSkillValue(caster.rawBurst, 0, lv)                // 2.5s
            : stage === 3 ? getSkillValue(caster.rawBurst, 1, lv)                // 2s
            : stage === 4 ? getSkillValue(caster.rawBurst, 2, lv)                // 1.5s
            : getSkillValue(caster.rawBurst, 3, lv);                             // 0.4s
          const chargeTimeTicks = Math.round(chargeSec * TICK_RATE);
          const maxAmmo         = getSkillValue(caster.rawBurst, 5, lv);         // 1

          caster.ammoLeft   = maxAmmo;
          caster.reloadTick = 0;

          caster.skillState.weaponSwitchHitMult          = getSkillValue(caster.rawBurst, 4, lv) / 100;
          caster.skillState.weaponSwitchMaxAmmo          = maxAmmo;
          caster.skillState.weaponSwitchType             = 'SR';
          caster.skillState.weaponSwitchEndTick          = Infinity;
          caster.skillState.weaponSwitchRoundsLeft       = maxAmmo;
          caster.skillState.weaponSwitchChargeTimeTicks  = chargeTimeTicks;
          caster.skillState.weaponSwitchFullChargeDamage = 30000;  // 300% FC → ×10000 单位
          caster.skillState.weaponSwitchUnlimitedAmmo    = false;
          caster.skillState.weaponSwitchPierce           = true;

          caster.chargeTick = state.tick + chargeTimeTicks;

          // 全队攻击伤害 ▲ p07% 10s。
          const end10 = state.tick + TICK_RATE * getSkillValue(caster.rawBurst, 7, lv);
          // 爆裂技能唯一的效果段（P1 为武器切换 Matis UberBuster）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Matis UberBuster', unitId: null,
            attackDamagePct: getSkillValue(caster.rawBurst, 6, lv) / 100, endTick: end10 },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },
};
