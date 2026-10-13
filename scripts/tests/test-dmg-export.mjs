/**
 * 伤害公式导出（src/ui/dmg-formula-export.js）回归测试 — 纯函数，无 I/O。
 *
 * 做法：用引擎 calcDamage 算出一次命中的伤害，按引擎 hitLog 口径构造命中记录，
 * 导出为计算器格式后用 scripts/lib/dmg-calc-eval.mjs 按计算器语义重算，二者应一致（±1 取整误差）。
 * 覆盖：武器（暴击 / 核心 / 全爆 / 距离 / 降防 / 珍藏品普攻倍率 / 优越代码魔方）、蓄力、
 *       技能真实伤害（无视防御 0 值项）、持续 / 分摊、SG 弹丸分类优先级、零件伤害、中文键名本地化。
 *
 * Run: node scripts/tests/test-dmg-export.mjs
 */

import { calcDamage } from '../../src/engine/damage.js';
import { buildDmgFormulaExport } from '../../src/ui/dmg-formula-export.js';
import { evalCalcExport } from '../lib/dmg-calc-eval.mjs';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

const exportEn = h => buildDmgFormulaExport(h, { lang: 'en' });
const types = obj => obj.coeffs.map(c => c.type);

// ── T1: 武器伤害（AR）全乘区 ─────────────────────────────────────────────
section('T1 weapon hit: crit / core / FB / distance / def down / elem cube');
{
  const bufs = [
    { name: 'S1 ATK',      atkPct: 0.35 },
    { name: 'Caster ATK',  atkFlat: 8000 },
    { name: 'Crit Buff',   critDamagePct: 0.30 },
    { name: 'Core Buff',   coreDamagePct: 0.20 },
    { name: 'NA Mult',     normalAttackDamageMultPct: 0.10 },
    { name: 'Elem Buff',   elementAdvantagePct: 0.15 },
    { name: 'Atk Dmg',     attackDamagePct: 0.25 },
    { name: 'Vuln', damageTakenPct: 0.20, isEnemyDebuff: true },
  ];
  const input = {
    atk: 50000, atkMultiplier: 1 + 0.35 + 0.05, otherAtkIncrement: 8000 + 1200,
    enemyDef: 1000, defMultiplier: 0.8, hitMultiplier: 0.0972, weaponType: 'AR',
    isCrit: true, critDmgIncrement: 0.12 + 0.30, hitPart: 'core', coreDmgIncrement: 0.20,
    distanceAdvantage: true, isFullBurst: true,
    attackerElement: 'Fire', defenderElement: 'Wind', elementAdvantageDmgIncrement: 0.1909 + 0.05 + 0.15,
    favNormalAttackDamageMult: 1 + 0.0954 + 0.10,
    extra: { attackDamageMult: 0.25 }, damageTakenMult: 0.20,
  };
  const { damage, breakdown } = calcDamage(input);
  const h = {
    unitId: 0, ammoBeforeShot: 30,
    atk: 50000, atkPct: 0.40, atkFlat: 9200, enemyDef: 800, enemyBaseDef: 1000,
    hitMult: 0.0972, favNormalAttackDamageMult: input.favNormalAttackDamageMult,
    isCrit: true, critDmgInc: 0.42, isCore: true, coreDmgIncrement: 0.20,
    isFullBurst: true, distanceAdv: true,
    elemMult: breakdown.elemMult, elementDmgPct: 0.2409, equipElementDmgPct: 0.05,
    chargeMult: 1, attackDamagePct: 0.25, damageTakenPct: 0.20, damage, buffBreakdown: bufs,
  };
  const obj = exportEn(h);
  eq('damageType', obj.damageType, 'weapon');
  eq('weaponDmg', obj.weaponDmg, 9.72);
  eq('enemyBaseDef', obj.enemyBaseDef, 1000);
  eq('defReduction 20%', obj.coeffs.find(c => c.type === 'defReduction')?.value, 20);
  eq('cube variant value', obj.coeffs.find(c => c.variant === 'cube')?.value, 19.09);
  eq('fav normal mult residual', obj.coeffs.find(c => c.type === 'collectibleNormalAtkMult')?.value, 9.54);
  const coreBase = obj.coeffs.find(c => c.type === 'coreDmg' && c.variant === 'base');
  eq('core base variant 200 (core_damage_rate 20000)', coreBase?.value, 200);
  eq('core base has no name', coreBase?.name, undefined);
  eq('crit base variant', obj.coeffs.find(c => c.type === 'critDmg')?.variant, 'base');
  eq('zh core base 子项', buildDmgFormulaExport(h, { lang: 'zh' })['系数'].find(c => c['类型'] === '核心伤害')?.['子项'], '基础');
  eq('fullBurst / distance', ['fullBurst', 'distance'].every(t => types(obj).includes(t)), true);
  near('calculator damage == engine damage', evalCalcExport(obj), damage, 1);
}

