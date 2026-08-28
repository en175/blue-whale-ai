import { useEffect, useRef, type RefObject } from 'react';

export interface DismissOnOutsideLayer {
  open: boolean;
  ref: RefObject<HTMLElement | null>;
  dismiss: () => void;
}

/**
 * 画布对话框内的下拉 / 浮层：在根节点外按下时收起该层。
 * 不触碰宿主对话框（IKBO6M：点画布空白关下拉和「模型与质量」等配置浮层，不关底部对话框）。
 */
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
