/**
 * 可注入的随机源 —— 便于确定性测试。
 *
 * 引擎内所有随机判定（暴击、核心命中、攻速门等）统一走 `rng()`，
 * 默认使用 `Math.random`。测试或需要可复现结果时，通过 `simulate(config)`
 * 的 `config.rng` 注入自定义生成器（如种子序列 `()=>0` 必真、`()=>0.999` 必假）。
 *
 * 注意：这是模块级可变状态，仅适用于串行模拟（蒙特卡洛逐次运行）。
 */

let _rng = Math.random;

/**
 * 设置随机源。传入 null/undefined 时恢复为 Math.random。
 * @param {(() => number)|null|undefined} fn
 */
export function setRng(fn) {
  _rng = typeof fn === 'function' ? fn : Math.random;
}

/** 返回 [0,1) 的随机数（走当前注入的随机源）。 */
export function rng() {
  return _rng();
}
