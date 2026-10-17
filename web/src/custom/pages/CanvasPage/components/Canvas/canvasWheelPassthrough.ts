import { useEffect, type RefObject } from 'react';

export function findFlowRenderer(from: Element): HTMLElement | null {
  const flow = from.closest('.react-flow');
  if (flow) return flow.querySelector<HTMLElement>('.react-flow__renderer');
  const stage = from.closest('[data-canvas-stage]');
  return stage?.querySelector<HTMLElement>('.react-flow__renderer') ?? null;
}

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

export function forwardWheelToRenderer(event: WheelEvent, rendererScope?: Element | null): boolean {
  const target = event.target;
  const renderer = (target instanceof Element ? findFlowRenderer(target) : null)
    ?? rendererScope?.querySelector<HTMLElement>('.react-flow__renderer') ?? null;
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

export function useOverlayWheelPassthrough(
  ref: RefObject<HTMLElement | null>,
  options?: { ignoreInsideReactFlow?: boolean; rendererScope?: Element | null },
) {
  const ignoreInsideReactFlow = options?.ignoreInsideReactFlow ?? false;
  const rendererScope = options?.rendererScope;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !el.contains(target)) return;
      if (ignoreInsideReactFlow && target.closest('.react-flow')) return;
      if (wheelTargetScrollsWithin(target, el)) {
        if (event.ctrlKey || event.metaKey) event.preventDefault();
        return;
      }
      if (forwardWheelToRenderer(event, rendererScope)) {
        event.preventDefault();
        return;
      }
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, true);
  });
}
