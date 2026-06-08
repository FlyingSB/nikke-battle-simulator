/**
 * lib/full-damage-trace.mjs
 * FullDamageTrace template — reusable unified timeline printer.
 *
 * Usage in a trace script:
 *   1. Set up squad config and call simulate().
 *   2. Override console.log to tee output to a file stream.
 *   3. Print nikke-specific header lines (stats, ammo calc, skill notes).
 *   4. Call printFullDamageTrace({ result, unitName, maxAmmo, hitDetailFn, outFilePath }).
 *
 * The function prints:
 *   - Damage summary by label
 *   - Column header
 *   - Unified timeline: burst markers, buff events, reload events,
 *     normal shot segments (compact), skill hits (full formula)
 *   - Footer totals
 */

export const TICK_RATE     = 60;
export const MAX_TICKS     = TICK_RATE * 180;
export const BURST_GAUGE_MAX = 1_000_000;

/**
 * Print burst energy calculation for one unit.
 * @param {object} o
 * @param {string}  o.name
 * @param {number}  o.burstEnergyPerShot   target_burst_energy_pershot (raw CDN)
 * @param {number}  [o.fullChargeDamage=10000]  CDN full_charge_damage (10000=×1, 25000=×2.5, …)
 * @param {number}  [o.s1SkillHitsPerShot=0]    extra S1 skill hits per shot trigger (e.g. Lib 5)
 * @param {number}  [o.s2SkillHitsPerShot=0]    extra S2 skill hits per shot trigger (e.g. Helm 1)
 * @param {number}  [o.s1GaugeFillPct=0]        S1 gauge-fill fraction per shot (e.g. Helm 0.1431)
 */
export function printBurstEnergyInfo(o) {
  const { name, burstEnergyPerShot } = o;
  const fcd     = o.fullChargeDamage    ?? 10000;
  const s1hits  = o.s1SkillHitsPerShot  ?? 0;
  const s2hits  = o.s2SkillHitsPerShot  ?? 0;
  const s1pct   = o.s1GaugeFillPct      ?? 0;
  const fcMult  = fcd / 10000;
  const fcEnergy   = Math.round(burstEnergyPerShot * fcMult);
  const s1HitEnergy = s1hits * burstEnergyPerShot;
  const s2HitEnergy = s2hits * burstEnergyPerShot;
  const s1FillEnergy = Math.round(s1pct * BURST_GAUGE_MAX);
  const totalPerTrigger = fcEnergy + s1HitEnergy + s2HitEnergy + s1FillEnergy;

  console.log(`Burst energy (${name}):`);
  if (fcMult !== 1) {
    console.log(`  base/shot:      ${fmtN(burstEnergyPerShot)}`);
    console.log(`  FC shot energy: ${fmtN(burstEnergyPerShot)} × ${fcMult.toFixed(2)} = ${fmtN(fcEnergy)}`);
  } else {
    console.log(`  energy/shot:    ${fmtN(burstEnergyPerShot)}`);
  }
  if (s1hits > 0) console.log(`  S1 skill hits:  ${s1hits} × ${fmtN(burstEnergyPerShot)} = ${fmtN(s1HitEnergy)}`);
  if (s2hits > 0) console.log(`  S2 skill hit:   ${s2hits} × ${fmtN(burstEnergyPerShot)} = ${fmtN(s2HitEnergy)}`);
  if (s1pct  > 0) console.log(`  S1 gauge fill:  ${fmtN(BURST_GAUGE_MAX)} × ${fmtP(s1pct)} = ${fmtN(s1FillEnergy)}`);
  const parts = [fmtN(fcEnergy)];
  if (s1hits > 0) parts.push(fmtN(s1HitEnergy));
  if (s2hits > 0) parts.push(fmtN(s2HitEnergy));
  if (s1pct  > 0) parts.push(fmtN(s1FillEnergy));
  console.log(`  total/trigger:  ${parts.join(' + ')} = ${fmtN(totalPerTrigger)}  (${fmtP(totalPerTrigger / BURST_GAUGE_MAX)} of shared gauge)`);
  console.log('');
}

export const fmtT = tick => {
  const s   = tick / TICK_RATE;
  const m   = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3);
  return `${String(m).padStart(2,'0')}:${sec.padStart(6,'0')}`;
};
export const fmtN = v => Math.round(v).toLocaleString('en-US');
export const fmtP = v => (v * 100).toFixed(2) + '%';

