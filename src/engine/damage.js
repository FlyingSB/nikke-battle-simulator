/**
 * NIKKE damage formula (community-researched).
 *
 * Sources:
 *   - nikke.gg damage formula guide
 *   - prydwen.gg mechanics breakdown
 *
 * Final Damage =
 *   ATK
 *   × WeaponMultiplier        (base hit % from weapon data)
 *   × SkillMultiplier         (skill scaling %)
 *   × CritMultiplier          (expected or rolled)
 *   × ElementMultiplier       (1.1 if advantage, 0.9 if disadvantage, 1.0 neutral)
 *   × DefenseReduction        (1 - DEF / (DEF + DEF_CONSTANT))
 *   × MiscModifiers           (buffs, debuffs, core damage, etc.)
 */

// ─── Constants ────────────────────────────────────────────────────────────

/**
 * Defense mitigation constant.
 * Community formula: mitigation = DEF / (DEF + 2 * BASE_ATK_AT_LEVEL)
 * Approximated here as a fixed constant tuned to mid-game values.
 * TODO: verify from data mining — likely scales with content level.
 */
const DEF_CONSTANT = 2000;

/** Element advantage/disadvantage multipliers */
const ELEMENT_MULT = 1.1;
const ELEMENT_WEAK = 0.9;

/**
 * Element advantage table.
 * Key beats value.
 *   Fire > Wind > Electric > Water > Fire  (cycle)
 *   Iron: neutral against all
 */
const ELEMENT_CHART = {
  Fire:     'Wind',
  Wind:     'Electric',
  Electric: 'Water',
  Water:    'Fire',
};

// Weapon base multipliers (% of ATK per shot, from character data)
// These are approximate — character detail JSON has exact values.
const WEAPON_MULTIPLIERS = {
  AR:  2.88,
  SMG: 1.12,
  SR:  10.50,
  MG:  0.86,
  SG:  0.63,   // per pellet
  RL:  12.00,
};

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} DamageInput
 * @property {number} atk               attacker's final ATK stat
 * @property {number} def               defender's DEF stat
 * @property {number} critRate          0.0 – 1.0
 * @property {number} critDmg           additive e.g. 0.5 = 150% total
 * @property {string} attackerElement
 * @property {string} defenderElement
 * @property {string} weaponType        AR | SMG | SR | MG | SG | RL
 * @property {number} skillMultiplier   e.g. 5.57 means 557%
 * @property {number} [miscMult]        product of all other multipliers
 * @property {boolean} [rolledCrit]     if true, apply full crit; if false no crit
 *                                      if undefined, use expected crit (for avg DPS)
 */

/**
 * Calculate damage for one hit.
 * @param {DamageInput} input
 * @returns {{ damage: number, isCrit: boolean }}
 */
export function calcDamage(input) {
  const {
    atk,
    def,
    critRate,
    critDmg,
    attackerElement,
    defenderElement,
    weaponType = 'AR',
    skillMultiplier = 1.0,
    miscMult = 1.0,
    rolledCrit,
  } = input;

  const weapMult = WEAPON_MULTIPLIERS[weaponType] ?? WEAPON_MULTIPLIERS.AR;

  // Crit
  let isCrit = false;
  let critMult;
  if (rolledCrit === undefined) {
    // Expected value mode (no RNG)
    critMult = 1 + critRate * critDmg;
  } else {
    isCrit = rolledCrit;
    critMult = isCrit ? (1 + critDmg) : 1.0;
  }

  // Defense reduction
  const defReduction = 1 - def / (def + DEF_CONSTANT);

  // Element
  const elemMult = getElementMultiplier(attackerElement, defenderElement);

  const damage = Math.floor(
    atk * weapMult * skillMultiplier * critMult * elemMult * defReduction * miscMult
  );

  return { damage, isCrit };
}

/**
 * Roll a crit result based on crit rate.
 * @param {number} critRate 0.0 – 1.0
 * @returns {boolean}
 */
export function rollCrit(critRate) {
  return Math.random() < critRate;
}

/**
 * Calculate expected (average) DPS over one magazine.
 * @param {DamageInput} input
 * @param {number} maxAmmo
 * @param {number} attackSpeed   shots per second
 * @returns {{ dps: number, dmgPerMag: number }}
 */
export function calcExpectedDPS(input, maxAmmo, attackSpeed) {
  const { damage } = calcDamage({ ...input, rolledCrit: undefined });
  const dmgPerMag = damage * maxAmmo;
  const dps = damage * attackSpeed;
  return { dps, dmgPerMag };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function getElementMultiplier(attackerElem, defenderElem) {
  if (ELEMENT_CHART[attackerElem] === defenderElem) return ELEMENT_MULT;
  if (ELEMENT_CHART[defenderElem] === attackerElem) return ELEMENT_WEAK;
  return 1.0;
}

export function getElementAdvantage(attackerElem, defenderElem) {
  if (ELEMENT_CHART[attackerElem] === defenderElem) return 'advantage';
  if (ELEMENT_CHART[defenderElem] === attackerElem) return 'disadvantage';
  return 'neutral';
}
