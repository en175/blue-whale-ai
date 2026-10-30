import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { getBezierPath, useReactFlow, useStore, type EdgeProps } from '@xyflow/react';
import { Scissors } from 'lucide-react';
import { placeScissorsOnEdge } from './edgeGeometry';
import styles from './index.module.css';

const DWELL_MS = 1000;
const SCISSORS_GAP = 30;
const SCISSORS_RADIUS = 11;
const SCISSORS_ICON = 14;

export default function CustomEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const { deleteElements, getZoom, screenToFlowPosition } = useReactFlow();
  const [scissorsPos, setScissorsPos] = useState<{ x: number; y: number } | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerOnScissorsRef = useRef(false);

  const connectedToSelected = useStore((state) => {
    const sourceNode = state.nodeLookup.get(source);
    const targetNode = state.nodeLookup.get(target);
    return Boolean(sourceNode?.selected || targetNode?.selected);
  });

  const targetGenerating = useStore((state) => {
    const data = state.nodeLookup.get(target)?.data as Record<string, unknown> | undefined;
    return data?.genStatus === 'generating' || data?.submitting === true;
  });

  const zoom = useStore((state) => state.transform[2]);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const glowRef = useRef<SVGPathElement>(null);
  const [edgeLength, setEdgeLength] = useState(0);
  useLayoutEffect(() => {
    const el = glowRef.current;
    setEdgeLength(el && typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0);
  }, [edgePath]);

  const glowLength = 26;
  const drawnLeftToRight = sourceX <= targetX;

  const gradientId = `edge-glow-${id.replace(/[^\w-]/g, '')}`;
  const gradientFrom = drawnLeftToRight ? sourceX : targetX;
  const gradientTo = drawnLeftToRight ? targetX : sourceX;

  const clearDwellTimer = useCallback(() => {
    if (dwellTimerRef.current !== null) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearDwellTimer(), [clearDwellTimer]);

  useEffect(() => {
    if (!targetGenerating) return;
    clearDwellTimer();
    setScissorsPos(null);
  }, [clearDwellTimer, targetGenerating]);

  const startDwell = useCallback((clientX: number, clientY: number) => {
    clearDwellTimer();
    const pointer = screenToFlowPosition({ x: clientX, y: clientY });
    const gap = SCISSORS_GAP / getZoom();
    dwellTimerRef.current = setTimeout(() => {
      dwellTimerRef.current = null;
      setScissorsPos(placeScissorsOnEdge(edgePath, pointer, gap));
    }, DWELL_MS);
  }, [clearDwellTimer, edgePath, getZoom, screenToFlowPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest(`.${styles.deleteBtn}`)) {
      pointerOnScissorsRef.current = true;
      return;
    }
    const backFromScissors = pointerOnScissorsRef.current;
    pointerOnScissorsRef.current = false;
    if (targetGenerating) {
      clearDwellTimer();
      return;
    }
    if (!backFromScissors && scissorsPos !== null) return;

    if (backFromScissors) setScissorsPos(null);
    startDwell(e.clientX, e.clientY);
  }, [clearDwellTimer, scissorsPos, startDwell, targetGenerating]);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (targetGenerating) return;
    startDwell(e.clientX, e.clientY);
  }, [startDwell, targetGenerating]);

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    const next = e.relatedTarget as Element | null;
    if (next?.closest?.(`.${styles.deleteBtn}`)) {
      pointerOnScissorsRef.current = true;
      return;
    }
    clearDwellTimer();
    pointerOnScissorsRef.current = false;
    setScissorsPos(null);
  }, [clearDwellTimer]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    void deleteElements({ edges: [{ id }] });
  };

  const iconX = scissorsPos?.x ?? labelX;
  const iconY = scissorsPos?.y ?? labelY;

  return (
    <g
      className={connectedToSelected ? `${styles.edgeGroup} ${styles.selectedConnected}` : styles.edgeGroup}
      style={{ '--edge-length': edgeLength } as CSSProperties}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {}
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={gradientFrom}
          y1={0}
          x2={gradientTo}
          y2={0}
        >
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#9cc9ff" />
          <stop offset="100%" stopColor="#9cc9ff" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={edgePath} fill="none" className={styles.basePath} />

      {}
      <path
        ref={glowRef}
        d={edgePath}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={edgeLength > 0 ? `${glowLength} ${Math.max(edgeLength - glowLength, glowLength)}` : undefined}
        strokeDashoffset={edgeLength}
        className={styles.glowPath}
      />

      {}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className={styles.hitPath}
      />

      {}
      <g
        className={scissorsPos !== null ? `${styles.deleteBtn} ${styles.deleteBtnVisible}` : styles.deleteBtn}
        transform={`translate(${iconX}, ${iconY}) scale(${1 / zoom})`}
        onClick={handleDelete}
      >
        <circle cx={0} cy={0} r={SCISSORS_RADIUS} fill="#2a2a2a" stroke="#555" strokeWidth={1} />
        <foreignObject
          x={-SCISSORS_ICON / 2}
          y={-SCISSORS_ICON / 2}
          width={SCISSORS_ICON}
          height={SCISSORS_ICON}
          style={{ pointerEvents: 'none' }}
        >
          <Scissors size={SCISSORS_ICON} strokeWidth={2} color="#ccc" />
        </foreignObject>
      </g>
    </g>
  );
}
