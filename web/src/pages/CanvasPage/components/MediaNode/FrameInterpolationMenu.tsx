/* ============================================
 * FrameInterpolationMenu 「高清 ▾」下拉（IKHLKR，ADR-0113）：视频卡工具条首位的 HD 高清入口
 * 自单按钮改造为带下拉的触发钮——首项「HD 高清」直启原链路（原单按钮行为零变化），
 * 次项「插帧」为新增入口。交互口径与「智能去字幕 ▾」「音视频分离 ▾」同构但独立实例
 * （家族「同构不共享」，ADR-0101 Consequences 末条 / ADR-0113）：悬浮触发钮自动展开、
 * 移出延迟 120ms 关闭（容忍指针滑向菜单的间隙，期间重新进入即取消）、Esc 与点外立即关闭、
 * 点击触发钮直启首项。
 * 家族差异（ADR-0113 决策三/决策四，本组件必须与家族分开的两层门槛）：
 *  - trigger gate ≠ item gate：家族是「任一项置灰即整钮置灰」；本下拉的整钮置灰只看
 *    未关联资产（两功能公共交集），HD 的分辨率上下限从整钮降为「HD 高清」项级置灰。
 *    故 triggerDisabledReason 由宿主单传，不从 items 归并。
 *  - 触发钮文字是「高清」，直启就必须是高清：HD 项被分辨率门槛拦住时点击不派发
 *    （title 显示原因），不自动改派插帧——点了「高清」却跑插帧是语义错位。
 *  - 项级 title = 置灰原因 ?? 自己的 hint：置灰原因（未关联资产/超分辨率上限/低于下限）
 *    比 hint 更能解释「为什么点不动」，可用态才回落到 hint（父单指定文案）。
 * 菜单就地渲染在工具条 wrap 内（同家族，不 portal）：DOM 位于 NodeFollowToolbar 钉屏幕
 * 容器（根元素带 data-gen-panel-territory）内，菜单项点击既不落 React Flow pane
 * （不触发 PaneClick 退出编辑会话）也不会被判为画布外点击误关生成面板。
 * 门槛由宿主算好经 items/triggerDisabledReason 传入——组件不感知资产与宽高字段。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

export interface FrameInterpolationMenuItem {
  /** 菜单项 id（'hd' / 'interpolation'） */
  id: string;
  label: string;
  /** 菜单项自己的悬停说明（可用态 title；置灰态 title 让位给置灰原因） */
  hint: string;
  /** 项级置灰原因（null=可用）：HD 项含未关联资产与分辨率上下限，插帧项仅未关联资产 */
  disabledReason: string | null;
  onSelect: () => void;
}

interface FrameInterpolationMenuProps {
  items: FrameInterpolationMenuItem[];
  /** 整钮置灰原因（trigger gate，只看未关联资产）；null=可点直启首项「HD 高清」 */
  triggerDisabledReason: string | null;
}

/** 移出后延迟关闭的等待窗口（容忍指针从触发钮滑向菜单的间隙，期间重新进入即取消） */
const HOVER_CLOSE_DELAY_MS = 120;

export default function FrameInterpolationMenu({ items, triggerDisabledReason }: FrameInterpolationMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  /** 点击触发钮直启首项「HD 高清」（口径同家族「点击触发钮直启所显示工具」，ADR-0101 规则二） */
  const primaryItem = items[0];
  const triggerDisabled = triggerDisabledReason != null;
  /** 触发钮悬停说明（ADR-0113 决策四）：整钮原因（未关联资产）优先；整钮可用而首项被分辨率
   *  门槛拦住时，原因从菜单项升到触发钮——触发钮文字是「高清」、点击随之无操作，用户不必展开
   *  菜单才知道为什么点不动。两项都可用时无 title（可用态不占悬停说明，菜单项各显自己的 hint）。 */
  const triggerTitle = triggerDisabledReason ?? primaryItem?.disabledReason ?? undefined;

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
  const launch = (item: FrameInterpolationMenuItem) => {
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
          // 整钮置灰（未关联资产）不派发；HD 项置灰（分辨率越限）时同样不派发——
          // 触发钮文字是「高清」，直启只可能是 HD，被拦时用户从菜单选插帧（ADR-0113）
          if (triggerDisabled || primaryItem.disabledReason != null) return;
          launch(primaryItem);
        }}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-disabled={triggerDisabled || undefined}
        data-testid="video-enhance-menu-trigger"
      >
        <span className={styles.hdBadge}>HD</span>
        <span>高清</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.qualityMenu} role="menu" data-testid="video-enhance-menu">
          {items.map((item) => {
            const disabled = item.disabledReason != null;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={styles.qualityMenuItem}
                aria-disabled={disabled || undefined}
                title={item.disabledReason ?? item.hint}
                data-testid={`video-enhance-menu-item-${item.id}`}
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
