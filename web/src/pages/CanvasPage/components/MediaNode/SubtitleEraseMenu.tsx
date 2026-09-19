/* ============================================
 * SubtitleEraseMenu 「智能去字幕 ▾」下拉（IKH3OU，ADR-0104）：视频卡工具条的去字幕入口。
 * 交互口径与 ImageQualityMenu 同构（家族「同构不共享」，ADR-0101 Consequences 末条 /
 * ADR-0098）：悬浮触发钮自动展开、移出延迟 120ms 关闭（容忍指针滑向菜单的间隙）、
 * Esc 与点外立即关闭、整钮置灰用 aria-disabled（点击无效但 hover 仍展开菜单，
 * 正是为保留「置灰时查看原因并改选」的路径）。
 * 与图片画质下拉的差异（ADR-0104 定案）：
 *  - 触发钮文案固定「智能去字幕」，不读 recentQualityTool（不做最近工具记忆）；
 *  - 菜单项纯文字无图标，两项分别直启「智能去字幕」与「框选去字幕」会话；
 *  - 整卡门槛（超 2K / 超 10 分钟，videoSubtitleEraseGateReason）命中时两项一并置灰，
 *    但各项 title 保留自己的 hint（规格故事 7：置灰仍能看两项说明，理解置灰是整卡门槛）。
 * 门槛由宿主算好经 items 传入——组件不感知分辨率/时长字段。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Subtitles } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

export interface SubtitleEraseMenuItem {
  /** 菜单项 id（'smart' / 'box'） */
  id: string;
  label: string;
  /** 菜单项自己的悬停说明（置灰时仍作 title：区分「整卡不可用」与「某模式不可用」） */
  hint: string;
  /** 置灰原因（null=可用）；两项同源整卡门槛，命中时整钮与两项一并置灰 */
  disabledReason: string | null;
  onSelect: () => void;
}

interface SubtitleEraseMenuProps {
  items: SubtitleEraseMenuItem[];
}

/** 移出后延迟关闭的等待窗口（容忍指针从触发钮滑向菜单的间隙，期间重新进入即取消） */
const HOVER_CLOSE_DELAY_MS = 120;

export default function SubtitleEraseMenu({ items }: SubtitleEraseMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  /** 文案固定不做最近工具记忆（ADR-0104）：点击触发钮直启首项「智能去字幕」，
   *  口径同家族「点击触发钮直启所显示工具」（ADR-0101 规则二）去掉记忆层。 */
  const primaryItem = items[0];
  /** 整钮置灰取任一项的置灰原因（两项同源整卡门槛）：点击无效，hover 仍展开菜单 */
  const gateReason = items.find((item) => item.disabledReason != null)?.disabledReason ?? null;
  const launchDisabled = gateReason != null;

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

  /** 启动会话的唯一路径（菜单项选择与触发钮直启共用）：关闭菜单并派发菜单项入口 */
  const launch = (item: SubtitleEraseMenuItem) => {
    close();
    item.onSelect();
  };

  if (!primaryItem) return null;

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
          launch(primaryItem);
        }}
        title={gateReason ?? undefined}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-disabled={launchDisabled || undefined}
        data-testid="subtitle-erase-menu-trigger"
      >
        <Subtitles size={14} strokeWidth={2} />
        <span>智能去字幕</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.qualityMenu} role="menu" data-testid="subtitle-erase-menu">
          {items.map((item) => {
            const disabled = item.disabledReason != null;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={styles.qualityMenuItem}
                aria-disabled={disabled || undefined}
                title={item.hint}
                data-testid={`subtitle-erase-menu-item-${item.id}`}
                onClick={() => {
                  if (disabled) return;
                  launch(item);
                }}
              >
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
