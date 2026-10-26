if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof Element !== 'undefined') {
  if (!('PointerEvent' in globalThis)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    (globalThis as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent =
      PointerEventPolyfill as unknown as typeof PointerEvent;
  }
  const elementPrototype = Element.prototype as Element & {
    hasPointerCapture?: (pointerId: number) => boolean;
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
  };
  elementPrototype.hasPointerCapture ??= () => false;
  elementPrototype.setPointerCapture ??= () => {};
  elementPrototype.releasePointerCapture ??= () => {};
}
