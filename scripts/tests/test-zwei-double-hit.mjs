/**
 * Zwei 爆裂双重命中机制回归测试。
 *
 * 游戏实机特性（可视为 bug）：Zwei 使用爆裂技能后切换至穿透 SR，
 * 该 SR 的"一击"实际造成两次独立伤害。两次命中的暴击独立判定。
 *
 * 若武器切换命中发生在全爆裂期间（burstStepSecs=0.1 可保证此条件），则：
 *   命中①：受 S1 P1 的一发穿透 buff（pierce1r，endRounds:1）加成；
 *           命中后 pierce1r 被消耗（roundsLeft→0），同时触发 S1 P2，
 *           添加 pierce_stack（pierceDamagePct+24.99%，endRounds:1）。
 *   命中②：受刚添加的 pierce_stack 加成，暴击独立判定；
 *           pierce_stack 不在本次射击中消耗（roundsLeft 保留为 1）。
 *
 * 测试编号：
 *   ZW1  两次命中均出现在 hitLog（label='normal_shot' 和 'normal_shot_2'）
 *   ZW2  命中①的伤害包含 pierce1r 加成（高于无 pierce 基准）
 *   ZW3  命中②的伤害包含 pierce_stack 加成（不含 pierce1r）
 *   ZW4  命中②比命中①伤害更高（pierce_stack > pierce1r）
 *   ZW5  全爆裂后 pierce1r roundsLeft=0；pierce_stack roundsLeft=1（保留至下一发）
 *   ZW6  critRate=1 时两次命中均为暴击
 *   ZW7  critRate=0 时两次命中均不暴击（两次独立判定结果一致）
 *
 * Run: node scripts/tests/test-zwei-double-hit.mjs
 */

import { initBattle, tick } from '../../src/engine/battle.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

// ─── SSR 珍藏品 mock 数据（Four-Leaf Clover Bookmark，lv10）─────────────────

/** 构造 10 元素 description_value_list，lv10（index 9）填入目标值。 */
function mkVals(lv10) {
  return { description_value: Array.from({ length: 10 }, (_, i) => i === 9 ? String(lv10) : '0') };
}

/**
 * skill2 暴击率全零版本：用于 critRate=0 测试中排除 S2 P2/P3 的暴击率 buff，
 * 避免非确定性暴击。S2 P2 仍会触发（不崩溃），但 critRateBonus=0，不影响判定。
 */
const ZERO_CRIT_SKILL2 = {
  _activeSkillLevel: 10,
  description_value_list: [
    mkVals('5'),   // p00: shot threshold
    mkVals('0'),   // p01: cover HP restore %
    mkVals('0'),   // p02: critRate % → 0，不添加任何暴击加成
    mkVals('10'),  // p03: sec
    mkVals('0'),   // p04: critRate stack % → 0
    mkVals('3'),   // p05: max stacks
    mkVals('5'),   // p06: sec
  ],
};

/**
 * 构造 Zwei SSR 珍藏品技能数据 mock（仅含战斗相关字段）。
 * lv10 数值来自技能文件注释。
 */
function makeZweiSSRFavSkills() {
  return {
    skill1: {
      _activeSkillLevel: 10,
      description_value_list: [
        mkVals('20.13'),  // p00: pierce1r pct (1 round)
        mkVals('1'),      // p01: rounds (const)
        mkVals('10.06'),  // p02: pierce10s pct (10s)
        mkVals('10'),     // p03: sec (const)
        mkVals('24.99'),  // p04: pierce_stack pct (stacking)
        mkVals('3'),      // p05: max stacks (const)
        mkVals('1'),      // p06: rounds (const)
      ],
    },
    skill2: {
      _activeSkillLevel: 10,
      description_value_list: [
        mkVals('5'),      // p00: shot threshold
        mkVals('7.52'),   // p01: cover HP restore %
        mkVals('18.63'),  // p02: critRate %
        mkVals('10'),     // p03: sec (SSR: 10s)
        mkVals('15'),     // p04: critRate stack %
        mkVals('3'),      // p05: max stacks
        mkVals('5'),      // p06: sec
      ],
    },
    burst: {
      _activeSkillLevel: 10,
      description_value_list: [
        mkVals('50.69'),  // p00: charge shot damage %
        mkVals('1'),      // p01: max ammo (const)
        mkVals('25.03'),  // p02: pierce damage % (SSR lv10)
        mkVals('10'),     // p03: sec (const)
      ],
    },
  };
}

// ─── 角色 / 小队 fixtures ────────────────────────────────────────────────────

let _nextId = 91000;

