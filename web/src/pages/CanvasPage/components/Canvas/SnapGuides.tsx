/* ============================================
 * SnapGuides 对齐线渲染层（IKGGCT T2）：
 * 拖拽吸附命中时把 snapAlignment 计算出的 guide 线段画到画布上，脱离即消失。
 * 屏幕空间绘制而非挂进 .react-flow__viewport 变换层：线坐标 = 画布坐标
 * × zoom + 平移，线宽恒 1 屏幕像素——等效于画布空间 strokeWidth = 1/zoom，
 * 但层级可与 GroupOverlay 各层一起精确编排。作为 ReactFlow children 渲染
 * 才能拿到 viewport context（同 GroupOverlay 先例）。纯视觉层不拦截交互。
 * ============================================ */
import { useViewport } from '@xyflow/react';
import type { SnapGuide } from '../../snapAlignment';
import styles from './index.module.css';

export default function SnapGuides({ guides }: { guides: SnapGuide[] }) {
  const { x, y, zoom } = useViewport();
  if (guides.length === 0) return null;
  return (
    <svg className={styles.snapGuides} data-testid="snap-guides">
      {guides.map((g) => {
        const panningOffset = g.orientation === 'vertical' ? x : y;
        const alongOffset = g.orientation === 'vertical' ? y : x;
        const fixed = g.pos * zoom + panningOffset;
        const from = g.from * zoom + alongOffset;
        const to = g.to * zoom + alongOffset;
        return g.orientation === 'vertical' ? (
          <line key={`${g.targetId}-${g.relation}`} x1={fixed} x2={fixed} y1={from} y2={to} />
        ) : (
          <line key={`${g.targetId}-${g.relation}`} x1={from} x2={to} y1={fixed} y2={fixed} />
        );
      })}
    </svg>
  );
}
