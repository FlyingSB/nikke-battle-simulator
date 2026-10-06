import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Arcana: Fortune Mate  (resource_id: 583)
export default {

  // ── Keepsake Album
  // ■ Activates when Full Burst ends. Affects all shotgun-wielding allies.
  //   ATK ▲ {p00}% of the caster's ATK x stack count of Precious Moments for {p01=15} sec.
  // ■ Activates when Happy Memories takes effect. Affects self.
  //   Snapshots of Youth: Normal Attack Damage Multiplier ▲ {p02=10}% continuously,
  //   stacks up to {p03=3} time(s).
  // ■ Activates when Full Burst ends. Affects self.
  //   Removes Making Memories. Removes Snapshots of Youth.
  //
  // group_id: 25831
  // p00 ATK▲% of caster's ATK per PM stack: [6.86, 7.54, 8.22, 8.91, 9.59, 10.27, 10.96, 11.64, 12.32, 13]
  // p01 duration (const): [15]
  // p02 Normal Atk Dmg Mult▲% per stack (const): [10]
  // p03 max stacks (const): [3]
  skill1: {
    groupId: 25831,
    triggers: [
      // S1 Part1 + Part3：Full Burst 结束
      //   Part1：根据 Precious Moments 层数，给所有 SG 友军追加 ATK 平坦加成 15s
      //   Part3：移除 Making Memories 相关 buff，移除 Snapshots of Youth
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          const lv      = caster.skillLevels[0];
          const atkPct  = getSkillValue(caster.rawSkill1, 0, lv) / 100;
          const pmStacks = caster.skillState.fortune_preciousMomentsStacks ?? 0;
          if (pmStacks > 0) {
            const atkFlat = Math.round(caster.stats.atk * atkPct * pmStacks);
            const end15   = state.tick + TICK_RATE * 15;
            const sgIds   = state.squad.filter(u => u.weaponType === 'SG').map(u => u.id);
            pushBuff(state, { name: 'Keepsake Album', unitIds: sgIds,
              atkFlat, multiplier: pmStacks, endTick: end15 });
          }

          // 移除 Making Memories 及其关联 buff（含 Happy Memories 弹丸数 ▲）
          state.buffs = state.buffs.filter(b =>
            b.name !== 'Making Memories' &&
            b.name !== 'Happy Memories' &&
            b.name !== 'Precious Moments' &&
            b.name !== 'Snapshots of Youth',
          );

          // 重置所有 Making Memories 内部计数
          caster.skillState.fortune_makingMemoriesActive  = false;
          caster.skillState.fortune_mmShotCount           = 0;
          caster.skillState.fortune_happyMemoriesStacks   = 0;
          caster.skillState.fortune_preciousMomentsStacks = 0;
          caster.skillState.fortune_snapshotsOfYouthStacks = 0;
        },
      },
    ],
  },

  // ── Memories and Moments
  // ■ Activates when performing normal attacks while in Making Memories status. Affects self.
  //   Effect changes according to the number of attacks. Resets when Making Memories is removed.
  //   Two times:   Reloads {p00=6} round(s).
  //   Four times:  Happy Memories: Number of pellets ▲ {p01=1} continuously,
  //                stacks up to {p02=3} time(s).
  //   Six times:   Precious Moments: ATK ▲ {p03}% continuously, stacks up to {p04=3} time(s).
  // ■ Activates when using Burst Skill. Affects all shotgun-wielding allies (except self).
  //   Attack Damage ▲ {p05}% for {p06=10} sec.
  //
  // group_id: 25832
  // p00 reload rounds (const): [6]
  // p01 pellets▲ per stack (const): [1]  → buff 字段 pelletFlat（不改 shotDamageMult，影响爆裂充能与按弹丸计数的技能）
  // p02 Happy Memories max stacks (const): [3]
  // p03 ATK▲% per stack: [1.47, 1.59, 1.70, 1.81, 1.93, 2.04, 2.15, 2.27, 2.38, 2.49]
  // p04 Precious Moments max stacks (const): [3]
  // p05 Attack Damage▲% to SG allies: [31.12, 33.77, 36.42, 39.08, 41.73, 44.38, 47.04, 49.69, 52.34, 55]
  // p06 duration (const): [10]
  skill2: {
    groupId: 25832,
    triggers: [
      // S2 Part1：每次普通攻击时，若 Making Memories 生效，推进循环计数器
      //   2发→补弹6发；4发→Happy Memories(弹丸+1，最多3层)；6发→Precious Moments(ATK+p03%，最多3层)，重置
      //   Happy Memories 触发时同步触发 S1 Part2：Snapshots of Youth +10% Normal Atk Dmg Mult（最多3层）
      {
        on: 'SHOT_COUNT',
        opts: { every: 1, counterKey: 'fortune_s2_shotDummy' },
        handler(state, caster) {
          if (!caster.skillState.fortune_makingMemoriesActive) return;

          caster.skillState.fortune_mmShotCount = (caster.skillState.fortune_mmShotCount ?? 0) + 1;
          const count = caster.skillState.fortune_mmShotCount;

          if (count === 2) {
            // 补弹 6 发
            const ammoBefore = caster.ammoLeft;
            caster.ammoLeft  = Math.min(caster.maxAmmo, caster.ammoLeft + 6);
            if (state.ammoLog && caster.ammoLeft !== ammoBefore)
              state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
                delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft,
                maxAmmo: caster.maxAmmo, source: 'fortune_s2_reload' });
          } else if (count === 4) {
            // Happy Memories：弹丸数 +1（最多3层，持续到 Full Burst 结束）
            //   建模：可叠层 pelletFlat buff，下一发起生效；shotDamageMult 不变（单次射击总系数固定，每颗弹丸伤害随之变化）
            const stacks = caster.skillState.fortune_happyMemoriesStacks ?? 0;
            if (stacks < 3) {
              caster.skillState.fortune_happyMemoriesStacks = stacks + 1;
              pushBuff(state, { name: 'Happy Memories', unitId: caster.id,
                pelletFlat: getSkillValue(caster.rawSkill2, 1, caster.skillLevels[1]),
                stackLimit: 3, endTick: Infinity });

              // S1 Part2：Happy Memories 生效时 → Snapshots of Youth Normal Atk Dmg Mult +10%（最多3层）
              const soStacks = (caster.skillState.fortune_snapshotsOfYouthStacks ?? 0);
              if (soStacks < 3) {
                caster.skillState.fortune_snapshotsOfYouthStacks = soStacks + 1;
                // TODO(实测) "Normal Attack Damage Multiplier" 暂按 normalAttackDamagePct（ExtraMultiplier 加法）建模；
                //   参考 Charge Damage Multiplier 与珍藏品同乘区的实测结论，可能应与珍藏品普攻倍率同乘区，待游戏内数据验证
                // 属 S1 P2，日志显式归属到 S1
                pushBuff(state, { name: 'Snapshots of Youth', unitId: caster.id,
                  normalAttackDamagePct: 0.1, endTick: Infinity },
                  { ...state._logCtx, skillLabel: caster.rawSkill1?.name_localkey ?? 'S1', slot: 'S1', partIdx: 1, lineIdx: null });
              }
            }
          } else if (count >= 6) {
            // Precious Moments：ATK ▲ p03%（最多3层）
            const lv     = caster.skillLevels[1];
            const atkPct = getSkillValue(caster.rawSkill2, 3, lv) / 100;
            const stacks = caster.skillState.fortune_preciousMomentsStacks ?? 0;
            if (stacks < 3) {
              caster.skillState.fortune_preciousMomentsStacks = stacks + 1;
              // 可叠层（上限 3）：stackLimit 使每次推入新增一层，getBuffSums 按层数累加
              pushBuff(state, { name: 'Precious Moments', unitId: caster.id,
                atkPct, stackLimit: 3, endTick: Infinity });
            }
            // 重置循环计数
            caster.skillState.fortune_mmShotCount = 0;
          }
        },
      },
      // S2 Part2：使用爆裂技能时，给所有 SG 友军（不含自身）附加 Attack Damage ▲ p05% 10s
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv        = caster.skillLevels[1];
          const atkDmgPct = getSkillValue(caster.rawSkill2, 5, lv) / 100;
          const end10     = state.tick + TICK_RATE * 10;
          const unitIds   = state.squad.filter(u => u.id !== caster.id && u.weaponType === 'SG').map(u => u.id);
          pushBuff(state, { name: 'Memories and Moments (Attack Damage)', unitIds,
            attackDamagePct: atkDmgPct, endTick: end10 });
        },
      },
    ],
  },

  // ── Radiant Youth
  // ■ Affects self.
  //   Making Memories:
  //     Function: Enhances attack capabilities.
  //     Effect 1: Critical Rate ▲ {p00}% continuously.
  //     Effect 2: Reloads {p01=2} round(s).
  //     Effect 3: Attack Damage ▲ {p02}% continuously.
  // ■ Affects all enemies.
  //   Deals {p03}% of final ATK as Burst Skill damage.
  //
  // group_id: 15833
  // p00 Crit Rate▲%: [11.87, 12.78, 13.70, 14.61, 15.52, 16.44, 17.35, 18.27, 19.18, 20.09]
  // p01 reload rounds (const): [2]
  // p02 Attack Damage▲%: [17.72, 19.08, 20.44, 21.81, 23.17, 24.53, 25.90, 27.26, 28.62, 29.99]
  // p03 Burst hit%: [327.6, 352.8, 378, 403.2, 428.4, 453.6, 478.8, 504, 529.2, 554.4]
  burst: {
    groupId: 15833,
    triggers: [
      // Burst：施加 Making Memories（暴击率 + 补弹 + Attack Damage ▲，持续到 Full Burst 结束）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv           = caster.skillLevels[2];
          const critRatePct  = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const atkDmgPct    = getSkillValue(caster.rawBurst, 2, lv) / 100;

          // Making Memories：暴击率 ▲ + Attack Damage ▲（持续到 Full Burst 结束时清除）
          pushBuff(state, { name: 'Making Memories', unitId: caster.id,
            critRatePct: critRatePct, attackDamagePct: atkDmgPct, endTick: Infinity });

          // Making Memories：立即补弹 2 发
          const ammoBefore = caster.ammoLeft;
          caster.ammoLeft  = Math.min(caster.maxAmmo, caster.ammoLeft + 2);
          if (state.ammoLog && caster.ammoLeft !== ammoBefore)
            state.ammoLog.push({ tick: state.tick, unitId: caster.id, unitName: caster.name,
              delta: caster.ammoLeft - ammoBefore, ammoAfter: caster.ammoLeft,
              maxAmmo: caster.maxAmmo, source: 'fortune_burst_makingMemories_reload' });

          // 激活 Making Memories 状态，重置 S2 循环计数
          caster.skillState.fortune_makingMemoriesActive = true;
          caster.skillState.fortune_mmShotCount          = 0;
        },
      },
      // Burst：1 次爆裂技能伤害 × p03%
      {
        on: 'BURST_SKILL_USE',
        target: 'ENEMY',
        effects: [
          {
            type: 'SKILL_DAMAGE',
            count: 1,
            mult: (caster) => getSkillValue(caster.rawBurst, 3, caster.skillLevels[2]) / 100,
            label: 'Burst',
          },
        ],
      },
    ],
  },
};