function dummyUnit(burstStep, overrides = {}) {
  return {
    characterId:              _nextId++,
    name:                     `Dummy-${burstStep}`,
    element:                  'Iron',
    weaponType:               'MG',
    burstStep,
    nativeBurstStep:          burstStep,
    _nikkeData:               { shot_detail: { reload_bullet: 10000 } },
    _computedStats:           { atk: 10_000, hp: 1_000_000, def: 500, critRate: 0, critDmg: 0.5 },
    targetBurstEnergyPerShot: 1_000_000,
    burstEnergyPerShot:       500,
    burstSkillCooltime:       0,
    baseAmmo:                 30,
    reloadTicks:              120,
    shotDamageMult:           0.03,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    rateOfFire:               600,
    ...overrides,
  };
}

/**
 * 构造 Zwei 单位配置（B1，SSR 珍藏品）。
 * 使用 MG 射速填充爆裂槽（初始武器），爆裂后 burst handler 自动切换至穿透 SR。
 */
function zweiUnit(statsOverride = {}) {
  return {
    characterId:              390,
    name:                     'Zwei',
    element:                  'Iron',
    weaponType:               'MG',
    burstStep:                'Step1',
    nativeBurstStep:          'Step1',
    nativeChangeBurstStep:    'Step2',
    changeBurstStep:          'Step2',
    _nikkeData:               { shot_detail: { reload_bullet: 10000 } },
    _computedStats:           { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0.5, ...statsOverride },
    targetBurstEnergyPerShot: 1_000_000,
    burstEnergyPerShot:       500,
    burstSkillCooltime:       0,
    baseAmmo:                 30,
    reloadTicks:              120,
    shotDamageMult:           0.03,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    rateOfFire:               600,
    ssrFavSkills:             makeZweiSSRFavSkills(),
    skillLevels:              [10, 10, 10],
  };
}

const ENEMY_NEAR = {
  maxHp:    1e15,
  def:      0,
  element:  'Iron',
  type:     'Boss',
  hasCore:  false,
  distance: 'NEAR',  // SR 在 NEAR 无距离加成
};

/**
 * 运行带 hitLog 的模拟，直到 Zwei 的武器切换 SR 双重命中出现为止。
 * burstStepSecs=0.1（6 ticks/步）确保全爆裂在 tick≈13 开始，
 * Zwei 的 SR 命中在 tick≈73（1.2s=72 ticks），发生在全爆裂窗口内。
 *
 * 注意：initBattle 只能从 cfg._favItemData 计算 ssrFavSkills，无法直接传入 cfg.ssrFavSkills。
 * 解决方案：initBattle 后直接在 squad 单位上注入 ssrFavSkills（在第一个 tick 前，burst 尚未触发）。
 *
 * @param {object} statsOverride   _computedStats 覆盖（如 critRate）
 * @param {boolean} includeSkill2  是否注入 skill2（会添加暴击率 buff；critRate=0 测试中需关闭以保持确定性）
 */
function runUntilDoubleHit(statsOverride = {}, includeSkill2 = true) {
  const config = {
    squad:         [zweiUnit(statsOverride), dummyUnit('Step2'), dummyUnit('Step3')],
    enemy:         ENEMY_NEAR,
    burstStepSecs: 0.1,
    hitLog:        true,
  };
  const state = initBattle(config);
  // 在第一个 tick 前注入 ssrFavSkills，让各技能 handler 的 caster.ssrFavSkills?.skillX 返回正确数据
  const zwei = state.squad.find(u => u.id === 390);
  const favSkills = makeZweiSSRFavSkills();
  // includeSkill2=false 时，使用暴击率全零的 skill2（S2 P2 仍能运行但不添加暴击加成）
  zwei.ssrFavSkills = includeSkill2 ? favSkills : { ...favSkills, skill2: ZERO_CRIT_SKILL2 };
  for (let t = 0; t < 120; t++) {
    const { over } = tick(state);
    if (over) break;
    if (state.hitLog.some(h => h.label === 'normal_shot_2')) break;
  }
  return state;
}

// ─── ZW1：hitLog 中同一 tick 出现 normal_shot 和 normal_shot_2 ────────────────

section('ZW1 — 双重命中：hitLog 出现两条 normal_shot / normal_shot_2');
{
  const state = runUntilDoubleHit();
  // 先找 normal_shot_2（双重命中第二次），再找同 tick 的 normal_shot（第一次）
  const hit2  = state.hitLog.find(h => h.label === 'normal_shot_2' && h.unitId === 390);
  const hit1  = state.hitLog.find(h => h.label === 'normal_shot'   && h.unitId === 390 && h.tick === hit2?.tick);
  eq('ZW1.1  hitLog 中存在 normal_shot（命中①）',   hit1 != null, true);
  eq('ZW1.2  hitLog 中存在 normal_shot_2（命中②）',  hit2 != null, true);
  eq('ZW1.3  两次命中发生在同一 tick', hit1 != null && hit2 != null && hit1.tick === hit2.tick, true);
}

// ─── ZW2/ZW3/ZW4：伤害差异验证（critRate=1，deterministic）────────────────────

