import { CircleHelp } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import styles from './index.module.css';

interface TooltipProps {
  /** 面板标题（一行）。长说明给它一个标题，读者才知道这段在回答什么。 */
  title?: ReactNode;
  /** 展开后的正文。 */
  content: ReactNode;
  /** 读屏用的可读名（图标本身没有文字）。 */
  label?: string;
}

/** 面板与图标之间的间隙：够看清是同一组，又小到鼠标能直接移进去。 */
const GAP = 6;
/** 视口四周至少留这么多，面板不许贴边。 */
const VIEWPORT_PADDING = 8;
/** 关面板的延迟：鼠标从图标移到面板要跨过 GAP，立即关会闪。 */
const CLOSE_DELAY_MS = 140;
/** 估算用的面板宽度（用于左右夹紧，真实宽度由 CSS 的 max-width 决定）。 */
const ESTIMATED_WIDTH = 400;

/**
 * 「?」图标 + 悬停/聚焦才显示的说明面板。
 *
 * <h2>几个不能省的细节</h2>
 *
 * <p>**为什么不是纯 CSS tooltip**：这一套图标全在弹窗里，而弹窗主体的滚动容器是
 * `overflow: auto` —— 就地绝对定位的面板会被容器裁掉（尤其是靠近底部的那些字段）。
 * 所以面板 `createPortal` 到 `document.body`，用 `position: fixed` 按图标的实时矩形定位。
 *
 * <p>**上下翻转**：面板**先渲染再量**（`useLayoutEffect`），量到下方放不下就翻到图标上方。
 * 不这么做，靠近视口底部的那些字段一展开就会把面板顶出屏幕，而滚动容器不会帮你——
 * 它是 `fixed` 的，不跟着滚。
 *
 * <p>**面板自身要接住鼠标**：`onMouseEnter` 取消关闭、`onMouseLeave` 关闭——否则长说明
 * 根本读不完（鼠标一离开图标就消失）。
 *
 * <p>**触屏没有 hover**：点击也能开合；开了之后 Esc 与点击别处都能收。
 */
export default function Tooltip({ title, content, label = '说明' }: TooltipProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 先落一个「贴着图标下方」的初值，再由 `useLayoutEffect` 按实测尺寸纠正。 */
  const [anchor, setAnchor] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const panelId = useId();

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearTimer();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      top: rect.bottom + GAP,
      left: Math.min(rect.left, Math.max(VIEWPORT_PADDING, window.innerWidth - ESTIMATED_WIDTH)),
      above: false,
    });
  }, [clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => setAnchor(null), CLOSE_DELAY_MS);
  }, [clearTimer]);

  // 展开后按**实测**尺寸纠正：下方放不下就翻上去；两侧夹紧视口。
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (anchor === null || panel === null || trigger === null) return;
    const rect = trigger.getBoundingClientRect();
    const { height, width } = panel.getBoundingClientRect();
    const below = rect.bottom + GAP;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_PADDING;
    const above = !fitsBelow && rect.top - GAP - height >= VIEWPORT_PADDING;
    const maxLeft = window.innerWidth - width - VIEWPORT_PADDING;
    const left = Math.max(VIEWPORT_PADDING, Math.min(rect.left, maxLeft));
    const top = above ? rect.top - GAP - height : Math.min(below, window.innerHeight - height - VIEWPORT_PADDING);
    if (top !== anchor.top || left !== anchor.left || above !== anchor.above) {
      setAnchor({ top, left, above });
    }
  }, [anchor]);

  // 展开态：Esc 与点击别处都能收（触屏与键盘用户不该被一个关不掉的面板困住）
  useEffect(() => {
    if (anchor === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearTimer();
        setAnchor(null);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      clearTimer();
      setAnchor(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [anchor, clearTimer]);

  /** 触屏没有 hover：点一下开、再点一下关。
   *  ⚠️ 必须吞掉事件：图标可能落在 `<summary>` 里（「高级 JSON」那处），
   *  不吞的话点图标会顺带展开/收起 details。 */
  const toggle = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (anchor === null) show();
      else {
        clearTimer();
        setAnchor(null);
      }
    },
    [anchor, clearTimer, show],
  );

  // 卸载时清掉未触发的定时器（否则关弹窗后回调仍会 setState）
  useEffect(() => clearTimer, [clearTimer]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={anchor !== null}
        aria-describedby={anchor ? panelId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={toggle}
      >
        <CircleHelp size={15} strokeWidth={2} />
      </button>
      {anchor !== null &&
        createPortal(
          <div className={styles.portal} style={{ top: anchor.top, left: anchor.left }}>
            <div
              id={panelId}
              role="tooltip"
              ref={panelRef}
              className={styles.panel}
              onMouseEnter={clearTimer}
              onMouseLeave={hide}
            >
              {title !== undefined && <div className={styles.title}>{title}</div>}
              <div className={styles.body}>{content}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
