/**
 * 伤害公式导出 — 把单次命中记录（hitLog 条目）转换为「Nikke 伤害计算器」导入格式（JSON）。
 * 由 store.copyDmgFormula 调用（点击详细日志的伤害数字）。
 *
 * 格式要点：
 * - 顶层 baseAtk / enemyBaseDef / damageType / weaponDmg|skillDmg / coeffs；
 * - 百分比类数值写百分数（35 表示 35%）；
 * - 界面为中文时键名、type、variant、damageType 使用中文显示名，英文时使用内部键。
 *
 * 与引擎乘区的对应（src/engine/damage.js）：
 *   atkMultiplier → atkIncrease；otherAtkIncrement → extraAtk；DEF 降低 → defReduction；
 *   普攻伤害倍率（珍藏品 + 技能同乘区）→ collectibleNormalAtkMult（仅武器伤害，技能伤害并入 skillDmg）；
 *   双枪（hitLog.dualGunMult，武器伤害系数 ×2）→ dualGun；
 *   CommonMultiplier → critDmg / coreDmg / fullBurst / distance；ElementMultiplier → attributeDmg；
 *   ChargeDamageMultiplier → weaponBaseCharge / collectibleChargeIncrease / chargeDmgIncrease；
 *   ExtraMultiplier → dmgIncrease / penetrationDmg / continuousAttackDmg / dotDmg / ignoreDefDmg / partsDmg；
 *   DamageTakenLikeMultiplier → enemyDmgTaken / sharedDmg。
 */
import { translate } from './i18n.js';

const _EPS = 0.0001;
// 计算器魔方优越代码子项只接受以下数值（%）
const _CUBE_ELEM_VALUES = [8.48, 10.6, 12.72, 14.84, 16.96, 19.09];
// 计算器武器基本蓄力伤害只接受以下数值（%）
const _WEAPON_CHARGE_VALUES = [100, 150, 200, 250, 350];
/** 贴合计算器菜单值（误差 tol 内取列表值，否则保留原值） */
const _snap = (v, list, tol) => list.find(x => Math.abs(x - v) < tol) ?? v;

/** 顶层 / 系数项键名的中文显示名 */
const _ZH_KEYS = {
  baseAtk: '基础攻击力', enemyBaseDef: '敌人基础防御力', damageType: '伤害类型',
  weaponDmg: '基本武器伤害系数', skillDmg: '技能伤害系数', coeffs: '系数',
  type: '类型', variant: '子项', name: '名称', value: '数值', hidden: '隐藏',
};

/** 系数 type 的中文显示名 */
export const ZH_TYPE_NAMES = {
  atkIncrease: '攻击力（百分比）', extraAtk: '攻击力（值）', defReduction: '防御力降低（百分比）',
  collectibleNormalAtkMult: '普通攻击倍率（珍藏品）', dualGun: '双枪', stackCopy: '叠加复制',
  critDmg: '暴击伤害', coreDmg: '核心伤害', fullBurst: '全爆裂补正', distance: '优势距离',
  attributeDmg: '优越代码伤害增加',
  weaponBaseCharge: '武器基本蓄力伤害', collectibleChargeIncrease: '蓄力伤害倍率（珍藏品）',
  chargeDmgIncrease: '蓄力伤害',
  dmgIncrease: '攻击伤害', penetrationDmg: '穿透伤害', continuousAttackDmg: '依次攻击伤害',
  dotDmg: '持续伤害', ignoreDefDmg: '无视防御力伤害',
  projectileAttachDmg: '发射体附着伤害', projectileExplosionDmg: '发射体爆炸伤害', partsDmg: '零件伤害',
  enemyDmgTaken: '敌人受到伤害', sharedDmg: '分摊伤害',
};

const _ZH_VARIANTS  = { base: '基础', cube: '魔方' };
const _ZH_DMG_TYPES = { weapon: '武器', skill: '技能' };

/** 比例（小数）→ 百分数，保留 4 位小数去掉浮点噪声 */
const _pct = v => Math.round(v * 1e6) / 1e4;
const _num = v => Math.round(v * 1e4) / 1e4;
const _nz  = v => Math.abs(v ?? 0) > _EPS;
const _sum = (arr, key) => arr.reduce((s, b) => s + (b[key] ?? 0), 0);

