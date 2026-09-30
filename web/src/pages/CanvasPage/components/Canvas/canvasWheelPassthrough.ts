/* ============================================
 * 浮层滚轮直通（IKIXDB）：生成面板 Dock / 钉屏幕工具栏等画布浮层不在
 * .react-flow__renderer 命中链上，wheel 到不了 renderer 上挂的 d3-zoom，
 * 画布平移被浮层截断。本模块把 CropFrame 的「暗区手势直通」提炼为共享工具：
 * renderer 定位 + wheel 合成转发（字段清单与 CropFrame 逐字一致）+ 浮层接管 hook。
 * 滚轮语义不变（本仓滚轮=平移 ADR-0081，ctrl/meta+滚轮、触控板捏合=缩放）。
 * ============================================ */
import { useEffect, type RefObject } from 'react';

/** 从命中元素定位 React Flow 的 d3-zoom 挂载层：优先 .react-flow 根（渲染在 flow
 *  内的浮层，如 CropFrame / NodeFollowToolbar），兜底最近画布舞台 [data-canvas-stage]
 *  （渲染在 flow 外的 Dock 等浮层，沿舞台向下找唯一 renderer）。 */
export function findFlowRenderer(from: Element): HTMLElement | null {
  const flow = from.closest('.react-flow');
  if (flow) return flow.querySelector<HTMLElement>('.react-flow__renderer');
  const stage = from.closest('[data-canvas-stage]');
  return stage?.querySelector<HTMLElement>('.react-flow__renderer') ?? null;
}

/** wheel 目标是否落在 boundary（不含）以内的真实滚动区：textarea、React Flow
 *  nowheel 约定（滚内容不滚画布），或 overflow auto/scroll/overlay 且内容实际溢出
 *  的容器（几何判定，浮层内可滚区无需逐个打标）。 */
export function wheelTargetScrollsWithin(target: Element, boundary: Element): boolean {
  for (let el: Element | null = target; el && el !== boundary; el = el.parentElement) {
    if (el instanceof HTMLTextAreaElement) return true;
    if (el.classList.contains('nowheel')) return true;
    const style = getComputedStyle(el);
    const scrollX = (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'overlay') && el.scrollWidth > el.clientWidth;
    const scrollY = (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') && el.scrollHeight > el.clientHeight;
    if (scrollX || scrollY) return true;
  }
  return false;
}

/** 把 wheel 事件按原字段转发给 renderer（同 CropFrame 暗区直通的字段清单）；
 *  找到 renderer 并派发返回 true，定位失败（浮层在舞台外/画布未挂载）返回 false。 */
export function forwardWheelToRenderer(event: WheelEvent): boolean {
  const target = event.target;
  const renderer = target instanceof Element ? findFlowRenderer(target) : null;
  if (!renderer) return false;
  renderer.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: false,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    }),
  );
  return true;
}

/** 浮层滚轮接管：原生捕获监听（React onWheel 根委托是 passive，拦不了默认行为）。
 *  浮层上的 wheel 转发给画布 renderer（IKIXDB：画布平移不被浮层截断）并拦默认；
 *  浮层内真实滚动区滚自身；ctrl/meta 恒拦浏览器整页缩放（原 canvasWrapper 行为）。
 *  ignoreInsideReactFlow：画布自身路径已由 d3-zoom 处理，不干预（canvasWrapper 场景）。
 *  effect 不设 deps：条件渲染浮层（如 NodeFollowToolbar early-return 翻转）挂载后
 *  下一帧布防、卸载拆防；wheel 监听无状态，重挂幂等。 */
export function useOverlayWheelPassthrough(
  ref: RefObject<HTMLElement | null>,
  options?: { ignoreInsideReactFlow?: boolean },
) {
  const ignoreInsideReactFlow = options?.ignoreInsideReactFlow ?? false;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !el.contains(target)) return;
      if (ignoreInsideReactFlow && target.closest('.react-flow')) return;
      if (wheelTargetScrollsWithin(target, el)) {
        // 可滚区滚自身内容；ctrl/meta 仍拦整页缩放（可滚区上捏合缩放交给画布语义）
        if (event.ctrlKey || event.metaKey) event.preventDefault();
        return;
      }
      if (forwardWheelToRenderer(event)) {
        event.preventDefault();
        return;
      }
      // 无 renderer（浮层在舞台外/画布未挂载）：仅保留整页缩放兜底
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, true);
  });
}
