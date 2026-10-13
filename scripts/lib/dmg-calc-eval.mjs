/**
 * 「Nikke 伤害计算器」导入格式求值器（仅英文内部键）— 用于校验 src/ui/dmg-formula-export.js 的导出结果。
 * 按计算器格式说明的语义计算伤害，供 scripts/tests/test-dmg-export.mjs 与浏览器内批量核对使用。
 *
 * 伤害 = floor( max(0, ATK − DEF) × 伤害系数 × 通用 × 优越代码 × 蓄力 × 伤害加成 × 易伤 )
 */

const FIXED = { fullBurst: 50, distance: 30 };
const VARIANT_BASE = { critDmg: 50, attributeDmg: 10 };
const EXTRA_TYPES = ['dmgIncrease', 'penetrationDmg', 'continuousAttackDmg', 'dotDmg', 'ignoreDefDmg',
  'projectileAttachDmg', 'projectileExplosionDmg', 'partsDmg'];

/**
 * @param {object} obj  计算器对象（英文键）
 * @returns {number}
 */
export function evalCalcExport(obj) {
  const cs = (obj.coeffs ?? []).filter(c => !c.hidden);
  // base 子项：暴击 / 优越代码为固定值，核心基础子项取 value（200 / 250）
  const val = c => FIXED[c.type] ?? (c.variant === 'base' ? VARIANT_BASE[c.type] : undefined) ?? c.value ?? 0;
  const of  = (...types) => cs.filter(c => types.includes(c.type));
  const sum = (...types) => of(...types).reduce((s, c) => s + val(c), 0) / 100;

  const atk = obj.baseAtk * (1 + sum('atkIncrease')) + of('extraAtk').reduce((s, c) => s + c.value, 0);
  const def = of('ignoreDefDmg').length ? 0 : (obj.enemyBaseDef ?? 0) * Math.max(0, 1 - sum('defReduction'));
  // 双枪：武器与技能伤害系数均 ×200%（固定值，限 1 个）
  const dualGun = of('dualGun').length ? 2 : 1;
  const hit = (obj.damageType === 'weapon'
    ? obj.weaponDmg / 100 * (1 + sum('collectibleNormalAtkMult'))
    : obj.skillDmg / 100) * dualGun;

  // 存在核心伤害项（含基础核心子项 200 / 250）时，核心项之和取代基础 100%
  let common = of('coreDmg').length ? sum('coreDmg') : 1;
  if (of('critDmg').length) common += sum('critDmg');
  common += sum('fullBurst', 'distance');

  const elem   = of('attributeDmg').length ? 1 + sum('attributeDmg') : 1;
  const base   = sum('weaponBaseCharge');
  const charge = base > 0 ? base * (1 + sum('collectibleChargeIncrease')) + sum('chargeDmgIncrease') : 1;
  const extra  = 1 + sum(...EXTRA_TYPES);
  const taken  = 1 + sum('enemyDmgTaken', 'sharedDmg');

  return Math.floor(Math.max(0, atk - def) * hit * common * elem * charge * extra * taken);
}
