/**
 * 伤害分解 tooltip — 把单次命中记录（hitLog 条目）拆成各乘区的来源明细 HTML。
 * 由 store.showDmgTooltip 调用；文案走 i18n，buff 名经调用方传入的 nameFn 翻译为界面语言。
 */
import { t } from './i18n.js';

const _ELEM_ADV_BASE      = 0.10;
const _BASE_CRIT_DAMAGE   = 0.50;
const _BASE_CORE_DAMAGE   = 1.00;
const _DISTANCE_ADV_BONUS = 0.30;
const _FULL_BURST_BONUS   = 0.50;

function _pct(v, decimals = 2) {
  return (v * 100).toFixed(decimals) + '%';
}
function _numFmt(v) {
  return Math.round(v).toLocaleString();
}

/**
 * @param {object} h  命中记录
 * @param {(name: string) => string} [nameFn]  buff 名显示翻译
 * @param {{ cubeElemName?: string|null }} [opts]  cubeElemName：优越代码加成来源的魔方技能原名（如 'Anti Code HC'）
 * @returns {string}
 */
export function buildDmgTooltipHTML(h, nameFn = n => n, { cubeElemName = null } = {}) {
  // 伤害公式中的 buff 显示名：数值按动态倍率 n 放大（multiplier）或按层数叠加（stacks>1）时追加「*n」
  const _bdName = b => {
    const name = nameFn(b.name);
    if (b.multiplier != null && b.multiplier !== 1) return `${name} *${b.multiplier}`;
    if ((b.stacks ?? 1) > 1) return `${name} *${b.stacks}`;
    return name;
  };

  const bd           = h.buffBreakdown ?? [];
  const enemyDef     = h.enemyDef ?? 0;
  const hitMult      = h.hitMult  ?? 1;
  const favMult      = h.favNormalAttackDamageMult ?? 1;
  const isCrit       = h.isCrit   ?? false;
  const critInc      = h.critDmgInc ?? 0;
  const isCore       = h.isCore   ?? false;
  const coreInc      = h.coreDmgIncrement ?? 0;
  const distAdv      = h.distanceAdv ?? false;
  const isFB         = h.isFullBurst ?? false;
  const elemMult     = h.elemMult ?? 1;
  const chargeMult   = h.chargeMult ?? 1;
  const sustainedPct = h.sustainedDamagePct ?? 0;
  const truePct      = h.trueDamagePct ?? 0;
  const isTrueDmg    = h.isTrueDamage ?? false;

  const coreBufs     = isCore ? bd.filter(b => Math.abs(b.coreDamagePct ?? 0) > 0.0001) : [];
  const coreBufSum   = coreBufs.reduce((s, b) => s + (b.coreDamagePct ?? 0), 0);
  const coreResidual = (isCore && coreInc > 0.0001) ? Math.max(0, coreInc - coreBufSum) : 0;

  // ── 分段构建器 ──────────────────────────────────────────────
  const sects = [];
  const addSect = (title, sub = false) => {
    const s = { title, sub, items: [] };
    sects.push(s);
    return s;
  };
  const addItem = (s, lbl, val, type = 'pct') => s.items.push({ lbl, val, type });
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ── 基础攻击力 ──
  {
    const s = addSect(t('dmg.baseAtk'));
    addItem(s, '', _numFmt(h.atk ?? 0), 'num');
  }

  // ── 攻击力系数（ATK%）──
  const atkPctBufs   = bd.filter(b => Math.abs(b.atkPct ?? 0) > 0.0001);
  const atkPctBufSum = atkPctBufs.reduce((s, b) => s + (b.atkPct ?? 0), 0);
  const atkPctEquip  = (h.atkPct ?? 0) - atkPctBufSum;
  if (Math.abs(h.atkPct ?? 0) > 0.0001) {
    const s = addSect(t('dmg.atkMult'));
    if (Math.abs(atkPctEquip) > 0.0001) addItem(s, t('dmg.gear'), `+${_pct(atkPctEquip)}`);
    atkPctBufs.forEach(b => addItem(s, _bdName(b), `+${_pct(b.atkPct)}`));
  }

  // ── 固定加成（次一级 sub-section）──
  const atkFlatBufs   = bd.filter(b => Math.abs(b.atkFlat ?? 0) > 0.0001);
  const atkFlatBufSum = atkFlatBufs.reduce((s, b) => s + (b.atkFlat ?? 0), 0);
  const atkFlatEquip  = (h.atkFlat ?? 0) - atkFlatBufSum;
  // 本次命中独有的额外 ATK 加算项（如 Maiden: Ice Rose S3 的「最终 MaxHP × 10%」），不在 atkFlat 中
  const extraAtkFlat  = h.extraAtkFlat ?? 0;
  if (Math.abs(h.atkFlat ?? 0) > 0.0001 || Math.abs(extraAtkFlat) > 0.0001) {
    const s = addSect(t('dmg.flatBonus'), true);
    if (Math.abs(atkFlatEquip) > 0.0001) addItem(s, t('dmg.gear'), `+${_numFmt(atkFlatEquip)}`, 'flat');
    atkFlatBufs.forEach(b => addItem(s, _bdName(b), `+${_numFmt(b.atkFlat)}`, 'flat'));
    if (Math.abs(extraAtkFlat) > 0.0001) addItem(s, h.extraAtkFlatLabel ?? t('dmg.extraBonus'), `+${_numFmt(extraAtkFlat)}`, 'flat');
  }

  // ── 防御力 ──
  {
    const s = addSect(t('dmg.def'));
    addItem(s, '', isTrueDmg ? t('dmg.trueIgnoreDef') : `−${_numFmt(enemyDef)}`, isTrueDmg ? 'note' : 'neg');
  }

  // ── 伤害系数 ──
  {
    const s = addSect(t('dmg.hitMult'));
    addItem(s, '', `×${_pct(hitMult)}`, 'pct');
    if (favMult !== 1) addItem(s, t('dmg.favNormalMult'), `×${_pct(favMult)}`, 'pct');
  }

  // ── 通用系数（暴击 / 核心 / 距离 / Full Burst）──
  if (isCrit || isCore || distAdv || isFB) {
    const s = addSect(t('dmg.common'));
    if (isCrit) {
      // 展开到每个 buff：基础 50% + 装备效果残量 + 各具名 buff
      // critInc = (装备 critDamagePct) + (buff critDamagePct 之和)，残量即装备来源
      const critBufs   = bd.filter(b => Math.abs(b.critDamagePct ?? 0) > 0.0001);
      const critBufSum = critBufs.reduce((acc, b) => acc + (b.critDamagePct ?? 0), 0);
      const critEquip  = critInc - critBufSum;
      addItem(s, t('dmg.critBase'), `+${_pct(_BASE_CRIT_DAMAGE)}`);
      if (Math.abs(critEquip) > 0.0001) addItem(s, t('dmg.gear'), `+${_pct(critEquip)}`);
      critBufs.forEach(b => addItem(s, _bdName(b), `+${_pct(b.critDamagePct)}`));
    }
    if (isCore) {
      addItem(s, t('dmg.coreBase'), `+${_pct(_BASE_CORE_DAMAGE)}`);
      coreBufs.forEach(b => addItem(s, _bdName(b), `+${_pct(b.coreDamagePct)}`));
      if (coreResidual > 0.0001) addItem(s, t('dmg.coreUp'), `+${_pct(coreResidual)}`);
    }
    if (distAdv) addItem(s, t('dmg.distAdv'), `+${_pct(_DISTANCE_ADV_BONUS)}`);
    if (isFB)    addItem(s, 'Full Burst',     `+${_pct(_FULL_BURST_BONUS)}`);
  }

  // ── 优越代码加成 ──
  if (elemMult > 1.0001) {
    const equipElemPct = h.equipElementDmgPct ?? 0;
    const cubeElemPct  = (h.elementDmgPct ?? 0) - equipElemPct;
    const elemBufs     = bd.filter(b => Math.abs(b.elementAdvantagePct ?? 0) > 0.0001);
    const s = addSect(t('dmg.elemAdv'));
    addItem(s, t('dmg.base'), `+${_pct(_ELEM_ADV_BASE)}`);
    if (Math.abs(equipElemPct) > 0.0001) addItem(s, t('dmg.gear'), `+${_pct(equipElemPct)}`);
    if (Math.abs(cubeElemPct)  > 0.0001) addItem(s, cubeElemName ? nameFn(cubeElemName) : t('dmg.cube'), `+${_pct(cubeElemPct)}`);
    elemBufs.forEach(b => addItem(s, _bdName(b), `+${_pct(b.elementAdvantagePct)}`));
  }

  // ── 蓄力系数 ──
  // chargeMult = 武器基础×(1+珍藏品+倍率 buff) + 装备 + 加法 buff，逐来源拆分展示
  if (Math.abs(chargeMult - 1) > 0.0001) {
    const chargeBufs   = bd.filter(b => Math.abs(b.chargeDamagePct ?? 0) > 0.0001);
    const chargeBufSum = chargeBufs.reduce((acc, b) => acc + (b.chargeDamagePct ?? 0), 0);
    const multBufs     = bd.filter(b => Math.abs(b.chargeDamageMultPct ?? 0) > 0.0001);
    const multBufSum   = multBufs.reduce((acc, b) => acc + (b.chargeDamageMultPct ?? 0), 0);
    const equipCharge  = h.equipChargeDmgPct ?? 0;
    const favChargePct = h.favChargeDmgPct ?? 0;
    // 珍藏品与 "Charge Damage Multiplier" buff 对武器基础是乘算（同一乘区相加）
    // 先剥离装备/加法 buff，再按 (1+珍藏品+倍率 buff) 还原出纯武器基础
    const baseWithFav  = chargeMult - equipCharge - chargeBufSum;
    const weaponBase   = baseWithFav / (1 + favChargePct + multBufSum);
    const s = addSect(t('dmg.chargeMult'));
    addItem(s, t('dmg.weaponBase'), `${_pct(weaponBase)}`);
    // 珍藏品显示原始蓄力伤害数值（与游戏内一致），乘算用 × 前缀 + 区分色
    if (Math.abs(favChargePct) > 0.0001) addItem(s, t('dmg.fav'), `×${_pct(favChargePct)}`, 'mult');
    multBufs.forEach(b => addItem(s, _bdName(b), `×${_pct(b.chargeDamageMultPct)}`, 'mult'));
    if (Math.abs(equipCharge)  > 0.0001) addItem(s, t('dmg.gear'), `+${_pct(equipCharge)}`);
    chargeBufs.forEach(b => addItem(s, _bdName(b), `+${_pct(b.chargeDamagePct)}`));
  }

  // ── 伤害加成（ExtraMultiplier）──
  const extraBufs = bd.filter(b =>
    Math.abs(b.attackDamagePct           ?? 0) > 0.0001 ||
    Math.abs(b.pierceDamagePct           ?? 0) > 0.0001 ||
    Math.abs(b.sequentialAttackDamagePct ?? 0) > 0.0001
  );
  const extraFallback = extraBufs.length === 0 && (
    Math.abs(h.attackDamagePct           ?? 0) > 0.0001 ||
    Math.abs(h.pierceDamagePct           ?? 0) > 0.0001 ||
    Math.abs(h.sequentialAttackDamagePct ?? 0) > 0.0001
  );
  const hasExtra = extraBufs.length > 0 || extraFallback
    || Math.abs(sustainedPct) > 0.0001 || Math.abs(truePct) > 0.0001;

  if (hasExtra) {
    const s = addSect(t('dmg.damageBonus'));
    if (extraBufs.length > 0) {
      extraBufs.forEach(b => {
        if (Math.abs(b.attackDamagePct           ?? 0) > 0.0001) addItem(s, _bdName(b), `+${_pct(b.attackDamagePct)}`);
        if (Math.abs(b.pierceDamagePct           ?? 0) > 0.0001) addItem(s, _bdName(b), `+${_pct(b.pierceDamagePct)}`);
        if (Math.abs(b.sequentialAttackDamagePct ?? 0) > 0.0001) addItem(s, _bdName(b), `+${_pct(b.sequentialAttackDamagePct)}`);
      });
    } else {
      if (Math.abs(h.attackDamagePct           ?? 0) > 0.0001) addItem(s, t('dmg.attackDmgUp'), `+${_pct(h.attackDamagePct)}`);
      if (Math.abs(h.pierceDamagePct           ?? 0) > 0.0001) addItem(s, t('dmg.pierceDmgUp'), `+${_pct(h.pierceDamagePct)}`);
      if (Math.abs(h.sequentialAttackDamagePct ?? 0) > 0.0001) addItem(s, t('dmg.seqDmgUp'),    `+${_pct(h.sequentialAttackDamagePct)}`);
    }
    if (Math.abs(sustainedPct) > 0.0001) {
      // 展开到每个 buff，剩余非具名来源归入"持续伤害增加"
      const sustainedBufs = bd.filter(b => Math.abs(b.sustainedDamagePct ?? 0) > 0.0001);
      const sustainedResidual = sustainedPct - sustainedBufs.reduce((acc, b) => acc + (b.sustainedDamagePct ?? 0), 0);
      sustainedBufs.forEach(b => addItem(s, _bdName(b), `+${_pct(b.sustainedDamagePct)}`));
      if (Math.abs(sustainedResidual) > 0.0001) addItem(s, t('dmg.sustainedDmgUp'), `+${_pct(sustainedResidual)}`);
    }
    if (Math.abs(truePct) > 0.0001) {
      // 展开到每个 buff，剩余非具名来源归入"无视防御力伤害增加"
      const trueBufs = bd.filter(b => Math.abs(b.trueDamagePct ?? 0) > 0.0001);
      const trueResidual = truePct - trueBufs.reduce((acc, b) => acc + (b.trueDamagePct ?? 0), 0);
      trueBufs.forEach(b => addItem(s, _bdName(b), `+${_pct(b.trueDamagePct)}`));
      if (Math.abs(trueResidual) > 0.0001) addItem(s, t('dmg.trueDmgUp'), `+${_pct(trueResidual)}`);
    }
  }

  // ── 受创加深（DamageTakenLikeMultiplier）──
  // 分摊伤害 ▲ 与受创加深同属一个乘区（h.damageTakenPct 已含），逐来源列出
  const debuffBufs = bd.filter(b => b.isEnemyDebuff && Math.abs(b.damageTakenPct ?? 0) > 0.0001);
  const distBufs   = bd.filter(b => Math.abs(b.distributedDamagePct ?? 0) > 0.0001);
  if (debuffBufs.length > 0 || distBufs.length > 0) {
    const s = addSect(t('dmg.damageTaken'));
    debuffBufs.forEach(b => addItem(s, _bdName(b), `+${_pct(b.damageTakenPct)}`));
    distBufs.forEach(b => addItem(s, `${_bdName(b)}${t('dmg.distributedSuffix')}`, `+${_pct(b.distributedDamagePct)}`));
  } else if (Math.abs(h.damageTakenPct ?? 0) > 0.0001) {
    const s = addSect(t('dmg.damageTaken'));
    addItem(s, t('dmg.damageTakenUp'), `+${_pct(h.damageTakenPct)}`);
  }

  // ── 渲染 ────────────────────────────────────────────────────
  const typeClass = type =>
    type === 'flat' ? 'dmg-tip-flat' :
    type === 'neg'  ? 'dmg-tip-neg'  :
    type === 'num'  ? 'dmg-tip-num'  :
    type === 'note' ? 'dmg-tip-note' :
    type === 'mult' ? 'dmg-tip-mult' : 'dmg-tip-pct';

  const sectHtml = sects.map(s => {
    const hdHtml   = `<div class="dmg-tip-hd">${esc(s.title)}</div>`;
    const rowsHtml = s.items.map(({ lbl, val, type }) =>
      `<div class="dmg-tip-row"><span class="dmg-tip-lbl">${esc(lbl)}</span><span class="${typeClass(type)}">${val}</span></div>`
    ).join('');
    return `<div class="dmg-tip-sect${s.sub ? ' dmg-tip-sect--sub' : ''}">${hdHtml}${rowsHtml}</div>`;
  }).join('');

  const resultHtml = `<div class="dmg-tip-result"><span class="dmg-tip-result-lbl">${esc(t('dmg.final'))}</span><span class="dmg-tip-result-val">${_numFmt(h.damage ?? 0)}</span></div>`;

  return `<div class="dmg-tip">${sectHtml}${resultHtml}</div>`;
}
