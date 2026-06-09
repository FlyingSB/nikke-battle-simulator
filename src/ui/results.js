/**
 * 结果视图 — 渲染战斗引擎返回的 BattleResult。
 */

const TICK_RATE = 60;

/**
 * @param {HTMLElement} container
 * @param {import('../engine/battle.js').BattleResult} result
 */
export function renderResults(container, result) {
  container.innerHTML = buildHTML(result);
  renderDamageChart(container, result);
  initLogFilters(container);
}

function buildHTML(r) {
  const isAveraged = (r.iterations ?? 1) > 1;
  const timeStr    = formatDuration(r.timeSeconds);
  const dpsStr     = formatNumber(r.dps);
  const dmgStr     = formatNumber(r.totalDamage);
  const hpPct      = r.enemyMaxHp
    ? (r.enemyHpLeft / (r.enemyMaxHp ?? (r.enemyHpLeft + r.totalDamage)) * 100).toFixed(1)
    : '0.0';

  const outcomeLabel = isAveraged
    ? `胜率 ${(r.winRate * 100).toFixed(1)}%`
    : (r.victory ? '胜利' : `剩余体力 ${hpPct}%`);
  const outcomeClass = r.victory ? 'victory' : 'defeat';

  return `
<section class="results">
  <h2>结果 ${isAveraged ? `<small>（${r.iterations} 次运行平均）</small>` : ''}</h2>

  <div class="result-summary">
    <div class="stat-card ${outcomeClass}">
      <span class="label">结果</span>
      <span class="value">${outcomeLabel}</span>
    </div>
    <div class="stat-card">
      <span class="label">${r.victory ? '击杀用时' : '战斗时长'}</span>
      <span class="value">${timeStr}</span>
    </div>
    <div class="stat-card">
      <span class="label">队伍 DPS</span>
      <span class="value">${dpsStr}</span>
    </div>
    <div class="stat-card">
      <span class="label">总伤害</span>
      <span class="value">${dmgStr}</span>
    </div>
    <div class="stat-card">
      <span class="label">Full Burst 次数</span>
      <span class="value">${typeof r.burstCount === 'number' ? r.burstCount.toFixed(isAveraged ? 1 : 0) : r.burstCount}</span>
    </div>
    ${!r.victory && !isAveraged ? `
    <div class="stat-card defeat">
      <span class="label">敌人剩余体力</span>
      <span class="value">${formatNumber(r.enemyHpLeft)}</span>
    </div>` : ''}
  </div>

  <h3>每位 NIKKE 造成的伤害</h3>
  <table class="unit-table">
    <thead>
      <tr>
        <th>NIKKE</th>
        <th>伤害</th>
        <th>DPS</th>
        <th>占比</th>
        <th>暴击率</th>
        <th>爆裂次数</th>
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
          <td>${typeof u.burstCount === 'number' ? u.burstCount.toFixed(isAveraged ? 1 : 0) : u.burstCount}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>

  <h3>伤害分布</h3>
  <canvas id="dmgChart" width="600" height="220"></canvas>

  ${buildLogHTML(r.log, isAveraged)}
</section>`;
}

// ─── 战斗日志 ───────────────────────────────────────────────────────────────

const LOG_LABELS = {
  burst_i:       { label: 'Burst I',          cls: 'log-burst-i'    },
  burst_ii:      { label: 'Burst II',         cls: 'log-burst-ii'   },
  burst_iii:     { label: 'Burst III',        cls: 'log-burst-iii'  },
  full_burst:    { label: '⚡ Full Burst',    cls: 'log-full-burst' },
  burst_end:     { label: 'Full Burst 结束', cls: 'log-burst-end'  },
  burst_timeout: { label: 'Full Burst 超时', cls: 'log-burst-end'  },
  reload:        { label: 'Reload',           cls: 'log-reload'     },
  hit:           { label: '普通攻击',         cls: 'log-hit'        },
  phase_change:  { label: '阶段切换',        cls: 'log-phase'      },
  skill_trigger: { label: '技能触发',        cls: 'log-skill'      },
};

