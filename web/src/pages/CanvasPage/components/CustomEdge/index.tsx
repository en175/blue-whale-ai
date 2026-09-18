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
/** 剪刀出现位置相对停稳指针的固定偏移：画布流坐标右上方，指针正下方不会出现按钮（IKGUVK）。
 *  偏移量须小于下方命中路径 strokeWidth 的一半加剪刀圆的 r，否则指针从连线移向剪刀的
 *  路上会掉进两边都不命中的空档；
 *  偏移是流坐标定值，画布缩放只改视觉大小，不改变这层关系 */
const SCISSORS_OFFSET = { x: 12, y: -12 } as const;

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
  /** 指针此刻是否停在剪刀上（IKGUVK）：区分「从剪刀移回连线」与「一直在连线上移动」 */
  const pointerOnScissorsRef = useRef(false);

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

  /* IKGUR7 审查修订：目标节点转入生成中时，已出现的剪刀立即收回，在途停稳计时一并清除。
     只在移动里拦不够——剪刀出现之后、或计时途中目标才转入生成中时，用户仍会等满 1 秒
     （或对着已经出现的剪刀）点下去，才被页面删除守卫以「生成中，输入连线只读」拒绝 */
  useEffect(() => {
    if (!targetGenerating) return;
    clearDwellTimer();
    setScissorsPos(null);
  }, [clearDwellTimer, targetGenerating]);

  /** 启动停稳计时：满 1 秒后在「停稳那一刻的指针位置 + 固定偏移」处出现剪刀 */
  const startDwell = useCallback((clientX: number, clientY: number) => {
    clearDwellTimer();
    const pos = screenToFlowPosition({ x: clientX, y: clientY });
    dwellTimerRef.current = setTimeout(() => {
      dwellTimerRef.current = null;
      setScissorsPos({ x: pos.x + SCISSORS_OFFSET.x, y: pos.y + SCISSORS_OFFSET.y });
    }, DWELL_MS);
  }, [clearDwellTimer, screenToFlowPosition]);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 指针落在剪刀上：可见性与位置都不动（指针从连线移向剪刀时靠这条保持可点）
    if ((e.target as Element).closest(`.${styles.deleteBtn}`)) {
      pointerOnScissorsRef.current = true;
      return;
    }
    const backFromScissors = pointerOnScissorsRef.current;
    pointerOnScissorsRef.current = false;
    // 目标节点生成中：不出现也不开始计时，避免用户等满 1 秒再被删除守卫拒绝
    if (targetGenerating) {
      clearDwellTimer();
      return;
    }
    // 已出现且指针仍在连线上：位置就地定格，不跟随指针、也不重新计时（IKGUVK）
    if (!backFromScissors && scissorsPos !== null) return;

    // 指针从剪刀移回连线：先收起剪刀，回到未出现状态，再按新位置重新计时（IKGUVK）
    if (backFromScissors) setScissorsPos(null);
    // 每次移动都按新位置重新计时，停稳满 1 秒才出现；出现位置与指针保持固定偏移
    startDwell(e.clientX, e.clientY);
  }, [clearDwellTimer, scissorsPos, startDwell, targetGenerating]);

  /* IKGUR7 审查修订：指针进入连线时也启动计时，覆盖「指针不动、连线因平移或缩放滑到指针下」
     这种没有 mousemove 的进入方式；与移动共用同一套启动逻辑 */
  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (targetGenerating) return;
    startDwell(e.clientX, e.clientY);
  }, [startDwell, targetGenerating]);

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    // 指针从连线移到剪刀上（剪刀是连线组的子元素）：不算离开，剪刀保持可见可点（IKGUVK）
    const next = e.relatedTarget as Element | null;
    if (next?.closest?.(`.${styles.deleteBtn}`)) {
      pointerOnScissorsRef.current = true;
      return;
    }
    // 既不在连线上也不在剪刀上：立即隐藏，不留残余定时任务
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
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
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

      {/* 剪刀删除按钮：停稳满 1 秒后追加出现类才可见，落点是停稳那一刻指针位置加固定偏移，
          出现后不再随指针移动（IKGUVK） */}
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
