import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  dragExpandCorner,
  dragExpandEdge,
  maxExpandPerSide,
  type ExpandSides,
  type SourceRect,
} from '../../imageOutpaint';
import styles from './index.module.css';

interface OutpaintFrameProps {
  rect: SourceRect;
  expands: ExpandSides;
  onExpandChange: (expands: ExpandSides) => void;
  dragHidden?: boolean;
}

type EdgeHandle = 'top' | 'right' | 'bottom' | 'left';
type CornerHandle = 'nw' | 'ne' | 'sw' | 'se';

export default function OutpaintFrame({ rect, expands, onExpandChange, dragHidden }: OutpaintFrameProps) {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();

  const dragRef = useRef<{ kind: 'edge' | 'corner'; handle: string; start: ExpandSides } | null>(null);
  const latestRef = useRef({ rect, expands, onExpandChange, screenToFlowPosition });
  latestRef.current = { rect, expands, onExpandChange, screenToFlowPosition };
  const detachRef = useRef<() => void>(() => {});

  const handleMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { rect: r, onExpandChange: change, screenToFlowPosition: toFlow } = latestRef.current;
    const pointer = toFlow({ x: e.clientX, y: e.clientY });
    const max = maxExpandPerSide(r);
    const next = drag.kind === 'edge'
      ? dragExpandEdge(drag.handle as EdgeHandle, r, pointer, drag.start, max)
      : dragExpandCorner(drag.handle as CornerHandle, r, pointer, drag.start, max, e.shiftKey);
    change(next);
  }, []);

  const handleUp = useCallback(() => {
    dragRef.current = null;
    detachRef.current();
  }, []);

  const startDrag = useCallback(
    (kind: 'edge' | 'corner', handle: string) => (e: React.PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { kind, handle, start: latestRef.current.expands };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
      detachRef.current = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);
      };
    },
    [handleMove, handleUp],
  );

  useEffect(
    () => () => {
      detachRef.current();
    },
    [],
  );

  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragstart', block, true);
    return () => document.removeEventListener('dragstart', block, true);
  }, []);

  const tl = flowToScreenPosition({ x: rect.x - expands.left, y: rect.y - expands.top });
  const br = flowToScreenPosition({
    x: rect.x + rect.width + expands.right,
    y: rect.y + rect.height + expands.bottom,
  });
  const boxLeft = tl.x;
  const boxTop = tl.y;
  const boxW = br.x - tl.x;
  const boxH = br.y - tl.y;

  return (
    <div className={styles.frameLayer} data-testid="outpaint-frame" data-outpaint-frame style={{ visibility: dragHidden ? 'hidden' : undefined }}>
      {}
      <div
        className={styles.frameBox}
        style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH }}
        data-testid="outpaint-frame-box"
      />
      {}
      <div
        className={`nodrag nopan ${styles.edgeHit} ${styles.edgeHitTop}`}
        style={{ left: boxLeft, top: boxTop, width: boxW }}
        data-testid="outpaint-handle-top"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'top')}
      >
        <div className={`${styles.edgeVisual} ${styles.edgeVisualH}`} />
      </div>
      <div
        className={`nodrag nopan ${styles.edgeHit} ${styles.edgeHitBottom}`}
        style={{ left: boxLeft, top: br.y, width: boxW }}
        data-testid="outpaint-handle-bottom"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'bottom')}
      >
        <div className={`${styles.edgeVisual} ${styles.edgeVisualH}`} />
      </div>
      <div
        className={`nodrag nopan ${styles.edgeHit} ${styles.edgeHitLeft}`}
        style={{ left: boxLeft, top: boxTop, height: boxH }}
        data-testid="outpaint-handle-left"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'left')}
      >
        <div className={`${styles.edgeVisual} ${styles.edgeVisualV}`} />
      </div>
      <div
        className={`nodrag nopan ${styles.edgeHit} ${styles.edgeHitRight}`}
        style={{ left: br.x, top: boxTop, height: boxH }}
        data-testid="outpaint-handle-right"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'right')}
      >
        <div className={`${styles.edgeVisual} ${styles.edgeVisualV}`} />
      </div>
      {}
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
        const cx = corner === 'nw' || corner === 'sw' ? boxLeft : br.x;
        const cy = corner === 'nw' || corner === 'ne' ? boxTop : br.y;
        const dirClass = corner === 'nw' || corner === 'se' ? styles.cornerNwse : styles.cornerNesw;
        return (
          <div
            key={corner}
            className={`nodrag nopan ${styles.cornerHit} ${dirClass}`}
            style={{ left: cx, top: cy }}
            data-testid={`outpaint-handle-${corner}`}
            title="拖动同时调整宽高；按住 Shift 等比外扩"
            onPointerDown={startDrag('corner', corner)}
          >
            <div className={styles.cornerVisual} />
          </div>
        );
      })}
    </div>
  );
}
