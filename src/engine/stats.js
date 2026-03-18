/**
 * Final stat computation.
 * Pipeline: base + level → attractive bonus → equipment → harmony cube → research
 */
import { getBaseStats, getAttractiveTable, getResearchBonuses } from '../data/models.js';

/**
 * @typedef {Object} NikkeConfig
 * @property {number} characterId
 * @property {string} classType       // Attacker | Defender | Supporter
 * @property {string} faction         // ELYSION etc.
 * @property {number} level           // 1–200+ (synchro-gated)
 * @property {number} attractiveLv    // ascension tier 0–40
 * @property {import('../data/models.js').Equipment[]} equipment  // up to 4 slots
 * @property {import('../data/models.js').HarmonyCube|null} cube
 * @property {number} cubeLevel       // 0–14
 * @property {number[]} researchIds   // unlocked recycle room IDs
 * @property {number} skill1Lv        // 1–10
 * @property {number} skill2Lv        // 1–10
 * @property {number} burstLv         // 1–10
 */

/**
 * @typedef {Object} FinalStats
 * @property {number} atk
 * @property {number} hp
 * @property {number} def
 * @property {number} critRate        // 0.0–1.0
 * @property {number} critDmg         // additive multiplier e.g. 0.5 = +50%
 * @property {number} maxAmmo
 * @property {number} hitRate
 */

const BASE_CRIT_RATE = 0.15;
const BASE_CRIT_DMG  = 0.50;
const BASE_AMMO      = 40;    // weapon-type dependent; refined per char later
const BASE_HIT_RATE  = 1.00;

/**
 * Compute fully-stacked stats for one NIKKE unit.
 * @param {NikkeConfig} cfg
 * @returns {FinalStats}
 */
export function computeFinalStats(cfg) {
  // 1. Base stats from level table
  const base = getBaseStats(cfg.characterId, cfg.level);

  // 2. Attractive (ascension) — percentage bonus applied to base
  const attrBonus = getAttractiveBonus(cfg.classType, cfg.attractiveLv ?? 0);
  let atk = base.atk * (1 + attrBonus.atkRate);
  let hp  = base.hp  * (1 + attrBonus.hpRate);
  let def = base.def * (1 + attrBonus.defRate);

  // 3. Equipment flat bonuses
  for (const equip of (cfg.equipment ?? [])) {
    atk += equip.atk ?? 0;
    hp  += equip.hp  ?? 0;
    def += equip.def ?? 0;
  }

  // 4. Harmony Cube flat bonuses (at cube level)
  if (cfg.cube && cfg.cubeLevel > 0) {
    const lvIdx = Math.min(cfg.cubeLevel, cfg.cube.atk.length - 1);
    atk += cfg.cube.atk[lvIdx] ?? 0;
    hp  += cfg.cube.hp[lvIdx]  ?? 0;
    def += cfg.cube.def[lvIdx] ?? 0;
  }

  // 5. Recycle Room research
  const research = getResearchBonuses();
  for (const id of (cfg.researchIds ?? [])) {
    const r = research.find(x => x.id === id);
    if (r) { atk += r.atk; hp += r.hp; def += r.def; }
  }

  return {
    atk: Math.floor(atk),
    hp:  Math.floor(hp),
    def: Math.floor(def),
    critRate: BASE_CRIT_RATE,
    critDmg:  BASE_CRIT_DMG,
    maxAmmo:  BASE_AMMO,
    hitRate:  BASE_HIT_RATE,
  };
}

// ─── Attractive (Ascension) bonus ─────────────────────────────────────────

const _attractiveCache = {};

function getAttractiveBonus(classType, level) {
  const key = `${classType}_${level}`;
  if (_attractiveCache[key]) return _attractiveCache[key];

  const table = getAttractiveTable();
  const row = table.find(r => r.attractive_level === level) ?? {};

  const prefix = classType.toLowerCase(); // attacker / defender / supporter
  const bonus = {
    atkRate: (row[`${prefix}_attack_rate`]  ?? 0) / 10000,
    hpRate:  (row[`${prefix}_hp_rate`]      ?? 0) / 10000,
    defRate: (row[`${prefix}_defence_rate`] ?? 0) / 10000,
  };
  _attractiveCache[key] = bonus;
  return bonus;
}