// ── Normal-shot segment helpers ───────────────────────────────────────────────

/** Signature used to group consecutive hits with identical damage parameters. */
function sig(h) {
  return `${h.atkPct}|${h.atkFlat}|${h.hitMult}|${h.favNormalAttackDamageMult ?? 1}|${h.attackDamagePct}|${h.pierceDamagePct ?? 0}|${h.damageTakenPct}|${h.isFullBurst}|${h.isCore}|${h.distanceAdv}|${h.elemMult}|${h.chargeMult}`;
}

/** Signature that ignores isCore — used for mixed-core weapons (SMG/AR/SG) to merge core/non-core into one segment. */
function sigNoCore(h) {
  return `${h.atkPct}|${h.atkFlat}|${h.hitMult}|${h.favNormalAttackDamageMult ?? 1}|${h.attackDamagePct}|${h.pierceDamagePct ?? 0}|${h.damageTakenPct}|${h.isFullBurst}|${h.distanceAdv}|${h.elemMult}|${h.chargeMult}`;
}

function segNoCrit(h) {
  const effAtk  = h.atk * (1 + h.atkPct) + h.atkFlat;
  const favMult = h.favNormalAttackDamageMult ?? 1;
  let cMult = 1;
  if (h.isFullBurst) cMult += 0.50;
  if (h.isCore)      cMult += 1.00 + (h.coreDmgIncrement ?? 0);
  if (h.distanceAdv) cMult += 0.30;
  const elemMult    = h.elemMult ?? 1;
  const chargeMult  = h.chargeMult ?? 1;
  const piercePct   = h.isPierce ? (h.pierceDamagePct ?? 0) : 0;
  return Math.floor(Math.max(0, effAtk - h.enemyDef) * h.hitMult * favMult
    * cMult * elemMult * chargeMult * (1 + h.attackDamagePct + piercePct) * (1 + h.damageTakenPct));
}

function segCrit(h) {
  const effAtk  = h.atk * (1 + h.atkPct) + h.atkFlat;
  const favMult = h.favNormalAttackDamageMult ?? 1;
  let cMult = 1;
  if (h.isFullBurst) cMult += 0.50;
  if (h.isCore)      cMult += 1.00 + (h.coreDmgIncrement ?? 0);
  if (h.distanceAdv) cMult += 0.30;
  cMult += 0.50 + (h.critDmgInc ?? 0);
  const elemMult    = h.elemMult ?? 1;
  const chargeMult  = h.chargeMult ?? 1;
  const piercePct   = h.isPierce ? (h.pierceDamagePct ?? 0) : 0;
  return Math.floor(Math.max(0, effAtk - h.enemyDef) * h.hitMult * favMult
    * cMult * elemMult * chargeMult * (1 + h.attackDamagePct + piercePct) * (1 + h.damageTakenPct));
}

// ── Expanded formula printer ──────────────────────────────────────────────────

/**
 * Print multi-line expanded formula for a hit (normal or skill).
 * Format: each factor shown as NAME(+value) [additive component] or NAME(*value) [multiplier].
 * @param {object} h        — hitLog entry
 * @param {number} favMult  — favNormalAttackDamageMult (1 for skill hits)
 */
