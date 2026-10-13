/**
 * 战斗模拟 Web Worker（module worker）。
 *
 * 在独立线程中运行蒙特卡洛模拟 + 一次带命中日志的单次模拟，使主线程在模拟期间保持可响应：
 *   - UI 可显示进度、可取消；
 *   - 外部自动化（Playwright MCP 等）在模拟期间仍能执行脚本、读取状态。
 * 主线程每次模拟新建一个 Worker、结束后立即 terminate，引擎在模拟中产生的全部内存随线程一并释放。
 *
 * 消息协议：
 *   入：{ baseConfig, iterations }
 *   出：{ type: 'progress', done, total }
 *       { type: 'done', mcResult, hitLog, log }
 *       { type: 'error', message, stack }
 *       { type: 'console-error', text }   引擎内 console.error 的转发（主线程错误弹窗只能捕获主线程日志）
 */

import { simulate, simulateMonteCarlo } from './battle.js';

const MAX_FORWARD_ARG_CHARS = 2000;

// 单个日志参数转文本：Error 取堆栈；对象转 JSON 并截断（引擎常附带整个单位配置）
function formatLogArg(a) {
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
  if (a && typeof a === 'object') {
    let s;
    try { s = JSON.stringify(a); } catch { s = String(a); }
    return s.length > MAX_FORWARD_ARG_CHARS ? `${s.slice(0, MAX_FORWARD_ARG_CHARS)}…` : s;
  }
  return String(a);
}

const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
  _origConsoleError(...args);
  try {
    self.postMessage({ type: 'console-error', text: args.map(formatLogArg).join('\n') });
  } catch (err) {
    _origConsoleError('[sim-worker] 转发错误日志失败:', err);
  }
};

// 进度消息节流：每完成约 5% 迭代才发送一次，避免大量小消息。
const PROGRESS_STEP_RATIO = 0.05;

self.onmessage = ({ data }) => {
  const { baseConfig, iterations } = data;
  try {
    const step = Math.max(1, Math.round(iterations * PROGRESS_STEP_RATIO));
    const mcResult = simulateMonteCarlo(baseConfig, iterations, (done, total) => {
      if (done % step === 0 || done === total) self.postMessage({ type: 'progress', done, total });
    });
    const single = simulate({ ...baseConfig, hitLog: true });
    // 只回传 UI 用到的字段：buffLog / ammoLog / burstEnergyLog 体积大且主线程不用。
    self.postMessage({ type: 'done', mcResult, hitLog: single.hitLog, log: single.log ?? [] });
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err), stack: err?.stack ?? '' });
  }
};
