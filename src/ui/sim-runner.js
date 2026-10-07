/**
 * 模拟运行器 — 在 Web Worker 中执行战斗模拟，并对外暴露运行状态。
 *
 * 设计意图：
 *   1. 主线程不再被数十秒的同步模拟阻塞，UI 与外部自动化（Playwright MCP）始终可响应；
 *   2. 每次模拟使用全新 Worker，结束 / 超时 / 取消时 terminate，引擎内存随线程整体释放；
 *   3. window.__simStatus 是纯数据快照，自动化脚本可轮询它判断模拟是否完成、失败或超时，
 *      而无需 await 一个可能长时间不返回的调用。
 */

const WORKER_URL = new URL('../engine/sim-worker.js', import.meta.url);

// 超时预算：固定开销 + 每次迭代预算（实测单次迭代约 0.3–0.6s，留足余量）。
const TIMEOUT_BASE_MS     = 30_000;
const TIMEOUT_PER_ITER_MS = 2_000;

const BYTES_PER_MB = 1024 * 1024;

/** 当前 JS 堆占用（MB）；非 Chromium 浏览器无 performance.memory，返回 null。 */
export function heapUsedMB() {
  const mem = globalThis.performance?.memory;
  return mem ? Math.round(mem.usedJSHeapSize / BYTES_PER_MB) : null;
}

/** 堆上限（MB）；不可用时返回 null。 */
export function heapLimitMB() {
  const mem = globalThis.performance?.memory;
  return mem ? Math.round(mem.jsHeapSizeLimit / BYTES_PER_MB) : null;
}

// ─── 对外状态 ────────────────────────────────────────────────────────────────
// state: 'idle' | 'running' | 'done' | 'error' | 'timeout' | 'cancelled'
let _status = Object.freeze({ state: 'idle', runId: 0 });

function _setStatus(patch) {
  _status = Object.freeze({ ..._status, ...patch, heapMB: heapUsedMB(), updatedAt: Date.now() });
  if (typeof window !== 'undefined') window.__simStatus = _status;
}

export function getSimStatus() {
  return _status;
}

if (typeof window !== 'undefined') {
  window.__simStatus = _status;
  // 供自动化读取的即时诊断：包含实时堆占用与运行耗时（__simStatus 只在状态变化时刷新）。
  window.__simDiag = () => ({
    ..._status,
    heapMB:      heapUsedMB(),
    heapLimitMB: heapLimitMB(),
    elapsedMs:   _status.state === 'running' && _status.startedAt ? Date.now() - _status.startedAt : _status.elapsedMs ?? null,
  });
}

// ─── 配置净化 ────────────────────────────────────────────────────────────────

/**
 * 深拷贝为纯数据对象。
 * store 中的角色数据是 Alpine 响应式 Proxy，structuredClone / postMessage 无法直接克隆；
 * 逐层读取并重建即可得到可传给 Worker 的普通对象（保留共享引用，防御循环引用）。
 */
export function toPlain(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (let i = 0; i < value.length; i++) out.push(toPlain(value[i], seen));
    return out;
  }
  const out = {};
  seen.set(value, out);
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (typeof v !== 'function') out[key] = toPlain(v, seen);
  }
  return out;
}

// ─── 运行 ────────────────────────────────────────────────────────────────────

export class SimCancelledError extends Error {
  constructor(message = '模拟已取消') { super(message); this.name = 'SimCancelledError'; }
}
export class SimTimeoutError extends Error {
  constructor(ms) { super(`模拟超时（超过 ${Math.round(ms / 1000)} 秒），已中止`); this.name = 'SimTimeoutError'; }
}

let _active = null; // 当前运行：{ cancel }

/**
 * 在 Worker 中运行一次完整模拟（蒙特卡洛 + 带命中日志的单次模拟）。
 * 同一时刻只允许一个运行；新的调用会先取消旧的。
 *
 * @param {object} baseConfig 引擎配置（可含响应式 Proxy，内部会净化）
 * @param {number} iterations 蒙特卡洛次数
 * @param {{ onProgress?: (done: number, total: number) => void }} [opts]
 * @returns {Promise<{ mcResult: object, hitLog: object[], log: object[] }>}
 */
export function runSimulation(baseConfig, iterations, { onProgress } = {}) {
  _active?.cancel();

  const runId     = _status.runId + 1;
  const startedAt = Date.now();
  const timeoutMs = TIMEOUT_BASE_MS + iterations * TIMEOUT_PER_ITER_MS;
  _setStatus({ state: 'running', runId, done: 0, total: iterations, startedAt, finishedAt: null, elapsedMs: null, error: null });

  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(WORKER_URL, { type: 'module' });
    } catch (err) {
      _setStatus({ state: 'error', error: `无法创建模拟线程：${err.message}`, finishedAt: Date.now(), elapsedMs: Date.now() - startedAt });
      reject(err);
      return;
    }

    let settled = false;
    const finish = (state, error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (_active === handle) _active = null;
      const finishedAt = Date.now();
      _setStatus({ state, error: error ? error.message : null, finishedAt, elapsedMs: finishedAt - startedAt });
      if (error) reject(error); else resolve(value);
    };

    const handle = { cancel: () => finish('cancelled', new SimCancelledError()) };
    _active = handle;

    const timer = setTimeout(() => finish('timeout', new SimTimeoutError(timeoutMs)), timeoutMs);

    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        _setStatus({ done: data.done, total: data.total });
        onProgress?.(data.done, data.total);
      } else if (data.type === 'done') {
        _setStatus({ done: iterations });
        finish('done', null, { mcResult: data.mcResult, hitLog: data.hitLog, log: data.log });
      } else if (data.type === 'error') {
        const err = new Error(data.message);
        err.stack = data.stack || err.stack;
        finish('error', err);
      }
    };
    // 模块加载失败、Worker 内未捕获异常
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      finish('error', new Error(`模拟线程出错：${ev.message || '未知错误（可能是模块加载失败）'}`));
    };
    // 回传数据无法反序列化
    worker.onmessageerror = () => finish('error', new Error('模拟结果无法反序列化'));

    try {
      worker.postMessage({ baseConfig: toPlain(baseConfig), iterations });
    } catch (err) {
      finish('error', new Error(`模拟配置无法传入线程：${err.message}`));
    }
  });
}

/** 取消当前运行（无运行时为空操作）。返回是否确实取消了一个运行。 */
export function cancelSimulation() {
  if (!_active) return false;
  _active.cancel();
  return true;
}
