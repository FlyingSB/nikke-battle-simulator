/**
 * Skill traits registry tests — pure, no CDN, no file I/O.
 *
 * Covers:
 *   getSkillTraits   — null for unknown ids, correct object for registered ids
 *   hasSkillTrait    — boolean flag lookup
 *   hasSkillTag      — tag membership check
 *   SKILL_TRAITS     — registry shape validation (all values are valid SkillTraits)
 *
 * Run: node scripts/tests/test-skills.mjs
 */

import {
  SKILL_TRAITS,
  getSkillTraits,
  hasSkillTrait,
  hasSkillTag,
} from '../../src/data/skill-traits.js';
import { eq, section, summary } from '../lib/test-harness.mjs';

// ── T1: getSkillTraits — unknown ids ─────────────────────────────────────────

section('T1: getSkillTraits — unknown / null / undefined');
{
  eq('null input',      getSkillTraits(null),      null);
  eq('undefined input', getSkillTraits(undefined),  null);
  eq('zero',            getSkillTraits(0),           null);
  eq('unregistered id', getSkillTraits(99999),       null);
}

// ── T2: hasSkillTrait — fallback without registration ────────────────────────

section('T2: hasSkillTrait — unregistered id always false');
{
  eq('canHitCore on unknown', hasSkillTrait(99999, 'canHitCore'), false);
  eq('null id',               hasSkillTrait(null,  'canHitCore'), false);
}

// ── T3: hasSkillTag — fallback without registration ──────────────────────────

section('T3: hasSkillTag — unregistered id always false');
{
  eq('tag on unknown', hasSkillTag(99999, 'projectile'), false);
  eq('null id',        hasSkillTag(null,  'projectile'), false);
}

// ── T4: SKILL_TRAITS registry shape validation ────────────────────────────────

section('T4: SKILL_TRAITS — every entry is a valid SkillTraits object');
{
  const ALLOWED_KEYS = new Set(['canHitCore', 'tags']);

  const entries = Object.entries(SKILL_TRAITS);

  // Registry intentionally empty at this stage — confirm it's a plain object.
  eq('registry is object', typeof SKILL_TRAITS, 'object');

  let allValid = true;
  for (const [rawId, traits] of entries) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) {
      console.log(`  [FAIL] key ${rawId}: not a positive integer group_id`);
      allValid = false;
      continue;
    }
    if (typeof traits !== 'object' || traits === null) {
      console.log(`  [FAIL] group_id ${id}: value is not an object`);
      allValid = false;
      continue;
    }
    for (const key of Object.keys(traits)) {
      if (!ALLOWED_KEYS.has(key)) {
        console.log(`  [FAIL] group_id ${id}: unknown key '${key}'`);
        allValid = false;
      }
    }
    if (traits.canHitCore !== undefined && typeof traits.canHitCore !== 'boolean') {
      console.log(`  [FAIL] group_id ${id}: canHitCore must be boolean`);
      allValid = false;
    }
    if (traits.tags !== undefined) {
      if (!Array.isArray(traits.tags)) {
        console.log(`  [FAIL] group_id ${id}: tags must be an array`);
        allValid = false;
      } else if (!traits.tags.every(t => typeof t === 'string')) {
        console.log(`  [FAIL] group_id ${id}: tags must be string[]`);
        allValid = false;
      }
    }
  }
  eq('all registry entries valid', allValid, true);
}

// ── T5: round-trip with synthetic entry ───────────────────────────────────────

section('T5: round-trip with synthetic entry');
{
  const SYNTHETIC_ID = 999001;
  SKILL_TRAITS[SYNTHETIC_ID] = { canHitCore: true, tags: ['projectile', 'attachment'] };

  eq('getSkillTraits returns object', typeof getSkillTraits(SYNTHETIC_ID),        'object');
  eq('canHitCore is true',            getSkillTraits(SYNTHETIC_ID).canHitCore,    true);
  eq('hasSkillTrait canHitCore',      hasSkillTrait(SYNTHETIC_ID, 'canHitCore'),  true);
  eq('hasSkillTag projectile',        hasSkillTag(SYNTHETIC_ID, 'projectile'),    true);
  eq('hasSkillTag attachment',        hasSkillTag(SYNTHETIC_ID, 'attachment'),    true);
  eq('hasSkillTag nonexistent',       hasSkillTag(SYNTHETIC_ID, 'explosion'),     false);

  // cleanup — keep registry pristine for subsequent runs in same process
  delete SKILL_TRAITS[SYNTHETIC_ID];
  eq('cleaned up synthetic entry', getSkillTraits(SYNTHETIC_ID), null);
}

summary('Skill traits tests');
