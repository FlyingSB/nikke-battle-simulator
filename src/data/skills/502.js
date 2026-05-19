import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Hello Ghost
  // ■ 进入战斗时激活，影响1个随机敌人。
  //   占领持续 {p02=6} 秒，轮回间隔 {p00=6} 秒。
  //   所需命中次数：{p01=100} 次（全体友军累计）。
  //   效果：达到100%时立即捕获1个幽灵，最多 {p03=13} 个。
  //   每轮按6s固定节奏重置，与本轮是否达标无关。
  // ■ 影响所有水属性友军（含自身）：效果随幽灵数量变化，前置效果持续触发。
  //   仅当幽灵 ≥1 时：ATK ▲ {p04}% of caster's ATK（持续）。
  //   仅当幽灵 ≥{p05=4} 时：属性优势攻击伤害 ▲ {p06}%（持续）。
  //   （游戏内描述为 ">4"，实际判定为 ≥4）
  //
  // group_id: 25021
  // p00 interval (const): [6]
  // p01 hit count (const): [100]
  // p02 possession duration (const): [6]
  // p03 max ghosts (const): [13]
  // p04 ATK▲% of caster ATK: [9.57, 10.3, 11.04, 11.78, 12.51, 13.25, 13.99, 14.72, 15.46, 16.2]
  // p05 ghost threshold (const): [4]  → 实际 ≥4
  // p06 Elem Adv ATK Dmg▲%: [20.68, 22.27, 23.86, 25.45, 27.04, 28.64, 30.23, 31.82, 33.41, 35]
  skill1: {
    groupId: 25021,
    triggers: [
      // S1 Part1：战斗开始 → 初始化幽灵计数与窗口基准
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          caster.skillState.ebs_ghostCount    = 0;
          caster.skillState.ebs_windowShotBase = 0;
        },
      },
      // S1 Part2：全队每次普通攻击后检测命中是否达100次 → 达标立即结算本轮
      //   state.squadShotCount 由引擎在每次任意单位射击后自增（skill-executor.js）。
      //   捕获后立即重置窗口基准（下一轮由 INTERVAL 在6s标记处再次重置）。
      //   ≥1 幽灵（首次）：给所有水属性友军附加 ATK ▲ p04%（以 caster ATK flat 形式，持续）
      //   ≥4 幽灵（首次）：额外附加 Elem Adv ATK Dmg ▲ p06%（持续）
      //   满载（13幽灵）时溢出捕获：触发 S2 Part2 伤害
      {
        on: 'SQUAD_SHOT_COUNT',
        handler(state, caster) {
          const shotsThisWindow = (state.squadShotCount ?? 0) - (caster.skillState.ebs_windowShotBase ?? 0);
          if (shotsThisWindow < 100) return;

          // 达标：立即结算，重置窗口基准
          caster.skillState.ebs_windowShotBase = state.squadShotCount ?? 0;

          const ghosts = caster.skillState.ebs_ghostCount ?? 0;

          // 满载溢出 → S2 Part2 伤害
          if (ghosts >= 13) {
            if (state.enemyHp <= 0) return;
            const lv     = caster.skillLevels[1];
            const hitPct = getSkillValue(caster.rawSkill2, 2, lv) / 100;
            const sums   = getBuffSums(state, caster.id);
            fireSkillHit(state, caster, hitPct, sums, false, 'ebs_s2_overflow');
            return;
          }

          const newGhosts = ghosts + 1;
          caster.skillState.ebs_ghostCount = newGhosts;

          const lv = caster.skillLevels[0];

          // 首次到达 1 幽灵：给水属性友军附加 ATK flat buff（持续）
          if (newGhosts === 1) {
            const atkPct  = getSkillValue(caster.rawSkill1, 4, lv) / 100;
            const atkFlat = Math.round(caster.stats.atk * atkPct);
            for (const u of state.squad) {
              if (u.element !== 'Water') continue;
              pushBuff(state, { name: 'ebs_s1_atkFlat', unitId: u.id,
                atkFlat, endTick: Infinity });
            }
          }

          // 首次到达 4 幽灵（≥4）：额外给水属性友军附加 Elem Adv buff（持续）
          if (newGhosts === 4) {
            const elemAdvPct = getSkillValue(caster.rawSkill1, 6, lv) / 100;
            for (const u of state.squad) {
              if (u.element !== 'Water') continue;
              pushBuff(state, { name: 'ebs_s1_elemAdv', unitId: u.id,
                elementAdvantageBonus: elemAdvPct, endTick: Infinity });
            }
          }
        },
      },
      // S1 Part3：每 6 秒固定重置窗口基准，与本轮是否达标无关
      {
        on: 'INTERVAL',
        opts: { seconds: 6 },
        handler(state, caster) {
          caster.skillState.ebs_windowShotBase = state.squadShotCount ?? 0;
        },
      },
    ],
  },

  // ── Ghostbuster
  // ■ 使用爆裂技能时激活，影响自身。
  //   ATK ▲ {p00}% 持续 {p01=10} 秒。
  // ■ 满载时捕获幽灵时激活，影响所有敌人。
  //   造成 {p02}% 最终 ATK 的伤害。（由 S1 SHOT_COUNT 溢出逻辑触发）
  //
  // group_id: 25022
  // p00 ATK▲%: [23.63, 25.45, 27.27, 29.09, 30.91, 32.72, 34.54, 36.36, 38.18, 40]
  // p01 duration (const): [10]
  // p02 overflow damage%: [650, 700, 750, 800, 850, 900, 950, 1000, 1050, 1100]
  skill2: {
    groupId: 25022,
    triggers: [
      // S2 Part1：使用爆裂技能时 → 自身 ATK ▲ p00% 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv     = caster.skillLevels[1];
          const atkPct = getSkillValue(caster.rawSkill2, 0, lv) / 100;
          const end10  = state.tick + TICK_RATE * 10;
          pushBuff(state, { name: 'ebs_s2_burstAtk', unitId: caster.id,
            atkPct, endTick: end10 });
        },
      },
    ],
  },

  // ── 13 Ghosts
  // ■ 幽灵数量不为13时，影响随机敌人单位：
  //   造成 {p00}% 最终ATK的伤害，连续攻击 {p01=6} 次，幽灵数 ▼ {p02=6}（至少保留1个）。
  // ■ 幽灵数量为13时，影响随机敌人单位：
  //   造成 {p03}% 最终ATK的伤害，连续攻击 {p04=13} 次，幽灵数 ▼ {p05=9}。
  // 首次伤害延迟0.2s，每次伤害间隔0.2s；受全爆裂伤害加成。
  //
  // group_id: 15023
  // p00 hit% (non-13): [472.72, 509.09, 545.45, 581.81, 618.18, 654.54, 690.9, 727.27, 763.63, 800]
  // p01 hit count non-13 (const): [6]
  // p02 ghost decrease non-13 (const): [6]
  // p03 hit% (13-ghost): same values as p00
  // p04 hit count 13-ghost (const): [13]
  // p05 ghost decrease 13-ghost (const): [9]
  burst: {
    groupId: 15023,
    triggers: [
      // Burst：根据幽灵数量选择模式，调度延迟技能命中，并立即更新幽灵计数
      //   首击延迟 0.2s（12 tick），后续每击间隔 0.2s；不含 burstSkillDamage，受全爆裂加成
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv      = caster.skillLevels[2];
          const ghosts  = caster.skillState.ebs_ghostCount ?? 0;
          const preSums = getBuffSums(state, caster.id);  // 含 S2 ATK buff
          const delay   = Math.round(0.2 * TICK_RATE);

          if (ghosts === 13) {
            // 13幽灵模式：13连发，幽灵 ▼ 9（结果：4）
            const hitPct = getSkillValue(caster.rawBurst, 3, lv) / 100;
            for (let h = 0; h < 13; h++) {
              state.pendingSkillHits.push({
                fireTick: state.tick + delay * (h + 1),
                caster, mult: hitPct, sums: preSums,
                isCharged: false, label: 'ebs_burst_hit',
              });
            }
            caster.skillState.ebs_ghostCount = ghosts - 9;  // 13 - 9 = 4
          } else {
            // 非13幽灵模式：6连发，幽灵 ▼ 6（至少保留1）
            const hitPct = getSkillValue(caster.rawBurst, 0, lv) / 100;
            for (let h = 0; h < 6; h++) {
              state.pendingSkillHits.push({
                fireTick: state.tick + delay * (h + 1),
                caster, mult: hitPct, sums: preSums,
                isCharged: false, label: 'ebs_burst_hit',
              });
            }
            caster.skillState.ebs_ghostCount = Math.max(1, ghosts - 6);
          }

          // 幽灵减少后，检查 Elem Adv buff 条件（需 ≥4 幽灵）
          const newGhosts = caster.skillState.ebs_ghostCount;
          if (newGhosts < 4) {
            state.buffs = state.buffs.filter(b => b.name !== 'ebs_s1_elemAdv');
          }
          // ATK buff（ebs_s1_atkFlat）：非13模式至少保留1幽灵，13模式后剩4幽灵，均 ≥1，故不移除
        },
      },
    ],
  },
};
