/**
 * Shared test harness for NIKKE test scripts.
 *
 * Usage:
 *   import { eq, near, pct, section, summary } from './lib/test-harness.mjs';
 *
 * Each import gets live bindings to the shared passed/failed counters.
 * One counter per Node.js process — no reset() needed when each test file
 * runs as its own `node` invocation.
 */

export let passed = 0, failed = 0;

/**
 * Exact-equality check.
 * @param {string} label
 * @param {*} got
 * @param {*} expected
 */
export function eq(label, got, expected) {
  const ok = got === expected;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`);
  if (ok) passed++; else failed++;
}

/**
 * Absolute-tolerance float check. Default tol=0.0001 suits pure-math tests.
 * Pass tol=1 when comparing integer stats that may differ by rounding.
 * @param {string} label
 * @param {number} got
 * @param {number} expected
 * @param {number} [tol=0.0001]
 */
export function near(label, got, expected, tol = 0.0001) {
  const ok = Math.abs(got - expected) <= tol;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: got ${got} expected ${expected} (tol ±${tol})`);
  if (ok) passed++; else failed++;
}

/**
 * Percentage-tolerance check for large stat values.
 * @param {string} label
 * @param {number} got
 * @param {number} expected
 * @param {number} [tolerancePct=0.005]  0.005 = 0.5%
 */
export function pct(label, got, expected, tolerancePct = 0.005) {
  const err = Math.abs(got - expected) / Math.abs(expected || 1);
  const ok  = err <= tolerancePct;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: got ${got.toLocaleString()} expected ${expected.toLocaleString()} (err ${(err * 100).toFixed(3)}%)`);
  if (ok) passed++; else failed++;
}

/**
 * Print a section header.
 * @param {string} title
 */
export function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

/**
 * Print final summary and exit(1) if any failures.
 * @param {string} label  e.g. 'Formula tests'
 */
export function summary(label) {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  ${label}: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(62)}`);
  if (failed > 0) process.exit(1);
}
