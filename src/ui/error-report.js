/**
 * 全局错误弹窗 —— 任何报错都弹窗提示，方便调试。
 *
 * 捕获来源：
 *   - console.error（项目各层的错误日志；模拟 Worker 内的 console.error 由 sim-runner 转发到主线程）
 *   - window 'error'（未捕获异常、Alpine 表达式错误等；资源加载失败不冒泡，不会触发）
 *   - window 'unhandledrejection'（未处理的 Promise 拒绝）
 *
 * 由 index.html 以独立 <script type="module"> 在 main.js 之前加载：主程序模块图加载失败时也能弹窗。
 * 不依赖 Alpine，直接操作 DOM（原生 <dialog>）；所有错误文本经 textContent 写入，不解析 HTML。
 * 相同来源 + 相同消息的错误合并为一条并计数，避免同一错误刷屏。
 *
 * 自动化调试：window.__errorReport() 返回当前已捕获的错误列表（纯数据）。
 */
import { t } from './i18n.js';

const MAX_ENTRIES       = 50;
const MAX_MESSAGE_CHARS = 300;
const MAX_DETAIL_CHARS  = 6000;

/** @type {{ key: string, source: string, message: string, detail: string, count: number, time: number }[]} */
let _entries   = [];
let _reporting = false;           // 防重入：渲染过程中再出错不再上报
let _dom       = null;            // 弹窗 DOM 引用（首次报错时创建）
const _origConsoleError = console.error.bind(console);

// ─── 错误内容整理 ────────────────────────────────────────────────────────────

function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max)}…（${t('errors.truncated', { n: s.length })}）` : s;
}

function isErrorLike(a) {
  return a instanceof Error || (a && typeof a === 'object' && typeof a.message === 'string' && 'stack' in a);
}

/** 单个参数的详细文本：Error 取堆栈，对象转 JSON（循环引用 / 不可序列化时回退 String） */
function describeArg(a) {
  if (isErrorLike(a)) return a.stack || `${a.name}: ${a.message}`;
  if (a && typeof a === 'object') {
    try { return JSON.stringify(a, null, 2) ?? String(a); } catch { return String(a); }
  }
  return String(a);
}

/** 一行摘要：字符串参数 + Error 的 name: message；对象参数只在详情中展示 */
function summarize(args) {
  const parts = args
    .map(a => (isErrorLike(a) ? `${a.name}: ${a.message}` : (a && typeof a === 'object') ? null : String(a)))
    .filter(Boolean);
  return truncate(parts.join(' ') || t('errors.unknown'), MAX_MESSAGE_CHARS);
}

/**
 * 记录一条错误并弹窗。
 * @param {unknown[]} args   console.error 风格的参数列表
 * @param {string}    source 'console' | 'exception' | 'promise'
 * @param {string}    [location] 出错位置（文件:行:列）
 */
export function reportError(args, source, location = '') {
  if (_reporting) return;
  _reporting = true;
  try {
    const list    = Array.isArray(args) ? args : [args];
    const message = summarize(list);
    const detail  = truncate([location, ...list.map(describeArg)].filter(Boolean).join('\n\n'), MAX_DETAIL_CHARS);
    const key     = `${source}|${message}`;
    const found   = _entries.find(e => e.key === key);
    _entries = found
      ? _entries.map(e => (e === found ? { ...e, count: e.count + 1, time: Date.now() } : e))
      : [..._entries, { key, source, message, detail, count: 1, time: Date.now() }].slice(-MAX_ENTRIES);
    render();
  } catch (err) {
    _origConsoleError('[错误弹窗] 渲染失败:', err);
  } finally {
    _reporting = false;
  }
}

// ─── 弹窗 DOM ────────────────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildDialog() {
  const dialog = el('dialog', 'err-dialog');
  dialog.setAttribute('aria-labelledby', 'err-dialog-title');

  const head  = el('header', 'err-head');
  const title = el('h2', 'err-title');
  title.id = 'err-dialog-title';
  const closeX = el('button', 'btn btn-ghost btn-sm', '✕');
  closeX.type = 'button';
  closeX.addEventListener('click', () => dialog.close());
  head.append(title, closeX);

  const list = el('ol', 'err-list');

  const foot    = el('footer', 'err-foot');
  const hint    = el('span', 'err-hint');
  const actions = el('div', 'err-actions');
  const copyBtn  = el('button', 'btn btn-ghost btn-sm');
  const clearBtn = el('button', 'btn btn-ghost btn-sm');
  const okBtn    = el('button', 'btn btn-primary btn-sm');
  for (const b of [copyBtn, clearBtn, okBtn]) b.type = 'button';
  copyBtn.addEventListener('click', () => copyAll(copyBtn));
  clearBtn.addEventListener('click', () => { _entries = []; dialog.close(); });
  okBtn.addEventListener('click', () => dialog.close());
  actions.append(copyBtn, clearBtn, okBtn);
  foot.append(hint, actions);

  dialog.append(head, list, foot);
  document.body.append(dialog);
  return { dialog, title, list, hint, copyBtn, clearBtn, okBtn };
}

function sourceLabel(source) {
  return t(`errors.source.${source}`);
}

function fmtTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function render() {
  if (typeof document === 'undefined' || !document.body) return;
  _dom ??= buildDialog();
  const { dialog, title, list, hint, copyBtn, clearBtn, okBtn } = _dom;

  title.textContent    = t('errors.title', { n: _entries.length });
  hint.textContent     = t('errors.hint');
  copyBtn.textContent  = t('errors.copy');
  clearBtn.textContent = t('errors.clear');
  okBtn.textContent    = t('errors.close');

  // 最新的错误在最上方，默认展开最新一条的详情
  list.replaceChildren(..._entries.slice().reverse().map((e, i) => {
    const item = el('li', 'err-item');
    const meta = el('div', 'err-meta');
    meta.append(
      el('span', 'err-time mono', fmtTime(e.time)),
      el('span', `err-src err-src--${e.source}`, sourceLabel(e.source)),
    );
    if (e.count > 1) meta.append(el('span', 'err-count mono', `×${e.count}`));
    const details = el('details', 'err-details');
    details.open = i === 0;
    details.append(el('summary', 'err-msg', e.message), el('pre', 'err-stack', e.detail));
    item.append(meta, details);
    return item;
  }));

  if (!dialog.open) dialog.showModal();
}

/** 复制全部错误（含详情）到剪贴板，便于粘贴给开发者 */
async function copyAll(btn) {
  const text = _entries.map(e =>
    `[${fmtTime(e.time)}] [${sourceLabel(e.source)}]${e.count > 1 ? ` ×${e.count}` : ''} ${e.message}\n${e.detail}`
  ).join('\n\n────────\n\n');
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = t('errors.copied');
  } catch (err) {
    _origConsoleError('[错误弹窗] 复制失败:', err);
    btn.textContent = t('errors.copyFailed');
  }
  setTimeout(() => { btn.textContent = t('errors.copy'); }, 1600);
}

// ─── 安装全局捕获 ────────────────────────────────────────────────────────────

console.error = (...args) => {
  _origConsoleError(...args);
  reportError(args, 'console');
};

window.addEventListener('error', ev => {
  const where = ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : '';
  reportError([ev.error ?? ev.message], 'exception', where);
});

window.addEventListener('unhandledrejection', ev => {
  reportError([ev.reason ?? t('errors.unknown')], 'promise');
});

window.__errorReport = () => _entries.map(({ source, message, detail, count, time }) =>
  ({ source, message, detail, count, time }));
