/* ============================================
 * OutpaintFrame 扩图扩展框覆盖层（IKGOQX）：
 * 自研屏幕空间覆盖层（仓内无节点级 resize 设施，做法参考 SnapGuides 对齐线
 * 与 GroupOverlay 整组拖动把手）：4 边 + 4 角手柄，只许向外扩、框永远完整
 * 包住原图内容区、每方向扩展量钳制 [0, 原图短边 40%]；拖边单边、拖角自由、
 * Shift 拖角锁定开始那一刻的框比例。拖拽换算全部走 imageOutpaint 纯函数。
 * 作为 ReactFlow children 渲染拿 viewport context（同 GroupOverlay 先例）；
 * 屏幕坐标 = flow × zoom + 平移，手柄尺寸恒为屏幕像素。
 * ============================================ */
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
  /** 源图内容区矩形（flow 坐标：节点左上角 + 标题偏移 + mediaContentBox 尺寸） */
  rect: SourceRect;
  expands: ExpandSides;
  onExpandChange: (expands: ExpandSides) => void;
}

/** 手柄类型：4 边（单边调整）+ 4 角（自由改比例，Shift 锁比例） */
type EdgeHandle = 'top' | 'right' | 'bottom' | 'left';
type CornerHandle = 'nw' | 'ne' | 'sw' | 'se';

export default function OutpaintFrame({ rect, expands, onExpandChange }: OutpaintFrameProps) {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();

  /** 拖拽会话：手柄类型 + 按下那一刻的扩展快照（Shift 锁比例基准） */
  const dragRef = useRef<{ kind: 'edge' | 'corner'; handle: string; start: ExpandSides } | null>(null);

  /** 屏幕点换 flow 坐标后走纯函数换算（组件行为与纯函数测试同源） */
  const onMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const pointer = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const max = maxExpandPerSide(rect);
      const next = drag.kind === 'edge'
        ? dragExpandEdge(drag.handle as EdgeHandle, rect, pointer, drag.start, max)
        : dragExpandCorner(drag.handle as CornerHandle, rect, pointer, drag.start, max, e.shiftKey);
      onExpandChange(next);
    },
    [rect, screenToFlowPosition, onExpandChange],
  );

  const onUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  }, [onMove]);

  const startDrag = useCallback(
    (kind: 'edge' | 'corner', handle: string) => (e: React.PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { kind, handle, start: expands };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [expands, onMove, onUp],
  );

  /** 卸载时清理拖拽监听（不触发回调，避免卸载期写父级状态） */
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    },
    [onMove, onUp],
  );

  // 屏幕空间框几何（flow × zoom + 平移）
  const tl = flowToScreenPosition({ x: rect.x - expands.left, y: rect.y - expands.top });
  const br = flowToScreenPosition({
    x: rect.x + rect.width + expands.right,
    y: rect.y + rect.height + expands.bottom,
  });
  const boxLeft = tl.x;
  const boxTop = tl.y;
  const boxW = br.x - tl.x;
  const boxH = br.y - tl.y;
  const midX = boxLeft + boxW / 2;
  const midY = boxTop + boxH / 2;

  return (
    <div className={styles.frameLayer} data-testid="outpaint-frame">
      {/* 框本体：纯视觉（边线 + 扩展区微填充），不拦截交互 */}
      <div
        className={styles.frameBox}
        style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH }}
        data-testid="outpaint-frame-box"
      />
      {/* 4 边手柄：单边外扩 */}
      <div
        className={`nodrag nopan ${styles.edgeHandle} ${styles.edgeTop}`}
        style={{ left: midX, top: boxTop }}
        data-testid="outpaint-handle-top"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'top')}
      />
      <div
        className={`nodrag nopan ${styles.edgeHandle} ${styles.edgeBottom}`}
        style={{ left: midX, top: br.y }}
        data-testid="outpaint-handle-bottom"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'bottom')}
      />
      <div
        className={`nodrag nopan ${styles.edgeHandle} ${styles.edgeLeft}`}
        style={{ left: boxLeft, top: midY }}
        data-testid="outpaint-handle-left"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'left')}
      />
      <div
        className={`nodrag nopan ${styles.edgeHandle} ${styles.edgeRight}`}
        style={{ left: br.x, top: midY }}
        data-testid="outpaint-handle-right"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'right')}
      />
      {/* 4 角手柄：自由改比例；按住 Shift 锁定开始那一刻的比例等比外扩 */}
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
        const cx = corner === 'nw' || corner === 'sw' ? boxLeft : br.x;
        const cy = corner === 'nw' || corner === 'ne' ? boxTop : br.y;
        const dirClass = corner === 'nw' || corner === 'se' ? styles.cornerNwse : styles.cornerNesw;
        return (
          <div
            key={corner}
            className={`nodrag nopan ${styles.cornerHandle} ${dirClass}`}
            style={{ left: cx, top: cy }}
            data-testid={`outpaint-handle-${corner}`}
            title="拖动同时调整宽高；按住 Shift 等比外扩"
            onPointerDown={startDrag('corner', corner)}
          />
        );
      })}
    </div>
  );
}