function printExpandedFormula(h, favMult, label = 'formula') {
  const atkMult  = 1 + h.atkPct;
  const atkFlat  = h.atkFlat ?? 0;
  const enemyDef = h.enemyDef ?? 0;
  const effAtk   = h.atk * atkMult + atkFlat;
  const effAtkMinusDef = Math.max(0, effAtk - enemyDef);
  const baseDmg  = effAtkMinusDef * h.hitMult * favMult;

  // cMult components (additive terms)
  const cParts = [];
  let cMult = 1;
  if (h.isFullBurst) { cMult += 0.50; cParts.push('fb(+0.50)'); }
  if (h.isCore)      { const ci = 1.00 + (h.coreDmgIncrement ?? 0); cMult += ci; cParts.push(`core(+${ci.toFixed(2)})`); }
  if (h.distanceAdv) { cMult += 0.30; cParts.push('dist(+0.30)'); }

  const elemMult   = h.elemMult   ?? 1;
  const chargeMult = h.chargeMult ?? 1;
  const piercePct  = h.isPierce ? (h.pierceDamagePct ?? 0) : 0;
  const xDmgTotal  = (h.attackDamagePct ?? 0) + piercePct;
  const xDmgMult   = 1 + xDmgTotal;
  const dTknMult   = 1 + (h.damageTakenPct ?? 0);
  const noCrit     = Math.floor(effAtkMinusDef * h.hitMult * favMult * cMult * elemMult * chargeMult * xDmgMult * dTknMult);

  // ATK% breakdown from buffs; equipAtkPct is inferred as remainder
  const atkPctBuffs = (h.buffBreakdown ?? []).filter(b => b.atkPct > 0);
  const sumBuffAtkPct = atkPctBuffs.reduce((s, b) => s + b.atkPct, 0);
  const equipAtkPct = h.atkPct - sumBuffAtkPct; // permanent equipment ATK%

  // ATK flat breakdown
  const atkFlatBuffs = (h.buffBreakdown ?? []).filter(b => b.atkFlat > 0);

  // xDmg breakdown
  const dmgBuffs    = (h.buffBreakdown ?? []).filter(b => b.attackDamagePct > 0);
  const pierceBuffs = h.isPierce ? (h.buffBreakdown ?? []).filter(b => b.pierceDamagePct > 0) : [];

  // Line 1: effATK
  const atkPctBreakdown = [];
  if (equipAtkPct > 0.0001) atkPctBreakdown.push(`equip(+${fmtP(equipAtkPct)})`);
  for (const b of atkPctBuffs) atkPctBreakdown.push(`${b.name}(+${fmtP(b.atkPct)})`);
  const atkMult_str = atkPctBreakdown.length > 1
    ? `*${atkMult.toFixed(4)} = 1+${atkPctBreakdown.join('+')}`
    : `*${atkMult.toFixed(4)}`;

  let line1 = `  ${label}:  atk(*${fmtN(h.atk)}) × atkMult(${atkMult_str})`;
  if (atkFlat > 0) {
    const flatBreakdown = atkFlatBuffs.length > 0
      ? ` = ${atkFlatBuffs.map(b => `${b.name}(+${fmtN(b.atkFlat)})`).join('+')}`
      : '';
    line1 += ` + atkFlat(+${fmtN(Math.round(atkFlat))}${flatBreakdown})`;
  }
  line1 += ` − def(-${fmtN(Math.round(enemyDef))}) = effATK(*${fmtN(Math.round(effAtkMinusDef))})`;
  console.log(line1);

  // Line 2: baseDmg
  let line2 = `             × hitMult(*${h.hitMult.toFixed(4)})`;
  if (favMult !== 1) line2 += ` × favMult(*${favMult.toFixed(4)})`;
  line2 += ` → baseDmg(*${fmtN(Math.round(baseDmg))})`;
  console.log(line2);

  // Line 3: cMult
  const cMult_str = cParts.length > 0
    ? `*${cMult.toFixed(2)} = 1 + ${cParts.join(' + ')}`
    : `*${cMult.toFixed(2)}`;
  console.log(`             × cMult(${cMult_str})`);

  // Line 4: elem + charge (only when > 1)
  const extras = [];
  if (elemMult   > 1) extras.push(`elemMult(*${elemMult.toFixed(4)})`);
  if (chargeMult > 1) extras.push(`chargeMult(*${chargeMult.toFixed(4)})`);
  if (extras.length) console.log(`             × ${extras.join(' × ')}`);

  // Line 5: xDmg
  if (xDmgTotal > 0) {
    const xParts = [
      ...dmgBuffs.map(b => `${b.name}(+${fmtP(b.attackDamagePct)})`),
      ...pierceBuffs.map(b => `${b.name}[pierce](+${fmtP(b.pierceDamagePct)})`),
    ];
    const xMult_str = xParts.length > 0
      ? `*${xDmgMult.toFixed(4)} = 1 + ${xParts.join(' + ')}`
      : `*${xDmgMult.toFixed(4)}`;
    console.log(`             × xDmgMult(${xMult_str})`);
  }

  // Line 6: dTkn + result
  // damageTakenPct on the hit already includes distributedBonus (enemy base + distributed)
  const distributedDamagePct = h.distributedDamagePct ?? 0;
  const enemyDTknBase        = (h.damageTakenPct ?? 0) - distributedDamagePct;
  let dTknStr = '';
  if (dTknMult > 1) {
    if (distributedDamagePct > 0) {
      const dTknParts = [];
      if (enemyDTknBase  > 0) dTknParts.push(`enemy(+${fmtP(enemyDTknBase)})`);
      dTknParts.push(`distDmg(+${fmtP(distributedDamagePct)})`);
      dTknStr = `dTknMult(*${dTknMult.toFixed(4)} = 1 + ${dTknParts.join(' + ')})`;
    } else {
      dTknStr = `dTknMult(*${dTknMult.toFixed(4)})`;
    }
  }
  const resultLine = dTknStr
    ? `             × ${dTknStr}  = ${fmtN(noCrit)}/hit (no crit)`
    : `             = ${fmtN(noCrit)}/hit (no crit)`;
  console.log(resultLine);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {object}   opts.result       — return value of simulate()
 * @param {string}   opts.unitName     — which unit to trace (matched by name)
 * @param {number}   opts.maxAmmo      — unit's computed max ammo (for X/maxAmmo display)
 * @param {Function} [opts.hitDetailFn]— (h) => string[]  extra lines printed after each
 *                                       skill hit's formula line (e.g. projBonus for Rapi)
 * @param {string}   opts.outFilePath  — path string shown in footer "Full log written to:"
 */
export function printFullDamageTrace({ result, unitName, maxAmmo, hitDetailFn, outFilePath }) {
  const ts = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  console.log(`Generated: ${ts}`);
  console.log('');
  const unit       = result.units.find(u => u.name === unitName);
  const unitId     = unit?.id;
  const weaponType = unit?.weaponType ?? 'AR';
  // SMG/AR/SG fire multiple shot types per mag (normal/core × crit/no-crit); show breakdown
  const showHitBreakdown = ['SMG', 'AR', 'SG'].includes(weaponType);

  // ── Partition hit log ──────────────────────────────────────────────────────
  const allHits    = (result.hitLog ?? []).filter(h => h.unitId === unitId);
  const normalHits = allHits.filter(h => h.label === 'normal_shot');
  const skillHits  = allHits.filter(h => h.label !== 'normal_shot');

  // Buff names that affect ammo capacity — their expiry ticks also split segments.
  const AMMO_CAPACITY_BUFFS = new Set(['liter_s1_t1_maxAmmo']);

  // Ticks at which a non-shot ammo change occurs — forces segment splits.
  // Includes: skill ammo events (excl. bastion cube), reloads, and ammo-capacity buff expiry.
  const ammoSplitTicks = new Set([
    ...(result.ammoLog ?? [])
      .filter(e => e.unitId === unitId && !e.source?.includes('bastion_cube'))
      .map(e => e.tick),
    ...(result.log ?? [])
      .filter(e => e.type === 'reload' && e.unitId === unitId)
      .map(e => e.tick),
    ...(result.buffLog ?? [])
      .filter(e => e.type === 'buff_expire' && AMMO_CAPACITY_BUFFS.has(e.name)
        && (e.unitId === unitId || e.unitId === null))
      .map(e => e.tick),
  ]);

  // Sorted split tick array for range checks (split events may fall between shot ticks)
  const splitTicksSorted = [...ammoSplitTicks].sort((a, b) => a - b);

  /**
   * Returns true if any split tick falls in (lastTick, currTick].
   * Handles both exact-tick events (reload, ammo_change — shot fires at same tick as event)
   * and between-tick events (buff expiry — may not coincide with a shot tick).
   */
  function hasSplitBetween(lastTick, currTick) {
    return splitTicksSorted.some(t => t > lastTick && t <= currTick);
  }

  // Mixed-core weapons (SMG/AR/SG) group by sigNoCore so core and non-core shots merge into one segment.
  // 100%-core weapons (MG/SR/RL) keep sig() which includes isCore (always true, no effect on grouping).
  const sigFn = showHitBreakdown ? sigNoCore : sig;

  // Normal shots → segments (force a break whenever a split event is crossed)
  const segments = [];
  let si = 0;
  while (si < normalHits.length) {
    const s0        = sigFn(normalHits[si]);
    const startTick = normalHits[si].tick;
    const group     = [];
    while (si < normalHits.length && sigFn(normalHits[si]) === s0) {
      if (group.length > 0 && hasSplitBetween(group[group.length - 1].tick, normalHits[si].tick)) break;
      group.push(normalHits[si++]);
    }
    segments.push({ startTick, endTick: group[group.length - 1].tick, group });
  }

  // Skill hits → activations (consecutive same-tick same-label)
  const activations = [];
  let ai = 0;
  while (ai < skillHits.length) {
    const { tick, label } = skillHits[ai];
    const group = [];
    while (ai < skillHits.length && skillHits[ai].tick === tick && skillHits[ai].label === label)
      group.push(skillHits[ai++]);
    activations.push(group);
  }

  // ── Damage summary ─────────────────────────────────────────────────────────
  const dmgByLabel = { ...(unit?.skillDamage ?? {}) };
  const unitTotal  = unit?.totalDamage ?? 0;
  const sortedLbls = Object.entries(dmgByLabel).sort((a, b) => b[1] - a[1]);
  console.log('Damage summary:');
  for (const [lbl, dmg] of sortedLbls)
    console.log(`  ${(lbl + ':').padEnd(16)}  ${fmtN(dmg).padStart(18)}  (${fmtP(dmg / unitTotal)})`);
  console.log(`  ${'UNIT TOTAL:'.padEnd(16)}  ${fmtN(unitTotal).padStart(18)}`);
  console.log('');
  console.log(`Normal shots: ${normalHits.length}   Skill hits: ${skillHits.length}   Reloads: ${unit?.reloadCount ?? 0}`);
  console.log('');

  // ── Column header ──────────────────────────────────────────────────────────
  const HDR = 'Time'.padEnd(10) + 'Source'.padEnd(18) + 'Hits'.padStart(6) +
    'eff.ATK'.padStart(12) + 'hitMult'.padStart(8) + 'baseDmg'.padStart(12) +
    'cMult'.padStart(8) + 'xDmg%'.padStart(8) + 'dTkn%'.padStart(8) + 'total'.padStart(16);
  const SEP       = '-'.repeat(HDR.length);
  const BURST_SEP = '='.repeat(HDR.length);

  // ── Build unified timeline ─────────────────────────────────────────────────
  // Same-tick order: burst(0) > buff(1) > reload(2) > ammo_change(2) > segment(3) > activation(4)
  // ammo_change from burst skills fires before that tick's shots; bastion fires after a shot
  // but within the same tick — both are shown at priority 2 (before shot segments).
  const BURST_EVENTS = new Set(['burst_i', 'burst_ii', 'burst_iii', 'full_burst', 'burst_end']);
  // KIND_ORDER 仅作 _seq 缺失时的后备排序（通常不触发）
  const KIND_ORDER   = { phase: 0, burst: 0, buff: 1, reload: 2, ammo_change: 2, segment: 3, activation: 4 };
  const timeline     = [];

  for (const ev of (result.log ?? []))
    if (ev.type === 'phase_change') timeline.push({ kind: 'phase', tick: ev.tick, ev });

  for (const ev of (result.log ?? []))
    if (BURST_EVENTS.has(ev.type)) timeline.push({ kind: 'burst', tick: ev.tick, ev });

  for (const ev of (result.buffLog ?? []))
    timeline.push({ kind: 'buff', tick: ev.tick, ev });

  for (const ev of (result.log ?? []).filter(e => e.type === 'reload' && e.unitId === unitId))
    timeline.push({ kind: 'reload', tick: ev.tick, ev });

  for (const ev of (result.ammoLog ?? []).filter(e => e.unitId === unitId && e.source !== 'bastion_cube'))
    timeline.push({ kind: 'ammo_change', tick: ev.tick, ev });

  for (const seg of segments)
    timeline.push({ kind: 'segment', tick: seg.startTick, seg });

  for (const group of activations)
    timeline.push({ kind: 'activation', tick: group[0].tick, group });

  // 主键：tick；次键：_seq（还原真实执行顺序）；后备：KIND_ORDER（_seq 缺失时）
  for (const item of timeline) {
    if (item.ev)    item._seq = item.ev._seq    ?? Infinity;
    else if (item.seg) item._seq = item.seg.group[0]?._seq ?? Infinity;
    else if (item.group) item._seq = item.group[0]?._seq   ?? Infinity;
  }
  timeline.sort((a, b) => {
    const tickDiff = a.tick - b.tick;
    if (tickDiff !== 0) return tickDiff;
    if (a._seq !== b._seq) return a._seq - b._seq;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });

  // Number reloads in order
  let reloadNum = 0;
  for (const item of timeline) if (item.kind === 'reload') item.reloadN = ++reloadNum;

  // ── Print timeline ─────────────────────────────────────────────────────────
  console.log(HDR);
  console.log(SEP);

  let burstRotation = 0;

  for (const item of timeline) {

    // Phase change markers
    if (item.kind === 'phase') {
      const { ev } = item;
      const label = ev.zone === 'HIDDEN' ? '▓▓ HIDDEN — attacks paused ▓▓' : `zone → ${ev.zone}`;
      console.log(`${fmtT(ev.tick)}  ${label}`);
      continue;
    }

    // Burst markers
    if (item.kind === 'burst') {
      const { ev } = item;
      if (ev.type === 'burst_i') {
        burstRotation++;
        console.log(BURST_SEP);
        console.log(`${fmtT(ev.tick)}  ── Burst Rotation ${burstRotation}: B1 = ${ev.unitName}`);
      } else if (ev.type === 'burst_ii') {
        console.log(`${fmtT(ev.tick)}     B2 = ${ev.unitName}`);
      } else if (ev.type === 'burst_iii') {
        console.log(`${fmtT(ev.tick)}     B3 = ${ev.unitName}${ev.isCA ? ' (CA)' : ''}`);
      } else if (ev.type === 'full_burst') {
        console.log(`${fmtT(ev.tick)}     Full Burst`);
      } else if (ev.type === 'burst_end') {
        console.log(`${fmtT(ev.tick)}     FB End`);
        console.log(BURST_SEP);
      }
      continue;
    }

    // Buff events
    if (item.kind === 'buff') {
      const { ev } = item;
      const who = ev.unitId === null
        ? 'all'
        : (result.units.find(u => u.id === ev.unitId)?.name ?? `#${ev.unitId}`);
      if (ev.type === 'buff_gain') {
        const dur = ev.endTick >= MAX_TICKS * 10
          ? 'permanent'
          : `${((ev.endTick - ev.tick) / TICK_RATE).toFixed(1)}s`;
        // Build effect summary string
        const effects = [];
        if (ev.atkPct               > 0) effects.push(`atk%(+${fmtP(ev.atkPct)})`);
        if (ev.atkFlat              > 0) effects.push(`atkFlat(+${fmtN(ev.atkFlat)})`);
        if (ev.attackDamagePct      > 0) effects.push(`xDmg(+${fmtP(ev.attackDamagePct)})`);
        if (ev.distributedDamagePct > 0) effects.push(`distDmg(+${fmtP(ev.distributedDamagePct)})`);
        if (ev.critRatePct        > 0) effects.push(`critRate(+${fmtP(ev.critRatePct)})`);
        if (ev.critDamagePct         > 0) effects.push(`critDmg(+${fmtP(ev.critDamagePct)})`);
        if (ev.chargeDamagePct      > 0) effects.push(`chgDmg(+${fmtP(ev.chargeDamagePct)})`);
        if (ev.chargeSpeedPct       > 0) effects.push(`chgSpd(+${fmtP(ev.chargeSpeedPct)})`);
        if (ev.reloadSpeedPct            > 0) effects.push(`reload(+${fmtP(ev.reloadSpeedPct)})`);
        if (ev.maxAmmoPct                > 0) effects.push(`ammo(+${fmtP(ev.maxAmmoPct)})`);
        if (ev.chargeTimeReductionTicks  > 0) effects.push(`chgTimeFlat(-${ev.chargeTimeReductionTicks}ticks)`);
        if (ev.hitRatePct              > 0) effects.push(`hitRate(+${fmtP(ev.hitRatePct)})`);
        const effectStr = effects.length ? `  {${effects.join('  ')}}` : '';
        console.log(`${fmtT(ev.tick).padEnd(10)}  + ${ev.name}  [${who}]  (${dur})${effectStr}`);
      } else if (ev.type === 'buff_expire') {
        console.log(`${fmtT(ev.tick).padEnd(10)}  - ${ev.name}  [${who}]  expired`);
      } else if (ev.type === 'cd_reduction') {
        const secs = (ev.reductionTicks / TICK_RATE).toFixed(2);
        console.log(`${fmtT(ev.tick).padEnd(10)}  ▼CD ${ev.name}  [${who}]  −${secs}s`);
      }
      continue;
    }

    // Reload event
    if (item.kind === 'reload') {
      const reloadMax = item.ev.maxAmmo ?? maxAmmo;
      console.log(`${fmtT(item.ev.tick).padEnd(10)}  reload #${item.reloadN}  ammo 0→${item.ev.ammoRefilled}/${reloadMax}`);
      continue;
    }

    // Ammo change from skill/cube
    if (item.kind === 'ammo_change') {
      const { ev } = item;
      // Capacity-only events (delta=0) are already shown via the buff_gain line — skip display.
      if (ev.delta === 0 && ev.maxAmmoDelta > 0) continue;
      const sign = ev.delta >= 0 ? '+' : '';
      console.log(`${fmtT(ev.tick).padEnd(10)}  ammo ${sign}${ev.delta} → ${ev.ammoAfter}/${ev.maxAmmo}  (${ev.source})`);
      continue;
    }

    // Normal shot segment
    if (item.kind === 'segment') {
      const { seg } = item;
      const group  = seg.group;
      const h      = group[0];
      const hLast  = group[group.length - 1];
      const subtot    = group.reduce((s, x) => s + x.damage, 0);
      const startAmmo = h.ammoBeforeShot ?? (h.ammoLeft + 1);
      const endAmmo   = hLast.ammoLeft ?? '?';
      const ammoMax   = hLast.maxAmmo ?? maxAmmo;
      const ammo      = `${startAmmo}→${endAmmo}/${ammoMax}`;
      const timeRange = seg.startTick === seg.endTick
        ? fmtT(seg.startTick).padEnd(21)
        : `${fmtT(seg.startTick)} - ${fmtT(seg.endTick)}`;
      const favMult = h.favNormalAttackDamageMult ?? 1;

      let compactLine, flagStr, hForNormal, hForCore;

      if (showHitBreakdown) {
        // Mixed-core (SMG/AR/SG): 4 possible hit types within one merged segment
        const ncHits  = group.filter(x => !x.isCore && !x.isCrit);
        const nccHits = group.filter(x => !x.isCore &&  x.isCrit);
        const kcHits  = group.filter(x =>  x.isCore && !x.isCrit);
        const kccHits = group.filter(x =>  x.isCore &&  x.isCrit);

        // Any hit as representative — use override to get core/non-core variants
        const hNorm = { ...h, isCore: false };
        const hCore = { ...h, isCore: true  };

        // Always show all 4 damage values; append [N] only when that type had hits this segment
        const fmt = (dmg, cnt) => cnt > 0 ? `${fmtN(dmg)}[${cnt}]` : fmtN(dmg);
        const outerPart  = fmt(segNoCrit(hNorm), ncHits.length);
        const innerParts = [
          fmt(segCrit(hNorm),    nccHits.length),
          fmt(segNoCrit(hCore),  kcHits.length),
          fmt(segCrit(hCore),    kccHits.length),
        ];
        compactLine = `${outerPart} (${innerParts.join(' / ')})`;

        const flags = [];
        if (h.isFullBurst) flags.push('FB');
        if (h.isPierce)    flags.push('pierce');
        if (h.distanceAdv) flags.push('dist');
        flagStr = flags.length ? `  [${flags.join('+')}]` : '';

        // Mixed-core: always show only the normal (non-core) formula
        hForNormal = hNorm;
        hForCore   = null;

      } else {
        // 100%-core (MG/SR/RL): all shots hit core — NORMAL = core no-crit, NORMAL_CRIT = core crit
        const ncHits  = group.filter(x => !x.isCrit);
        const nccHits = group.filter(x =>  x.isCrit);

        // Always show both damage values; append [N] only when that type had hits
        const fmt = (dmg, cnt) => cnt > 0 ? `${fmtN(dmg)}[${cnt}]` : fmtN(dmg);
        compactLine = `${fmt(segNoCrit(h), ncHits.length)} (${fmt(segCrit(h), nccHits.length)})`;

        const flags = [];
        if (h.isFullBurst) flags.push('FB');
        if (h.isPierce)    flags.push('pierce');
        if (h.isCore)      flags.push('core');
        if (h.distanceAdv) flags.push('dist');
        flagStr = flags.length ? `  [${flags.join('+')}]` : '';

        // 100%-core: only one formula needed (core formula)
        hForNormal = h;
        hForCore   = null;
      }

      console.log(`${timeRange}  ${compactLine}  ammo ${ammo}  = ${fmtN(subtot)}${flagStr}`);

      const dmgParts = [
        ...(h.buffBreakdown ?? []).filter(b => b.attackDamagePct).map(b => `${b.name}:+${fmtP(b.attackDamagePct)}`),
        ...(h.isPierce ? (h.buffBreakdown ?? []).filter(b => b.pierceDamagePct).map(b => `${b.name}[pierce]:+${fmtP(b.pierceDamagePct)}`) : []),
      ];
      if (dmgParts.length) console.log(`  xDmg%: ${dmgParts.join('  ')}`);

      printExpandedFormula(hForNormal, favMult, 'formula');
      continue;
    }

    // Skill hit activation
    const { group } = item;
    const h        = group[0];
    const total2   = group.reduce((s, x) => s + x.damage, 0);
    const crits2   = group.filter(x => x.isCrit).length;
    const hitCount = group.length;

    const effAtk  = h.atk * (1 + h.atkPct) + h.atkFlat;
    const baseDmg = Math.max(0, effAtk - h.enemyDef) * h.hitMult;

    let cMult = 1;
    if (h.isFullBurst) cMult += 0.50;
    if (h.isCore)      cMult += 1.00 + (h.coreDmgIncrement ?? 0);

    const totalXdmg = h.attackDamagePct;
    const hitsLabel = crits2 > 0 ? `${hitCount}(${crits2}C)` : `${hitCount}`;

    console.log(
      fmtT(h.tick).padEnd(10) +
      h.label.padEnd(18) +
      hitsLabel.padStart(6) +
      fmtN(Math.round(effAtk)).padStart(12) +
      h.hitMult.toFixed(4).padStart(8) +
      fmtN(Math.round(baseDmg)).padStart(12) +
      ('×' + cMult.toFixed(2)).padStart(8) +
      fmtP(totalXdmg).padStart(8) +
      fmtP(h.damageTakenPct).padStart(8) +
      fmtN(total2).padStart(16),
    );

    // Standard buff detail lines
    const atkPctBuffs    = (h.buffBreakdown ?? []).filter(b => b.atkPct);
    const atkFlatBuffs   = (h.buffBreakdown ?? []).filter(b => b.atkFlat);
    const dmgPctBuffs    = (h.buffBreakdown ?? []).filter(b => b.attackDamagePct);
    const elemAdvBuffs   = (h.buffBreakdown ?? []).filter(b => b.elementAdvantagePct);
    if (atkPctBuffs.length)
      console.log('  ATK%:     ' + atkPctBuffs.map(b => `${b.name}:+${fmtP(b.atkPct)}`).join('  '));
    if (atkFlatBuffs.length)
      console.log('  ATK flat: ' + atkFlatBuffs.map(b => `${b.name}:+${fmtN(b.atkFlat)}`).join('  '));
    if (dmgPctBuffs.length)
      console.log('  xDmg%:    ' + dmgPctBuffs.map(b => `${b.name}:+${fmtP(b.attackDamagePct)}`).join('  '));
    if (elemAdvBuffs.length)
      console.log('  elemAdv%: ' + elemAdvBuffs.map(b => `${b.name}:+${fmtP(b.elementAdvantagePct)}`).join('  '));

    // Expanded formula (no crit path)
    printExpandedFormula(h, 1);

    // Nikke-specific extra lines (e.g. projBonus for Rapi)
    if (hitDetailFn) {
      for (const line of hitDetailFn(h) ?? []) console.log(line);
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  console.log(SEP);
  const normalTotal = unit?.skillDamage?.normal_shot ?? 0;
  const skillTotal  = activations.reduce((s, g) => s + g.reduce((ss, h) => ss + h.damage, 0), 0);
  console.log(`Normal shot total: ${fmtN(normalTotal).padStart(18)}`);
  console.log(`Skill total:       ${fmtN(skillTotal).padStart(18)}`);
  console.log(`Unit total:        ${fmtN(unitTotal).padStart(18)}`);
  console.log('');
  console.log(`Full log written to: ${outFilePath}`);
}
