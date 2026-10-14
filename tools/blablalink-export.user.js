// ==UserScript==
// @name         Nikke 角色数据导出
// @namespace    https://www.blablalink.com/
// @version      1.5.1
// @downloadURL  https://flyingsb.github.io/nikke-battle-simulator/tools/blablalink-export.user.js
// @updateURL    https://flyingsb.github.io/nikke-battle-simulator/tools/blablalink-export.user.js
// @description  在 blablalink 页面上一键导出 Nikke 账号角色详细数据与据点信息为 JSON
// @match        https://www.blablalink.com/*
// @match        https://*.blablalink.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @connect      api.blablalink.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- 常量 ----------
  const SERVERS = [
    { code: 81, name: 'japan',  label: '日服 (Japan)' },
    { code: 82, name: 'na',     label: '北美服 (NA)' },
    { code: 83, name: 'korea',  label: '韩服 (Korea)' },
    { code: 84, name: 'global', label: '国际服 (Global)' },
    { code: 85, name: 'sea',    label: '东南亚服 (SEA)' },
    { code: 91, name: 'hmt',    label: '港澳台服 (HMT)' },
  ];
  // 新版在前，旧版在后，依次尝试
  const TARGET_SELECTORS = [
    'div.flex.items-center.relative.shrink-0',
    'div.flex.items-center.relative',
  ];
  const PANEL_ID = 'nikke-export-panel';
  const ICON_ID = 'nikke-export-icon';
  const API_BASE = 'https://api.blablalink.com/api/game/proxy/Game/';
  const PERM_HINT = '\n如已登录仍报错，请在浏览器扩展管理中，将 Tampermonkey 的「网站访问权限」设为「在所有网站上」，然后完全重启浏览器。';

  // ---------- 工具 ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function timestampNow() {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // 读取所有 cookie（含 HttpOnly）
  function getAllCookies() {
    return new Promise((resolve, reject) => {
      if (typeof GM_cookie === 'undefined' || !GM_cookie.list) {
        reject(new Error('GM_cookie 不可用，请确认使用 Tampermonkey 并已授权。' + PERM_HINT));
        return;
      }
      GM_cookie.list({ url: location.href }, (cookies, error) => {
        if (error) { reject(new Error('读取 Cookie 失败: ' + error + PERM_HINT)); return; }
        if (!cookies || !cookies.length) {
          reject(new Error('未读取到任何 Cookie，请先登录。' + PERM_HINT));
          return;
        }
        const map = {};
        cookies.forEach(c => { map[c.name] = c.value; });
        const str = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        resolve({ map, str });
      });
    });
  }

  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...opts,
        onload: res => {
          if (res.status >= 200 && res.status < 300) {
            try { resolve(JSON.parse(res.responseText)); }
            catch (e) { reject(new Error('响应不是合法 JSON: ' + res.responseText.slice(0, 200))); }
          } else {
            reject(new Error(`HTTP ${res.status}: ${res.responseText.slice(0, 200)}`));
          }
        },
        onerror: () => reject(new Error('网络请求失败')),
        ontimeout: () => reject(new Error('请求超时')),
      });
    });
  }

  // 调用 blablalink API，校验业务 code
  async function callApi(name, headers, payload) {
    const res = await gmRequest({
      method: 'POST',
      url: API_BASE + name,
      headers,
      data: JSON.stringify(payload),
    });
    if (res.code !== 0) throw new Error(`${name}: code=${res.code}, msg=${res.msg}`);
    return res;
  }

  // ---------- UI ----------
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
    span.addEventListener('click', togglePanel);
    return span;
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position: fixed;
      top: 64px;
      right: 16px;
      z-index: 999999;
      width: 320px;
      background: #1f2230;
      color: #e8eaf2;
      border: 1px solid #2e3344;
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 13px;
      display: none;
    `;

    const optionsHtml = SERVERS.map(s =>
      `<option value="${s.code}|${s.name}">${s.label}</option>`
    ).join('');

    panel.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <div style="font-weight:600; font-size:14px;">Nikke 角色数据导出</div>
        <span id="nikke-close-btn" style="cursor:pointer; opacity:.7; font-size:18px; line-height:1;">×</span>
      </div>

      <div style="margin-bottom:10px;">
        <div style="font-size:12px; color:#a8adbe; margin-bottom:6px;">服务器</div>
        <select id="nikke-server" style="
          width:100%; padding:8px 10px; background:#262a3a; color:#e8eaf2;
          border:1px solid #353a4d; border-radius:6px; font-size:13px; outline:none;">
          ${optionsHtml}
        </select>
      </div>

      <div style="margin-bottom:12px; font-size:11px; color:#7b8099; line-height:1.5;">
        Cookie 将自动从浏览器读取（含 HttpOnly）。<br>
        如读取失败，请在 <span style="color:#d4d6e0;">扩展管理</span> 中将 Tampermonkey 的<span style="color:#ffb84d;">「网站访问权限」设为「在所有网站上」</span>，并完全重启浏览器。
      </div>

      <button id="nikke-export-btn" style="
        width:100%; padding:9px; background:#5b6cff; color:#fff;
        border:none; border-radius:6px; font-size:13px; font-weight:600;
        cursor:pointer; transition:background .15s;">导出</button>

      <div id="nikke-status" style="
        margin-top:10px; font-size:12px; min-height:16px;
        line-height:1.5; word-break:break-all; white-space:pre-wrap;"></div>
    `;

    panel.querySelector('#nikke-close-btn').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    const exportBtn = panel.querySelector('#nikke-export-btn');
    exportBtn.addEventListener('click', doExport);
    exportBtn.addEventListener('mouseenter', e => {
      if (!e.target.disabled) e.target.style.background = '#4a5ce8';
    });
    exportBtn.addEventListener('mouseleave', e => {
      if (!e.target.disabled) e.target.style.background = '#5b6cff';
    });

    return panel;
  }

  function togglePanel() {
    const p = document.getElementById(PANEL_ID);
    if (!p) return;
    p.style.display = (p.style.display === 'none' || !p.style.display) ? 'block' : 'none';
  }

  function setStatus(msg, type) {
    const el = document.getElementById('nikke-status');
    if (!el) return;
    const colors = { info: '#8ab4ff', success: '#4ade80', error: '#f87171' };
    el.style.color = colors[type] || '#a8adbe';
    el.textContent = msg;
  }

  function setBusy(btn, busy) {
    btn.disabled = busy;
    btn.style.opacity = busy ? '0.6' : '1';
    btn.style.cursor = busy ? 'not-allowed' : 'pointer';
  }

  // ---------- 业务 ----------
  async function doExport() {
    const btn = document.getElementById('nikke-export-btn');
    const sel = document.getElementById('nikke-server').value;
    const [serverCode, serverName] = sel.split('|');

    setBusy(btn, true);

    try {
      setStatus('正在读取 Cookie…', 'info');
      const { map: cookies, str: cookieStr } = await getAllCookies();

      if (!cookies.game_gameid) throw new Error('Cookie 中缺少 game_gameid，请先登录。' + PERM_HINT);
      if (!cookies.game_openid) throw new Error('Cookie 中缺少 game_openid，请先登录。' + PERM_HINT);

      const gameId = cookies.game_gameid;
      const openId = cookies.game_openid;

      if (gameId !== '29080' && gameId !== '29157') {
        throw new Error(`game_gameid 只能为 29080 或 29157（当前：${gameId}）`);
      }
      if (gameId === '29157' && serverCode !== '91') {
        throw new Error('game_gameid=29157 时，服务器必须为港澳台服');
      }
      if (gameId === '29080' && serverCode === '91') {
        throw new Error('game_gameid=29080 时，服务器不能为港澳台服');
      }

      const xCommonParams = {
        game_id: '16',
        area_id: serverName,
        source: 'pc_web',
        intl_game_id: gameId,
        language: 'zh-TW',
        env: 'prod',
        data_statistics_scene: 'outer',
        data_statistics_page_id: 'https://www.blablalink.com/shiftyspad/nikke?nikke=16&skin_index=1',
        data_statistics_client_type: 'pc_web',
        data_statistics_lang: 'zh-TW'
      };

      const headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en,zh;q=0.9,zh-CN;q=0.8,zh-TW;q=0.7',
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
        'Origin': 'https://www.blablalink.com',
        'Priority': 'u=1, i',
        'Referer': 'https://www.blablalink.com/',
        'Sec-Ch-Ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'User-Agent': navigator.userAgent,
        'X-Channel-Type': '2',
        'X-Common-Params': JSON.stringify(xCommonParams),
        'X-Language': 'zh-TW'
      };

      const payloadBase = { intl_open_id: openId, nikke_area_id: parseInt(serverCode, 10) };

      // 1) 角色列表
      setStatus('正在获取角色列表…', 'info');
      const d1 = await callApi('GetUserCharacters', headers, payloadBase);
      const characters = (d1.data && d1.data.characters) || [];
      if (!characters.length) throw new Error('账号中没有任何角色');
      const nameCodes = characters.map(c => c.name_code);

      // 2) 角色详细数据
      setStatus(`已获取 ${nameCodes.length} 个角色，正在拉取详细数据…`, 'info');
      const d2 = await callApi('GetUserCharacterDetails', headers, { ...payloadBase, name_codes: nameCodes });

      // 3) 据点信息
      setStatus('正在拉取据点信息…', 'info');
      const d3 = await callApi('GetUserProfileOutpostInfo', headers, payloadBase);

      // 合并：仅保留指定三个字段
      const merged = {
        data: {
          character_details: d2.data.character_details,
          state_effects:     d2.data.state_effects,
          outpost_info:      d3.data.outpost_info,
        }
      };

      const filename = `${openId}_user_character_details_${timestampNow()}.json`;
      downloadJson(filename, merged);
      setStatus(`导出成功：${filename}`, 'success');
    } catch (err) {
      setStatus('错误：' + (err && err.message ? err.message : err), 'error');
    } finally {
      setBusy(btn, false);
    }
  }

  // ---------- 注入 ----------
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
    if (target.querySelector('#' + ICON_ID)) return true;

    target.insertBefore(buildIcon(), target.firstChild);
    if (!document.getElementById(PANEL_ID)) {
      document.body.appendChild(buildPanel());
    }
    return true;
  }

  if (!inject()) {
    const observer = new MutationObserver(() => {
      const target = findTarget();
      if (target && !target.querySelector('#' + ICON_ID)) {
        inject();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();