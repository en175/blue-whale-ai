import { type CropPresetKey } from '@/custom/enums';
import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { findFlowRenderer, forwardWheelToRenderer } from '../Canvas/canvasWheelPassthrough';
import { cropPresetRatio, dragCropCorner, dragCropEdge, moveCropRect, type CropCorner, type CropEdge, type CropRect } from '../../imageCrop';
import styles from './index.module.css';

export interface CropFrameProps {
  bounds: CropRect;
  rect: CropRect;
  preset: CropPresetKey;
  minSide: number;
  onRectChange: (rect: CropRect) => void;
  dragHidden?: boolean;
  onDarkAreaClick: () => void;
}

type DragTarget =
  | { kind: 'move' }
  | { kind: 'edge'; handle: CropEdge }
  | { kind: 'corner'; handle: CropCorner };

type DragSession = DragTarget & {
  start: CropRect;
  startPointer: { x: number; y: number };
};

export default function CropFrame({ bounds, rect, preset, minSide, onRectChange, onDarkAreaClick, dragHidden }: CropFrameProps) {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();

  const dragRef = useRef<DragSession | null>(null);
  const latestRef = useRef({ bounds, rect, preset, minSide, onRectChange, onDarkAreaClick, screenToFlowPosition });
  latestRef.current = { bounds, rect, preset, minSide, onRectChange, onDarkAreaClick, screenToFlowPosition };
  const detachRef = useRef<() => void>(() => {});

  const handleMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { bounds: b, rect: r, preset: p, minSide: ms, onRectChange: change, screenToFlowPosition: toFlow } = latestRef.current;
    const pointer = toFlow({ x: e.clientX, y: e.clientY });
    let next: CropRect;
    if (drag.kind === 'move') {
      next = moveCropRect(drag.start, pointer.x - drag.startPointer.x, pointer.y - drag.startPointer.y, b);
    } else if (drag.kind === 'edge') {
      next = dragCropEdge(drag.handle, r, b, pointer, ms);
    } else {
      const locked = e.shiftKey ? drag.start.width / drag.start.height : cropPresetRatio(p);
      next = dragCropCorner(drag.handle, drag.start, b, pointer, ms, locked);
    }
    change(next);
  }, []);

  const handleUp = useCallback(() => {
    dragRef.current = null;
    detachRef.current();
  }, []);

  const startDrag = useCallback(
    (target: DragTarget) => (e: React.PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      if (target.kind === 'edge' && cropPresetRatio(latestRef.current.preset) != null) return;
      e.preventDefault();
      e.stopPropagation();
      const toFlow = latestRef.current.screenToFlowPosition;
      dragRef.current = {
        ...target,
        start: latestRef.current.rect,
        startPointer: toFlow({ x: e.clientX, y: e.clientY }),
      };
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

  const layerRef = useRef<HTMLDivElement | null>(null);
  const rendererEl = () => (layerRef.current ? findFlowRenderer(layerRef.current) : null);

  const forwardWheel = (e: React.WheelEvent) => {
    forwardWheelToRenderer(e.nativeEvent);
  };

  const forwardPanStart = (clientX: number, clientY: number) => {
    const target = rendererEl();
    if (!target) return;
    target.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: false,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 0,
        buttons: 1,
      }),
    );
  };

  const darkRef = useRef<{ x: number; y: number; forwarded: boolean } | null>(null);
  const darkPannedRef = useRef(false);

  const onDarkPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    darkRef.current = { x: e.clientX, y: e.clientY, forwarded: false };
    darkPannedRef.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onDarkPointerMove = (e: React.PointerEvent) => {
    const session = darkRef.current;
    if (!session || session.forwarded) return;
    const dx = e.clientX - session.x;
    const dy = e.clientY - session.y;
    if (dx * dx + dy * dy <= 16) return;
    session.forwarded = true;
    darkPannedRef.current = true;
    forwardPanStart(e.clientX, e.clientY);
  };

  const onDarkPointerUp = () => {
    darkRef.current = null;
  };

  const onDarkClick = () => {
    if (darkPannedRef.current) {
      darkPannedRef.current = false;
      return;
    }
    latestRef.current.onDarkAreaClick();
  };

  const darkBandProps = {
    onPointerDown: onDarkPointerDown,
    onPointerMove: onDarkPointerMove,
    onPointerUp: onDarkPointerUp,
    onClick: onDarkClick,
    onWheel: forwardWheel,
  } as const;

  const tl = flowToScreenPosition({ x: rect.x, y: rect.y });
  const br = flowToScreenPosition({ x: rect.x + rect.width, y: rect.y + rect.height });
  const boxLeft = tl.x;
  const boxTop = tl.y;
  const boxW = br.x - tl.x;
  const boxH = br.y - tl.y;
  const locked = cropPresetRatio(preset) != null;
  const edgeHandleClass = (extra: string) =>
    `nodrag nopan ${styles.edgeHit} ${extra}${locked ? ` ${styles.edgeHandleDisabled}` : ''}`;

  return (
    <div className={styles.frameLayer} data-testid="crop-frame" data-crop-frame="" ref={layerRef} style={{ visibility: dragHidden ? 'hidden' : undefined }}>
      {}
      <div
        {...darkBandProps}
        className={`${styles.darkBand} ${styles.darkBandTop}`}
        style={{ height: Math.max(0, boxTop) }}
        data-testid="crop-dark-top"
      />
      <div
        {...darkBandProps}
        className={`${styles.darkBand} ${styles.darkBandBottom}`}
        style={{ top: br.y }}
        data-testid="crop-dark-bottom"
      />
      <div
        {...darkBandProps}
        className={`${styles.darkBand} ${styles.darkBandLeft}`}
        style={{ top: boxTop, height: boxH, width: Math.max(0, boxLeft) }}
        data-testid="crop-dark-left"
      />
      <div
        {...darkBandProps}
        className={`${styles.darkBand} ${styles.darkBandRight}`}
        style={{ top: boxTop, height: boxH, left: br.x }}
        data-testid="crop-dark-right"
      />

      {}
      <div
        className={`nodrag nopan ${styles.moveZone}`}
        style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH }}
        data-testid="crop-move-zone"
        title="按住拖动移动裁切框"
        onPointerDown={startDrag({ kind: 'move' })}
        onWheel={forwardWheel}
      />

      {}
      <div
        className={styles.frameBox}
        style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH }}
        data-testid="crop-frame-box"
      />

      {}
      <div
        className={edgeHandleClass(styles.edgeHitTop)}
        style={{ left: boxLeft, top: boxTop, width: boxW }}
        data-testid="crop-handle-top"
        title={locked ? '锁定比例下不可拖动单边' : '向内拖动收缩裁切范围'}
        onPointerDown={startDrag({ kind: 'edge', handle: 'top' })}
        onWheel={forwardWheel}
      />
      <div
        className={edgeHandleClass(styles.edgeHitBottom)}
        style={{ left: boxLeft, top: br.y, width: boxW }}
        data-testid="crop-handle-bottom"
        title={locked ? '锁定比例下不可拖动单边' : '向内拖动收缩裁切范围'}
        onPointerDown={startDrag({ kind: 'edge', handle: 'bottom' })}
        onWheel={forwardWheel}
      />
      <div
        className={edgeHandleClass(styles.edgeHitLeft)}
        style={{ left: boxLeft, top: boxTop, height: boxH }}
        data-testid="crop-handle-left"
        title={locked ? '锁定比例下不可拖动单边' : '向内拖动收缩裁切范围'}
        onPointerDown={startDrag({ kind: 'edge', handle: 'left' })}
        onWheel={forwardWheel}
      />
      <div
        className={edgeHandleClass(styles.edgeHitRight)}
        style={{ left: br.x, top: boxTop, height: boxH }}
        data-testid="crop-handle-right"
        title={locked ? '锁定比例下不可拖动单边' : '向内拖动收缩裁切范围'}
        onPointerDown={startDrag({ kind: 'edge', handle: 'right' })}
        onWheel={forwardWheel}
      />

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
            data-testid={`crop-handle-${corner}`}
            title={locked ? '拖动等比缩放（以对角为锚）' : '拖动调整宽高；按住 Shift 等比缩放'}
            onPointerDown={startDrag({ kind: 'corner', handle: corner })}
            onWheel={forwardWheel}
          >
            <div className={styles.cornerVisual} />
          </div>
        );
      })}
    </div>
  );
}
