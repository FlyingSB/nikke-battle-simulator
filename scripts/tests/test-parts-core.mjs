/**
 * 零件核心（PARTS_CORE）敌人核心状态回归测试。
 *
 * 零件核心仅出现于 Ultra（过激派）/ Material H（秘材H）/ Storm Bringer（岚灾）：
 *   · 核心为无限血量零件，核心命中同时受核心伤害与零件伤害（damageToPartsPct）加成；
 *   · 核心命中同时视作零件命中：CORE_HIT / PARTS_HIT 类触发与条件均生效；
 *   · 穿透命中核心：额外结算一次纯本体伤害（不吃核心/零件加成）；
 *   · 爆炸命中只结算一次（游戏中穿透仅见于 SG / SR 类武器，不存在穿透 RL）。
 *
 * 测试编号：
 *   PC1  非穿透命中核心：伤害 = 暴露核心 × (1 + 零件加成)，无额外本体行
 *   PC2  穿透命中核心：核心行吃零件加成 + 额外 _pierce_body 本体行（纯本体伤害）
 *   PC3  核心命中同时触发 CORE_HIT 与 PARTS_HIT，IS_PARTS_HIT / IS_CORE_HIT 条件成立
 *   PC4  核心行动在战斗中切换到 PARTS_CORE 时，状态标志正确设置
 *   PC5  isPartsHit 判定助手
 *
 * Run: node scripts/tests/test-parts-core.mjs
 */

import { initBattle, tick } from '../../src/engine/battle.js';
import { pushBuff, isPartsHit } from '../../src/engine/battle-utils.js';
import { onShotFired } from '../../src/engine/skill-executor.js';
import { SKILL_TRAITS } from '../../src/data/skill-traits.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

let _nextId = 92000;

/** 精准武器 dummy（无散布数据 → 恒核心命中），无技能文件。 */
function dummyUnit(weaponType, burstStep) {
  return {
    characterId:              _nextId++,
    name:                     `Dummy-${weaponType}-${burstStep}`,
    element:                  'Iron',
    weaponType,
    burstStep,
    nativeBurstStep:          burstStep,
    _nikkeData:               { shot_detail: { reload_bullet: 10000 } },
    _computedStats:           { atk: 10_000, hp: 1_000_000, def: 500, critRate: 0, critDmg: 0.5 },
    targetBurstEnergyPerShot: 0,
    burstEnergyPerShot:       0,
    burstSkillCooltime:       0,
    baseAmmo:                 30,
    reloadTicks:              120,
    shotDamageMult:           1.0,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    rateOfFire:               600,
  };
}

function makeSquad() {
  return [dummyUnit('SR', 'Step1'), dummyUnit('SR', 'Step2'), dummyUnit('SR', 'Step3')];
}

/**
 * 运行至首个普攻命中出现，返回该 tick 该单位的全部命中行。
 * @param {object} enemyOverrides  敌人配置覆盖（coreIsParts 等）
 * @param {object} buff            额外全队 buff（pierce / damageToPartsPct）
 */
function firstShotRows(enemyOverrides, buff) {
  const state = initBattle({
    squad: makeSquad(),
    enemy: { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', distance: 'NEAR',
             hasCore: true, ...enemyOverrides },
    hitLog: true,
  });
  const unitId = state.squad[0].id;
  pushBuff(state, { name: 'TestBuff', unitId: null, endTick: Infinity, ...buff });
  for (let t = 0; t < 600; t++) {
    const { over } = tick(state);
    if (over) break;
    const first = state.hitLog.find(h => h.unitId === unitId && h.label === 'normal_shot');
    if (first) return state.hitLog.filter(h => h.unitId === unitId && h.tick === first.tick);
  }
  return [];
}

const PARTS_BUFF = { damageToPartsPct: 0.5 };

section('PC1 — 非穿透命中零件核心：核心伤害 × (1 + 零件加成)');
{
  const exposed   = firstShotRows({}, PARTS_BUFF);
  const partsCore = firstShotRows({ coreIsParts: true }, PARTS_BUFF);
  eq('PC1: 暴露核心命中核心', exposed[0]?.isCore, true);
  eq('PC1: 零件核心命中核心', partsCore[0]?.isCore, true);
  near('PC1: 零件核心伤害 = 暴露核心 × 1.5', partsCore[0]?.damage / exposed[0]?.damage, 1.5, 1e-3);
  eq('PC1: 非穿透无额外本体行', partsCore.some(r => r.label.endsWith('_pierce_body')), false);
}

