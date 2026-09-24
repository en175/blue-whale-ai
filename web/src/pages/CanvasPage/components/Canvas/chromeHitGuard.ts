/** 画布上层控件（工具栏 / 小地图 / 缩放条 / 节点跟随条）命中标记 */
export const CANVAS_CHROME_SELECTOR = '[data-canvas-chrome], .react-flow__minimap';
/** 盖在 chrome 之上的浮层（标签操作层 / @ 菜单 / 预览）：命中它们不得转发给底下的工具条 */
export const CANVAS_OVERLAY_SELECTOR = '[data-canvas-overlay]';

const CHROME_INTERACTIVE = 'button, a, [role="button"], input';
const registeredChrome = new Set<Element>();

function pointInRect(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isFullViewportCover(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width >= window.innerWidth - 2 && rect.height >= window.innerHeight - 2;
}

export function registerCanvasChrome(el: Element | null): () => void {
  if (!el) return () => {};
  registeredChrome.add(el);
  return () => {
    registeredChrome.delete(el);
  };
}

function collectChromeRoots(): Element[] {
  const roots = new Set<Element>(registeredChrome);
  for (const node of document.querySelectorAll(CANVAS_CHROME_SELECTOR)) {
    roots.add(node);
  }
  return [...roots];
}

/** 只按控件矩形判断 */
export function canvasChromeAtPoint(clientX: number, clientY: number): Element | null {
  for (const root of collectChromeRoots()) {
    if (isFullViewportCover(root)) continue;
    const style = getComputedStyle(root);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (pointInRect(root.getBoundingClientRect(), clientX, clientY)) return root;
    for (const extra of root.querySelectorAll('[class*="popup"]')) {
      if (!(extra instanceof Element) || isFullViewportCover(extra)) continue;
      if (pointInRect(extra.getBoundingClientRect(), clientX, clientY)) return root;
    }
  }
  return null;
}

/** 浮层在 pointerdown 卸掉后，同一次手势的 click 仍落在底下 chrome 上，需吞掉转发 */
let overlayGestureUntil = 0;

function markOverlayGesture(): void {
  overlayGestureUntil = performance.now() + 400;
}

function overlayGestureActive(): boolean {
  return performance.now() < overlayGestureUntil;
}

function isCanvasOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CANVAS_OVERLAY_SELECTOR) != null;
}

export function isStolenCanvasChromeHit(event: Event): boolean {
  if (!('clientX' in event) || !('clientY' in event)) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest(CANVAS_CHROME_SELECTOR)) return false;
  if (isCanvasOverlayTarget(target)) {
    if (event.type === 'pointerdown' || event.type === 'mousedown') markOverlayGesture();
    return false;
  }
  if (overlayGestureActive()) return false;
  const { clientX, clientY } = event as PointerEvent;
  return canvasChromeAtPoint(clientX, clientY) != null;
}

let selectionLockUntil = 0;
let selectionLockIds: Set<string> | null = null;
let idleSelectedIds = new Set<string>();

/** 指针不在工具栏上时记住选中，避免穿透先选中再上锁把脏快照锁进去 */
export function rememberIdleSelection(ids: Iterable<string>): void {
  if (selectionLockIds && performance.now() < selectionLockUntil) return;
  idleSelectedIds = new Set(ids);
}

export function lockChromeSelection(ids?: Iterable<string>): void {
  selectionLockIds = new Set(ids ?? idleSelectedIds);
  selectionLockUntil = performance.now() + 600;
}

export function chromeSelectionLockIds(): Set<string> | null {
  if (!selectionLockIds || performance.now() >= selectionLockUntil) return null;
  return selectionLockIds;
}

export function releaseChromeSelectionLock(): void {
  if (performance.now() < selectionLockUntil) return;
  selectionLockIds = null;
}

let pointerOverChrome = false;

export function trackChromePointer(clientX: number, clientY: number): boolean {
  pointerOverChrome = canvasChromeAtPoint(clientX, clientY) != null;
  return pointerOverChrome;
}

/** 指针在工具栏上，或本轮工具栏手势尚未结束：不要应用选中、不要挂操作栏 */
export function shouldSuppressCanvasSelection(): boolean {
  return pointerOverChrome || chromeSelectionLockIds() != null;
}

let lastChromeClickAt = 0;
let lastChromeClickEl: Element | null = null;

function chromeInteractiveAt(clientX: number, clientY: number): HTMLElement | null {
  const chrome = canvasChromeAtPoint(clientX, clientY);
  if (!chrome) return null;
  for (const node of chrome.querySelectorAll(CHROME_INTERACTIVE)) {
    if (!(node instanceof HTMLElement) || isFullViewportCover(node)) continue;
    if (pointInRect(node.getBoundingClientRect(), clientX, clientY)) return node;
  }
  return null;
}

function rememberChromeClick(el: Element): void {
  lastChromeClickEl = el;
  lastChromeClickAt = performance.now();
}

function alreadyClicked(el: Element): boolean {
  return lastChromeClickEl === el && performance.now() - lastChromeClickAt < 400;
}

export function swallowStolenCanvasChromeHit(event: Event): boolean {
  const target = event.target;
  if (target instanceof Element && target.closest(CANVAS_CHROME_SELECTOR)) {
    if (event.type === 'click') {
      const interactive = target.closest(CHROME_INTERACTIVE);
      if (interactive instanceof HTMLElement) rememberChromeClick(interactive);
    }
    return false;
  }
  if (!isStolenCanvasChromeHit(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();
  if (target instanceof HTMLVideoElement) target.pause();
  else if (target instanceof Element) target.closest('video')?.pause();
  if (event.type !== 'click' || !('clientX' in event)) return true;
  const { clientX, clientY } = event as PointerEvent;
  const interactive = chromeInteractiveAt(clientX, clientY);
  if (!interactive || alreadyClicked(interactive)) return true;
  rememberChromeClick(interactive);
  interactive.click();
  return true;
}
