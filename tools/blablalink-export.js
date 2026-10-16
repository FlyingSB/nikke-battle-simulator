/*
 * Nikke 角色数据导出器（页面内版本）。
 *
 * 在 blablalink 页面上运行，书签小工具与油猴脚本共用本文件：
 *   - 书签：动态插入 <script src=".../blablalink-export.js" data-autorun>，加载后自动打开面板并开始导出；
 *   - 油猴：@require 本文件，由脚本调用 window.__nikkeExport.open()。
 *
 * 不依赖任何 GM_* API：
 *   - 登录 Cookie（game_openid 等）是 HttpOnly，但从本页 fetch 时浏览器会自动携带（credentials: 'include'）；
 *   - openid 取自 localStorage 的 lip-user-info，游戏 ID 取自非 HttpOnly 的 cookie 缓存；
 *   - 服务器自动识别：依次请求各服 GetUserCharacters，取第一个返回角色的服。
 *
 * 数据交付：
 *   - 若本页由模拟器 window.open 打开（存在 window.opener），先握手确认模拟器来源（白名单），
 *     再 postMessage 直接回传，模拟器收到后自动载入；
 *   - 否则（或握手超时）在面板上提供「下载 JSON」「复制 JSON」，再到模拟器中导入。
 */
(function () {
  'use strict';

  /* 重复加载（再次点击书签）时只重新打开面板并导出 */
  if (window.__nikkeExport) { window.__nikkeExport.open({ autoRun: true }); return; }

  var VERSION = '1.0.0';
  var API_BASE = 'https://api.blablalink.com/api/game/proxy/Game/';
  var HOST_ID = 'nikke-export-host';

  /* 服务器：code 为 nikke_area_id，name 为 X-Common-Params.area_id；自动识别时按数组顺序尝试 */
  var SERVERS = [
    { code: 84, name: 'global', label: '国际服 (Global)' },
    { code: 82, name: 'na',     label: '北美服 (NA)' },
    { code: 81, name: 'japan',  label: '日服 (Japan)' },
    { code: 83, name: 'korea',  label: '韩服 (Korea)' },
    { code: 85, name: 'sea',    label: '东南亚服 (SEA)' },
    { code: 91, name: 'hmt',    label: '港澳台服 (HMT)' },
  ];
  var GAME_ID_HMT = '29157';
  var GAME_ID_INTL = '29080';

  /* 允许接收账号数据的模拟器来源：GitHub Pages 正式站 + 本机开发服务器 */
  function isSimulatorOrigin(origin) {
    return origin === 'https://flyingsb.github.io'
      || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  }

  /* 与模拟器约定的消息类型（模拟器端见 src/ui/blablalink-import.js） */
  var MSG = {
    ready: 'nikke-export:ready',
    hello: 'nikke-export:hello',
    data:  'nikke-export:data',
    ack:   'nikke-export:ack',
  };
  var HANDSHAKE_TIMEOUT_MS = 1500;
  var ACK_TIMEOUT_MS = 8000;

  /* ---------- 账号信息 ---------- */

  function readCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function readOpenId() {
    var keys = ['lip-user-info', '__ss_storage_ls_cache_login_meta__'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var info = JSON.parse(localStorage.getItem(keys[i]) || 'null');
        if (info && info.openid) return String(info.openid);
      } catch (e) { /* 该项不是合法 JSON，继续尝试下一项 */ }
    }
    return null;
  }

  /* 候选 (游戏 ID, 服务器) 组合：已知游戏 ID 时只试对应服，未知时国际版各服与港澳台服都试 */
  function candidateTargets(gameId, forcedCode) {
    var list = [];
    SERVERS.forEach(function (s) {
      var gid = s.code === 91 ? GAME_ID_HMT : GAME_ID_INTL;
      if (gameId && gameId !== gid) return;
      if (forcedCode && s.code !== forcedCode) return;
      list.push({ gameId: gid, server: s });
    });
    return list;
  }

  /* ---------- API ---------- */

  function callApi(name, target, payload) {
    var common = {
      game_id: '16',
      area_id: target.server.name,
      source: 'pc_web',
      intl_game_id: target.gameId,
      language: 'zh-TW',
      env: 'prod',
      data_statistics_scene: 'outer',
      data_statistics_page_id: location.href,
      data_statistics_client_type: 'pc_web',
      data_statistics_lang: 'zh-TW',
    };
    return fetch(API_BASE + name, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Channel-Type': '2',
        'X-Common-Params': JSON.stringify(common),
        'X-Language': 'zh-TW',
      },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) throw new Error(name + ': HTTP ' + res.status);
      return res.json();
    });
  }

  function requireOk(name, res) {
    if (!res || res.code !== 0) {
      throw new Error(name + ': code=' + (res && res.code) + ', msg=' + (res && res.msg));
    }
    return res;
  }

  /* 依次尝试候选服，返回第一个有角色的服及其角色列表 */
  function detectServer(openId, targets, onStatus) {
    var i = 0;
    var lastMsg = '';
    function next() {
      if (i >= targets.length) {
        throw new Error('所有服务器均未返回角色数据' + (lastMsg ? '（' + lastMsg + '）' : '')
          + '。请确认已登录，且已在 blablalink 绑定游戏角色。');
      }
      var t = targets[i++];
      onStatus('正在查询 ' + t.server.label + '…');
      return callApi('GetUserCharacters', t, { intl_open_id: openId, nikke_area_id: t.server.code })
        .then(function (res) {
          var chars = res && res.code === 0 && res.data && res.data.characters;
          if (chars && chars.length) return { target: t, characters: chars };
          lastMsg = res && res.msg ? res.msg : '';
          return next();
        });
    }
    return Promise.resolve().then(next);
  }

  /**
   * 拉取并合并账号数据。
   * @param {{ serverCode?: number, onStatus: (msg: string) => void }} opts
   * @returns {Promise<{ json: object, openId: string, server: object, count: number }>}
   */
  function fetchAccount(opts) {
    var onStatus = opts.onStatus;
    var openId = readOpenId();
    if (!openId) return Promise.reject(new Error('未检测到登录信息，请先登录 blablalink 后再试。'));
    var gameId = readCookie('__ss_storage_cookie_cache_game_id__');
    var targets = candidateTargets(gameId, opts.serverCode);
    if (!targets.length) {
      return Promise.reject(new Error('所选服务器与当前账号（游戏 ID ' + gameId + '）不匹配。'));
    }

    return detectServer(openId, targets, onStatus).then(function (found) {
      var t = found.target;
      var base = { intl_open_id: openId, nikke_area_id: t.server.code };
      var nameCodes = found.characters.map(function (c) { return c.name_code; });
      onStatus(t.server.label + '：' + nameCodes.length + ' 个角色，正在拉取详细数据…');
      return Promise.all([
        callApi('GetUserCharacterDetails', t, Object.assign({}, base, { name_codes: nameCodes }))
          .then(function (r) { return requireOk('GetUserCharacterDetails', r); }),
        callApi('GetUserProfileOutpostInfo', t, base)
          .then(function (r) { return requireOk('GetUserProfileOutpostInfo', r); }),
      ]).then(function (rs) {
        var details = rs[0].data || {};
        /* 与油猴脚本旧版输出一致：只保留模拟器需要的三个字段 */
        var json = {
          data: {
            character_details: details.character_details,
            state_effects:     details.state_effects,
            outpost_info:      (rs[1].data || {}).outpost_info,
          },
        };
        var count = (details.character_details || []).length;
        if (!count) throw new Error('角色详细数据为空');
        return { json: json, openId: openId, server: t.server, count: count };
      });
    });
  }

  /* ---------- 与模拟器握手 ---------- */

  /* 解析为模拟器来源（字符串）；无 opener、非白名单来源或超时则解析为 null */
  function handshake() {
    return new Promise(function (resolve) {
      var opener = window.opener;
      if (!opener || opener.closed) { resolve(null); return; }
      var timer = setTimeout(function () { done(null); }, HANDSHAKE_TIMEOUT_MS);
      function onMsg(e) {
        if (e.source !== opener || !e.data || e.data.type !== MSG.hello) return;
        if (!isSimulatorOrigin(e.origin)) return;
        done(e.origin);
      }
      function done(origin) {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(origin);
      }
      window.addEventListener('message', onMsg);
      /* ready 消息不含任何账号数据，可以发往任意来源 */
      try { opener.postMessage({ type: MSG.ready, version: VERSION }, '*'); } catch (e) { done(null); }
    });
  }

  /* 回传数据（只发往握手确认的来源）并等待模拟器确认；解析为 { ok, count?, error? } */
  function sendToSimulator(origin, json) {
    return new Promise(function (resolve) {
      var opener = window.opener;
      if (!opener || opener.closed) { resolve({ ok: false, error: '模拟器页面已关闭' }); return; }
      var timer = setTimeout(function () { done({ ok: false, error: '模拟器未响应' }); }, ACK_TIMEOUT_MS);
      function onMsg(e) {
        if (e.source !== opener || e.origin !== origin || !e.data || e.data.type !== MSG.ack) return;
        done({ ok: !!e.data.ok, count: e.data.count, error: e.data.error });
      }
      function done(r) {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(r);
      }
      window.addEventListener('message', onMsg);
      opener.postMessage({ type: MSG.data, version: VERSION, payload: json }, origin);
    });
  }

  /* ---------- 下载 / 复制 ---------- */

  function pad(n) { return String(n).padStart(2, '0'); }
  function timestampNow() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_'
      + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function downloadText(filename, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* 移动端下载可能异步开始，延迟释放 */
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  /* 优先 Clipboard API；不可用或被拒时退回 execCommand（部分移动浏览器） */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve().then(function () { return legacyCopy(text); });
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (!ok) throw new Error('复制失败');
  }

  /* ---------- 面板 UI（Shadow DOM，避免与站点样式互相影响） ---------- */

  var STYLE = [
    ':host { all: initial; }',
    '.panel { position: fixed; top: 64px; right: 12px; z-index: 2147483647;',
    '  width: min(340px, calc(100vw - 24px)); box-sizing: border-box;',
    '  background: #1f2230; color: #e8eaf2; border: 1px solid #2e3344; border-radius: 10px;',
    '  box-shadow: 0 8px 32px rgba(0,0,0,.45); padding: 14px 14px 12px;',
    '  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }',
    '.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }',
    '.title { font-weight: 600; font-size: 14px; }',
    '.ver { color: #7b8099; font-size: 11px; margin-left: 6px; font-weight: 400; }',
    '.close { background: none; border: 0; color: #a8adbe; font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 6px; }',
    'label { display: block; font-size: 12px; color: #a8adbe; margin-bottom: 4px; }',
    'select { width: 100%; padding: 8px 10px; background: #262a3a; color: #e8eaf2;',
    '  border: 1px solid #353a4d; border-radius: 6px; font-size: 14px; margin-bottom: 10px; }',
    '.row { display: flex; gap: 8px; }',
    'button.btn { flex: 1; padding: 10px; border: 0; border-radius: 6px; font-size: 13px; font-weight: 600;',
    '  cursor: pointer; background: #5b6cff; color: #fff; font-family: inherit; }',
    'button.btn:hover:not(:disabled) { background: #4a5ce8; }',
    'button.btn.ghost { background: #2c3143; color: #e8eaf2; }',
    'button.btn.ghost:hover:not(:disabled) { background: #363c52; }',
    'button.btn:disabled { opacity: .55; cursor: not-allowed; }',
    '.status { margin-top: 10px; font-size: 12px; min-height: 18px; white-space: pre-wrap; word-break: break-word; color: #a8adbe; }',
    '.status.info { color: #8ab4ff; } .status.success { color: #4ade80; } .status.error { color: #f87171; }',
    '.out { margin-top: 8px; display: none; } .out.show { display: flex; }',
  ].join('\n');

  var ui = null;      /* { host, select, runBtn, out, status } */
  var result = null;  /* 最近一次导出结果 */
  var busy = false;

  function buildUi() {
    var host = document.createElement('div');
    host.id = HOST_ID;
    var root = host.attachShadow({ mode: 'open' });
    var options = '<option value="">自动识别</option>' + SERVERS.map(function (s) {
      return '<option value="' + s.code + '">' + s.label + '</option>';
    }).join('');
    root.innerHTML = '<style>' + STYLE + '</style>'
      + '<div class="panel" role="dialog" aria-label="Nikke 角色数据导出">'
      + '<div class="head"><div class="title">Nikke 角色数据导出<span class="ver">v' + VERSION + '</span></div>'
      + '<button class="close" type="button" aria-label="关闭">×</button></div>'
      + '<label for="srv">服务器</label><select id="srv">' + options + '</select>'
      + '<div class="row"><button class="btn run" type="button">导出</button></div>'
      + '<div class="row out"><button class="btn ghost dl" type="button">下载 JSON</button>'
      + '<button class="btn ghost cp" type="button">复制 JSON</button></div>'
      + '<div class="status" aria-live="polite"></div>'
      + '</div>';
    document.body.appendChild(host);

    ui = {
      host: host,
      select: root.querySelector('#srv'),
      runBtn: root.querySelector('.run'),
      out: root.querySelector('.out'),
      status: root.querySelector('.status'),
    };
    root.querySelector('.close').addEventListener('click', close);
    ui.runBtn.addEventListener('click', run);
    root.querySelector('.dl').addEventListener('click', onDownload);
    root.querySelector('.cp').addEventListener('click', onCopy);
  }

  function onDownload() {
    if (!result) return;
    var name = result.openId + '_user_character_details_' + timestampNow() + '.json';
    downloadText(name, JSON.stringify(result.json, null, 2));
    setStatus('已下载：' + name + '\n回到模拟器点「导入账号」选择该文件。', 'success');
  }

  function onCopy() {
    if (!result) return;
    copyText(JSON.stringify(result.json)).then(function () {
      setStatus('已复制到剪贴板。\n回到模拟器的「从 blablalink 导入」中点「从剪贴板读取」。', 'success');
    }, function () {
      setStatus('复制失败，请改用「下载 JSON」。', 'error');
    });
  }

  function setStatus(msg, type) {
    ui.status.className = 'status' + (type ? ' ' + type : '');
    ui.status.textContent = msg;
  }

  function setBusy(b) {
    busy = b;
    ui.runBtn.disabled = b;
    ui.select.disabled = b;
  }

  function reportDelivery(sent) {
    ui.out.classList.add('show');
    if (sent && sent.ok) {
      setStatus('✓ 已导入模拟器（' + (sent.count || result.count) + ' 个角色），可以关闭此页。', 'success');
    } else if (sent) {
      setStatus('已获取 ' + result.count + ' 个角色，但发送到模拟器失败（' + (sent.error || '未知原因') + '）。\n'
        + '请用下方按钮下载或复制后手动导入。', 'error');
    } else {
      setStatus('已获取 ' + result.count + ' 个角色（' + result.server.label + '）。\n下载或复制后到模拟器中导入。', 'success');
    }
  }

  function run() {
    if (busy) return;
    setBusy(true);
    ui.out.classList.remove('show');
    result = null;
    var serverCode = ui.select.value ? parseInt(ui.select.value, 10) : undefined;
    /* 握手与数据拉取并行，握手超时不拖慢整体 */
    var originP = handshake();
    fetchAccount({ serverCode: serverCode, onStatus: function (m) { setStatus(m, 'info'); } })
      .then(function (r) {
        result = r;
        ui.select.value = String(r.server.code);
        return originP.then(function (origin) {
          if (!origin) return null;
          setStatus('已获取 ' + r.count + ' 个角色，正在发送到模拟器…', 'info');
          return sendToSimulator(origin, r.json);
        });
      })
      .then(function (sent) { if (result) reportDelivery(sent); })
      .catch(function (err) {
        setStatus('错误：' + (err && err.message ? err.message : err), 'error');
      })
      .then(function () { setBusy(false); });
  }

  function open(opts) {
    if (!ui || !document.getElementById(HOST_ID)) buildUi();
    ui.host.style.display = '';
    if (opts && opts.autoRun) run();
  }

  function close() {
    if (ui) ui.host.style.display = 'none';
  }

  function toggle() {
    if (ui && document.getElementById(HOST_ID) && ui.host.style.display !== 'none') close();
    else open();
  }

  window.__nikkeExport = { version: VERSION, open: open, close: close, toggle: toggle, fetchAccount: fetchAccount };

  /* 书签加载时 script 标签带 data-autorun；油猴 @require 时不自动运行，由脚本决定 */
  var cur = document.currentScript;
  if (cur && cur.hasAttribute('data-autorun')) open({ autoRun: true });
})();
