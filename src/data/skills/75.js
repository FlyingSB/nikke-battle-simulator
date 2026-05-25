import { pushBuff, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

export default {

  // ── Ah Ah, Mic Test
  // ■ Activates when entering Full Burst for the first time after using own Burst Skill. Affects self.
  //   Intro: Critical damage ▲ {p00}% continuously. Cannot be dispelled. Persists after revival.
  // ■ Activates when entering Full Burst for the first time without using own Burst Skill. Affects self.
  //   Highlight: Critical damage ▲ {p01}% continuously. Cannot be dispelled. Persists after revival.
  // ■ Activates when entering Full Burst. Affects self if in Intro status.
  //   Sustained damage ▲ {p02}% for {p03=10} sec.
  // ■ Activates when entering Full Burst. Affects self if in Highlight status.
  //   Sustained damage ▲ {p04}% for {p05=10} sec.
  //
  // group_id: 20751
  // p00 Intro Crit Damage▲%: [11.98, 12.9, 13.82, 14.74, 15.67, 16.59, 17.51, 18.43, 19.35, 20.28]
  // p01 Highlight Crit Damage▲%: [11.98, 12.9, 13.82, 14.74, 15.67, 16.59, 17.51, 18.43, 19.35, 20.28]
  // p02 Intro Sustained damage▲%: [35.56, 38.3, 41.04, 43.77, 46.51, 49.24, 51.98, 54.72, 57.45, 60.19]
  // p03 duration (const): [10, ...]
  // p04 Highlight Sustained damage▲%: [138.88, 149.56, 160.24, 170.93, 181.61, 192.29, 202.98, 213.66, 224.34, 235.03]
  // p05 duration (const): [10, ...]
  skill1: {
    groupId: 20751,
    triggers: [
      // BURST_SKILL_USE 先于 ENTER_FULL_BURST 触发；此处仅标记本体本轮已使用爆裂，供状态判断使用
      {
        on: 'BURST_SKILL_USE',
        logTargets: null,
        handler(state, caster) {
          caster.skillState.dws_burstUsedFlag = true;
        },
      },
      // 进入全爆裂：首次分配 Intro/Highlight 状态（永久暴击伤害加成），每次给予 10s 持续伤害加成
      {
        on: 'ENTER_FULL_BURST',
        logTargets: 'SELF',
        handler(state, caster) {
          const lv = caster.skillLevels[0];

          if (!caster.skillState.dws_statusSet) {
            caster.skillState.dws_statusSet = true;
            caster.skillState.dws_status    = caster.skillState.dws_burstUsedFlag ? 'intro' : 'highlight';
            const cdIdx = caster.skillState.dws_status === 'intro' ? 0 : 1;
            const cdPct = getSkillValue(caster.rawSkill1, cdIdx, lv) / 100;
            // 永久暴击伤害加成，不可驱散，复活后保留
            pushBuff(state, { name: 'dws_s1_critDmg', unitId: caster.id,
              critDmgBonus: cdPct, endTick: Infinity });
          }

          if (caster.skillState.dws_status === 'intro') {
            const sdPct = getSkillValue(caster.rawSkill1, 2, lv) / 100;
            pushBuff(state, { name: 'dws_s1_intro_sd', unitId: caster.id,
              sustainedDamagePct: sdPct, endTick: state.tick + TICK_RATE * 10 });
          } else if (caster.skillState.dws_status === 'highlight') {
            const sdPct = getSkillValue(caster.rawSkill1, 4, lv) / 100;
            pushBuff(state, { name: 'dws_s1_hl_sd', unitId: caster.id,
              sustainedDamagePct: sdPct, endTick: state.tick + TICK_RATE * 10 });
          }
        },
      },
    ],
  },

  // ── I'm Gonna Sing Now!
  // ■ Activates when an ally or self destroys an enemy's part. Affects all allies (except self).
  //   Mute: Gains immunity to Noise Pollution continuously, stacks up to {p00=3} time(s).
  //   [部件摧毁事件（PART_DESTROYED）未建模 — 跳过]
  // ■ Activates when an ally or self destroys an enemy's part. Affects self.
  //   Sustained damage ▲ {p03}% for {p04=15} sec.
  //   [部件摧毁事件（PART_DESTROYED）未建模 — 跳过]
  // ■ Activates when attacking with Full Charge. Affects self.
  //   Sustained damage ▲ {p01}% for {p02=3} sec, stacks up to {p05=2} time(s).
  // ■ Activates when entering Full Burst. Affects the stage target.
  //   Deals {p06}% of final ATK as sustained damage every 1 sec for {p07=9} sec.
  //
  // group_id: 20752
  // p00 Mute max stacks (const): [3, ...]  — 不建模
  // p01 FC Sustained damage▲%/stack: [187.99, 202.45, 216.91, 231.37, 245.83, 260.29, 274.75, 289.22, 303.68, 318.14]
  // p02 FC duration (const): [3, ...]
  // p03 Part break Sustained damage▲%: [40.2, 43.29, 46.39, 49.48, 52.57, 55.67, 58.76, 61.85, 64.94, 68.04]  — 不建模
  // p04 Part break duration (const): [15, ...]  — 不建模
  // p05 FC max stacks (const): [2, ...]
  // p06 Burst DoT %/sec: [37.42, 40.3, 43.18, 46.06, 48.94, 51.82, 54.7, 57.58, 60.45, 63.33]
  // p07 Burst DoT duration (const): [9, ...]
  skill2: {
    groupId: 20752,
    triggers: [
      // S2 Part3: 全蓄力 → 自身持续伤害▲ p01%/层 3s，叠加至 2 层（刷新计时器）
      {
        on: 'FULL_CHARGE',
        logTargets: 'SELF',
        handler(state, caster) {
          const lv  = caster.skillLevels[1];
          const pct = getSkillValue(caster.rawSkill2, 1, lv) / 100;
          const end = state.tick + TICK_RATE * 3;
          const existing = state.buffs.find(b => b.name === 'dws_s2_fc_sd' && b.unitId === caster.id);
          if (existing) {
            existing.stackCount          = Math.min(2, (existing.stackCount ?? 1) + 1);
            existing.sustainedDamagePct = existing.stackCount * pct;
            existing.endTick            = end;
          } else {
            pushBuff(state, { name: 'dws_s2_fc_sd', unitId: caster.id,
              sustainedDamagePct: pct, endTick: end, stackCount: 1 });
          }
        },
      },
      // S2 Part4: 进入全爆裂 → 对舞台目标每秒 p06% ATK 持续伤害 DoT，持续 9s
      {
        on: 'ENTER_FULL_BURST',
        logTargets: 'ENEMY',
        handler(state, caster) {
          const lv   = caster.skillLevels[1];
          const mult = getSkillValue(caster.rawSkill2, 6, lv) / 100;
          const end  = state.tick + TICK_RATE * 9;
          const existing = state.dots.find(d => d.dotName === 'dws_s2_fb_dot' && d.casterId === caster.id);
          if (existing) {
            existing.multPerStack = mult;
            existing.endTick      = end;
          } else {
            state.dots.push({
              casterId:      caster.id,
              label:         'S2 P2',
              dotName:       'dws_s2_fb_dot',
              multPerStack:  mult,
              stacks:        1,
              endTick:       end,
              nextFireTick:  state.tick + TICK_RATE,
              intervalTicks: TICK_RATE,
              sustainedDamage: true,
            });
          }
        },
      },
    ],
  },

  // ── La La La ♬
  // ■ Affects all enemies.
  //   Damage taken ▲ {p07}% for {p08=10} sec.
  //   Deals {p00}% of final ATK as sustained damage every 1 sec for {p01=9} sec.
  // ■ Affects the enemy if the enemy is the stage target.
  //   Deals {p05}% of final ATK as sustained damage every 1 sec for {p06=9} sec.
  // ■ Affects all allies (except self) if self is in Highlight status.
  //   Noise Pollution: Hit rate ▼ {p02=100}% for {p03=1} sec.
  //   [Noise Pollution / Mute 联动系统未建模 — 跳过]
  // ■ Affects all allies if self is in Highlight status.
  //   Stack count of Mute ▼ {p04=1}.
  //   [Mute 叠层系统未建模 — 跳过]
  //
  // group_id: 10753
  // p00 DoT to all enemies %/sec: [10.89, 11.72, 12.56, 13.4, 14.24, 15.07, 15.91, 16.75, 17.59, 18.43]
  // p01 DoT duration (const): [9, ...]
  // p02 Noise Pollution hit rate▼% (const): [100, ...]  — 不建模
  // p03 Noise Pollution duration (const): [1, ...]  — 不建模
  // p04 Mute stack reduction (const): [1, ...]  — 不建模
  // p05 Stage target DoT %/sec: [107.07, 115.31, 123.55, 131.78, 140.02, 148.26, 156.49, 164.73, 172.97, 181.2]
  // p06 Stage target DoT duration (const): [9, ...]
  // p07 Damage taken▲%: [14.82, 15.96, 17.1, 18.24, 19.38, 20.52, 21.66, 22.8, 23.95, 25.09]
  // p08 Damage taken duration (const): [10, ...]
  burst: {
    groupId: 10753,
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];

          // 全体敌人承伤▲ p07% 10s（刷新时仅延长 endTick，不重复累加）
          const dtPct      = getSkillValue(caster.rawBurst, 7, lv) / 100;
          const dtEnd      = state.tick + TICK_RATE * 10;
          const existingDt = state.buffs.find(b => b.name === 'dws_burst_dt');
          if (!existingDt) state.enemyDamageTakenPct += dtPct;
          pushBuff(state, { name: 'dws_burst_dt', unitId: null,
            enemyDamageTakenPct: dtPct, endTick: dtEnd });

          // 全体敌人 DoT p00%/sec + 舞台目标额外 DoT p05%/sec（单 Boss 场景合并），持续 9s
          const dotAllMult   = getSkillValue(caster.rawBurst, 0, lv) / 100;
          const dotStageMult = getSkillValue(caster.rawBurst, 5, lv) / 100;
          const totalMult    = dotAllMult + dotStageMult;
          const dotEnd       = state.tick + TICK_RATE * 9;
          const existingDot  = state.dots.find(d => d.dotName === 'dws_burst_dot' && d.casterId === caster.id);
          if (existingDot) {
            existingDot.multPerStack = totalMult;
            existingDot.endTick      = dotEnd;
          } else {
            state.dots.push({
              casterId:      caster.id,
              label:         'Burst',
              dotName:       'dws_burst_dot',
              multPerStack:  totalMult,
              stacks:        1,
              endTick:       dotEnd,
              nextFireTick:  state.tick + TICK_RATE,
              intervalTicks: TICK_RATE,
              sustainedDamage: true,
            });
          }
        },
      },
    ],
  },
};
