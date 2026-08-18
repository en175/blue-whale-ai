/* ============================================
 * CustomEdge 自定义连线边：贝塞尔路径与彗星流光动画
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
  const { setEdges } = useReactFlow();

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
    setEdges((prev) => prev.filter((edge) => edge.id !== id));
  };

  const grad = `url(#flow-grad-${id})`;

  return (
    <g className={styles.edgeGroup}>
      {/* 浅蓝 → 深蓝 渐变 */}
      <defs>
        <linearGradient
          id={`flow-grad-${id}`}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor="#7dd8fa" />
          <stop offset="100%" stopColor="#1e56c8" />
        </linearGradient>
      </defs>

      {/* 可见基础连线 */}
      <path d={edgePath} fill="none" className={styles.basePath} />

      {/* 外层虚化光晕 */}
      <path d={edgePath} fill="none" className={styles.flowGlow} stroke={grad} />

      {/* 8 层等宽描边叠加：头部对齐、宽度 0.5px 递进，模糊融合成平滑渐细 */}
      <path d={edgePath} fill="none" className={styles.flow1} stroke={grad} />
      <path d={edgePath} fill="none" className={styles.flow2} stroke={grad} />
      <path d={edgePath} fill="none" className={styles.flow3} stroke={grad} />
      <path d={edgePath} fill="none" className={styles.flow4} stroke={grad} />
      <path d={edgePath} fill="none" className={styles.flow5} stroke={grad} />
      <path d={edgePath} fill="none" className={styles.flow6} stroke={grad} />
      <path d={edgePath} fill="none" className={styles.flow7} stroke={grad} />
      <path d={edgePath} fill="none" className={styles.flow8} stroke={grad} />

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
