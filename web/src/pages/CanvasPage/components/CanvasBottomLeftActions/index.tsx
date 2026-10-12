import { ArrowLeft, Map as MapIcon, Link, Link2Off, Magnet } from 'lucide-react';
import styles from '../../index.module.css';

export type CanvasSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface CanvasBottomLeftActionsProps {
  showMiniMap: boolean;
  showEdges: boolean;
  snapAlignmentOn: boolean;
  saveStatus: CanvasSaveStatus;
  savedAt: string;
  onBackHome: () => void;
  onToggleMiniMap: () => void;
  onToggleEdges: () => void;
  onToggleSnap: () => void;
  onRetrySave: () => void;
}

export default function CanvasBottomLeftActions({
  showMiniMap,
  showEdges,
  snapAlignmentOn,
  saveStatus,
  savedAt,
  onBackHome,
  onToggleMiniMap,
  onToggleEdges,
  onToggleSnap,
  onRetrySave,
}: CanvasBottomLeftActionsProps) {
  return (
    <div className={styles.bottomLeftActions} data-canvas-chrome>
      <button className={styles.backHomeBtn} onClick={onBackHome}>
        <ArrowLeft size={14} strokeWidth={2} />
        <span>返回首页</span>
      </button>
      <button
        className={`${styles.mapBtn} ${showMiniMap ? styles.mapBtnActive : ''}`}
        onClick={onToggleMiniMap}
        title={showMiniMap ? '隐藏小地图' : '显示小地图'}
      >
        <MapIcon size={14} strokeWidth={2} />
      </button>
      <button
        className={`${styles.mapBtn} ${showEdges ? styles.mapBtnActive : ''}`}
        onClick={onToggleEdges}
        title={showEdges ? '隐藏连线' : '显示连线'}
      >
        {showEdges ? <Link size={14} strokeWidth={2} /> : <Link2Off size={14} strokeWidth={2} />}
      </button>
      <button
        className={`${styles.mapBtn} ${snapAlignmentOn ? styles.mapBtnActive : ''}`}
        onClick={onToggleSnap}
        title={snapAlignmentOn ? '关闭对齐吸附' : '开启对齐吸附'}
      >
        <Magnet size={14} strokeWidth={2} />
      </button>
      {saveStatus !== 'idle' && (
        <span
          data-gen-panel-territory
          className={`${styles.saveStatus} ${saveStatus === 'error' ? styles.saveStatusError : ''}`}
        >
          {saveStatus === 'saving' && '保存中…'}
          {saveStatus === 'saved' && `已保存 ${savedAt}`}
          {saveStatus === 'error' && <>
            保存失败，请重试 <button type="button" onClick={onRetrySave}>重试保存</button>
          </>}
        </span>
      )}
    </div>
  );
}
