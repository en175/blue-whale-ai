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
  title?: ReactNode;
  content: ReactNode;
  label?: string;
  trigger?: ReactNode;
}

const GAP = 6;
const VIEWPORT_PADDING = 8;
const CLOSE_DELAY_MS = 140;
const ESTIMATED_WIDTH = 400;

export default function Tooltip({ title, content, label = '说明', trigger }: TooltipProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={trigger === undefined ? styles.trigger : styles.triggerInline}
        aria-label={label}
        aria-expanded={anchor !== null}
        aria-describedby={anchor ? panelId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={toggle}
      >
        {trigger ?? <CircleHelp size={15} strokeWidth={2} />}
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