section('PC2 — 穿透命中零件核心：核心伤害（含零件加成）+ 纯本体伤害');
{
  const buff = { ...PARTS_BUFF, pierce: true };
  const exposed   = firstShotRows({}, buff);
  const partsCore = firstShotRows({ coreIsParts: true }, buff);
  const exposedCore = exposed.find(r => r.label === 'normal_shot');
  const coreRow     = partsCore.find(r => r.label === 'normal_shot');
  const bodyRow     = partsCore.find(r => r.label.endsWith('_pierce_body'));
  eq('PC2: 暴露核心穿透无额外本体行', exposed.some(r => r.label.endsWith('_pierce_body')), false);
  eq('PC2: 零件核心核心行', coreRow?.isCore, true);
  eq('PC2: 零件核心额外本体行', bodyRow?.hitPart, 'body');
  near('PC2: 核心行 = 暴露核心 × 1.5（零件加成）', coreRow?.damage / exposedCore?.damage, 1.5, 1e-3);
  // 暴露核心行 = 本体 × 2（核心 +100%）；零件核心本体行不吃核心/零件加成
  near('PC2: 本体行 = 暴露核心行 / 2（纯本体）', bodyRow?.damage / exposedCore?.damage, 0.5, 1e-3);
}

section('PC3 — 零件核心的核心命中同时触发 CORE_HIT 与 PARTS_HIT');
{
  const TEST_ID = 92999;
  const fired = [];
  SKILL_TRAITS[TEST_ID] = {
    skill1: { triggers: [
      { on: 'CORE_HIT',  handler: () => fired.push('CORE_HIT') },
      { on: 'PARTS_HIT', handler: () => fired.push('PARTS_HIT') },
      { on: 'SHOT_COUNT', conditions: [{ type: 'IS_PARTS_HIT' }], handler: () => fired.push('IS_PARTS_HIT') },
      { on: 'SHOT_COUNT', conditions: [{ type: 'IS_CORE_HIT' }],  handler: () => fired.push('IS_CORE_HIT') },
    ] },
  };
  const unit  = { id: TEST_ID, skillState: {} };
  const shot  = (enemyCoreIsParts, hitPart) => {
    fired.length = 0;
    const state = { tick: 0, buffs: [], squad: [unit], enemyCoreIsParts };
    onShotFired(state, unit, { sums: {}, isCharged: false, hitPart, ammoAfterShot: 5 });
    return [...fired].sort().join(',');
  };
  try {
    eq('PC3: 零件核心 × 核心命中 → 四者全触发', shot(true, 'core'),
      'CORE_HIT,IS_CORE_HIT,IS_PARTS_HIT,PARTS_HIT');
    eq('PC3: 普通核心 × 核心命中 → 仅核心', shot(false, 'core'), 'CORE_HIT,IS_CORE_HIT');
    eq('PC3: 零件核心 × 本体命中 → 均不触发', shot(true, 'body'), '');
  } finally {
    delete SKILL_TRAITS[TEST_ID];
  }
}

section('PC4 — 核心行动切换到 PARTS_CORE');
{
  const state = initBattle({
    squad: makeSquad(),
    enemy: { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', distance: 'NEAR', hasCore: false,
             coreActions: [{ startTick: 5, value: 'PARTS_CORE' }, { startTick: 8, value: 'EXPOSED' }] },
  });
  for (let t = 0; t < 6; t++) tick(state);
  eq('PC4: enemyHasCore', state.enemyHasCore, true);
  eq('PC4: enemyCoreIsParts', state.enemyCoreIsParts, true);
  eq('PC4: enemyCoreProtected', state.enemyCoreProtected, false);
  for (let t = 0; t < 4; t++) tick(state);
  eq('PC4: 切回 EXPOSED 后 enemyCoreIsParts', state.enemyCoreIsParts, false);
}

section('PC5 — isPartsHit 判定助手');
{
  eq('PC5: parts',               isPartsHit({}, 'parts'), true);
  eq('PC5: core（普通核心）',     isPartsHit({}, 'core'), false);
  eq('PC5: core（零件核心）',     isPartsHit({ enemyCoreIsParts: true }, 'core'), true);
  eq('PC5: body（零件核心）',     isPartsHit({ enemyCoreIsParts: true }, 'body'), false);
}

summary('Parts-core tests');