/** 命中记录是否为武器（普通射击）伤害：只有普通射击日志带 ammoBeforeShot（battle.js 射击分支写入） */
export function isWeaponHit(h) {
  return h.ammoBeforeShot !== undefined;
}

/**
 * SG 单个弹丸分类的命中记录视图：暴击 / 核心 / 核心伤害增量取该类，伤害系数取单颗弹丸系数
 * （公式导出只算单颗弹丸，不乘弹丸数；弹丸数另记于 pelletCount，damage 为该类小计）。
 * 零件伤害仅零件核心敌人的核心命中生效（引擎按弹丸类结算），非核心类剔除零件加成。
 * @param {object} h  整发命中记录
 * @param {{ isCrit: boolean, isCore: boolean, count: number, damage: number, coreDmgIncrement?: number }} g
 * @returns {object}
 */
export function pelletGroupHit(h, g) {
  const noParts = !g.isCore;
  return {
    ...h, isCrit: g.isCrit, isCore: g.isCore, coreDmgIncrement: g.coreDmgIncrement,
    hitMult: h.pelletHitMult ?? h.hitMult, pelletCount: g.count, damage: g.damage,
    ...(noParts ? {
      damageToPartsPct: 0,
      buffBreakdown: (h.buffBreakdown ?? []).map(b => (b.damageToPartsPct ? { ...b, damageToPartsPct: 0 } : b)),
    } : {}),
  };
}

// SG 导出时选取的弹丸分类优先级：暴击 + 核心 > 仅核心 > 仅暴击 > 非暴击 · 非核心
const _PELLET_PRIORITY = [[true, true], [false, true], [true, false], [false, false]];

/**
 * 按优先级选出 SG 要导出的弹丸分类；非 SG（无 pelletGroups）返回 null。
 * @param {object} h
 * @returns {object|null}  pelletGroups 中的一项
 */
export function pickPelletGroup(h) {
  const groups = (h.pelletGroups ?? []).filter(g => g.count > 0);
  for (const [crit, core] of _PELLET_PRIORITY) {
    const g = groups.find(x => !!x.isCrit === crit && !!x.isCore === core);
    if (g) return g;
  }
  return null;
}

/**
 * @param {object} h  命中记录（hitLog 条目）
 * @param {object} [opts]
 * @param {string} [opts.lang='zh']  'zh' 输出中文键名，其余输出英文内部键
 * @param {(name: string) => string} [opts.nameFn]  buff 名显示翻译
 * @returns {object}  计算器对象；SG 按 pickPelletGroup 的优先级选一个弹丸分类，只导出单颗弹丸的公式
 */
export function buildDmgFormulaExport(h, { lang = 'zh', nameFn = n => n } = {}) {
  const g = pickPelletGroup(h);
  return _localize(_buildCalcObject(g ? pelletGroupHit(h, g) : h, lang, nameFn), lang);
}

