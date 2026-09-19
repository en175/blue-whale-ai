/* ============================================
 * SubtitleEraseBoxesLayer 去字幕编辑态框渲染层（IKGZ83，IKGZ7V 波3）：
 * 叠在源视频卡内容区上的半透明矩形描边渲染 + 拉框指针交互接管。
 * - 框渲染 = 半透明填充 + 虚线描边（检测区语义，区别于图片擦除的棋盘格涂抹区；
 *   官方文档示例即为虚线检测框）；渲染数据 = subtitleEraseBoxes 的 state.boxes
 *   （显示坐标，落笔即固化）+ 拖拽进行中的 liveBox 预览。
 * - 指针事件换算成显示坐标（相对内容区左上、未乘画布 zoom：clientXY 偏移除以 zoom）
 *   上抛，落笔/固化由 CanvasPage 经 applySubtitleBox 完成；本层不持有编辑状态。
 * - nodrag/nopan 阻止节点拖拽与画布平移（接管源视频卡区域，不影响画布其他区域，
 *   规格 Implementation Decisions「接管源视频卡区域的指针交互，不影响画布其他操作」）。
 * ============================================ */
import { useCallback, useRef } from 'react';
import { useStore } from '@xyflow/react';
import type { SubtitleBoxOp, SubtitleBoxPoint } from '../../subtitleEraseBoxes';

export interface SubtitleEraseBoxesLayerProps {
  /** 已固化的框（显示坐标，落笔即固化，无活框选中态） */
  boxes: readonly SubtitleBoxOp[];
  /** 拖拽进行中的活框预览（未固化，pointerup 才落栈；null=无拖拽） */
  liveBox: SubtitleBoxOp | null;
  /** 显示区域未缩放尺寸（与框图元显示坐标系同源） */
  displayWidth: number;
  displayHeight: number;
  onBoxStart: (point: SubtitleBoxPoint) => void;
  onBoxMove: (point: SubtitleBoxPoint) => void;
  onBoxEnd: () => void;
}

/** 检测框视觉：半透明主色填充（不遮挡画面明暗轮廓，规格故事 13）+ 虚线描边 */
const BOX_FILL = 'rgba(61, 90, 254, 0.16)';
const BOX_STROKE = '#3d5afe';
const BOX_STROKE_WIDTH = 1.5;
const BOX_DASH = '6 4';

/** 单个框的 SVG 矩形（对角归一渲染；固化框与活框预览共用） */
function BoxShape({ op, preview }: { op: SubtitleBoxOp; preview?: boolean }) {
  const x = Math.min(op.from.x, op.to.x);
  const y = Math.min(op.from.y, op.to.y);
  return (
    <rect
      x={x}
      y={y}
      width={Math.abs(op.to.x - op.from.x)}
      height={Math.abs(op.to.y - op.from.y)}
      fill={BOX_FILL}
      stroke={BOX_STROKE}
      strokeWidth={BOX_STROKE_WIDTH}
      strokeDasharray={BOX_DASH}
      opacity={preview ? 0.7 : 1}
    />
  );
}

export default function SubtitleEraseBoxesLayer({
  boxes,
  liveBox,
  displayWidth,
  displayHeight,
  onBoxStart,
  onBoxMove,
  onBoxEnd,
}: SubtitleEraseBoxesLayerProps) {
  const zoom = useStore((state) => state.transform[2]);
  const draggingRef = useRef(false);

  /** 指针事件 → 显示坐标（相对内容区左上，除以画布 zoom 抵消缩放） */
  const toDisplayPoint = useCallback(
    (event: React.PointerEvent<HTMLElement>): SubtitleBoxPoint => {
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
    onBoxStart(toDisplayPoint(event));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    event.stopPropagation();
    onBoxMove(toDisplayPoint(event));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    onBoxEnd();
  };

  return (
    <div
      className="nodrag nopan"
      data-testid="subtitle-erase-boxes-layer"
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
      /* 落笔后浏览器派发的 click 必须截在层内：冒泡命中 NodeWrapper 的 onClick 会对
         有生成记录的源卡触发 onNodeClick → 打开生成面板并退出编辑态（框选丢失） */
      onClick={(event) => event.stopPropagation()}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${displayWidth} ${displayHeight}`}
        preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        {boxes.map((op, i) => (
          <BoxShape key={i} op={op} />
        ))}
        {liveBox && <BoxShape op={liveBox} preview />}
      </svg>
    </div>
  );
}
