/* ============================================
 * ImageQualityMenu 「高清 ▾」下拉（IKGOT7）：图片卡工具条的画质类工具入口。
 * 菜单项由宿主以数组传入（id/label/图标/可用性判定），本组件只负责展开与置灰口径，
 * 扩图（IKGOQ0）就绪后在「高清」与「擦除」之间插入中间位——只改宿主的数组，不改本组件。
 * IKGZ5P 触发钮最近工具语义：文案/图标显示全局记忆的最近使用工具（默认「高清」，
 * recentQualityTool 全局单值 + localStorage 持久，跨卡片共享）；悬浮触发钮自动展开、
 * 移出关闭（延迟容忍移向菜单的间隙）；点击触发钮直启所显示工具（复用菜单项既有入口
 * handler，两路共用同一写入点 persistRecentQualityTool）；所显示工具对当前卡不可用时
 * 整钮置灰（aria-disabled + 点击无效），hover 仍展开菜单可见原因并改选。
 * 点外关闭复用 useDismissOnOutside；Esc 关闭口径同 AtMentionMenu 的 window keydown。
 * ============================================ */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { persistRecentQualityTool, readRecentQualityTool, subscribeRecentQualityTool } from '../../recentQualityTool';
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
  /** 触发按钮悬停说明（缺省按最近工具的置灰原因/悬停说明） */
  title?: string;
}

/** 移出后延迟关闭的等待窗口（容忍指针从触发钮滑向菜单的间隙，期间重新进入即取消） */
const HOVER_CLOSE_DELAY_MS = 120;

export default function ImageQualityMenu({ items, title }: ImageQualityMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  /** 最近使用的画质工具（全局单值，跨卡片共享；localStorage 持久，默认「高清」） */
  const recentId = useSyncExternalStore(subscribeRecentQualityTool, readRecentQualityTool);
  const recentItem = items.find((item) => item.id === recentId) ?? items[0];
  const RecentIcon = recentItem.icon;
  /** 所显示工具对当前卡不可用（复用菜单项既有置灰门槛）：整钮置灰、点击无效，hover 仍可展开菜单 */
  const launchDisabled = recentItem.disabledReason != null;

  const cancelScheduledClose = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const close = () => {
    cancelScheduledClose();
    setOpen(false);
  };

  /** 移出 wrap 延迟关闭：为指针滑向菜单项留出间隙（菜单在 wrap 下方 6px 悬浮） */
  const scheduleClose = () => {
    if (closeTimerRef.current != null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  };

  useEffect(() => cancelScheduledClose, []);

  useDismissOnOutside([
    { open, ref: wrapRef, dismiss: close },
  ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cancelScheduledClose();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /** 启动工具的唯一路径（菜单选择与触发钮直启共用）：写入最近工具记忆并派发菜单项既有入口 */
  const launch = (item: ImageQualityMenuItem) => {
    close();
    persistRecentQualityTool(item.id);
    item.onSelect();
  };

  return (
    <div
      className={`nodrag nopan ${styles.qualityWrap}`}
      ref={wrapRef}
      onMouseEnter={() => {
        cancelScheduledClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={styles.toolBtn}
        onClick={() => {
          if (launchDisabled) return;
          launch(recentItem);
        }}
        title={title ?? recentItem.disabledReason ?? recentItem.hint ?? '画质工具'}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-disabled={launchDisabled || undefined}
        data-testid="image-quality-trigger"
      >
        <RecentIcon size={14} strokeWidth={2} />
        <span>{recentItem.label}</span>
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
                  launch(item);
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
