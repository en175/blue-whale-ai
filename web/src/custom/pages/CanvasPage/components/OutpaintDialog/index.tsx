import { type OutpaintPresetKey, OUTPAINT_PRESET_LABELS } from '@/custom/enums';
import { useEffect, useRef, useState } from 'react';
import { X, ArrowUp, ChevronDown } from 'lucide-react';
import RatioIcon from '@/custom/components/RatioIcon';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../agent/followDialog';
import { OUTPAINT_PRESET_ORDER, matchOutpaintPreset, maxExpandPerSide, outpaintPresetAvailability, type ExpandSides } from '../../tools/image/imageOutpaint';
import MediaToolQuoteBadge from '../MediaToolQuoteBadge';
import styles from './index.module.css';

interface OutpaintDialogProps {
  onClose: () => void;
  sourceSize: { width: number; height: number };
  expands: ExpandSides;
  onPresetSelect: (key: OutpaintPresetKey) => void;
  onSend: () => boolean;
  followAnchor?: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

function triggerIconRatio(
  matched: OutpaintPresetKey | null,
  sourceSize: { width: number; height: number },
  expands: ExpandSides,
): string {
  if (matched === 'original' || matched === null) {
    if (matched === 'original') return `${sourceSize.width}:${sourceSize.height}`;
    const boxW = sourceSize.width + expands.left + expands.right;
    const boxH = sourceSize.height + expands.top + expands.bottom;
    return `${boxW}:${boxH}`;
  }
  return matched;
}

export default function OutpaintDialog({
  onClose,
  sourceSize,
  expands,
  onPresetSelect,
  onSend,
  followAnchor, dragHidden,
}: OutpaintDialogProps) {
  const availability = outpaintPresetAvailability(sourceSize, maxExpandPerSide(sourceSize));
  const matched = matchOutpaintPreset(expands, sourceSize);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuAnchorRef.current && !menuAnchorRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const zeroExpand =
    expands.top <= 0 && expands.right <= 0 && expands.bottom <= 0 && expands.left <= 0;
  const canSend = !zeroExpand;
  const sendDisabledReason = '先拖动扩展框选择要扩展的范围';
  const triggerLabel = matched ? OUTPAINT_PRESET_LABELS[matched] : '自定义';

  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
      data-gen-panel-territory
    >
      <div className={styles.toolbar} data-testid="outpaint-dialog">
        <button type="button" className={styles.iconBtn} onClick={onClose} title="退出扩图" data-testid="outpaint-close">
          <X size={14} strokeWidth={2} />
        </button>
        <span className={styles.divider} aria-hidden />

        <div className={styles.menuAnchor} ref={menuAnchorRef}>
          <button
            type="button"
            className={styles.triggerBtn}
            aria-haspopup="menu"
            aria-expanded={menuOpen || undefined}
            title="选择扩展后的画面比例"
            data-testid="outpaint-ratio-trigger"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <RatioIcon ratio={triggerIconRatio(matched, sourceSize, expands)} size={14} />
            <span>{triggerLabel}</span>
            <ChevronDown size={12} strokeWidth={2} />
          </button>
          {menuOpen && (
            <div className={styles.menuPopup} role="menu" data-testid="outpaint-ratio-menu">
              {}
              <span
                className={`${styles.menuChip} ${matched === null ? styles.menuChipActive : ''}`}
                data-testid="outpaint-preset-custom"
                title={matched === null ? '当前为手动拖拽出的自定义比例' : undefined}
              >
                自定义
              </span>
              {OUTPAINT_PRESET_ORDER.map((key) => {
                const disabledReason = availability[key];
                const active = matched === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    aria-disabled={!!disabledReason || undefined}
                    title={disabledReason ?? undefined}
                    className={`${styles.menuItem} ${active ? styles.menuItemActive : ''}`}
                    data-testid={`outpaint-preset-${key.replace(':', '-')}`}
                    onClick={guarded(!!disabledReason, () => {
                      onPresetSelect(key);
                      setMenuOpen(false);
                    })}
                  >
                    <RatioIcon
                      ratio={key === 'original' ? `${sourceSize.width}:${sourceSize.height}` : key}
                      size={14}
                    />
                    <span>{OUTPAINT_PRESET_LABELS[key]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {}
        <button type="button" className={styles.countBtn} disabled title="多张生成暂未开放，本期固定生成 1 张" data-testid="outpaint-count">
          <span>1张</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>

        <MediaToolQuoteBadge
          toolType="image_outpaint"
          input={{}}
          variant="hint"
          testId="image-outpaint-quote"
        />

        <button
          type="button"
          className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
          onClick={guarded(!canSend, onSend)}
          disabled={!canSend}
          title={zeroExpand ? sendDisabledReason : '发送'}
          data-testid="outpaint-send-btn"
        >
          <ArrowUp size={14} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}
