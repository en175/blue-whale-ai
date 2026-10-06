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
  /** IKJR9J 拖拽隐藏：锚定卡被拖时 visibility 级隐藏（不卸载） */
  dragHidden?: boolean;
}

/** 手柄类型：4 边（单边调整）+ 4 角（自由改比例，Shift 锁比例） */
type EdgeHandle = 'top' | 'right' | 'bottom' | 'left';
type CornerHandle = 'nw' | 'ne' | 'sw' | 'se';

export default function OutpaintFrame({ rect, expands, onExpandChange, dragHidden }: OutpaintFrameProps) {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();

  /** 拖拽会话：手柄类型 + 按下那一刻的扩展快照（Shift 锁比例基准） */
  const dragRef = useRef<{ kind: 'edge' | 'corner'; handle: string; start: ExpandSides } | null>(null);
  /** 动态依赖（rect / expands / onExpandChange / 换算器）进 ref：window 监听引用稳定，
   *  拖拽进行中的重渲染不再拆监听。旧实现清理 effect 依赖 onMove，而 rect 每次渲染
   *  都是父级新对象，第一帧 move 引起重渲染即拆掉监听、拖拽冻结（多帧回归用例钉死）。 */
  const latestRef = useRef({ rect, expands, onExpandChange, screenToFlowPosition });
  latestRef.current = { rect, expands, onExpandChange, screenToFlowPosition };
  /** 会话 detach：startDrag 挂监听时赋值，up / 卸载兜底时调用 */
  const detachRef = useRef<() => void>(() => {});

  /** 屏幕点换 flow 坐标后走纯函数换算（动态取 latestRef，组件行为与纯函数测试同源） */
  const handleMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { rect: r, onExpandChange: change, screenToFlowPosition: toFlow } = latestRef.current;
    const pointer = toFlow({ x: e.clientX, y: e.clientY });
    const max = maxExpandPerSide(r);
    const next = drag.kind === 'edge'
      ? dragExpandEdge(drag.handle as EdgeHandle, r, pointer, drag.start, max)
      : dragExpandCorner(drag.handle as CornerHandle, r, pointer, drag.start, max, e.shiftKey);
    change(next);
  }, []);

  const handleUp = useCallback(() => {
    dragRef.current = null;
    detachRef.current();
  }, []);

  const startDrag = useCallback(
    (kind: 'edge' | 'corner', handle: string) => (e: React.PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { kind, handle, start: latestRef.current.expands };
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

  /** 卸载时清理拖拽监听（不触发回调，避免卸载期写父级状态）；依赖 []：只做真正卸载兜底 */
  useEffect(
    () => () => {
      detachRef.current();
    },
    [],
  );

  /** 会话期间拦截原生 dragstart：pointerdown 落空到图片时浏览器会启动 HTML5 拖拽
   * （半透明重影跟手，验收实测报障）；捕获阶段统一按住。节点拖动走 pointer 事件
   * 不依赖 HTML5 DnD，不受影响 */
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragstart', block, true);
    return () => document.removeEventListener('dragstart', block, true);
  }, []);

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

  return (
    <div className={styles.frameLayer} data-testid="outpaint-frame" data-outpaint-frame style={{ visibility: dragHidden ? 'hidden' : undefined }}>
      {/* 框本体：纯视觉（边线 + 扩展区微填充），不拦截交互 */}
      <div
        className={styles.frameBox}
        style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH }}
        data-testid="outpaint-frame-box"
      />
      {/* 4 边手柄：命中带贯穿整条边（用户拖的是"边框线"本身，中点蓝条只是视觉提示）。
          旧实现只有中点 40×6 小把柄，落空即被节点/画布/图片原生拖拽抢走事件（验收报障） */}
      <div
        className={`nodrag nopan ${styles.edgeHit} ${styles.edgeHitTop}`}
        style={{ left: boxLeft, top: boxTop, width: boxW }}
        data-testid="outpaint-handle-top"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'top')}
      >
        <div className={`${styles.edgeVisual} ${styles.edgeVisualH}`} />
      </div>
      <div
        className={`nodrag nopan ${styles.edgeHit} ${styles.edgeHitBottom}`}
        style={{ left: boxLeft, top: br.y, width: boxW }}
        data-testid="outpaint-handle-bottom"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'bottom')}
      >
        <div className={`${styles.edgeVisual} ${styles.edgeVisualH}`} />
      </div>
      <div
        className={`nodrag nopan ${styles.edgeHit} ${styles.edgeHitLeft}`}
        style={{ left: boxLeft, top: boxTop, height: boxH }}
        data-testid="outpaint-handle-left"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'left')}
      >
        <div className={`${styles.edgeVisual} ${styles.edgeVisualV}`} />
      </div>
      <div
        className={`nodrag nopan ${styles.edgeHit} ${styles.edgeHitRight}`}
        style={{ left: br.x, top: boxTop, height: boxH }}
        data-testid="outpaint-handle-right"
        title="向外拖动扩展画面"
        onPointerDown={startDrag('edge', 'right')}
      >
        <div className={`${styles.edgeVisual} ${styles.edgeVisualV}`} />
      </div>
      {/* 4 角手柄：20×20 透明命中区（边角交汇处角优先，z-index 高于边带），视觉点 10×10；
          自由改比例，按住 Shift 锁定开始那一刻的比例等比外扩 */}
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
        const cx = corner === 'nw' || corner === 'sw' ? boxLeft : br.x;
        const cy = corner === 'nw' || corner === 'ne' ? boxTop : br.y;
        const dirClass = corner === 'nw' || corner === 'se' ? styles.cornerNwse : styles.cornerNesw;
        return (
          <div
            key={corner}
            className={`nodrag nopan ${styles.cornerHit} ${dirClass}`}
            style={{ left: cx, top: cy }}
            data-testid={`outpaint-handle-${corner}`}
            title="拖动同时调整宽高；按住 Shift 等比外扩"
            onPointerDown={startDrag('corner', corner)}
          >
            <div className={styles.cornerVisual} />
          </div>
        );
      })}
    </div>
  );
}
