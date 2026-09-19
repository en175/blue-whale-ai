/* ============================================
 * CropDialog 裁切面板（IKGW1N，IKGV2J 整包第三票）：跟随源图卡下方浮出的横条，
 * 六选项（自由 + 1:1/4:3/3:4/16:9/9:16，选项数据单源于 imageCrop.ts 不另造）+
 * 「取消」文字钮 + 确认图标钮（IKGZ5Q：Dock 主发送钮同款——灰底圆角方形 + 白 ↑ 图标，
 * 裁切恒可确认故恒激活态；「确认」文案保留在 title）。比例项视觉复用共享 RatioIcon
 * （IKGBTV 口径；「自由」无固定比例不渲染图标）。
 * 选中预设：父级以 inscribeCropRect 把框变为内容区内最大内接该比例矩形并居中；
 * 取消绑 onClose（CanvasPage 接 exitCropMode，四退出之一）；确认绑 onConfirm
 * （本票渲染在位、点击派发回调；裁切执行链路由 IKGW1S 实装）。
 * data-gen-panel-territory 豁免点外关闭误杀；跟随锚为中心点锚（IKH1WI：inline left = 源卡
 * 中心 x，面板自身 translateX(-50%) 真居中，口径同 CutoutToolbar）。
 * ============================================ */
import { ArrowUp } from 'lucide-react';
import RatioIcon from '@/components/RatioIcon';
import type { FollowDialogAnchor } from '../../followDialog';
import { CROP_PRESET_LABELS, CROP_PRESET_ORDER, type CropPresetKey } from '../../imageCrop';
import styles from './index.module.css';

interface CropDialogProps {
  /** 当前比例模式（高亮判定） */
  preset: CropPresetKey;
  /** 点比例选项：预设 → 父级 inscribeCropRect 最大内接居中；自由 → 框保持不变 */
  onPresetChange: (key: CropPresetKey) => void;
  /** 确认裁切（裁切执行与建卡由 IKGW1S 实装） */
  onConfirm: () => void;
  /** 取消（退出裁切模式，丢弃不留痕） */
  onClose: () => void;
  /** 绑定源图卡时悬浮跟随其下方；缺省锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
}

export default function CropDialog({ preset, onPresetChange, onConfirm, onClose, followAnchor }: CropDialogProps) {
  return (
    <div
      className={`${styles.panel} ${followAnchor ? styles.panelFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
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
