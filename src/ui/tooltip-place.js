/**
 * 浮动 tooltip（伤害 / 技能 / Buff / 充能）的定位与触屏关闭。
 *
 * 桌面：跟随鼠标，超出视口时翻到光标另一侧。
 * 窄屏或触屏（无悬停能力）：改为贴底抽屉（.tip--sheet），宽度撑满视口，内容过长时内部滚动；
 * 触屏上点按触发元素即显示（浏览器会为轻触补发 mouseenter），点按其它位置时由
 * bindTouchTipDismiss 统一关闭。
 */

const TIP_IDS = ['dmg-tooltip', 'skill-tooltip', 'buff-tooltip', 'gauge-tooltip'];

// 触发 tooltip 的元素：在这些元素上点按不关闭（由其自身的 mouseenter 处理器替换内容）
const TIP_TRIGGERS = '.log-label--tip, .buff-tag, .log-dmg--tip, .log-gauge--tip';

const sheetQuery = typeof matchMedia === 'function'
  ? matchMedia('(max-width: 760px), (hover: none)')
  : null;

/** 是否使用贴底抽屉样式 */
function useSheet() {
  return !!sheetQuery?.matches;
}

/**
 * 显示并定位 tooltip。调用前须已写入内容。
 * @param {HTMLElement} tip
 * @param {MouseEvent} event 触发事件（取光标坐标）
 */
export function placeTip(tip, event) {
  if (useSheet()) {
    tip.classList.add('tip--sheet');
    tip.style.left = '';
    tip.style.top  = '';
    tip.style.display = 'block';
    tip.scrollTop = 0;
    return;
  }
  tip.classList.remove('tip--sheet');
  // 先移出视口渲染一次以测量尺寸，再按光标位置摆放
  tip.style.left = '-9999px';
  tip.style.top  = '0px';
  tip.style.display = 'block';
  const rect = tip.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = event.clientX + 16, y = event.clientY + 8;
  if (x + rect.width  > vw) x = event.clientX - rect.width  - 8;
  if (y + rect.height > vh) y = event.clientY - rect.height - 8;
  tip.style.left = Math.max(4, x) + 'px';
  tip.style.top  = Math.max(4, y) + 'px';
}

/** 隐藏全部浮动 tooltip */
export function hideAllTips() {
  for (const id of TIP_IDS) {
    const tip = document.getElementById(id);
    if (tip) tip.style.display = 'none';
  }
}

/**
 * 触屏：点按触发元素与 tooltip 本身以外的任何位置时关闭 tooltip。
 * 触屏上 mouseleave 不一定可靠触发（如点按空白区域），因此需要这层兜底。
 */
export function bindTouchTipDismiss() {
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const el = /** @type {Element} */ (e.target);
    if (el.closest?.(TIP_TRIGGERS) || TIP_IDS.some(id => el.closest?.('#' + id))) return;
    hideAllTips();
  }, { passive: true });
}
