/**
 * Unified test runner — runs all regression test suites in order.
 *
 * Suites (in dependency order):
 *   1. test-formulas.mjs  — pure math, no I/O
 *   2. test-urls.mjs      — URL generation algorithm
 *   3. test-data.mjs      — data pipeline (requires scripts/cache/)
 *   4. test-stats.mjs     — full stat pipeline (fetches CDN if cache cold)
 *
 * Usage:
 *   node scripts/test-all.mjs
 *
 * Exit 0 only if all suites pass.
 * To populate scripts/cache/ for test-data.mjs, run test-battle.mjs first.
 */

import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  { name: 'Formulas',   file: 'test-formulas.mjs',   note: 'pure math, no I/O'                      },
  { name: 'Skills',     file: 'test-skills.mjs',     note: 'skill traits registry'                   },
  { name: 'RapiB1/B3',   file: 'test-rapi-burst.mjs',   note: 'Rapi burst-step & Combat Assist, no I/O' },
  { name: 'Cinderella', file: 'test-cinderella.mjs', note: 'Cinderella skill fixes, no I/O'           },
  { name: 'URLs',       file: 'test-urls.mjs',       note: 'URL generation algorithm'                },
  { name: 'Data',       file: 'test-data.mjs',       note: 'requires scripts/cache/'                 },
  { name: 'Stats',      file: 'test-stats.mjs',      note: 'may fetch from CDN'                      },
  { name: 'RedHoodBurst', file: 'test-red-hood-burst.mjs', note: 'Red Hood weapon switch shot count' },
  { name: 'BurstTiming', file: 'test-burst-timing.mjs',   note: 'B3 burst direct damage delay & bonus behavior' },
];

const LINE = '═'.repeat(62);

console.log(LINE);
console.log('  NIKKE Battle Simulator — Test Suite');
console.log(LINE);

const results = [];

for (const suite of SUITES) {
  console.log(`\n  ▶ ${suite.name.padEnd(10)} (${suite.note})`);
  console.log('─'.repeat(62));

  const r = spawnSync(process.execPath, [join(__dirname, suite.file)], {
    stdio: 'inherit',
  });

  results.push({ name: suite.name, ok: r.status === 0 && r.error == null, error: r.error });
}

console.log(`\n${LINE}`);
console.log('  Results');
console.log(LINE);

let anyFailed = false;
for (const { name, ok, error } of results) {
  console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}  ${name}`);
  if (error) console.log(`         ${error.message}`);
  if (!ok) anyFailed = true;
}

console.log(LINE);

if (anyFailed) {
  console.log('  One or more suites failed.\n');
  process.exit(1);
} else {
  console.log('  All suites passed.\n');
}
