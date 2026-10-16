import { useCallback, useId, useRef } from 'react';
import { useStore } from '@xyflow/react';
import type { MaskOp, MaskPoint } from '../../tools/image/eraseMask';

export interface EraseMaskLayerProps {
  ops: readonly MaskOp[];
  liveOp: MaskOp | null;
  displayWidth: number;
  displayHeight: number;
  onStrokeStart: (point: MaskPoint) => void;
  onStrokeMove: (point: MaskPoint) => void;
  onStrokeEnd: () => void;
}

const CHECKER_CELL_PX = 16;
const MASK_OPACITY = 0.55;

function MaskOpShape({ op }: { op: MaskOp }) {
  const value = op.erase ? 'black' : 'white';
  if (op.kind === 'rect') {
    const x = Math.min(op.from.x, op.to.x);
    const y = Math.min(op.from.y, op.to.y);
    return (
      <rect
        x={x}
        y={y}
        width={Math.abs(op.to.x - op.from.x)}
        height={Math.abs(op.to.y - op.from.y)}
        fill={value}
      />
    );
  }
  const radius = Math.max(1, op.radius);
  if (op.points.length === 1) {
    const p = op.points[0]!;
    return <circle cx={p.x} cy={p.y} r={radius} fill={value} />;
  }
  const d = op.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  return (
    <path
      d={d}
      stroke={value}
      strokeWidth={radius * 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

export default function EraseMaskLayer({
  ops,
  liveOp,
  displayWidth,
  displayHeight,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd,
}: EraseMaskLayerProps) {
  const zoom = useStore((state) => state.transform[2]);
  const maskId = `erase-mask${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const patternId = `erase-checker${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const draggingRef = useRef(false);

  const toDisplayPoint = useCallback(
    (event: React.PointerEvent<HTMLElement>): MaskPoint => {
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
    onStrokeStart(toDisplayPoint(event));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    event.stopPropagation();
    onStrokeMove(toDisplayPoint(event));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    onStrokeEnd();
  };

  return (
    <div
      className="nodrag nopan"
      data-testid="erase-mask-layer"
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
        <defs>
          <pattern id={patternId} width={CHECKER_CELL_PX * 2} height={CHECKER_CELL_PX * 2} patternUnits="userSpaceOnUse">
            <rect width={CHECKER_CELL_PX * 2} height={CHECKER_CELL_PX * 2} fill="rgba(255,255,255,0.28)" />
            <rect width={CHECKER_CELL_PX} height={CHECKER_CELL_PX} fill="rgba(255,255,255,0.85)" />
            <rect x={CHECKER_CELL_PX} y={CHECKER_CELL_PX} width={CHECKER_CELL_PX} height={CHECKER_CELL_PX} fill="rgba(255,255,255,0.85)" />
          </pattern>
          <mask id={maskId}>
            <rect x={0} y={0} width={displayWidth} height={displayHeight} fill="black" />
            {ops.map((op, i) => (
              <MaskOpShape key={i} op={op} />
            ))}
            {liveOp && <MaskOpShape op={liveOp} />}
          </mask>
        </defs>
        <rect
          x={0}
          y={0}
          width={displayWidth}
          height={displayHeight}
          fill={`url(#${patternId})`}
          mask={`url(#${maskId})`}
          opacity={MASK_OPACITY}
        />
      </svg>
    </div>
  );
}