/** 构造英文内部键形式的计算器对象 */
function _buildCalcObject(h, lang, nameFn) {
  const tr = key => translate(lang, key);
  // buff 显示名：动态倍率 / 叠层时追加「*n」（同 dmg-tooltip）
  const bdName = b => {
    const name = nameFn(b.name);
    if (b.multiplier != null && b.multiplier !== 1) return `${name} *${b.multiplier}`;
    if ((b.stacks ?? 1) > 1) return `${name} *${b.stacks}`;
    return name;
  };
  const bd = h.buffBreakdown ?? [];
  const coeffs = [];
  const add = (type, name = null, value = null, extra = {}) => {
    const c = { type, ...extra };
    if (name != null) c.name = name;
    if (value != null) c.value = value;
    coeffs.push(c);
  };
  // 来源拆分：总量减去 buff 之和的残量（装备 / 非具名来源）以 residualName 列一项，再逐 buff 列出
  const addSplit = (type, total, key, residualName, toVal = _pct) => {
    const bufs = bd.filter(b => _nz(b[key]));
    const residual = (total ?? 0) - _sum(bufs, key);
    if (_nz(residual)) add(type, residualName, toVal(residual));
    bufs.forEach(b => add(type, bdName(b), toVal(b[key])));
  };

  const weapon  = isWeaponHit(h);
  const favMult = h.favNormalAttackDamageMult ?? 1;
  const isTrue  = h.isTrueDamage ?? false;

  // ── 攻击力 ──
  addSplit('atkIncrease', h.atkPct, 'atkPct', tr('dmg.gear'));
  addSplit('extraAtk', h.atkFlat, 'atkFlat', tr('dmg.gear'), _num);
  if (_nz(h.extraAtkFlat)) add('extraAtk', h.extraAtkFlatLabel ?? tr('dmg.extraBonus'), _num(h.extraAtkFlat));

  // ── 防御力：日志 enemyDef 为降低后的实际值（真实伤害记 0），按基础值反推降低比例 ──
  const baseDef = h.enemyBaseDef ?? h.enemyDef ?? 0;
  if (!isTrue && baseDef > 0 && _nz(1 - (h.enemyDef ?? 0) / baseDef)) {
    add('defReduction', null, _pct(1 - h.enemyDef / baseDef));
  }

  // ── 普攻伤害倍率（仅武器伤害；技能伤害并入 skillDmg）──
  if (weapon && _nz(favMult - 1)) {
    addSplit('collectibleNormalAtkMult', favMult - 1, 'normalAttackDamageMultPct', tr('dmg.fav'));
  }

  // ── 双枪：计算器固定 ×200%，日志 hitMult 已含该倍率，导出时从基本武器伤害系数中拆出 ──
  const dualGunMult = h.dualGunMult ?? 1;
  if (dualGunMult !== 1) add('dualGun');

  // ── 通用系数 ──
  // 暴击 / 核心 / 优越代码基础值用计算器 base 子项（名称固定为「基础暴击」「基础核心」「基础优越」）
  if (h.isCrit) {
    add('critDmg', null, null, { variant: 'base' });
    addSplit('critDmg', h.critDmgInc, 'critDamagePct', tr('dmg.gear'));
  }
  if (h.isCore) {
    // 核心基础子项 = 武器核心总倍率（CDN core_damage_rate：20000 → 200%，25000 → 250%）。
    // 日志 coreDmgIncrement = 单位级增量（core_damage_rate/10000 − 2）+ Σ核心 buff，残量即单位级增量；
    // 残量超出 250 档的部分（技能显式传入的额外核心增量）另列「核心伤害增加」
    const coreBufs = bd.filter(b => _nz(b.coreDamagePct));
    const residual = (h.coreDmgIncrement ?? 0) - _sum(coreBufs, 'coreDamagePct');
    const baseVal  = residual >= 0.5 - _EPS ? 250 : 200;
    add('coreDmg', null, baseVal, { variant: 'base' });
    const extraCore = residual - (baseVal - 200) / 100;
    if (_nz(extraCore)) add('coreDmg', tr('dmg.coreUp'), _pct(extraCore));
    coreBufs.forEach(b => add('coreDmg', bdName(b), _pct(b.coreDamagePct)));
  }
  if (h.isFullBurst) add('fullBurst');
  if (h.distanceAdv) add('distance');

  // ── 优越代码 ──
  if ((h.elemMult ?? 1) > 1 + _EPS) {
    add('attributeDmg', null, null, { variant: 'base' });
    const equipElem = h.equipElementDmgPct ?? 0;
    const cubeElem  = (h.elementDmgPct ?? 0) - equipElem;
    if (_nz(equipElem)) add('attributeDmg', tr('dmg.gear'), _pct(equipElem));
    // 魔方部分即魔方技能「Anti Code HC」（stats.js cubeElementDmgPct）→ 计算器魔方子项，数值取其等级列表值
    if (_nz(cubeElem)) {
      add('attributeDmg', null, _snap(_pct(cubeElem), _CUBE_ELEM_VALUES, 0.006), { variant: 'cube' });
    }
    bd.filter(b => _nz(b.elementAdvantagePct)).forEach(b => add('attributeDmg', bdName(b), _pct(b.elementAdvantagePct)));
  }

  // ── 蓄力：chargeMult = 武器基础 × (1 + 珍藏品 + 倍率 buff) + 装备 + 加法 buff ──
  const chargeMult = h.chargeMult ?? 1;
  if (_nz(chargeMult - 1)) {
    const chargeBufs = bd.filter(b => _nz(b.chargeDamagePct));
    const multBufs   = bd.filter(b => _nz(b.chargeDamageMultPct));
    const equip      = h.equipChargeDmgPct ?? 0;
    const fav        = h.favChargeDmgPct ?? 0;
    const weaponBase = (chargeMult - equip - _sum(chargeBufs, 'chargeDamagePct'))
      / (1 + fav + _sum(multBufs, 'chargeDamageMultPct'));
    add('weaponBaseCharge', null, _snap(_pct(weaponBase), _WEAPON_CHARGE_VALUES, 0.01));
    if (_nz(fav)) add('collectibleChargeIncrease', tr('dmg.fav'), _pct(fav));
    multBufs.forEach(b => add('collectibleChargeIncrease', bdName(b), _pct(b.chargeDamageMultPct)));
    if (_nz(equip)) add('chargeDmgIncrease', tr('dmg.gear'), _pct(equip));
    chargeBufs.forEach(b => add('chargeDmgIncrease', bdName(b), _pct(b.chargeDamagePct)));
  }

  // ── 伤害加成（ExtraMultiplier）──
  addSplit('dmgIncrease', h.attackDamagePct, 'attackDamagePct', tr('dmg.attackDmgUp'));
  addSplit('penetrationDmg', h.pierceDamagePct, 'pierceDamagePct', tr('dmg.pierceDmgUp'));
  addSplit('continuousAttackDmg', h.sequentialAttackDamagePct, 'sequentialAttackDamagePct', tr('dmg.seqDmgUp'));
  addSplit('dotDmg', h.sustainedDamagePct, 'sustainedDamagePct', tr('dmg.sustainedDmgUp'));
  // 零件伤害：日志 damageToPartsPct 已按「本次命中是否命中零件」取值（零件核心敌人的核心命中 / 技能命中零件）
  addSplit('partsDmg', h.damageToPartsPct, 'damageToPartsPct', tr('dmg.partsDmgUp'));
  if (isTrue) {
    // 真实伤害：至少保留一项启用中的无视防御力伤害（数值 0 亦可），使计算器按防御力 0 计算
    const before = coeffs.length;
    addSplit('ignoreDefDmg', h.trueDamagePct, 'trueDamagePct', tr('dmg.trueDmgUp'));
    if (coeffs.length === before) add('ignoreDefDmg', null, 0);
  }

  // ── 受创加深（含分摊伤害，同一乘区）──
  const debuffs = bd.filter(b => b.isEnemyDebuff && _nz(b.damageTakenPct));
  const shared  = bd.filter(b => _nz(b.distributedDamagePct));
  const takenResidual = (h.damageTakenPct ?? 0) - _sum(debuffs, 'damageTakenPct') - _sum(shared, 'distributedDamagePct');
  debuffs.forEach(b => add('enemyDmgTaken', bdName(b), _pct(b.damageTakenPct)));
  if (_nz(takenResidual)) add('enemyDmgTaken', tr('dmg.damageTakenUp'), _pct(takenResidual));
  shared.forEach(b => add('sharedDmg', bdName(b), _pct(b.distributedDamagePct)));

  const obj = { baseAtk: _num(h.atk ?? 0), enemyBaseDef: _num(baseDef), damageType: weapon ? 'weapon' : 'skill' };
  // 技能伤害不吃珍藏品倍率，技能来源的普攻倍率直接并入技能伤害系数
  if (weapon) obj.weaponDmg = _pct((h.hitMult ?? 0) / dualGunMult);
  else        obj.skillDmg  = _pct((h.hitMult ?? 0) * favMult);
  obj.coeffs = coeffs;
  return obj;
}

/** 中文界面：键名、type、variant、damageType 换成中文显示名 */
function _localize(obj, lang) {
  if (lang !== 'zh') return obj;
  const k = key => _ZH_KEYS[key] ?? key;
  const coeff = c => Object.fromEntries(Object.entries(c).map(([key, v]) => [k(key),
    key === 'type' ? (ZH_TYPE_NAMES[v] ?? v) : key === 'variant' ? (_ZH_VARIANTS[v] ?? v) : v]));
  return Object.fromEntries(Object.entries(obj).map(([key, v]) => [k(key),
    key === 'damageType' ? _ZH_DMG_TYPES[v] : key === 'coeffs' ? v.map(coeff) : v]));
}
