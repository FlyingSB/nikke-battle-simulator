/**
 * NIKKE Battle Simulator — Entry point
 */
import { loadAllData } from './data/loader.js';
import { renderSquadBuilder } from './ui/squad-builder.js';
import { renderResults } from './ui/results.js';
import { simulate, simulateMonteCarlo } from './engine/battle.js';
import { computeFinalStats } from './engine/stats.js';

const $loader   = document.getElementById('loader');
const $progress = document.getElementById('loadProgress');
const $app      = document.getElementById('app');
const $builder  = document.getElementById('squadBuilder');
const $results  = document.getElementById('results');

async function init() {
  showLoader('Loading game data...');

  try {
    await loadAllData((key, done, total) => {
      $progress.textContent = `Loading ${key}… (${done}/${total})`;
    });
    $progress.textContent = 'Data loaded ✓';
  } catch (err) {
    $progress.textContent = `⚠ Failed to load some data: ${err.message}. Using fallback.`;
  }

  hideLoader();
  renderSquadBuilder($builder, onSimulate);
}

function onSimulate(config) {
  if (!config.squad.length) {
    alert('Enable at least one NIKKE slot.');
    return;
  }

  // Apply stat overrides if user entered manual values
  const processedSquad = config.squad.map(cfg => {
    if (cfg._atkOverride || cfg._hpOverride || cfg._defOverride) {
      cfg._statOverride = {
        atk: cfg._atkOverride || undefined,
        hp:  cfg._hpOverride  || undefined,
        def: cfg._defOverride || undefined,
      };
    }
    return cfg;
  });

  const processedConfig = { ...config, squad: processedSquad };

  $results.innerHTML = '<p class="loading-text">Simulating…</p>';
  $results.scrollIntoView({ behavior: 'smooth' });

  // Run simulation async to not block UI
  setTimeout(() => {
    try {
      const result = config.useMonteCarlo
        ? simulateMonteCarlo(processedConfig, config.iterations)
        : simulate(processedConfig);

      renderResults($results, result);
    } catch (err) {
      $results.innerHTML = `<p class="error">Simulation error: ${err.message}</p>`;
      console.error(err);
    }
  }, 10);
}

function showLoader(msg) {
  $progress.textContent = msg;
  $loader.classList.remove('hidden');
  $app.classList.add('hidden');
}

function hideLoader() {
  $loader.classList.add('hidden');
  $app.classList.remove('hidden');
}

init();
