import { useEffect, useRef, useState } from 'react';
import type { Viewport } from '@xyflow/react';
import { useOverlayWheelPassthrough } from '../../components/Canvas/canvasWheelPassthrough';

const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1.1 };

export function useCanvasViewportSurface() {
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperSize, setWrapperSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const [liveViewport, setLiveViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  useEffect(() => { setLiveViewport(viewport); }, [viewport]);
  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    const update = () => setWrapperSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useOverlayWheelPassthrough(canvasWrapperRef, { ignoreInsideReactFlow: true });
  return {
    canvasWrapperRef,
    wrapperSize,
    viewport,
    setViewport,
    viewportRef,
    liveViewport,
    setLiveViewport,
  };
}
