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
 */

import { simulate, simulateMonteCarlo } from './battle.js';

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
