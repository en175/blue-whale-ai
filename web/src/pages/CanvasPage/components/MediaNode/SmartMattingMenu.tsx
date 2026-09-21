/* ============================================
 * SmartMattingMenu 「智能抠像 ▾」下拉（IKHK7N，ADR-0112）：视频卡工具条的智能抠像入口。
 * 交互口径与「智能去字幕 ▾」（SubtitleEraseMenu）/「音视频分离 ▾」（AudioVideoSplitMenu）
 * 同构但独立实例（家族「同构不共享」，ADR-0101 Consequences 末条 / ADR-0098）：
 * 悬浮触发钮自动展开、移出延迟 120ms 关闭（容忍指针滑向菜单的间隙，期间重新进入即取消）、
 * Esc 与点外立即关闭、点击触发钮直启首项「人像抠像」。
 * 家族差异（ADR-0112 定案）：
 *  - 模式选择前置到入口下拉（「素材是不是绿幕」是发起前的分类问题而非参数）：
 *    两项纯文字 = 「人像抠像」（任意视频只识别人物主体）+「绿幕抠像」（绿幕/纯色背景
 *    素材，主体可为人、物品、动物），各项 title 恒为自己的 hint（置灰时仍能看两项说明，
 *    理解置灰是整卡门槛，同去字幕规格故事 7 口径）；
 *  - 触发钮图标 WandSparkles + 文案「智能抠像」+ ChevronDown；可用态触发钮 title 保留
 *    入口效果边界说明（同 AudioVideoSplitMenu triggerHint 口径）。
 * 菜单就地渲染在工具条 wrap 内（同 SubtitleEraseMenu，不 portal）：DOM 位于
 * NodeFollowToolbar 钉屏幕容器（根元素带 data-gen-panel-territory）内，菜单项点击既不落
 * React Flow pane（不触发 PaneClick 退出编辑会话）也不会被判为画布外点击误关生成面板。
 * 门槛由宿主算好经 items 传入——组件不感知资产/时长字段；置灰条件两条（未关联资产 /
 * 时长超 10 分钟且有时长数据，smartMattingGateReason）命中时整钮与两项一并置灰，
 * aria-disabled 置灰点击无效，hover 仍可展开菜单查看两项说明与置灰原因。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, WandSparkles } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

export interface SmartMattingMenuItem {
  /** 菜单项 id（'portrait' / 'greenscreen'） */
  id: string;
  label: string;
  /** 菜单项自己的悬停说明（置灰时仍作 title：区分「整卡不可用」与「某模式不可用」） */
  hint: string;
  /** 置灰原因（null=可用）；两项同源整卡门槛，命中时整钮与两项一并置灰 */
  disabledReason: string | null;
  onSelect: () => void;
}

interface SmartMattingMenuProps {
  items: SmartMattingMenuItem[];
  /** 可用态触发钮悬停说明（置灰态 title 恒为置灰原因，同一 title 通道互斥） */
  triggerHint?: string;
}

/** 移出后延迟关闭的等待窗口（容忍指针从触发钮滑向菜单的间隙，期间重新进入即取消） */
const HOVER_CLOSE_DELAY_MS = 120;

export default function SmartMattingMenu({ items, triggerHint }: SmartMattingMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  /** 点击触发钮直启首项「人像抠像」（口径同家族「点击触发钮直启所显示工具」，ADR-0101 规则二） */
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
  const launch = (item: SmartMattingMenuItem) => {
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
        data-testid="smart-matting-menu-trigger"
      >
        <WandSparkles size={14} strokeWidth={2} />
        <span>智能抠像</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.qualityMenu} role="menu" data-testid="smart-matting-menu">
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
                data-testid={`smart-matting-menu-item-${item.id}`}
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
