/* ============================================
 * ZoomControl 画布缩放控制器：放大/缩小/百分比
 * ============================================ */
import { useReactFlow, useViewport } from '@xyflow/react';
import { Plus, Minus, Maximize } from 'lucide-react';
import styles from './index.module.css';

export default function ZoomControl() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();

  const percentage = Math.round(zoom * 100);

  return (
    <div className={styles.zoomControl} data-canvas-chrome="block">
      <button
        className={styles.zoomBtn}
        onClick={() => zoomOut()}
        title="缩小"
      >
        <Minus size={14} strokeWidth={2} />
      </button>
      <span className={styles.zoomValue}>{percentage}%</span>
      <button
        className={styles.zoomBtn}
        onClick={() => zoomIn()}
        title="放大"
      >
        <Plus size={14} strokeWidth={2} />
      </button>
      <span className={styles.zoomDivider} />
      <button
        className={styles.zoomBtn}
        onClick={() => zoomTo(1, { duration: 300 })}
        title="一键 100%"
      >
        100%
      </button>
      <button
        className={styles.zoomBtn}
        onClick={() => fitView({ padding: 0.2, duration: 300 })}
        title="适应画布"
      >
        <Maximize size={13} strokeWidth={2} />
      </button>
    </div>
  );
}