function buildLogHTML(log, isAveraged) {
  if (!log || !log.length) {
    return `
<h3>战斗日志</h3>
<p class="loading-text" style="padding:1rem">本次运行未发生爆裂事件。</p>`;
  }

  // 收集按首次出现顺序排列的角色名（排除 hit，避免顺序被射击事件干扰）
  const unitNames = [];
  const seenUnits = new Set();
  for (const e of log) {
    if (e.unitName && e.type !== 'hit' && !seenUnits.has(e.unitName)) {
      seenUnits.add(e.unitName);
      unitNames.push(e.unitName);
    }
  }
  const hasHits = log.some(e => e.type === 'hit');

  const unitBtns = unitNames.map(n =>
    `<button class="log-filter-btn log-filter-btn--active" data-filter-unit="${n}">${n}</button>`
  ).join('');
  const hitBtn = hasHits
    ? `<button class="log-filter-btn" data-filter-hit>普通攻击</button>`
    : '';

  let lineNum = 0;
  const rows = log.map(e => {
    const meta    = LOG_LABELS[e.type] ?? { label: e.type, cls: '' };
    const t       = e.tick / TICK_RATE;
    const mm      = String(Math.floor(t / 60)).padStart(2, '0');
    const ss      = String(Math.floor(t % 60)).padStart(2, '0');
    const burstSuffix = (e.type === 'full_burst' && e.burstNum != null) ? ` #${e.burstNum}` : '';
    const name    = e.unitName ? ` — ${e.unitName}` : '';
    const isHit   = e.type === 'hit';
    const hidden  = isHit ? ' log-hidden' : '';
    const unitAttr = e.unitName ? ` data-unit="${e.unitName}"` : '';
    if (!isHit) lineNum++;
    return `<div class="log-row ${meta.cls}${hidden}" data-type="${e.type}"${unitAttr}>
      <span class="log-line">${isHit ? '' : lineNum}</span>
      <span class="log-time">[${mm}:${ss}]</span>
      <span class="log-desc">${meta.label}${burstSuffix}${name}</span>
    </div>`;
  }).join('');

  const note = isAveraged ? ' <small>（取自第 1 次运行）</small>' : '';
  return `
<h3>战斗日志${note}</h3>
<div class="log-filters">${unitBtns}${hitBtn}</div>
<div class="battle-log">${rows}</div>`;
}

function initLogFilters(container) {
  const filterBar = container.querySelector('.log-filters');
  if (!filterBar) return;

  const allRows   = [...container.querySelectorAll('.log-row[data-type]')];
  const activeUnits = new Set(
    [...filterBar.querySelectorAll('[data-filter-unit]')].map(b => b.dataset.filterUnit)
  );
  let showHits = false;

  function applyFilters() {
    let n = 0;
    for (const row of allRows) {
      const unit  = row.dataset.unit;
      const isHit = row.dataset.type === 'hit';
      const show  = (!unit || activeUnits.has(unit)) && (!isHit || showHits);
      row.classList.toggle('log-hidden', !show);
      if (show) row.querySelector('.log-line').textContent = ++n;
    }
  }

  filterBar.addEventListener('click', e => {
    const btn = e.target.closest('.log-filter-btn');
    if (!btn) return;
    if ('filterHit' in btn.dataset) {
      showHits = !showHits;
      btn.classList.toggle('log-filter-btn--active', showHits);
    } else if ('filterUnit' in btn.dataset) {
      const unit = btn.dataset.filterUnit;
      if (activeUnits.has(unit)) activeUnits.delete(unit);
      else activeUnits.add(unit);
      btn.classList.toggle('log-filter-btn--active', activeUnits.has(unit));
    }
    applyFilters();
  });
}

// ─── 图表 ────────────────────────────────────────────────────────────────────

function renderDamageChart(container, r) {
  const canvas = container.querySelector('#dmgChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };

  ctx.clearRect(0, 0, W, H);

  const units = r.units.filter(u => u.totalDamage > 0);
  if (!units.length) return;

  const maxDmg  = Math.max(...units.map(u => u.totalDamage));
  const barW    = (W - padding.left - padding.right) / units.length - 8;
  const chartH  = H - padding.top - padding.bottom;
  const colors  = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];

  units.forEach((u, i) => {
    const barH = (u.totalDamage / maxDmg) * chartH;
    const x    = padding.left + i * (barW + 8);
    const y    = padding.top + chartH - barH;

    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y, barW, barH);

    ctx.fillStyle = '#ccc';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(u.name.substring(0, 8), x + barW / 2, H - padding.bottom + 15);
    ctx.fillText(formatNumber(u.totalDamage), x + barW / 2, y - 4);
  });

  // Y 轴
  ctx.strokeStyle = '#555';
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, H - padding.bottom);
  ctx.stroke();
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

function formatNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.floor(n).toString();
}

function formatDuration(sec) {
  const m  = Math.floor(sec / 60);
  const s  = (sec % 60).toFixed(1);
  return m > 0 ? `${m}:${s.padStart(4, '0')}` : `${sec.toFixed(1)}s`;
}
