/** 会挡住画布选中的上层控件：左侧栏 / 左下角 / 缩放条 / 小地图。不含节点跟随操作栏。 */
export const CANVAS_BLOCK_CHROME_SELECTOR = '[data-canvas-chrome="block"], .react-flow__minimap';

function pointInRect(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isFullViewportCover(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width >= window.innerWidth - 2 && rect.height >= window.innerHeight - 2;
}

/** 坐标是否落在会挡住选中的上层控件上 */
export function canvasChromeAtPoint(clientX: number, clientY: number): Element | null {
  for (const root of document.querySelectorAll(CANVAS_BLOCK_CHROME_SELECTOR)) {
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

export function isStolenCanvasChromeHit(event: Event): boolean {
  if (!('clientX' in event) || !('clientY' in event)) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest(CANVAS_BLOCK_CHROME_SELECTOR)) return false;
  const { clientX, clientY } = event as PointerEvent;
  return canvasChromeAtPoint(clientX, clientY) != null;
}

let lockedIds: Set<string> | null = null;
let idleSelectedIds = new Set<string>();
let pointerOverBlockChrome = false;

export function rememberIdleSelection(ids: Iterable<string>): void {
  if (lockedIds) return;
  idleSelectedIds = new Set(ids);
}

export function lockChromeSelection(ids?: Iterable<string>): void {
  lockedIds = new Set(ids ?? idleSelectedIds);
}

export function unlockChromeSelection(): void {
  lockedIds = null;
}

export function chromeSelectionLockIds(): Set<string> | null {
  return lockedIds;
}

export function trackChromePointer(clientX: number, clientY: number): boolean {
  pointerOverBlockChrome = canvasChromeAtPoint(clientX, clientY) != null;
  return pointerOverBlockChrome;
}

/** 指针在左侧栏/小地图等挡选控件上，或本轮按下尚未抬起 */
export function shouldSuppressCanvasSelection(): boolean {
  return pointerOverBlockChrome || lockedIds != null;
}

/** 拦截打到节点上、坐标却在挡选控件里的事件。不补发 click，以免工具栏连点/丢手势。 */
export function swallowStolenCanvasChromeHit(event: Event): boolean {
  if (!isStolenCanvasChromeHit(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  if ('stopImmediatePropagation' in event) event.stopImmediatePropagation();
  return true;
}
