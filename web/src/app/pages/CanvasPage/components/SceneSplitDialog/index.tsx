import { ArrowUp, X, Zap } from 'lucide-react';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import {
  SCENE_SPLIT_GRANULARITIES,
  SCENE_SPLIT_GRANULARITY_LABELS,
  type SceneSplitGranularity,
} from '../../sceneSplit';
import styles from './index.module.css';

interface SceneSplitDialogProps {
  onClose: () => void;
  granularity: SceneSplitGranularity;
  onGranularityChange: (granularity: SceneSplitGranularity) => void;
  onSend: () => void;
  submitting?: boolean;
  sendBarAnchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function SceneSplitDialog({
  onClose,
  granularity,
  onGranularityChange,
  onSend,
  submitting,
  sendBarAnchor, dragHidden,
}: SceneSplitDialogProps) {
  const readOnly = submitting === true;

  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    <div
      className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
      style={anchoredOverlayStyle(sendBarAnchor, dragHidden)}
      data-gen-panel-territory
      data-testid="scene-split-send-bar"
    >
      <button
        type="button"
        className={styles.toolBtn}
        data-testid="scene-split-close"
        title="退出场景切分（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.barTitle} data-testid="scene-split-title">
        场景切分
      </span>
      {}
      <div className={styles.segmentGroup} role="radiogroup" aria-label="切分粒度" data-testid="scene-split-granularity">
        {SCENE_SPLIT_GRANULARITIES.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={item === granularity}
            className={`${styles.segmentBtn} ${item === granularity ? styles.segmentBtnActive : ''}`}
            data-testid={`scene-split-granularity-${item}`}
            disabled={readOnly}
            title={
              item === 'fine'
                ? '细：切得更碎，片段更多'
                : item === 'coarse'
                  ? '粗：忽略不显著的场景变化，片段更少'
                  : '标准：官方推荐粒度'
            }
            onClick={guarded(readOnly, () => onGranularityChange(item))}
          >
            {SCENE_SPLIT_GRANULARITY_LABELS[item]}
          </button>
        ))}
      </div>
      <span className={styles.freeBadge} title="本期免费" data-testid="scene-split-free-badge">
        <Zap size={12} strokeWidth={2} />
        <span>0</span>
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="scene-split-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '发送场景切分任务'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
