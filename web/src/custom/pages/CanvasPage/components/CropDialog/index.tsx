import { type CropPresetKey, CROP_PRESET_LABELS } from '@/custom/enums';
import { ArrowUp } from 'lucide-react';
import RatioGroup from '@/custom/components/RatioGroup';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../agent/followDialog';
import { CROP_PRESET_ORDER } from '../../tools/image/imageCrop';
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
      <RatioGroup
        className={styles.presetRow}
        variant="compact"
        value={preset}
        ariaLabel="裁切比例"
        onChange={onPresetChange}
        options={CROP_PRESET_ORDER.map((key) => ({
          value: key,
          label: CROP_PRESET_LABELS[key],
          showIcon: key !== 'free',
          testId: `crop-preset-${key.replace(':', '-')}`,
          title: key === 'free' ? '自由调整裁切范围，不锁定比例' : `锁定为 ${CROP_PRESET_LABELS[key]} 比例`,
        }))}
      />
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
