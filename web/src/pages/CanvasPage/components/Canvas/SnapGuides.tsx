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
