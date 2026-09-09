/* ============================================
 * CustomEdge 自定义连线边：贝塞尔路径 + 虚线流动
 * ============================================ */
import { getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { Scissors } from 'lucide-react';
import styles from './index.module.css';

export default function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    void deleteElements({ edges: [{ id }] });
  };

  return (
    <g className={styles.edgeGroup}>
      {/* 连线 */}
      <path d={edgePath} fill="none" className={styles.basePath} />

      {/* 透明粗路径扩大悬停区域 */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className={styles.hitPath}
      />

      {/* 剪刀删除按钮（CSS 悬停显示） */}
      <g
        className={styles.deleteBtn}
        transform={`translate(${labelX - 10}, ${labelY - 10})`}
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