// ── T1b: 核心 250 档（core_damage_rate 25000 → 单位级增量 0.5）────────────────
section('T1b core base 250');
{
  const bufs = [{ name: 'Core Buff', coreDamagePct: 0.40 }];
  const input = { atk: 40000, enemyDef: 500, hitMultiplier: 1.2, hitPart: 'core', coreDmgIncrement: 0.5 + 0.40 };
  const { damage } = calcDamage(input);
  const h = { ammoBeforeShot: 5, atk: 40000, atkPct: 0, atkFlat: 0, enemyDef: 500, enemyBaseDef: 500,
    hitMult: 1.2, isCore: true, coreDmgIncrement: 0.90, damage, buffBreakdown: bufs };
  const obj = exportEn(h);
  const core = obj.coeffs.filter(c => c.type === 'coreDmg');
  eq('core base 250', core.find(c => c.variant === 'base')?.value, 250);
  eq('core entries: base + buff', core.length, 2);
  near('calculator damage == engine damage', evalCalcExport(obj), damage, 1);
}

// ── T2: 蓄力武器（SR）─────────────────────────────────────────────────────
section('T2 charged SR hit');
{
  const bufs = [
    { name: 'Charge Mult', chargeDamageMultPct: 0.30 },
    { name: 'Charge Dmg',  chargeDamagePct: 0.20 },
  ];
  const input = {
    atk: 40000, enemyDef: 500, hitMultiplier: 0.8, weaponType: 'SR', isCharged: true,
    fullChargeDamage: 25000, favChargeDmgPct: 0.165, chargeDmgMultPct: 0.30, chargeDmgStat: 1 + 0.10 + 0.20,
  };
  const { damage, breakdown } = calcDamage(input);
  const h = {
    ammoBeforeShot: 6, atk: 40000, atkPct: 0, atkFlat: 0, enemyDef: 500, enemyBaseDef: 500,
    hitMult: 0.8, chargeMult: breakdown.chargeMult, equipChargeDmgPct: 0.10, favChargeDmgPct: 0.165,
    damage, buffBreakdown: bufs,
  };
  const obj = exportEn(h);
  eq('weaponBaseCharge 250', obj.coeffs.find(c => c.type === 'weaponBaseCharge')?.value, 250);
  eq('no defReduction', types(obj).includes('defReduction'), false);
  near('calculator damage == engine damage', evalCalcExport(obj), damage, 1);
}

