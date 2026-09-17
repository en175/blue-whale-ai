/* ============================================
 * CustomEdge 自定义连线边：贝塞尔路径 + 虚线流动
 * ============================================ */
import { useCallback, useRef, useState } from 'react';
import { getBezierPath, useReactFlow, useStore, type EdgeProps } from '@xyflow/react';
import { Scissors } from 'lucide-react';
import styles from './index.module.css';

/** 剪刀图标圆心相对 foreignObject 组原点的偏移 */
const SCISSORS_CENTER = 10;

/** 将指针屏幕坐标投影到 SVG 路径上最近的一点 */
function closestPointOnPath(path: SVGPathElement, clientX: number, clientY: number) {
  const screenCtm = path.getScreenCTM();
  if (!screenCtm) return null;

  const cursor = new DOMPoint(clientX, clientY).matrixTransform(screenCtm.inverse());
  const totalLength = path.getTotalLength();
  if (totalLength <= 0) return null;

  let bestLength = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const coarseStep = Math.max(8, totalLength / 40);

  for (let length = 0; length <= totalLength; length += coarseStep) {
    const point = path.getPointAtLength(length);
    const distance = (point.x - cursor.x) ** 2 + (point.y - cursor.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLength = length;
    }
  }

  const refineStart = Math.max(0, bestLength - coarseStep);
  const refineEnd = Math.min(totalLength, bestLength + coarseStep);
  const fineStep = Math.max(1, coarseStep / 8);

  for (let length = refineStart; length <= refineEnd; length += fineStep) {
    const point = path.getPointAtLength(length);
    const distance = (point.x - cursor.x) ** 2 + (point.y - cursor.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLength = length;
    }
  }

  const closest = path.getPointAtLength(bestLength);
  return { x: closest.x, y: closest.y };
}

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
  const { deleteElements } = useReactFlow();
  const pathRef = useRef<SVGPathElement>(null);
  const [scissorsPos, setScissorsPos] = useState<{ x: number; y: number } | null>(null);

  /* IKGGC0：source/target 任一端节点被选中时连线流动，与悬停共用同一份 CSS 定义；
     纯渲染期从 store 派生，不写入连线数据、不参与自动保存 */
  const connectedToSelected = useStore((state) => {
    const sourceNode = state.nodeLookup.get(source);
    const targetNode = state.nodeLookup.get(target);
    return Boolean(sourceNode?.selected || targetNode?.selected);
  });

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 指针已在剪刀上时不再重算，避免点击时图标抖动
    if ((e.target as Element).closest(`.${styles.deleteBtn}`)) return;
    const path = pathRef.current;
    if (!path) return;
    const closest = closestPointOnPath(path, e.clientX, e.clientY);
    if (closest) setScissorsPos(closest);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setScissorsPos(null);
  }, []);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    void deleteElements({ edges: [{ id }] });
  };

  const iconX = scissorsPos?.x ?? labelX;
  const iconY = scissorsPos?.y ?? labelY;

  return (
    <g
      className={connectedToSelected ? `${styles.edgeGroup} ${styles.selectedConnected}` : styles.edgeGroup}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* 连线 */}
      <path d={edgePath} fill="none" className={styles.basePath} />

      {/* 透明粗路径扩大悬停区域 */}
      <path
        ref={pathRef}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className={styles.hitPath}
      />

      {/* 剪刀删除按钮：沿连线跟随指针，默认落在中点 */}
      <g
        className={styles.deleteBtn}
        transform={`translate(${iconX - SCISSORS_CENTER}, ${iconY - SCISSORS_CENTER})`}
        onClick={handleDelete}
      >
        <circle cx={10} cy={10} r={11} fill="#2a2a2a" stroke="#555" strokeWidth={1} />
        <foreignObject x={3} y={3} width={14} height={14} style={{ pointerEvents: 'none' }}>
          <Scissors size={14} strokeWidth={2} color="#ccc" />
        </foreignObject>
      </g>
    </g>
  );
}
