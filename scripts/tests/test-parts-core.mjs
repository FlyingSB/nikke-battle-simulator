/**
 * 零件核心（PARTS_CORE）敌人核心状态回归测试。
 *
 * 零件核心仅出现于 Black Smith（铁匠）/ Material H（秘材H）/ Storm Bringer（岚灾）：
 *   · 核心为无限血量零件，核心命中同时受核心伤害与零件伤害（damageToPartsPct）加成；
 *   · 穿透命中核心：额外结算一次纯本体伤害（不吃核心/零件加成）；
 *   · 爆炸（RL 普攻）命中只结算一次，即便带穿透也不追加本体伤害。
 *
 * 测试编号：
 *   PC1  非穿透命中核心：伤害 = 暴露核心 × (1 + 零件加成)，无额外本体行
 *   PC2  穿透命中核心：核心行吃零件加成 + 额外 _pierce_body 本体行（不吃零件加成）
 *   PC3  RL 穿透命中零件核心：不追加本体伤害
 *   PC4  核心行动在战斗中切换到 PARTS_CORE 时，状态标志正确设置
 *
 * Run: node scripts/tests/test-parts-core.mjs
 */

import { initBattle, tick } from '../../src/engine/battle.js';
import { pushBuff } from '../../src/engine/battle-utils.js';
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

/**
 * 运行至首个普攻命中出现，返回该 tick 该单位的全部命中行。
 * @param {object} enemyOverrides  敌人配置覆盖（coreIsParts / corePierceDual 等）
 * @param {object} buff            额外全队 buff（pierce / damageToPartsPct）
 * @param {string} weaponType
 */
function firstShotRows(enemyOverrides, buff, weaponType = 'SR') {
  const state = initBattle({
    squad: [dummyUnit(weaponType, 'Step1'), dummyUnit('SR', 'Step2'), dummyUnit('SR', 'Step3')],
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
  const dual      = firstShotRows({ corePierceDual: true }, buff);
  const partsCore = firstShotRows({ coreIsParts: true }, buff);
  const coreRow  = partsCore.find(r => r.label === 'normal_shot');
  const bodyRow  = partsCore.find(r => r.label.endsWith('_pierce_body'));
  const dualCore = dual.find(r => r.label === 'normal_shot');
  const dualBody = dual.find(r => r.label.endsWith('_pierce_body'));
  eq('PC2: 存在核心行', coreRow?.isCore, true);
  eq('PC2: 存在额外本体行', bodyRow?.hitPart, 'body');
  near('PC2: 核心行 = 穿透双判核心行 × 1.5（零件加成）', coreRow?.damage / dualCore?.damage, 1.5, 1e-3);
  eq('PC2: 本体行不吃零件加成（与穿透双判一致）', bodyRow?.damage, dualBody?.damage);
}

section('PC3 — RL 穿透命中零件核心：爆炸只结算一次');
{
  const rows = firstShotRows({ coreIsParts: true }, { ...PARTS_BUFF, pierce: true }, 'RL');
  eq('PC3: RL 命中核心', rows[0]?.isCore, true);
  eq('PC3: 无额外本体行', rows.some(r => r.label.endsWith('_pierce_body')), false);
}

section('PC4 — 核心行动切换到 PARTS_CORE');
{
  const state = initBattle({
    squad: [dummyUnit('SR', 'Step1'), dummyUnit('SR', 'Step2'), dummyUnit('SR', 'Step3')],
    enemy: { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', distance: 'NEAR', hasCore: false,
             coreActions: [{ startTick: 5, value: 'PARTS_CORE' }] },
  });
  for (let t = 0; t < 10; t++) tick(state);
  eq('PC4: enemyHasCore', state.enemyHasCore, true);
  eq('PC4: enemyCoreIsParts', state.enemyCoreIsParts, true);
  eq('PC4: enemyCorePierceDual', state.enemyCorePierceDual, true);
  eq('PC4: enemyCoreProtected', state.enemyCoreProtected, false);
}

summary('Parts-core tests');