// ── T3: 技能真实伤害 / 持续 / 分摊 / 技能普攻倍率并入 skillDmg ──────────────
section('T3 skill hit: true damage, sustained, distributed');
{
  const bufs = [
    { name: 'DoT Up',  sustainedDamagePct: 0.12 },
    { name: 'Shared',  distributedDamagePct: 0.05 },
    { name: 'NA Mult', normalAttackDamageMultPct: 0.20 },
  ];
  const input = {
    atk: 30000, enemyDef: 2000, hitMultiplier: 2.5, isTrueDamage: true,
    favNormalAttackDamageMult: 1.2,
    extra: { sustainedDamagePct: 0.12 }, damageTakenMult: 0.10 + 0.05,
  };
  const { damage } = calcDamage(input);
  const h = {
    atk: 30000, atkPct: 0, atkFlat: 0, enemyDef: 0, enemyBaseDef: 2000, isTrueDamage: true, trueDamagePct: 0,
    hitMult: 2.5, favNormalAttackDamageMult: 1.2, sustainedDamagePct: 0.12,
    damageTakenPct: 0.15, distributedDamagePct: 0.05, damage, buffBreakdown: bufs,
  };
  const obj = exportEn(h);
  eq('damageType', obj.damageType, 'skill');
  eq('skillDmg folds NA mult', obj.skillDmg, 300);
  eq('no collectibleNormalAtkMult on skill', types(obj).includes('collectibleNormalAtkMult'), false);
  eq('ignoreDefDmg 0 present', obj.coeffs.find(c => c.type === 'ignoreDefDmg')?.value, 0);
  eq('sharedDmg 5', obj.coeffs.find(c => c.type === 'sharedDmg')?.value, 5);
  eq('enemyDmgTaken residual 10', obj.coeffs.find(c => c.type === 'enemyDmgTaken')?.value, 10);
  near('calculator damage == engine damage', evalCalcExport(obj), damage, 1);
}

// ── T4: SG 弹丸分类 → 按优先级只导出一类 ───────────────────────────────────
section('T4 SG pellet group priority: crit+core > core > crit > normal');
{
  const perPellet = 0.1;
  const base = { atk: 20000, enemyDef: 300, weaponType: 'SG' };
  const gNormal = { isCrit: false, isCore: false, count: 5 };
  const gCrit   = { isCrit: true,  isCore: false, count: 3 };
  const gCore   = { isCrit: false, isCore: true,  count: 2 };
  const gBoth   = { isCrit: true,  isCore: true,  count: 1 };
  const dmgOf = g => calcDamage({ ...base, hitMultiplier: perPellet * g.count, isCrit: g.isCrit,
    hitPart: g.isCore ? 'core' : 'body' }).damage;
  const mkHit = groups => ({
    ammoBeforeShot: 9, atk: 20000, atkPct: 0, atkFlat: 0, enemyDef: 300, enemyBaseDef: 300,
    hitMult: 1.1, pelletHitMult: perPellet, critDmgInc: 0, buffBreakdown: [],
    pelletGroups: groups.map(g => ({ ...g, damage: dmgOf(g), coreDmgIncrement: 0 })),
  });
  const cases = [
    ['all four → crit+core', [gNormal, gCrit, gCore, gBoth], gBoth],
    ['no crit+core → core',  [gNormal, gCrit, gCore],        gCore],
    ['crit + normal → crit', [gNormal, gCrit],               gCrit],
    ['normal only',          [gNormal],                      gNormal],
  ];
  // 导出只算单颗弹丸：伤害系数 = 每弹丸系数（不乘弹丸数），伤害 = 该类单颗弹丸伤害
  for (const [label, groups, want] of cases) {
    const obj = exportEn(mkHit(groups));
    eq(`${label}: single object`, Array.isArray(obj), false);
    near(`${label}: weaponDmg (per pellet)`, obj.weaponDmg, perPellet * 100, 1e-6);
    near(`${label}: damage (one pellet)`, evalCalcExport(obj), dmgOf({ ...want, count: 1 }), 1);
    eq(`${label}: crit/core of chosen group`,
      obj.coeffs.some(c => c.type === 'critDmg') === want.isCrit && obj.coeffs.some(c => c.type === 'coreDmg') === want.isCore, true);
  }
}

