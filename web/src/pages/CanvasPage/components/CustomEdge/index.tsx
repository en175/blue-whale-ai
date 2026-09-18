/* ============================================
 * CustomEdge 自定义连线边：贝塞尔路径 + 虚线流动 + 停稳出现的剪刀删除按钮
 * ============================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBezierPath, useReactFlow, useStore, type EdgeProps } from '@xyflow/react';
import { Scissors } from 'lucide-react';
import styles from './index.module.css';

/** 剪刀图标圆心相对 foreignObject 组原点的偏移 */
const SCISSORS_CENTER = 10;
/** 指针在连线上停稳满这么久剪刀才出现；期间任一次移动都重新计时（IKGUVG） */
const DWELL_MS = 1000;

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
  const { deleteElements, screenToFlowPosition } = useReactFlow();
  const [scissorsPos, setScissorsPos] = useState<{ x: number; y: number } | null>(null);
  /** 未触发的停稳计时（IKGUVG）：移动、离开、卸载都要清掉 */
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* IKGGC0：source/target 任一端节点被选中时连线流动，与悬停共用同一份 CSS 定义；
     纯渲染期从 store 派生，不写入连线数据、不参与自动保存 */
  const connectedToSelected = useStore((state) => {
    const sourceNode = state.nodeLookup.get(source);
    const targetNode = state.nodeLookup.get(target);
    return Boolean(sourceNode?.selected || targetNode?.selected);
  });

  /* IKGUVG：目标节点生成中不出现剪刀。口径同页面 isGeneratingNode——
     生成态 genStatus 在 store 里；提交窗口（页面 submittingNodeId）由页面渲染期注入节点 data */
  const targetGenerating = useStore((state) => {
    const data = state.nodeLookup.get(target)?.data as Record<string, unknown> | undefined;
    return data?.genStatus === 'generating' || data?.submitting === true;
  });

  const clearDwellTimer = useCallback(() => {
    if (dwellTimerRef.current !== null) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
  }, []);

  /* 卸载清理：不留残余计时任务 */
  useEffect(() => () => clearDwellTimer(), [clearDwellTimer]);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 指针已在剪刀上时不再重算，避免点击时图标抖动（也是指针移向剪刀时保持可见的前提）
    if ((e.target as Element).closest(`.${styles.deleteBtn}`)) return;
    // 目标节点生成中：不出现也不开始计时，避免用户等满 1 秒再被删除守卫拒绝
    if (targetGenerating) {
      clearDwellTimer();
      return;
    }
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    clearDwellTimer();
    if (scissorsPos !== null) {
      // 已出现：位置关系暂按原样跟随指针（错开与定格见 IKGUVK）
      setScissorsPos(pos);
      return;
    }
    // 未出现：每次移动都按新位置重新计时，停稳满 1 秒才出现
    dwellTimerRef.current = setTimeout(() => {
      dwellTimerRef.current = null;
      setScissorsPos(pos);
    }, DWELL_MS);
  }, [clearDwellTimer, screenToFlowPosition, scissorsPos, targetGenerating]);

  const handleMouseLeave = useCallback(() => {
    clearDwellTimer();
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
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
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

      {/* 剪刀删除按钮：停稳满 1 秒后追加出现类才可见，本票落在指针位置 */}
      <g
        className={scissorsPos !== null ? `${styles.deleteBtn} ${styles.deleteBtnVisible}` : styles.deleteBtn}
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
