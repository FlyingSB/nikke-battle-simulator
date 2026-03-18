/**
 * Normalize raw CDN data into clean objects used by the engine.
 */
import { getData } from './loader.js';

// ─── Character ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Character
 * @property {number} id
 * @property {string} name
 * @property {'Attacker'|'Defender'|'Supporter'} classType
 * @property {'Fire'|'Water'|'Wind'|'Electric'|'Iron'} element
 * @property {string} weaponType   // AR, SMG, SR, MG, SG, RL
 * @property {string} damageType   // Metal, Energy, Bio
 * @property {string} faction      // ELYSION, MISSILIS, TETRA, PILGRIM, ABNORMAL
 * @property {number} rarity       // 2=R, 3=SR, 4=SSR
 * @property {number[]} costumeIds
 */

/** @returns {Character[]} */
export function getAllCharacters() {
  const raw = getData('characters') ?? [];
  return raw.map(c => ({
    id: c.id,
    name: c.name_localkey?.name ?? String(c.id),
    classType: c.class,
    element: elementName(c.element_id),
    weaponType: c.shot_id?.weapon_type ?? 'AR',
    damageType: c.shot_id?.damage_type ?? 'Metal',
    faction: c.corporation,
    rarity: c.original_rare ?? 4,
    costumeIds: (c.costumes ?? []).map(x => x.id),
  }));
}

/** @param {number} id @returns {Character|undefined} */
export function getCharacter(id) {
  return getAllCharacters().find(c => c.id === id);
}

// ─── Character Stats by Level ─────────────────────────────────────────────

/**
 * @typedef {Object} CharacterStats
 * @property {number} atk
 * @property {number} hp
 * @property {number} def
 * @property {number} level
 */

/**
 * Get a character's base stats at a given level.
 * character_detail is a single character object (the CDN file has one character).
 * In production this would index by character_id.
 * @param {number} characterId
 * @param {number} level
 * @returns {CharacterStats}
 */
export function getBaseStats(characterId, level) {
  const detail = getData('characterDetail');
  if (!detail) return { atk: 0, hp: 0, def: 0, level };

  // The detail file from CDN has one character (Rapi LRH for now).
  // stat_list is array indexed by level-1.
  const statList = detail.stat_list ?? detail.stats ?? [];
  const entry = statList[level - 1] ?? statList[0] ?? {};
  return {
    level,
    atk: entry.atk ?? entry.attack ?? 0,
    hp: entry.hp ?? 0,
    def: entry.def ?? entry.defence ?? 0,
  };
}

// ─── Equipment ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Equipment
 * @property {number} id
 * @property {string} name
 * @property {'A'|'B'|'C'|'D'} slot
 * @property {'Attacker'|'Defender'|'Supporter'|'All'} classReq
 * @property {number} tier         // 1-10
 * @property {number} atk
 * @property {number} hp
 * @property {number} def
 */

/** @returns {Equipment[]} */
export function getAllEquipment() {
  const raw = getData('equipment') ?? [];
  return raw.map(e => {
    const stats = parseStatArray(e.stat ?? []);
    return {
      id: e.id,
      name: e.name_localkey?.name ?? String(e.id),
      slot: e.item_sub_type,
      classReq: e.class,
      tier: e.grade_core_id ?? 1,
      atk: stats.atk,
      hp: stats.hp,
      def: stats.def,
    };
  });
}

// ─── Harmony Cubes ────────────────────────────────────────────────────────

/**
 * @typedef {Object} HarmonyCube
 * @property {number} id
 * @property {string} name
 * @property {number} rarity
 * @property {number[]} atk   // per enhancement level
 * @property {number[]} hp
 * @property {number[]} def
 * @property {Array<{name:string, values:number[]}>} skills
 */

/** @returns {HarmonyCube[]} */
export function getAllHarmonyCubes() {
  const raw = getData('harmonyCubes') ?? [];
  return raw.map(c => ({
    id: c.id,
    name: c.name_localkey?.name ?? String(c.id),
    rarity: c.item_rare ?? 1,
    atk: c.atk ?? [],
    hp: c.hp ?? [],
    def: c.def ?? [],
    skills: (c.skill_list ?? []).map(s => ({
      name: s.name_localkey?.name ?? '',
      values: s.value_list ?? [],
    })),
  }));
}

// ─── Attractive (Ascension) ───────────────────────────────────────────────

/**
 * @typedef {Object} AttractiveBonus
 * @property {number} level   // 1-40
 * @property {number} atkRate
 * @property {number} hpRate
 * @property {number} defRate
 * @property {string} classType
 */

/** @returns {AttractiveBonus[]} */
export function getAttractiveTable() {
  const raw = getData('attractive') ?? [];
  // Each record has bonuses per class type
  return raw.map(r => r); // kept raw; engine will look up by level + class
}

// ─── Recycle Room ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} ResearchBonus
 * @property {number} id
 * @property {number} atk
 * @property {number} hp
 * @property {number} def
 * @property {string} type   // Personal/Class/Corporation
 */

/** @returns {ResearchBonus[]} */
export function getResearchBonuses() {
  const raw = getData('recycleRoom') ?? [];
  return raw.map(r => ({
    id: r.id,
    atk: r.attack ?? r.atk ?? 0,
    hp: r.hp ?? 0,
    def: r.defence ?? r.def ?? 0,
    type: r.recycle_type ?? '',
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function elementName(id) {
  const map = { 1: 'Fire', 2: 'Water', 3: 'Wind', 4: 'Electric', 5: 'Iron' };
  return map[id] ?? 'Iron';
}

function parseStatArray(statArr) {
  const out = { atk: 0, hp: 0, def: 0 };
  for (const s of statArr) {
    const type = (s.stat_type ?? '').toLowerCase();
    const val = s.stat_value ?? 0;
    if (type.includes('atk') || type === 'attack') out.atk += val;
    else if (type === 'hp') out.hp += val;
    else if (type.includes('def')) out.def += val;
  }
  return out;
}
