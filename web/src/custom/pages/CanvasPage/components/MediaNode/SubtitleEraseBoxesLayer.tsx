import { useCallback, useRef } from 'react';
import { useStore } from '@xyflow/react';
import type { SubtitleBoxOp, SubtitleBoxPoint } from '../../tools/video/subtitleEraseBoxes';

export interface SubtitleEraseBoxesLayerProps {
  boxes: readonly SubtitleBoxOp[];
  liveBox: SubtitleBoxOp | null;
  displayWidth: number;
  displayHeight: number;
  onBoxStart: (point: SubtitleBoxPoint) => void;
  onBoxMove: (point: SubtitleBoxPoint) => void;
  onBoxEnd: () => void;
}

const BOX_FILL = 'rgba(208, 208, 208, 0.16)';
const BOX_STROKE = '#d0d0d0';
const BOX_STROKE_WIDTH = 1.5;
const BOX_DASH = '6 4';

function BoxShape({ op, preview }: { op: SubtitleBoxOp; preview?: boolean }) {
  const x = Math.min(op.from.x, op.to.x);
  const y = Math.min(op.from.y, op.to.y);
  return (
    <rect
      x={x}
      y={y}
      width={Math.abs(op.to.x - op.from.x)}
      height={Math.abs(op.to.y - op.from.y)}
      fill={BOX_FILL}
      stroke={BOX_STROKE}
      strokeWidth={BOX_STROKE_WIDTH}
      strokeDasharray={BOX_DASH}
      opacity={preview ? 0.7 : 1}
    />
  );
}

export default function SubtitleEraseBoxesLayer({
  boxes,
  liveBox,
  displayWidth,
  displayHeight,
  onBoxStart,
  onBoxMove,
  onBoxEnd,
}: SubtitleEraseBoxesLayerProps) {
  const zoom = useStore((state) => state.transform[2]);
  const draggingRef = useRef(false);

  const toDisplayPoint = useCallback(
    (event: React.PointerEvent<HTMLElement>): SubtitleBoxPoint => {
      const rect = event.currentTarget.getBoundingClientRect();
      const scale = zoom || 1;
      return {
        x: (event.clientX - rect.left) / scale,
        y: (event.clientY - rect.top) / scale,
      };
    },
    [zoom],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draggingRef.current = true;
    onBoxStart(toDisplayPoint(event));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    event.stopPropagation();
    onBoxMove(toDisplayPoint(event));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    onBoxEnd();
  };

  return (
    <div
      className="nodrag nopan"
      data-testid="subtitle-erase-boxes-layer"
      data-gen-panel-territory
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={(event) => event.stopPropagation()}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${displayWidth} ${displayHeight}`}
        preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {boxes.map((op, i) => (
          <BoxShape key={i} op={op} />
        ))}
        {liveBox && <BoxShape op={liveBox} preview />}
      </svg>
    </div>
  );
}
