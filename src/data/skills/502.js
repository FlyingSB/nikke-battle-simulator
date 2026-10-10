import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Elegg: Boom and Shock  (resource_id: 502)
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
      // S1 Part1：初始化幽灵计数与窗口基准
      {
        on: 'PROGRAM_INIT',
        handler(state, caster) {
          caster.skillState.ebs_ghostCount     = 0;
          caster.skillState.ebs_windowShotBase = 0;
          caster.skillState.ebs_windowSettled  = false;
        },
      },
      // S1 Part2：全队每次普通攻击后检测命中是否达100次 → 达标立即结算本轮
      //   state.squadShotCount 由引擎在每次任意单位射击后自增（skill-executor.js）。
      //   捕获后立即重置窗口基准（下一轮由 INTERVAL 在6s标记处再次重置）。
      //   ≥1 幽灵（首次）：给所有水属性友军附加 ATK ▲ p04%（以 caster ATK flat 形式，持续）
      //   ≥4 幽灵（首次）：额外附加 Elem Adv ATK Dmg ▲ p06%（持续）
      //   满载（13幽灵）时溢出捕获：触发 S2 Part2 伤害
      // 注：属■段0，但因 PROGRAM_INIT 占用 tdefIdx=0，此触发器 tdefIdx=1（partIdx=1），接受偏移
      {
        on: 'SQUAD_SHOT_COUNT',
        handler(state, caster) {
          if (caster.skillState.ebs_windowSettled) return;
          const shotsThisWindow = (state.squadShotCount ?? 0) - (caster.skillState.ebs_windowShotBase ?? 0);
          if (shotsThisWindow < 100) return;

          // 达标：立即结算，重置窗口基准，锁定本轮
          caster.skillState.ebs_windowShotBase = state.squadShotCount ?? 0;
          caster.skillState.ebs_windowSettled  = true;

          const ghosts = caster.skillState.ebs_ghostCount ?? 0;

          // 满载溢出 → S2 Part2 伤害
          if (ghosts >= 13) {
            if (state.enemyHp <= 0) return;
            const lv     = caster.skillLevels[1];
            const hitPct = getSkillValue(caster.rawSkill2, 2, lv) / 100;
            const sums   = getBuffSums(state, caster.id);
            fireSkillHit(state, caster, hitPct, sums, 'S2');
            return;
          }

          const newGhosts = ghosts + 1;
          caster.skillState.ebs_ghostCount = newGhosts;

          const lv = caster.skillLevels[0];

          // 首次到达 1 幽灵：给水属性友军附加 ATK flat buff（持续）
          const waterIds = state.squad.filter(u => u.element === 'Water').map(u => u.id);
          if (newGhosts === 1) {
            const atkPct  = getSkillValue(caster.rawSkill1, 4, lv) / 100;
            const atkFlat = Math.round(caster.stats.atk * atkPct);
            pushBuff(state, { name: 'Hello Ghost (ATK)', unitIds: waterIds,
              atkFlat, endTick: Infinity });
          }

          // 首次到达 4 幽灵（≥4）：额外给水属性友军附加 Elem Adv buff（持续）
          if (newGhosts === 4) {
            const elemAdvPct = getSkillValue(caster.rawSkill1, 6, lv) / 100;
            pushBuff(state, { name: 'Hello Ghost (Elem Adv Damage)', unitIds: waterIds,
              elementAdvantagePct: elemAdvPct, endTick: Infinity });
          }
        },
      },
      // S1 Part3：每 6 秒固定重置窗口基准，与本轮是否达标无关
      // 注：与上方同属■段0，此触发器 tdefIdx=2（partIdx=2），接受偏移
      {
        on: 'INTERVAL',
        opts: { seconds: 6 },
        handler(state, caster) {
          caster.skillState.ebs_windowShotBase = state.squadShotCount ?? 0;
          caster.skillState.ebs_windowSettled  = false;
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
          // S2 唯一的效果段（P2 为伤害）→ 日志标签省略 P 后缀
          pushBuff(state, { name: 'Ghostbuster', unitId: caster.id,
            atkPct, endTick: end10 }, { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },

  // ── 13 Ghosts
  // ■ 幽灵数量不为13时，影响随机敌人单位：
  //   造成 {p00}% 最终ATK的伤害，连续攻击 {p01=6} 次，幽灵数 ▼ {p02=6}（至少保留1个）。
  // ■ 幽灵数量为13时，影响随机敌人单位：
  //   造成 {p03}% 最终ATK的伤害，连续攻击 {p04=13} 次，幽灵数 ▼ {p05=9}。
  // 进入全爆裂后 0.2s 首次伤害，每次伤害间隔 0.2s。
  // 【全爆裂加成】受影响（描述 as damage，但已实测受全爆裂 +50% 及 ENTER_FULL_BURST buff 影响，属 §2.1 措辞规则的例外）。
  // S2 Part1（Ghostbuster ATK ▲，使用爆裂技能时生效）同样作用于本爆裂伤害（已实测）。
  // 伤害按进入全爆裂瞬间的快照计算（所有效果已生效），之后按延迟依次打出；不随命中时 buff 变化。
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
      //   进入全爆裂后 0.2s（12 tick）首击（B3 施放后 0.6s，引擎统一后移 0.4s），后续每击间隔 0.2s；
      //   非默认结算（已实测）：affectedByFullBurst →
      //   引擎在进入全爆裂瞬间（ENTER_FULL_BURST 等效果全部生效后）取一次 sums 快照，所有命中按延迟用该快照出伤；
      //   快照含全爆裂 +50%（命中时判定）、ENTER_FULL_BURST buff、S2 Part1 Ghostbuster ATK ▲（skill2 先于 burst 执行）
      //   以及 S1 属性优势 buff（先计入快照，再由下方 FULL_BURST_SNAPSHOT 触发器移除）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv      = caster.skillLevels[2];
          const ghosts  = caster.skillState.ebs_ghostCount ?? 0;
          const delay   = Math.round(0.2 * TICK_RATE);

          if (ghosts === 13) {
            // 13幽灵模式：13连发，幽灵 ▼ 9（结果：4）
            const hitPct = getSkillValue(caster.rawBurst, 3, lv) / 100;
            for (let h = 0; h < 13; h++) {
              state.pendingSkillHits.push({
                fireTick: state.tick + delay * (h + 1),
                caster, mult: hitPct,
                isCharged: false, label: 'Burst P2',
                opts: { affectedByFullBurst: true, isSequentialAttack: true },
              });
            }
            caster.skillState.ebs_ghostCount = ghosts - 9;  // 13 - 9 = 4
          } else {
            // 非13幽灵模式：6连发，幽灵 ▼ 6（至少保留1）
            const hitPct = getSkillValue(caster.rawBurst, 0, lv) / 100;
            for (let h = 0; h < 6; h++) {
              state.pendingSkillHits.push({
                fireTick: state.tick + delay * (h + 1),
                caster, mult: hitPct,
                isCharged: false, label: 'Burst P1',
                opts: { affectedByFullBurst: true, isSequentialAttack: true },
              });
            }
            caster.skillState.ebs_ghostCount = Math.max(1, ghosts - 6);
          }

          // 幽灵减少后 Elem Adv buff 条件（需 ≥4 幽灵）的检查推迟到全爆裂快照之后（见下方触发器），
          // 使本次爆裂伤害快照仍计入该 buff
          caster.skillState.ebs_elemAdvCheckPending = true;
          // ATK buff（Hello Ghost P2 L1）：非13模式至少保留1幽灵，13模式后剩4幽灵，均 ≥1，故不移除
        },
      },
      // 全爆裂快照完成后：幽灵 <4 则移除 S1 属性优势 buff（先计入爆裂伤害快照，再移除）
      {
        on: 'FULL_BURST_SNAPSHOT',
        handler(state, caster) {
          if (!caster.skillState.ebs_elemAdvCheckPending) return false;
          caster.skillState.ebs_elemAdvCheckPending = false;
          if ((caster.skillState.ebs_ghostCount ?? 0) < 4) {
            state.buffs = state.buffs.filter(b => b.name !== 'Hello Ghost (Elem Adv Damage)');
          }
        },
      },
    ],
  },
};
