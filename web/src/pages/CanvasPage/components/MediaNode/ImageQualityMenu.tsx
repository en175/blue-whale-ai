/* ============================================
 * ImageQualityMenu 「高清 ▾」下拉（IKGOT7）：图片卡工具条的画质类工具入口。
 * 菜单项由宿主以数组传入（id/label/图标/可用性判定），本组件只负责展开与置灰口径，
 * 扩图（IKGOQ0）就绪后在「高清」与「擦除」之间插入中间位——只改宿主的数组，不改本组件。
 * 点外关闭复用 useDismissOnOutside；Esc 关闭口径同 AtMentionMenu 的 window keydown。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Expand, type LucideIcon } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

export interface ImageQualityMenuItem {
  /** 菜单项 id（'enhance' / 'erase'，扩图后续插入 'outpaint' 等） */
  id: string;
  label: string;
  icon: LucideIcon;
  /** 可用时的悬停说明 */
  hint?: string;
  /** 置灰原因（null=可用；置灰项 title 展示原因且点击不派发，口径同 ImageEnhanceDialog guarded） */
  disabledReason: string | null;
  onSelect: () => void;
}

interface ImageQualityMenuProps {
  items: ImageQualityMenuItem[];
  /** 触发按钮悬停说明 */
  title?: string;
}

export default function ImageQualityMenu({ items, title }: ImageQualityMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open, ref: wrapRef, dismiss: () => setOpen(false) },
  ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={`nodrag nopan ${styles.qualityWrap}`} ref={wrapRef}>
      <button
        type="button"
        className={styles.toolBtn}
        onClick={() => setOpen((v) => !v)}
        title={title ?? '画质工具'}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        data-testid="image-quality-trigger"
      >
        <Expand size={14} strokeWidth={2} />
        <span>高清</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.qualityMenu} role="menu" data-testid="image-quality-menu">
          {items.map((item) => {
            const Icon = item.icon;
            const disabled = item.disabledReason != null;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={styles.qualityMenuItem}
                aria-disabled={disabled || undefined}
                title={item.disabledReason ?? item.hint}
                data-testid={`image-quality-item-${item.id}`}
                onClick={() => {
                  if (disabled) return;
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <Icon size={14} strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
