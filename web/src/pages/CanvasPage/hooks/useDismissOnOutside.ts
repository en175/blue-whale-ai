import { useEffect, useRef, type RefObject } from 'react';

export interface DismissOnOutsideLayer {
  open: boolean;
  ref: RefObject<HTMLElement | null>;
  dismiss: () => void;
}

export function useDismissOnOutside(layers: DismissOnOutsideLayer[]): void {
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const anyOpen = layers.some((layer) => layer.open);

  useEffect(() => {
    if (!anyOpen) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      for (const layer of layersRef.current) {
        if (!layer.open) continue;
        const root = layer.ref.current;
        if (root && !root.contains(target)) layer.dismiss();
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [anyOpen]);
}
