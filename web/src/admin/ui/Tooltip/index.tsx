import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CircleHelp } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import styles from './index.module.css';

interface TooltipProps {
  title?: ReactNode;
  content: ReactNode;
  label?: string;
  trigger?: ReactNode;
}

const CLOSE_DELAY_MS = 140;

export default function Tooltip({ title, content, label = '说明', trigger }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearTimer();
    setOpen(true);
  }, [clearTimer]);

  const hide = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [clearTimer]);

  const toggle = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (open) {
        clearTimer();
        setOpen(false);
      } else {
        show();
      }
    },
    [clearTimer, open, show],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <PopoverPrimitive.Anchor asChild>
        <button
          type="button"
          className={trigger === undefined ? styles.trigger : styles.triggerInline}
          aria-label={label}
          aria-expanded={open}
          aria-describedby={open ? panelId : undefined}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          onClick={toggle}
        >
          {trigger ?? <CircleHelp size={15} strokeWidth={2} />}
        </button>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={panelId}
          role="tooltip"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={styles.portal}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseEnter={clearTimer}
          onMouseLeave={hide}
        >
          <div className={styles.panel}>
            {title !== undefined && <div className={styles.title}>{title}</div>}
            <div className={styles.body}>{content}</div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
