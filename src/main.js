/**
 * NIKKE 战斗模拟器 — 入口
 *
 * 初始化流程：
 *   1. 从 CDN 导入 Alpine.js ESM 版本
 *   2. 注册全局 store（createStore()）
 *   3. 启动 Alpine（处理 HTML 中的指令）
 *   4. store.init() 由 HTML x-init 触发，异步加载游戏数据
 */

import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.3/dist/module.esm.js';
import { createStore } from './ui/store.js';

Alpine.store('sim', createStore());

// ── 自动保存 ──────────────────────────────────────────────────────────────────
document.addEventListener('alpine:initialized', () => {
  let _saveTimer = null;
  Alpine.effect(() => {
    const sim = Alpine.store('sim');
    if (sim.loading) return;
    const snapshot = sim._getSnapshot();
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try { localStorage.setItem('nikke-sim-v1', JSON.stringify(snapshot)); } catch {}
    }, 500);
  });
});

// ── echarts 懒加载 ────────────────────────────────────────────────────────────
let _echarts = null;
async function getEcharts() {
  if (_echarts) return _echarts;
  const mod = await import('https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.esm.min.js');
  _echarts = mod.default ?? mod;
  return _echarts;
}

function fmtNum(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

// 供 Alpine x-effect 调用，在结果更新后重绘图表
window.__renderDamageChart = async function (result) {
  if (!result?.units?.length) return;
  const el = document.getElementById('dmgChart');
  if (!el) return;
  const echarts = await getEcharts();
  const chart   = echarts.getInstanceByDom(el) ?? echarts.init(el, null, { renderer: 'svg' });

  const units  = result.units.filter(u => u.totalDamage > 0);
  const COLORS = ['#e05c4f', '#4fa3e0', '#2ecc71', '#f0a500', '#9b59b6'];

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      confine: true,
      formatter: params => {
        const u    = units[params.dataIndex];
        const pct  = result.totalDamage > 0 ? (u.totalDamage / result.totalDamage * 100).toFixed(1) : '0.0';
        return `${params.name}<br/>伤害：${fmtNum(u.totalDamage)}<br/>占比：${pct}%`;
      },
    },
    xAxis: {
      type: 'category',
      data: units.map(u => u.name),
      axisLabel: { color: '#7a8498', fontSize: 11, interval: 0, rotate: units.length > 3 ? 15 : 0 },
      axisLine: { lineStyle: { color: '#2a2f3d' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#7a8498', fontSize: 10, formatter: v => fmtNum(v) },
      splitLine: { lineStyle: { color: '#1c2130' } },
    },
    series: [{
      type: 'bar',
      data: units.map((u, i) => ({
        value: u.totalDamage,
        itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [4, 4, 0, 0] },
      })),
      label: {
        show: true, position: 'top',
        color: '#d4dbe8', fontSize: 11,
        formatter: p => fmtNum(p.value),
      },
    }],
    grid: { left: 56, right: 12, top: 36, bottom: 36 },
  });
};

Alpine.start();
