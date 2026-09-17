/* ============================================
 * OutpaintDialog 扩图参数面板骨架（IKGOQX）：
 * 跟随源图卡下方的轻量面板。本票只做比例行 + 关闭 X + 占位容器；
 * 张数控件、「本期免费」文案与发送钮是 IKGOR6 范围，占位容器留给后续接入。
 * 骨架照搬 ImageEnhanceDialog：跟随锚定（followAnchor）、data-gen-panel-territory
 * 领土豁免、置灰守卫（aria-disabled + 点击守卫 + title 悬停原因）。
 * 比例选项用共享宽高比图标组件 RatioIcon 渲染（IKGBTV 防漂移口径）。
 * ============================================ */
import { X } from 'lucide-react';
import RatioIcon from '@/components/RatioIcon';
import type { FollowDialogAnchor } from '../../followDialog';
import {
  OUTPAINT_PRESET_LABELS,
  OUTPAINT_PRESET_ORDER,
  matchOutpaintPreset,
  maxExpandPerSide,
  outpaintPresetAvailability,
  type ExpandSides,
  type OutpaintPresetKey,
} from '../../imageOutpaint';
import styles from './index.module.css';

interface OutpaintDialogProps {
  onClose: () => void;
  /** 源图内容区尺寸（预设可达性与命中判定基准） */
  sourceSize: { width: number; height: number };
  /** 当前四方向扩展量（命中预设高亮 / 自定义被动状态的判定输入） */
  expands: ExpandSides;
  /** 点预设：父级以原图中心为锚外扩到该比例最小包含框（不可达预设已置灰不会触发） */
  onPresetSelect: (key: OutpaintPresetKey) => void;
  /** 绑定源图卡时悬浮跟随其下方；缺省锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
}

export default function OutpaintDialog({
  onClose,
  sourceSize,
  expands,
  onPresetSelect,
  followAnchor,
}: OutpaintDialogProps) {
  const availability = outpaintPresetAvailability(sourceSize, maxExpandPerSide(sourceSize));
  const matched = matchOutpaintPreset(expands, sourceSize);

  /** 置灰守卫（口径同 ImageEnhanceDialog：aria-disabled + 点击守卫，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
      data-gen-panel-territory
    >
      <div className={styles.dialog} data-testid="outpaint-dialog">
        <div className={styles.headerRow}>
          <span className={styles.title}>扩图</span>
          <button type="button" className={styles.iconBtn} onClick={onClose} title="关闭" data-testid="outpaint-close">
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>比例</span>
          <div className={styles.presetGroup}>
            {OUTPAINT_PRESET_ORDER.map((key) => {
              const disabledReason = availability[key];
              const active = matched === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-disabled={!!disabledReason || undefined}
                  title={disabledReason ?? undefined}
                  className={`${styles.presetBtn} ${active ? styles.presetBtnActive : ''}`}
                  data-testid={`outpaint-preset-${key.replace(':', '-')}`}
                  onClick={guarded(!!disabledReason, () => onPresetSelect(key))}
                >
                  <RatioIcon ratio={key === 'original' ? `${sourceSize.width}:${sourceSize.height}` : key} />
                  <span>{OUTPAINT_PRESET_LABELS[key]}</span>
                </button>
              );
            })}
            {/* 自定义：手动拖拽后的被动状态展示，不可主动点选（规格故事 32） */}
            <span
              className={`${styles.customChip} ${matched === null ? styles.customChipActive : ''}`}
              data-testid="outpaint-preset-custom"
              title={matched === null ? '当前为手动拖拽出的自定义比例' : undefined}
            >
              自定义
            </span>
          </div>
        </div>

        {/* 占位容器：张数控件 / 「本期免费」文案 / 发送钮由 IKGOR6 接入 */}
        <div className={styles.bodyPlaceholder} data-testid="outpaint-body-placeholder" />
      </div>
    </div>
  );
}
