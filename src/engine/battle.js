/**
 * Battle simulation engine.
 *
 * Simulates time-based combat at discrete ticks.
 * Each tick = 1/30 second (30fps simulation).
 *
 * Flow:
 *   initBattle(config) → BattleState
 *   while (!isOver):
 *     tick(state) → events[]
 *   getResults(state) → BattleResult
 */
import { calcDamage, rollCrit } from './damage.js';
import { computeFinalStats } from './stats.js';

export const TICK_RATE = 30; // ticks per second
const MAX_TICKS = 30 * 300;  // 5-minute cap

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} EnemyConfig
 * @property {number} maxHp
 * @property {number} def
 * @property {string} element
 * @property {string} type        // Normal | Elite | Boss
 */

/**
 * @typedef {Object} BattleConfig
 * @property {import('./stats.js').NikkeConfig[]} squad   // 1-5 NIKKEs
 * @property {EnemyConfig} enemy
 * @property {number} [iterations]   // Monte Carlo runs (default 1 for deterministic)
 * @property {boolean} [useMonteCarlo]
 */

/**
 * @typedef {Object} UnitState
 * @property {number} id
 * @property {string} name
 * @property {string} element
 * @property {string} weaponType
 * @property {import('./stats.js').FinalStats} stats
 * @property {number} currentHp
 * @property {number} ammoLeft
 * @property {number} reloadTick       // tick when reload completes (0 = ready)
 * @property {number} burstGauge       // 0–100
 * @property {number} totalDamage
 * @property {number} hitCount
 * @property {number} critCount
 * @property {number} burstCount
 * @property {object[]} activeBuffs    // { id, duration, value }
 */

/**
 * @typedef {Object} BattleState
 * @property {UnitState[]} squad
 * @property {number} enemyHp
 * @property {number} enemyMaxHp
 * @property {number} tick
 * @property {boolean} fullBurstActive
 * @property {number} fullBurstTick    // tick when current burst ends
 * @property {object[]} log
 */

// ─── Weapon attack speeds (shots/tick) ────────────────────────────────────
const ATTACK_SPEED = {
  AR:  0.20,  // ~6 shots/sec
  SMG: 0.33,  // ~10 shots/sec
  SR:  0.05,  // ~1.5 shots/sec (charge + fire)
  MG:  0.27,  // ~8 shots/sec
  SG:  0.10,  // ~3 shots/sec
  RL:  0.05,  // ~1.5 shots/sec
};
const RELOAD_TICKS = {
  AR:  60,  // 2s
  SMG: 60,
  SR:  45,
  MG:  90,  // 3s
  SG:  75,
  RL:  90,
};
const BURST_CHARGE_PER_HIT = 4; // % per hit — rough approximation

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Initialize a fresh battle state.
 * @param {BattleConfig} config
 * @returns {BattleState}
 */
export function initBattle(config) {
  const squad = config.squad.map(cfg => {
    const stats = computeFinalStats(cfg);
    return {
      id: cfg.characterId,
      name: cfg.name ?? `NIKKE_${cfg.characterId}`,
      element: cfg.element ?? 'Iron',
      weaponType: cfg.weaponType ?? 'AR',
      stats,
      currentHp: stats.hp,
      ammoLeft: stats.maxAmmo,
      reloadTick: 0,
      burstGauge: 0,
      totalDamage: 0,
      hitCount: 0,
      critCount: 0,
      burstCount: 0,
      activeBuffs: [],
    };
  });

  return {
    squad,
    enemyHp: config.enemy.maxHp,
    enemyMaxHp: config.enemy.maxHp,
    enemyDef: config.enemy.def,
    enemyElement: config.enemy.element ?? 'Iron',
    tick: 0,
    fullBurstActive: false,
    fullBurstTick: 0,
    log: [],
  };
}

/**
 * Advance simulation by one tick.
 * @param {BattleState} state
 * @returns {{ over: boolean, events: object[] }}
 */
