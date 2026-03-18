/**
 * Results view — renders BattleResult from battle engine.
 */

/**
 * @param {HTMLElement} container
 * @param {import('../engine/battle.js').BattleResult} result
 */
export function renderResults(container, result) {
  container.innerHTML = buildHTML(result);
  renderDamageChart(container, result);
}

function buildHTML(r) {
  const isAveraged = r.iterations > 1;
  const winLabel = isAveraged
    ? `Win rate: ${(r.winRate * 100).toFixed(1)}%`
    : (r.victory ? '✓ Victory' : '✗ Defeat');

  const timeStr = r.timeSeconds.toFixed(2) + 's';
  const dpsStr  = formatNumber(r.dps);
  const dmgStr  = formatNumber(r.totalDamage);
  const hpPct   = ((r.enemyHpLeft / (r.enemyHpLeft + r.totalDamage)) * 100).toFixed(1);

  return `
<section class="results">
  <h2>Results ${isAveraged ? `<small>(avg of ${r.iterations} runs)</small>` : ''}</h2>

  <div class="result-summary">
    <div class="stat-card ${r.victory ? 'victory' : 'defeat'}">
      <span class="label">Outcome</span>
      <span class="value">${winLabel}</span>
    </div>
    <div class="stat-card">
      <span class="label">Time to Kill</span>
      <span class="value">${timeStr}</span>
    </div>
    <div class="stat-card">
      <span class="label">Total DPS</span>
      <span class="value">${dpsStr}</span>
    </div>
    <div class="stat-card">
      <span class="label">Total Damage</span>
      <span class="value">${dmgStr}</span>
    </div>
    <div class="stat-card">
      <span class="label">Full Bursts</span>
      <span class="value">${r.burstCount.toFixed(1)}</span>
    </div>
    ${!r.victory ? `
    <div class="stat-card defeat">
      <span class="label">Enemy HP Left</span>
      <span class="value">${hpPct}%</span>
    </div>` : ''}
  </div>

  <h3>Unit Breakdown</h3>
  <table class="unit-table">
    <thead>
      <tr>
        <th>NIKKE</th>
        <th>Total Damage</th>
        <th>DPS</th>
        <th>Share</th>
        <th>Crit Rate</th>
        <th>Bursts</th>
      </tr>
    </thead>
    <tbody>
      ${r.units.map(u => {
        const share = r.totalDamage > 0
          ? ((u.totalDamage / r.totalDamage) * 100).toFixed(1)
          : '0.0';
        return `
        <tr>
          <td>${u.name}</td>
          <td>${formatNumber(u.totalDamage)}</td>
          <td>${formatNumber(u.dps)}</td>
          <td>
            <div class="share-bar">
              <div class="share-fill" style="width:${share}%"></div>
              <span>${share}%</span>
            </div>
          </td>
          <td>${(u.critRate * 100).toFixed(1)}%</td>
          <td>${u.burstCount.toFixed(1)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  <h3>Damage Distribution</h3>
  <canvas id="dmgChart" width="600" height="220"></canvas>
</section>`;
}

function renderDamageChart(container, r) {
  const canvas = container.querySelector('#dmgChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };

  ctx.clearRect(0, 0, W, H);

  const units = r.units.filter(u => u.totalDamage > 0);
  if (!units.length) return;

  const maxDmg = Math.max(...units.map(u => u.totalDamage));
  const barW = (W - padding.left - padding.right) / units.length - 8;
  const chartH = H - padding.top - padding.bottom;

  const colors = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6'];

  units.forEach((u, i) => {
    const barH = (u.totalDamage / maxDmg) * chartH;
    const x = padding.left + i * (barW + 8);
    const y = padding.top + chartH - barH;

    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y, barW, barH);

    // Label
    ctx.fillStyle = '#ccc';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(u.name.substring(0, 8), x + barW / 2, H - padding.bottom + 15);
    ctx.fillText(formatNumber(u.totalDamage), x + barW / 2, y - 4);
  });

  // Y axis
  ctx.strokeStyle = '#555';
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, H - padding.bottom);
  ctx.stroke();
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.floor(n).toString();
}
