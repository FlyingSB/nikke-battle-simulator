/**
 * 从 blablalink 导入账号：模拟器端。
 *
 * blablalink 的接口只允许其自身来源跨域调用、登录 Cookie 为 HttpOnly，模拟器无法直接请求，
 * 因此数据由运行在 blablalink 页面上的导出器（tools/blablalink-export.js，书签或油猴脚本加载）拉取。
 * 本模块负责：
 *   1. window.open 打开 blablalink（窗口名 SIM_WINDOW_NAME，油猴脚本据此自动开始导出）；
 *   2. 与导出器 postMessage 握手：ready → hello → data → ack；
 *      只接受来自本模块打开的窗口、且来源为 *.blablalink.com 的消息；
 *   3. 校验粘贴 / 剪贴板中的账号 JSON（自动回传不可用时的后备路径）。
 */

export const BLABLALINK_URL = 'https://www.blablalink.com/shiftyspad';
export const SIM_WINDOW_NAME = 'nikke-sim-export';

// 与 tools/blablalink-export.js 中的 MSG 保持一致
const MSG = {
  ready: 'nikke-export:ready',
  hello: 'nikke-export:hello',
  data:  'nikke-export:data',
  ack:   'nikke-export:ack',
};

const BLABLALINK_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*blablalink\.com$/;

/** 当前会话：{ win, onData }；同一时间只保留一个 */
let session = null;

function onMessage(e) {
  if (!session || e.source !== session.win || !BLABLALINK_ORIGIN_RE.test(e.origin)) return;
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === MSG.ready) {
    // 告知导出器本页来源，导出器校验白名单后才会发送账号数据
    e.source.postMessage({ type: MSG.hello }, e.origin);
    return;
  }
  if (msg.type === MSG.data) {
    // onData 成功时会关闭导入弹窗并 stopBlablalinkExport()（session 置空），先保存窗口引用
    const win = session.win;
    let res;
    try {
      res = session.onData(msg.payload);
    } catch (err) {
      res = { ok: false, error: err?.message ?? String(err) };
    }
    e.source.postMessage({ type: MSG.ack, ok: !!res?.ok, count: res?.count, error: res?.error }, e.origin);
    // 导入成功后关闭 blablalink 标签，浏览器回到模拟器页（脚本打开的窗口允许由打开方关闭）
    if (res?.ok) {
      setTimeout(() => { try { win.close(); } catch { /* 已被用户关闭 */ } }, 600);
    }
  }
}

/**
 * 打开 blablalink 并等待导出器回传。须在用户点击事件中同步调用（否则会被弹窗拦截）。
 * @param {(payload: unknown) => { ok: boolean, count?: number, error?: string }} onData 收到数据时调用，返回值回传给导出器
 * @returns {boolean} 窗口是否成功打开
 */
export function openBlablalinkExport(onData) {
  const win = window.open(BLABLALINK_URL, SIM_WINDOW_NAME);
  if (!win) return false;
  if (!session) window.addEventListener('message', onMessage);
  session = { win, onData };
  return true;
}

/** 停止接收回传（关闭导入弹窗时调用） */
export function stopBlablalinkExport() {
  if (!session) return;
  window.removeEventListener('message', onMessage);
  session = null;
}

/**
 * 解析粘贴 / 剪贴板中的账号 JSON。
 * @param {string} text
 * @returns {{ ok: true, json: object } | { ok: false, errorKey: string }}
 */
export function parseAccountText(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: false, errorKey: 'acctImport.err.empty' };
  let json;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { ok: false, errorKey: 'acctImport.err.json' };
  }
  const details = json?.data?.character_details;
  if (!Array.isArray(details) || !details.length) return { ok: false, errorKey: 'acctImport.err.format' };
  return { ok: true, json };
}
