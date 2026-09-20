/* ============================================
 * AudioVideoSplitMenu 「音视频分离 ▾」下拉（IKHA2E）：视频卡工具条的音视频分离入口，
 * 自单按钮改造为带下拉的触发钮。交互口径与「智能去字幕 ▾」（SubtitleEraseMenu）同构
 * 但独立实例（家族「同构不共享」，ADR-0101 Consequences 末条 / ADR-0098）：
 * 悬浮触发钮自动展开、移出延迟 120ms 关闭（容忍指针滑向菜单的间隙，期间重新进入即取消）、
 * Esc 与点外立即关闭、点击触发钮直启首项「音视频分离」（原单按钮直启行为不变）。
 * 家族差异：
 *  - 触发钮图标 AudioLines + 文案「音视频分离」+ ChevronDown；可用态触发钮 title 保留
 *    入口效果边界说明（去字幕下拉可用态无 title，因其旧效果边界句已随 ADR-0104 废除）；
 *  - 两项=「音视频分离」（原直启链路零变化）+「人声背景分离」（IKHA2E 新入口，本票仅
 *    交付点击派发挂接点，编辑态本体由后续票实现，未注入回调时点击安全 no-op）。
 * 菜单就地渲染在工具条 wrap 内（同 SubtitleEraseMenu，不 portal）：DOM 位于
 * NodeFollowToolbar 钉屏幕容器（根元素带 data-gen-panel-territory）内，菜单项点击既不落
 * React Flow pane（不触发 PaneClick 退出编辑会话）也不会被判为画布外点击误关生成面板。
 * 门槛由宿主算好经 items 传入——组件不感知资产字段；唯一置灰条件=视频未关联资产
 * （audioVideoSplitGateReason，ADR-0103 决策四：不做时长/分辨率/大小前置拦截），
 * 整钮 aria-disabled 置灰点击无效，hover 仍可展开菜单查看两项说明与置灰原因。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronDown } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

export interface AudioVideoSplitMenuItem {
  /** 菜单项 id（'split' / 'vocalBackground'） */
  id: string;
  label: string;
  /** 菜单项自己的悬停说明（置灰时仍作 title：区分「整卡不可用」与「某入口不可用」） */
  hint: string;
  /** 置灰原因（null=可用）；两项同源整卡门槛，命中时整钮与两项一并置灰 */
  disabledReason: string | null;
  onSelect: () => void;
}

interface AudioVideoSplitMenuProps {
  items: AudioVideoSplitMenuItem[];
  /** 可用态触发钮悬停说明（置灰态 title 恒为置灰原因，同一 title 通道互斥） */
  triggerHint?: string;
}

/** 移出后延迟关闭的等待窗口（容忍指针从触发钮滑向菜单的间隙，期间重新进入即取消） */
const HOVER_CLOSE_DELAY_MS = 120;

export default function AudioVideoSplitMenu({ items, triggerHint }: AudioVideoSplitMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  /** 点击触发钮直启首项「音视频分离」（口径同家族「点击触发钮直启所显示工具」，ADR-0101 规则二） */
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

  /** 启动的唯一路径（菜单项选择与触发钮直启共用）：关闭菜单并派发菜单项入口 */
  const launch = (item: AudioVideoSplitMenuItem) => {
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
        title={gateReason ?? triggerHint}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-disabled={launchDisabled || undefined}
        data-testid="audio-video-split-menu-trigger"
      >
        <AudioLines size={14} strokeWidth={2} />
        <span>音视频分离</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.qualityMenu} role="menu" data-testid="audio-video-split-menu">
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
                data-testid={`audio-video-split-menu-item-${item.id}`}
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