section('ZW2-ZW4 — 命中①/② 伤害差异（critRate=1）');
{
  // 预期计算（lv10，critRate=1，enemyDef=0，距离 NEAR，Iron vs Iron）：
  //   baseDamage   = 100000 * (50.69/100) = 50690
  //   commonMult   = 1 + 0.5(crit) + 0.5(fullBurst) = 2.0
  //   chargeMult   = 30000/10000 = 3.0
  //   base = 50690 * 2.0 * 3.0 = 304140
  //
  //   命中① pierce：burst_pierce(0.2503) + pierce1r(0.2013) + pierce10s(0.1006) = 0.5522
  //   damage1 = floor(304140 * 1.5522) = 472086
  //
  //   命中② pierce：burst_pierce(0.2503) + pierce10s(0.1006) + pierce_stack(0.2499) = 0.6008
  //   damage2 = floor(304140 * 1.6008) = 486867
  const EXPECTED_DMG1 = 472086;
  const EXPECTED_DMG2 = 486867;

  const state = runUntilDoubleHit({ critRate: 1.0 });
  const hit2  = state.hitLog.find(h => h.label === 'normal_shot_2' && h.unitId === 390);
  const hit1  = state.hitLog.find(h => h.label === 'normal_shot'   && h.unitId === 390 && h.tick === hit2?.tick);

  eq('ZW2.1  命中① isCrit=true', hit1?.isCrit, true);
  eq('ZW3.1  命中② isCrit=true', hit2?.isCrit, true);
  near('ZW2.2  命中① 伤害 ≈ 472086（含 pierce1r+pierce10s+burst_pierce）',
    hit1?.damage ?? 0, EXPECTED_DMG1, 1);
  near('ZW3.2  命中② 伤害 ≈ 486867（含 pierce_stack+pierce10s+burst_pierce）',
    hit2?.damage ?? 0, EXPECTED_DMG2, 1);
  eq('ZW4    命中② 伤害 > 命中①（pierce_stack > pierce1r）',
    (hit2?.damage ?? 0) > (hit1?.damage ?? 0), true);
}

// ─── ZW5：buff 状态——pierce1r 消耗，pierce_stack 保留 ──────────────────────────

section('ZW5 — buff 状态：pierce1r 消耗，pierce_stack roundsLeft=1 保留');
{
  const state       = runUntilDoubleHit();
  const pierce1r    = state.buffs.find(b => b.name === 'zwei_s1_pierce1r');
  const pierceStack = state.buffs.find(b => b.name === 'zwei_s1_pierce_stack');

  // pierce1r 的 roundsLeft 应已变为 0（已被消耗），buff 对象可能仍在数组中（仅 roundsLeft=0）
  const pierce1rConsumed = pierce1r == null || (pierce1r.roundsLeft ?? 0) <= 0;
  eq('ZW5.1  pierce1r 已被消耗（roundsLeft=0 或已移除）', pierce1rConsumed, true);

  // pierce_stack 在本次射击后应保留 roundsLeft=1，供下一发消耗
  eq('ZW5.2  pierce_stack 存在于 buffs',                    pierceStack != null, true);
  eq('ZW5.3  pierce_stack roundsLeft=1（留至下一发再消耗）', pierceStack?.roundsLeft, 1);
}

// ─── ZW6：critRate=0 时两次命中均不暴击 ────────────────────────────────────────

section('ZW6 — critRate=0（无 skill2 暴击率 buff）：两次命中均不暴击');
{
  // includeSkill2=false：禁止 S2 P2（ENTER_FULL_BURST 暴击率 buff）和 S2 P3（Pierce Attacks 101 暴击叠层），
  // 排除非确定性暴击因素，确保 critRate=0 时两次命中绝对不暴击。
  const state = runUntilDoubleHit({ critRate: 0 }, false);
  const hit2  = state.hitLog.find(h => h.label === 'normal_shot_2' && h.unitId === 390);
  const hit1  = state.hitLog.find(h => h.label === 'normal_shot'   && h.unitId === 390 && h.tick === hit2?.tick);
  eq('ZW6.1  命中① isCrit=false', hit1?.isCrit, false);
  eq('ZW6.2  命中② isCrit=false', hit2?.isCrit, false);
}

// ─── ZW7：Zwei hitCount 包含两次命中 ───────────────────────────────────────────

section('ZW7 — Zwei hitCount 包含两次命中');
{
  const state    = runUntilDoubleHit();
  const zweiUnit = state.squad.find(u => u.id === 390);
  // 武器切换 SR 仅有 1 发弹匣，但该发贡献 hitCount += 2
  eq('ZW7    Zwei hitCount ≥ 2（SR 武器切换一击记录两次）', (zweiUnit?.hitCount ?? 0) >= 2, true);
}

summary('Zwei 双重命中测试');
