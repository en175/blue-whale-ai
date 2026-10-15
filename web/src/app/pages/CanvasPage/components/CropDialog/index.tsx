import { ArrowUp } from 'lucide-react';
import RatioIcon from '@/app/components/RatioIcon';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import { CROP_PRESET_LABELS, CROP_PRESET_ORDER, type CropPresetKey } from '../../imageCrop';
import styles from './index.module.css';

interface CropDialogProps {
  preset: CropPresetKey;
  onPresetChange: (key: CropPresetKey) => void;
  onConfirm: () => void;
  onClose: () => void;
  followAnchor?: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function CropDialog({ preset, onPresetChange, onConfirm, onClose, followAnchor, dragHidden }: CropDialogProps) {
  return (
    <div
      className={`${styles.panel} ${followAnchor ? styles.panelFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
      data-gen-panel-territory
      data-testid="crop-dialog"
    >
      <span className={styles.title}>裁切</span>
      <span className={styles.divider} aria-hidden />
      <div className={styles.presetRow} role="group" aria-label="裁切比例">
        {CROP_PRESET_ORDER.map((key) => {
          const active = preset === key;
          return (
            <button
              key={key}
              type="button"
              className={`${styles.presetBtn} ${active ? styles.presetBtnActive : ''}`}
              data-testid={`crop-preset-${key.replace(':', '-')}`}
              aria-pressed={active}
              title={key === 'free' ? '自由调整裁切范围，不锁定比例' : `锁定为 ${CROP_PRESET_LABELS[key]} 比例`}
              onClick={() => onPresetChange(key)}
            >
              {key === 'free' ? null : <RatioIcon ratio={key} />}
              <span>{CROP_PRESET_LABELS[key]}</span>
            </button>
          );
        })}
      </div>
      <span className={styles.divider} aria-hidden />
      <button type="button" className={styles.cancelBtn} data-testid="crop-cancel" onClick={onClose}>
        取消
      </button>
      <button
        type="button"
        className={styles.confirmBtn}
        data-testid="crop-confirm"
        title="确认"
        onClick={onConfirm}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
