import { useEffect, useRef, type RefObject } from 'react';

export interface DismissOnOutsideLayer {
  open: boolean;
  ref: RefObject<HTMLElement | null> | readonly RefObject<HTMLElement | null>[];
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
        const refs = Array.isArray(layer.ref) ? layer.ref : [layer.ref];
        const roots = refs.map((ref) => ref.current).filter((root): root is HTMLElement => root !== null);
        if (roots.length === 0) continue;
        if (!roots.some((root) => root.contains(target))) layer.dismiss();
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [anyOpen]);
}
