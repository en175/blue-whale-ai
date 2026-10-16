import { VIDEO_ENHANCE_RESOLUTION_LABELS } from '@/custom/enums';
import { useState } from 'react';
import { X, ArrowUp } from 'lucide-react';
import { VIDEO_ENHANCE_RESOLUTIONS, type VideoEnhanceResolution } from '@lib/contracts/video-enhance';

import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../agent/followDialog';
import styles from './index.module.css';

interface VideoEnhanceDialogProps {
  onClose: () => void;
  onSend: (resolution: VideoEnhanceResolution) => boolean | Promise<boolean>;
  onParamsChange: (resolution: VideoEnhanceResolution) => void;
  initialResolution?: VideoEnhanceResolution | null;
  generating?: boolean;
  submitting?: boolean;
  followAnchor?: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function VideoEnhanceDialog({
  onClose,
  onSend,
  onParamsChange,
  initialResolution,
  generating,
  submitting,
  followAnchor, dragHidden,
}: VideoEnhanceDialogProps) {
  const [resolution, setResolution] = useState<VideoEnhanceResolution>(
    () => initialResolution ?? VIDEO_ENHANCE_RESOLUTIONS[0],
  );

  const readOnly = generating === true || submitting === true;
  const readOnlyReason = generating
    ? '生成中，参数只读'
    : '正在保存并提交，参数只读';

  const sendTitle = readOnly ? readOnlyReason : '最高可至 4K';
  const canSend = !readOnly;

  const handleResolutionChange = (next: VideoEnhanceResolution) => {
    if (readOnly || next === resolution) return;
    setResolution(next);
    onParamsChange(next);
  };

  const handleSend = () => {
    if (!canSend) return;
    void Promise.resolve(onSend(resolution));
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
      data-gen-panel-territory
      data-testid="video-enhance-dialog"
    >
      <div className={styles.dialog}>
        <div className={styles.headerRow}>
          <span className={styles.title}>HD 高清</span>
          <button type="button" className={styles.iconBtn} onClick={onClose} title="关闭" data-testid="video-enhance-close-btn">
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {readOnly && <div className={styles.readOnlyHint}>{readOnlyReason}</div>}

        {}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>目标分辨率</span>
          <div className={styles.resolutionGroup}>
            {VIDEO_ENHANCE_RESOLUTIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.resolutionBtn} ${value === resolution ? styles.resolutionBtnActive : ''}`}
                data-testid={`video-enhance-resolution-${value}`}
                onClick={() => handleResolutionChange(value)}
                disabled={readOnly}
              >
                {VIDEO_ENHANCE_RESOLUTION_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.bottomBar}>
          <span className={styles.freeHint}>本期免费</span>
          <button
            type="button"
            className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!canSend}
            title={sendTitle}
            data-testid="video-enhance-send-btn"
          >
            <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