export function tick(state) {
  if (state.enemyHp <= 0) return { over: true, events: [] };
  if (state.tick >= MAX_TICKS) return { over: true, events: [] };

  const events = [];
  state.tick++;

  // Full Burst expires?
  if (state.fullBurstActive && state.tick > state.fullBurstTick) {
    state.fullBurstActive = false;
    events.push({ type: 'burst_end', tick: state.tick });
  }

  // Check if all 5 bursts ready → trigger Full Burst
  const burstReady = state.squad.every(u => u.burstGauge >= 100);
  if (burstReady && !state.fullBurstActive) {
    state.fullBurstActive = true;
    state.fullBurstTick = state.tick + TICK_RATE * 10; // 10s burst window
    state.squad.forEach(u => { u.burstGauge = 0; u.burstCount++; });
    events.push({ type: 'full_burst', tick: state.tick });
  }

  // Each unit attacks
  for (const unit of state.squad) {
    if (unit.currentHp <= 0) continue;

    // Reloading
    if (unit.ammoLeft <= 0) {
      if (unit.reloadTick === 0) {
        unit.reloadTick = state.tick + (RELOAD_TICKS[unit.weaponType] ?? 60);
      }
      continue;
    }
    if (unit.reloadTick > 0) {
      if (state.tick < unit.reloadTick) continue;
      unit.ammoLeft = unit.stats.maxAmmo;
      unit.reloadTick = 0;
    }

    // Attack speed check
    const speed = ATTACK_SPEED[unit.weaponType] ?? 0.2;
    if (Math.random() > speed) continue; // probabilistic per-tick attack

    // Fire
    const isCrit = rollCrit(unit.stats.critRate);
    const burstMult = state.fullBurstActive ? 1.5 : 1.0; // basic burst damage boost
    const { damage } = calcDamage({
      atk: unit.stats.atk,
      def: state.enemyDef,
      critRate: unit.stats.critRate,
      critDmg: unit.stats.critDmg,
      attackerElement: unit.element,
      defenderElement: state.enemyElement,
      weaponType: unit.weaponType,
      skillMultiplier: 1.0,
      miscMult: burstMult,
      rolledCrit: isCrit,
    });

    unit.ammoLeft--;
    unit.hitCount++;
    if (isCrit) unit.critCount++;
    unit.totalDamage += damage;
    unit.burstGauge = Math.min(100, unit.burstGauge + BURST_CHARGE_PER_HIT);

    state.enemyHp -= damage;
    events.push({ type: 'hit', tick: state.tick, unitId: unit.id, damage, isCrit });

    if (state.enemyHp <= 0) {
      events.push({ type: 'kill', tick: state.tick });
      return { over: true, events };
    }
  }

  return { over: false, events };
}

/**
 * Run full simulation to completion.
 * @param {BattleConfig} config
 * @returns {BattleResult}
 */
export function simulate(config) {
  const state = initBattle(config);
  const allEvents = [];

  while (true) {
    const { over, events } = tick(state);
    allEvents.push(...events);
    if (over) break;
  }

  return buildResult(state, allEvents);
}

/**
 * Run N Monte Carlo simulations, return averaged results.
 * @param {BattleConfig} config
 * @param {number} iterations
 * @returns {BattleResult}
 */
export function simulateMonteCarlo(config, iterations = 100) {
  const results = [];
  for (let i = 0; i < iterations; i++) {
    results.push(simulate(config));
  }
  return averageResults(results);
}

// ─── Result builders ──────────────────────────────────────────────────────

/**
 * @typedef {Object} UnitResult
 * @property {number} id
 * @property {string} name
 * @property {number} totalDamage
 * @property {number} dps
 * @property {number} critRate    actual
 * @property {number} burstCount
 */

/**
 * @typedef {Object} BattleResult
 * @property {boolean} victory
 * @property {number} timeSeconds
 * @property {number} totalDamage
 * @property {number} dps
 * @property {UnitResult[]} units
 * @property {number} enemyHpLeft
 * @property {number} burstCount
 */

function buildResult(state, events) {
  const timeSeconds = state.tick / TICK_RATE;
  const victory = state.enemyHp <= 0;
  const totalDamage = state.squad.reduce((s, u) => s + u.totalDamage, 0);
  const burstCount = events.filter(e => e.type === 'full_burst').length;

  return {
    victory,
    timeSeconds,
    totalDamage,
    dps: timeSeconds > 0 ? totalDamage / timeSeconds : 0,
    enemyHpLeft: Math.max(0, state.enemyHp),
    burstCount,
    units: state.squad.map(u => ({
      id: u.id,
      name: u.name,
      totalDamage: u.totalDamage,
      dps: timeSeconds > 0 ? u.totalDamage / timeSeconds : 0,
      critRate: u.hitCount > 0 ? u.critCount / u.hitCount : 0,
      burstCount: u.burstCount,
    })),
  };
}

function averageResults(results) {
  const n = results.length;
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / n;

  return {
    victory: results.filter(r => r.victory).length / n > 0.5,
    winRate: results.filter(r => r.victory).length / n,
    timeSeconds: avg(results.map(r => r.timeSeconds)),
    totalDamage: avg(results.map(r => r.totalDamage)),
    dps: avg(results.map(r => r.dps)),
    enemyHpLeft: avg(results.map(r => r.enemyHpLeft)),
    burstCount: avg(results.map(r => r.burstCount)),
    units: results[0].units.map((_, i) => ({
      id: results[0].units[i].id,
      name: results[0].units[i].name,
      totalDamage: avg(results.map(r => r.units[i]?.totalDamage ?? 0)),
      dps: avg(results.map(r => r.units[i]?.dps ?? 0)),
      critRate: avg(results.map(r => r.units[i]?.critRate ?? 0)),
      burstCount: avg(results.map(r => r.units[i]?.burstCount ?? 0)),
    })),
    iterations: n,
  };
}