// ── T4b: 零件伤害（零件核心敌人的核心命中；SG 非核心类剔除）──────────────────
section('T4b parts damage');
{
  const bufs = [{ name: 'Parts Up', damageToPartsPct: 0.30 }];
  const input = { atk: 30000, enemyDef: 500, hitMultiplier: 0.5, hitPart: 'core', coreIsParts: true,
    extra: { damageToPartsMult: 0.30 } };
  const { damage } = calcDamage(input);
  const h = { ammoBeforeShot: 3, atk: 30000, atkPct: 0, atkFlat: 0, enemyDef: 500, enemyBaseDef: 500,
    hitMult: 0.5, isCore: true, coreDmgIncrement: 0, damageToPartsPct: 0.30, damage, buffBreakdown: bufs };
  const obj = exportEn(h);
  const parts = obj.coeffs.filter(c => c.type === 'partsDmg');
  eq('partsDmg entry', parts.length === 1 && parts[0].name === 'Parts Up' && parts[0].value, 30);
  near('calculator damage == engine damage', evalCalcExport(obj), damage, 1);

  // SG：只有仅暴击类时（非核心），零件加成不生效、不导出
  const sg = { ...h, pelletHitMult: 0.05, pelletGroups: [{ isCrit: true, isCore: false, count: 4, damage: 1, coreDmgIncrement: 0 }] };
  eq('SG non-core group: no partsDmg', exportEn(sg).coeffs.some(c => c.type === 'partsDmg'), false);
  eq('zh type name', buildDmgFormulaExport(h, { lang: 'zh' })['系数'].some(c => c['类型'] === '零件伤害'), true);
}

// ── T4c: 双枪（hitLog.dualGunMult = 2，hitMult 已含 ×2）─────────────────────
section('T4c dual gun: weaponDmg excludes ×2, dualGun coeff exported');
{
  const input = { atk: 30000, enemyDef: 800, hitMultiplier: 0.0506 * 2, weaponType: 'SMG', isCrit: true };
  const { damage } = calcDamage(input);
  const h = {
    ammoBeforeShot: 50, atk: 30000, atkPct: 0, atkFlat: 0, enemyDef: 800, enemyBaseDef: 800,
    hitMult: 0.0506 * 2, dualGunMult: 2, isCrit: true, critDmgInc: 0, damage, buffBreakdown: [],
  };
  const obj = exportEn(h);
  eq('weaponDmg is base (5.06)', obj.weaponDmg, 5.06);
  eq('dualGun coeff present once', obj.coeffs.filter(c => c.type === 'dualGun').length, 1);
  eq('zh dualGun type name', buildDmgFormulaExport(h, { lang: 'zh' })['系数'].some(c => c['类型'] === '双枪'), true);
  near('calculator damage == engine damage', evalCalcExport(obj), damage, 1);
  eq('no dualGun without dualGunMult', types(exportEn({ ...h, dualGunMult: undefined })).includes('dualGun'), false);
}

// ── T5: 中文键名 ──────────────────────────────────────────────────────────
section('T5 zh localization');
{
  const h = {
    ammoBeforeShot: 1, atk: 1000, atkPct: 0.1, atkFlat: 0, enemyDef: 0, enemyBaseDef: 0, hitMult: 1,
    isCrit: true, critDmgInc: 0, elemMult: 1.2909, elementDmgPct: 0.1909, equipElementDmgPct: 0, buffBreakdown: [],
  };
  const obj = buildDmgFormulaExport(h, { lang: 'zh' });
  eq('伤害类型', obj['伤害类型'], '武器');
  eq('基本武器伤害系数', obj['基本武器伤害系数'], 100);
  eq('首项类型', obj['系数'][0]['类型'], '攻击力（百分比）');
  eq('首项名称', obj['系数'][0]['名称'], '装备');
  const critBase = obj['系数'].find(c => c['类型'] === '暴击伤害');
  eq('暴击基础子项', critBase?.['子项'], '基础');
  eq('暴击基础不写名称 / 数值（计算器固定为「基础暴击」50%）', critBase?.['名称'] === undefined && critBase?.['数值'] === undefined, true);
  eq('魔方子项', obj['系数'].find(c => c['子项'] === '魔方')?.['数值'], 19.09);
}

summary('DmgExport');
