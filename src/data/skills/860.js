import { pushBuff, fireSkillHit, getBuffSums, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Chisato  (resource_id: 860)
//
// 武器：SMG（1440 RPM，弹匣 120）。爆裂阶段 Step3，CD 40s。
// Extrasensory（超感）充能值保存在 skillState.chisatoExtrasensory（0–100，单位 %）。

const ES_KEY = 'chisatoExtrasensory';

// 「Only when above X%」类效果：充能值 > 阈值时持续生效（不可移除），低于时移除
const ES_TIERS = [
  { name: 'Extrasensory (ATK)',         thresholdIdx: 3, valueIdx: 4, field: 'atkPct',        lineIdx: 3 },
  { name: 'Extrasensory (True Damage)', thresholdIdx: 5, valueIdx: 6, field: 'trueDamagePct', lineIdx: 4 },
  { name: 'Extrasensory (Hit Rate)',    thresholdIdx: 7, valueIdx: 8, field: 'hitRatePct',    lineIdx: 5 },
];

// 设置充能值并刷新各档效果；达到上限时触发 Dodging Bullets（无敌，敌方伤害未建模，仅记录日志）
function setExtrasensory(state, caster, value) {
  const raw = caster.rawSkill1;
  const lv  = caster.skillLevels[0];
  const max = getSkillValue(raw, 1, lv);
  const prev = caster.skillState[ES_KEY] ?? 0;
  const next = Math.max(0, Math.min(max, value));
  caster.skillState[ES_KEY] = next;
  const s1Ctx = { unitName: caster.name, skillLabel: raw?.name_localkey ?? 'S1', slot: 'S1',
    partIdx: 1, lineIdx: null, trigger: state._logCtx?.trigger ?? '' };

  if (next >= max && prev < max) {
    pushBuff(state, { name: 'Dodging Bullets', unitId: caster.id,
      endTick: state.tick + TICK_RATE * getSkillValue(raw, 2, lv) }, { ...s1Ctx, lineIdx: 2 });
  }
  for (const tier of ES_TIERS) {
    const active = next > getSkillValue(raw, tier.thresholdIdx, lv);
    const has    = state.buffs.some(b => b.name === tier.name && b.unitId === caster.id);
    if (active && !has) {
      pushBuff(state, { name: tier.name, unitId: caster.id,
        [tier.field]: getSkillValue(raw, tier.valueIdx, lv) / 100, endTick: Infinity },
        { ...s1Ctx, lineIdx: tier.lineIdx });
    } else if (!active && has) {
      state.buffs = state.buffs.filter(b => !(b.name === tier.name && b.unitId === caster.id));
    }
  }
}

export default {

  // ── Extrasensory（S1）
  // ■ Activates at the start of battle. Affects self.
  //   Charges Extrasensory to {p00}%, up to {p01}%. This effect is continuous and cannot be removed.
  // ■ Activates while in Extrasensory status. Affects self.
  //   Effect changes according to the charge level of Extrasensory. Previous effects trigger repeatedly.
  //   Only when at {p01}%: Dodging Bullets: Invulnerable for {p02} sec.
  //   Only when above {p03}%: ATK ▲ {p04}%. This effect is continuous and cannot be removed.
  //   Only when above {p05}%: True Damage ▲ {p06}%. This effect is continuous and cannot be removed.
  //   Only when above {p07}%: Hit Rate ▲ {p08}%. This effect is continuous and cannot be removed.
  // ■ Affects self every {p09} sec.
  //   Extrasensory ▼ {p10}%.
  // p00: [100,...]   p01: [100,...]   p02: [2,...]
  // p03: [70,...]
  // p04: [31.72,34.16,36.61,39.05,41.49,43.93,46.37,48.81,51.25,53.69]
  // p05: [55,...]
  // p06: [28.73,30.94,33.15,35.36,37.57,39.78,41.99,44.2,46.41,48.62]
  // p07: [25,...]
  // p08: [13.22,14.23,15.25,16.27,17.28,18.3,19.32,20.33,21.35,22.37]
  // p09: [2,...]     p10: [1,...]
  skill1: {
    triggers: [
      // P1：战斗开始 → 充能至 p00%（P2 各档效果随之生效）
      {
        on: 'BATTLE_START',
        handler(state, caster) {
          setExtrasensory(state, caster, getSkillValue(caster.rawSkill1, 0, caster.skillLevels[0]));
        },
      },
      // P2：各档效果由 setExtrasensory 在充能值变化时刷新
      {},
      // P3：每 p09=2 秒充能值 ▼ p10%（opts.seconds 需静态，p09 为常量 2）
      {
        on: 'INTERVAL',
        opts: { seconds: 2 },
        handler(state, caster) {
          const lv = caster.skillLevels[0];
          setExtrasensory(state, caster,
            (caster.skillState[ES_KEY] ?? 0) - getSkillValue(caster.rawSkill1, 10, lv));
        },
      },
    ],
  },

  // ── AP Rounds（S2）
  // ■ Activates when using Burst Skill. Affects self.
  //   Normal attacks deal true damage for {p00} sec.
  // ■ Activates after landing {p01} normal attack(s). Affects the target.
  //   Deals {p02}% of final ATK as true damage.
  // p00: [10,...]
  // p01: [48,...]
  // p02: [279.01,300.48,321.94,343.4,364.87,386.33,407.79,429.25,450.72,472.18]
  skill2: {
    triggers: [
      // P1：使用爆裂技能 → 普通攻击造成真实伤害（p00 秒）
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          pushBuff(state, { name: 'AP Rounds', unitId: caster.id, normalAttackTrueDamage: true,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawSkill2, 0, caster.skillLevels[1]) });
        },
      },
      // P2：每 p01=48 发普通攻击 → p02% 最终 ATK 真实伤害（opts.every 需静态，p01 为常量 48）
      {
        on: 'SHOT_COUNT',
        opts: { every: 48 },
        handler(state, caster) {
          if (state.enemyHp <= 0) return;
          fireSkillHit(state, caster, getSkillValue(caster.rawSkill2, 2, caster.skillLevels[1]) / 100,
            getBuffSums(state, caster.id), 'S2', { isTrueDamage: true });
        },
      },
    ],
  },

  // ── Emergency Charge（Burst）
  // ■ Affects self.
  //   Charges Extrasensory to {p00}%.
  //   ATK ▲ {p01}% for {p02} sec.
  // p00: [100,...]
  // p01: [43.23,46.56,49.88,53.21,56.53,59.86,63.18,66.51,69.84,73.16]
  // p02: [10,...]
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv = caster.skillLevels[2];
          setExtrasensory(state, caster, getSkillValue(caster.rawBurst, 0, lv));
          pushBuff(state, { name: 'Emergency Charge', unitId: caster.id,
            atkPct: getSkillValue(caster.rawBurst, 1, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(caster.rawBurst, 2, lv) },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },
};
