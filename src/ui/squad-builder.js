/**
 * Squad Builder UI component.
 * Renders 5 NIKKE slots + enemy config form.
 */
import { getAllCharacters, getAllEquipment, getAllHarmonyCubes } from '../data/models.js';

const FACTIONS = ['ELYSION', 'MISSILIS', 'TETRA', 'PILGRIM', 'ABNORMAL'];
const CLASSES   = ['Attacker', 'Defender', 'Supporter'];
const ELEMENTS  = ['Fire', 'Water', 'Wind', 'Electric', 'Iron'];
const WEAPONS   = ['AR', 'SMG', 'SR', 'MG', 'SG', 'RL'];

/**
 * Render squad builder into a container element.
 * @param {HTMLElement} container
 * @param {(config: import('../engine/battle.js').BattleConfig) => void} onSimulate
 */
export function renderSquadBuilder(container, onSimulate) {
  container.innerHTML = buildHTML();
  bindEvents(container, onSimulate);
}

// ─── HTML ──────────────────────────────────────────────────────────────────

function buildHTML() {
  return `
<section class="squad-builder">
  <h2>Squad Configuration</h2>

  <div class="squad-slots" id="squadSlots">
    ${[0,1,2,3,4].map(i => slotHTML(i)).join('')}
  </div>

  <section class="enemy-config">
    <h2>Enemy</h2>
    <div class="config-grid">
      <label>HP
        <input type="number" id="enemyHp" value="10000000" min="1" step="100000">
      </label>
      <label>DEF
        <input type="number" id="enemyDef" value="500" min="0" step="10">
      </label>
      <label>Element
        <select id="enemyElement">
          ${ELEMENTS.map(e => `<option value="${e}">${e}</option>`).join('')}
        </select>
      </label>
      <label>Type
        <select id="enemyType">
          <option value="Normal">Normal Rapture</option>
          <option value="Elite">Elite Rapture</option>
          <option value="Boss">Boss</option>
        </select>
      </label>
    </div>
  </section>

  <section class="sim-options">
    <h2>Simulation</h2>
    <div class="config-grid">
      <label>
        <input type="checkbox" id="useMonteCarlo" checked>
        Monte Carlo (avg crit RNG)
      </label>
      <label>Iterations
        <input type="number" id="iterations" value="200" min="1" max="2000" step="50">
      </label>
    </div>
  </section>

  <button class="btn-simulate" id="btnSimulate">▶ Simulate</button>
</section>`;
}

function slotHTML(i) {
  return `
<div class="slot-card" data-slot="${i}">
  <div class="slot-header">
    <span class="slot-num">NIKKE ${i + 1}</span>
    <button class="btn-toggle-slot" data-slot="${i}">Enable</button>
  </div>
  <div class="slot-body hidden" data-slot-body="${i}">
    <div class="config-grid">
      <label>Character ID
        <input type="number" class="char-id" data-slot="${i}" value="${1000 + i}" min="1">
      </label>
      <label>Name
        <input type="text" class="char-name" data-slot="${i}" value="NIKKE ${i+1}">
      </label>
      <label>Class
        <select class="char-class" data-slot="${i}">
          ${CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </label>
      <label>Element
        <select class="char-element" data-slot="${i}">
          ${ELEMENTS.map(e => `<option value="${e}">${e}</option>`).join('')}
        </select>
      </label>
      <label>Weapon
        <select class="char-weapon" data-slot="${i}">
          ${WEAPONS.map(w => `<option value="${w}">${w}</option>`).join('')}
        </select>
      </label>
      <label>Level
        <input type="number" class="char-level" data-slot="${i}" value="200" min="1" max="556">
      </label>
      <label>Ascension (0-40)
        <input type="number" class="char-attractive" data-slot="${i}" value="0" min="0" max="40">
      </label>
      <label>ATK (override)
        <input type="number" class="char-atk" data-slot="${i}" value="0" min="0"
               placeholder="0 = use data">
      </label>
      <label>HP (override)
        <input type="number" class="char-hp" data-slot="${i}" value="0" min="0">
      </label>
      <label>DEF (override)
        <input type="number" class="char-def" data-slot="${i}" value="0" min="0">
      </label>
    </div>
  </div>
</div>`;
}

// ─── Events ────────────────────────────────────────────────────────────────

function bindEvents(container, onSimulate) {
  // Toggle slots
  container.querySelectorAll('.btn-toggle-slot').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.slot;
      const body = container.querySelector(`[data-slot-body="${i}"]`);
      const hidden = body.classList.toggle('hidden');
      btn.textContent = hidden ? 'Enable' : 'Disable';
    });
  });

  // Enable first slot by default
  const firstBtn = container.querySelector('.btn-toggle-slot[data-slot="0"]');
  if (firstBtn) firstBtn.click();

  // Simulate button
  container.querySelector('#btnSimulate').addEventListener('click', () => {
    const config = buildConfig(container);
    onSimulate(config);
  });
}

function buildConfig(container) {
  const squad = [];

  for (let i = 0; i < 5; i++) {
    const body = container.querySelector(`[data-slot-body="${i}"]`);
    if (body.classList.contains('hidden')) continue;

    const val = (cls) => container.querySelector(`.${cls}[data-slot="${i}"]`)?.value;

    const atkOverride = parseInt(val('char-atk')) || 0;
    const hpOverride  = parseInt(val('char-hp'))  || 0;
    const defOverride = parseInt(val('char-def'))  || 0;

    squad.push({
      characterId:   parseInt(val('char-id')) || 1000 + i,
      name:          val('char-name') || `NIKKE ${i+1}`,
      classType:     val('char-class') || 'Attacker',
      element:       val('char-element') || 'Iron',
      weaponType:    val('char-weapon') || 'AR',
      level:         parseInt(val('char-level'))      || 200,
      attractiveLv:  parseInt(val('char-attractive')) || 0,
      equipment:     [],
      cube:          null,
      cubeLevel:     0,
      researchIds:   [],
      // Stat overrides applied in stats.js if non-zero
      _atkOverride:  atkOverride,
      _hpOverride:   hpOverride,
      _defOverride:  defOverride,
    });
  }

  return {
    squad,
    enemy: {
      maxHp:   parseInt(container.querySelector('#enemyHp').value)   || 10_000_000,
      def:     parseInt(container.querySelector('#enemyDef').value)   || 500,
      element: container.querySelector('#enemyElement').value || 'Iron',
      type:    container.querySelector('#enemyType').value    || 'Normal',
    },
    useMonteCarlo: container.querySelector('#useMonteCarlo').checked,
    iterations:    parseInt(container.querySelector('#iterations').value) || 200,
  };
}
