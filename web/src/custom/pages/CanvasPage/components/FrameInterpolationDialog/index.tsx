import { useState } from 'react';
import { X, ArrowUp } from 'lucide-react';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../agent/followDialog';
import {
  FRAME_INTERPOLATION_DEFAULT_FPS,
  FRAME_INTERPOLATION_FPS_VALUES,
  FRAME_INTERPOLATION_SEND_HINT,
  frameInterpolationFpsLabel,
  type FrameInterpolationFps,
} from '../../tools/video/frameInterpolation';
import MediaToolQuoteBadge from '../MediaToolQuoteBadge';
import styles from './index.module.css';

interface FrameInterpolationDialogProps {
  onClose: () => void;
  onSend: (fps: FrameInterpolationFps) => boolean | Promise<boolean>;
  onParamsChange: (fps: FrameInterpolationFps) => void;
  initialFps?: FrameInterpolationFps | null;
  sourceAssetId?: string | null;
  generating?: boolean;
  submitting?: boolean;
  followAnchor?: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function FrameInterpolationDialog({
  onClose,
  onSend,
  onParamsChange,
  initialFps,
  sourceAssetId,
  generating,
  submitting,
  followAnchor, dragHidden,
}: FrameInterpolationDialogProps) {
  const [fps, setFps] = useState<FrameInterpolationFps>(
    () => initialFps ?? FRAME_INTERPOLATION_DEFAULT_FPS,
  );

  const readOnly = generating === true || submitting === true;
  const readOnlyReason = generating
    ? '生成中，参数只读'
    : '正在保存并提交，参数只读';

  const sendTitle = readOnly ? readOnlyReason : FRAME_INTERPOLATION_SEND_HINT;
  const canSend = !readOnly;

  const handleFpsChange = (next: FrameInterpolationFps) => {
    if (readOnly || next === fps) return;
    setFps(next);
    onParamsChange(next);
  };

  const handleSend = () => {
    if (!canSend) return;
    void Promise.resolve(onSend(fps));
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
      data-gen-panel-territory
      data-testid="frame-interpolation-dialog"
    >
      <div className={styles.dialog}>
        <div className={styles.headerRow}>
          <span className={styles.title}>视频插帧</span>
          <button type="button" className={styles.iconBtn} onClick={onClose} title="关闭" data-testid="frame-interpolation-close-btn">
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {readOnly && <div className={styles.readOnlyHint}>{readOnlyReason}</div>}

        {}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>目标帧率</span>
          <div className={styles.fpsGroup}>
            {FRAME_INTERPOLATION_FPS_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.fpsBtn} ${value === fps ? styles.fpsBtnActive : ''}`}
                data-testid={`frame-interpolation-fps-${value}`}
                onClick={() => handleFpsChange(value)}
                disabled={readOnly}
              >
                {frameInterpolationFpsLabel(value)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.bottomBar}>
          <MediaToolQuoteBadge
            toolType="video_frame_interpolation"
            params={sourceAssetId ? { source_asset_id: sourceAssetId, fps } : null}
            variant="hint"
            testId="frame-interpolation-quote"
          />
          <button
            type="button"
            className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!canSend}
            title={sendTitle}
            data-testid="frame-interpolation-send-btn"
          >
            <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
