// ==UserScript==
// @name         Nikke 角色数据导出
// @namespace    https://www.blablalink.com/
// @version      2.0.0
// @downloadURL  https://flyingsb.github.io/nikke-battle-simulator/tools/blablalink-export.user.js
// @updateURL    https://flyingsb.github.io/nikke-battle-simulator/tools/blablalink-export.user.js
// @description  在 blablalink 页面上一键导出 Nikke 账号角色详细数据与据点信息，可直接回传模拟器或保存为 JSON
// @match        https://www.blablalink.com/*
// @match        https://*.blablalink.com/*
// @require      https://flyingsb.github.io/nikke-battle-simulator/tools/blablalink-export.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// 导出逻辑与面板在 @require 的 blablalink-export.js 中（与书签小工具共用），本脚本只负责：
//   1. 在站点顶栏注入入口图标，点击切换导出面板；
//   2. 页面由模拟器「从 blablalink 导入」打开时（window.name 约定见 src/ui/blablalink-import.js），自动开始导出。
// 自 2.0.0 起不再需要 GM_cookie / GM_xmlhttpRequest，也无需修改 Tampermonkey 的网站访问权限。

(function () {
  'use strict';

  const exporter = window.__nikkeExport;
  if (!exporter) return;

  // 新版在前，旧版在后，依次尝试
  const TARGET_SELECTORS = [
    'div.flex.items-center.relative.shrink-0',
    'div.flex.items-center.relative',
  ];
  const ICON_ID = 'nikke-export-icon';
  const SIM_WINDOW_NAME = 'nikke-sim-export';

  function buildIcon() {
    const span = document.createElement('span');
    span.id = ICON_ID;
    span.className = 'fill-current cursor-pointer w-[24px] h-[24px]';
    span.setAttribute('data-cname', 'svg-icon');
    span.style.color = '#3EAFFF';
    span.title = 'Nikke 角色数据导出';
    span.innerHTML = `
      <svg width="100%" height="100%" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M24 6 V30 M14 22 L24 32 L34 22" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8 36 V40 H40 V36" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    span.addEventListener('click', () => exporter.toggle());
    return span;
  }

  function findTarget() {
    for (const sel of TARGET_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function inject() {
    const target = findTarget();
    if (!target) return false;
    if (!target.querySelector('#' + ICON_ID)) target.insertBefore(buildIcon(), target.firstChild);
    return true;
  }

  // 站点为 SPA，顶栏可能晚于脚本出现或被重新渲染，持续观察并补注入
  inject();
  new MutationObserver(() => {
    const target = findTarget();
    if (target && !target.querySelector('#' + ICON_ID)) inject();
  }).observe(document.body, { childList: true, subtree: true });

  if (window.name === SIM_WINDOW_NAME && window.opener) exporter.open({ autoRun: true });
})();
