/* ============================================
 * EraseMaskLayer 擦除编辑态遮罩层（IKGOTB，IKGOSZ 波3）：
 * 叠在源图卡内容区上的半透明棋盘格渲染 + 指针交互接管。
 * - 棋盘格渲染数据 = eraseMask 的 state.ops（显示坐标图元按序叠加，涂=白格纹/橡皮=从并集减去），
 *   经 SVG mask 依序覆盖实现「后写覆盖先写」的最终并集形态；半透明叠加不遮挡底下画面明暗轮廓（故事 14）。
 * - 指针事件换算成显示坐标（相对内容区左上、未乘画布 zoom：clientXY 偏移除以 zoom）上抛，
 *   落笔/固化由 CanvasPage 经 applyMaskOp 完成；本层不持有编辑状态。
 * - nodrag/nopan 阻止节点拖拽与画布平移（接管源图卡区域，不影响画布其他区域，故事 16）。
 * ============================================ */
import { useCallback, useId, useRef } from 'react';
import { useStore } from '@xyflow/react';
import type { MaskOp, MaskPoint } from '../../eraseMask';

export interface EraseMaskLayerProps {
  /** 已固化的遮罩图元（显示坐标，按序叠加成并集） */
  ops: readonly MaskOp[];
  /** 拖拽进行中的活笔预览（未固化，pointerup 才落栈） */
  liveOp: MaskOp | null;
  /** 显示区域未缩放尺寸（与 MaskCoordinateSpace.displayWidth/Height 同源） */
  displayWidth: number;
  displayHeight: number;
  onStrokeStart: (point: MaskPoint) => void;
  onStrokeMove: (point: MaskPoint) => void;
  onStrokeEnd: () => void;
}

/** 棋盘格单格尺寸（显示坐标像素） */
const CHECKER_CELL_PX = 16;
/** 涂区整体不透明度：半透明叠加，底下画面的明暗轮廓仍可辨（规格故事 14） */
const MASK_OPACITY = 0.55;

/** 单个图元的 mask 图元（涂=白/橡皮=黑，依序渲染后者覆盖前者，与 rasterizeMask 同序同语义） */
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
  // useId 含冒号（防撞设计），SVG funciri（url(#id)）里冒号在部分浏览器解析异常——清洗成安全字符
  const maskId = `erase-mask${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const patternId = `erase-checker${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const draggingRef = useRef(false);

  /** 指针事件 → 显示坐标（相对内容区左上，除以画布 zoom 抵消缩放，任意缩放下与原图像素对齐） */
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
    // pointer capture 保证拖出区域仍收 move（jsdom 无该 API，optional call 防御）
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
