import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronRight } from 'lucide-react';
import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

export const DROPDOWN_HOVER_CLOSE_DELAY_MS = 120;

export interface DropdownMenuItem {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  loading?: boolean;
  title?: string;
  testId?: string;
  checked?: boolean;
  onSelect?: () => void;
  children?: DropdownMenuItem[];
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  items?: DropdownMenuItem[];
  panel?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  openOnHover?: boolean;
  hoverCloseDelayMs?: number;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  canvasSafe?: boolean;
  modal?: boolean;
  contentClassName?: string;
  wrapClassName?: string;
  contentTestId?: string;
  triggerStyle?: CSSProperties;
}

type TriggerElementProps = {
  className?: string;
  style?: CSSProperties;
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
};

function itemLabel(item: DropdownMenuItem): ReactNode {
  const text =
    item.loading && typeof item.label === 'string' ? `${item.label}中…` : item.label;
  return <span className={styles.label}>{text}</span>;
}

function leafItemClass(item: DropdownMenuItem): string {
  return joinClassNames(styles.item, item.danger && styles.danger, item.checked && styles.checked);
}

function MenuItems({ items }: { items: DropdownMenuItem[] }) {
  const selectedKey = items.find((item) => item.checked)?.key;
  const useRadio = items.some((item) => item.checked !== undefined);

  const leaves = items.map((item) => {
    if (item.children?.length) {
      return (
        <Menu.Sub key={item.key}>
          <Menu.SubTrigger
            className={styles.item}
            disabled={item.disabled}
            title={item.title}
          >
            {itemLabel(item)}
            <ChevronRight size={14} strokeWidth={2} className={styles.chevron} />
          </Menu.SubTrigger>
          <Menu.SubContent
            className={joinClassNames(styles.content, 'nodrag', 'nopan')}
            sideOffset={2}
            alignOffset={-6}
            collisionPadding={8}
          >
            <MenuItems items={item.children} />
          </Menu.SubContent>
        </Menu.Sub>
      );
    }

    const inactive = Boolean(item.disabled || item.loading);
    if (useRadio) {
      return (
        <Menu.RadioItem
          key={item.key}
          value={item.key}
          className={leafItemClass(item)}
          disabled={inactive}
          title={item.title}
          data-testid={item.testId}
        >
          {itemLabel(item)}
        </Menu.RadioItem>
      );
    }

    return (
      <Menu.Item
        key={item.key}
        className={leafItemClass(item)}
        disabled={inactive}
        title={item.title}
        data-testid={item.testId}
        onSelect={() => {
          if (inactive) return;
          item.onSelect?.();
        }}
      >
        {itemLabel(item)}
      </Menu.Item>
    );
  });

  if (!useRadio) return leaves;
  return (
    <Menu.RadioGroup value={selectedKey} onValueChange={(key) => {
      const item = items.find((entry) => entry.key === key);
      if (item?.disabled || item?.loading) return;
      item?.onSelect?.();
    }}>
      {leaves}
    </Menu.RadioGroup>
  );
}

export default function DropdownMenu({
  trigger,
  items = [],
  panel,
  open,
  defaultOpen,
  onOpenChange,
  openOnHover = false,
  hoverCloseDelayMs = DROPDOWN_HOVER_CLOSE_DELAY_MS,
  align = 'start',
  side = 'bottom',
  canvasSafe = false,
  modal,
  contentClassName,
  wrapClassName,
  contentTestId,
  triggerStyle,
}: DropdownMenuProps) {
  const extraClass = canvasSafe ? 'nodrag nopan' : undefined;
  const modalMode = modal ?? !openOnHover;
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const controlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const isOpen = controlled ? open : uncontrolledOpen;

  const setIsOpen = (next: boolean) => {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const cancelScheduledClose = () => {
    if (closeTimerRef.current == null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const scheduleClose = () => {
    if (closeTimerRef.current != null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setIsOpen(false);
    }, hoverCloseDelayMs);
  };

  useEffect(() => cancelScheduledClose, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cancelScheduledClose();
      setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (wrapRef.current?.contains(target)) return;
      cancelScheduledClose();
      setIsOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen]);

  const hoverHandlers = openOnHover
    ? {
        onMouseEnter: () => {
          cancelScheduledClose();
          setIsOpen(true);
        },
        onMouseLeave: scheduleClose,
      }
    : undefined;

  const triggerNode = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<TriggerElementProps>, {
        className: joinClassNames(
          (trigger.props as TriggerElementProps).className,
          extraClass,
        ),
        style: { ...(trigger.props as TriggerElementProps).style, ...triggerStyle },
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
          (trigger.props as TriggerElementProps).onPointerDown?.(event);
          event.preventDefault();
        },
        onClick: (event: ReactMouseEvent<HTMLElement>) => {
          (trigger.props as TriggerElementProps).onClick?.(event);
          if (openOnHover) {
            const launchDisabled =
              event.currentTarget.getAttribute('aria-disabled') === 'true';
            if (launchDisabled) return;
            cancelScheduledClose();
            setIsOpen(false);
            return;
          }
          cancelScheduledClose();
          setIsOpen(!isOpen);
        },
      })
    : trigger;

  return (
    <Menu.Root
      open={isOpen}
      onOpenChange={(next) => {
        if (openOnHover && next) return;
        cancelScheduledClose();
        setIsOpen(next);
      }}
      modal={modalMode}
    >
      <div
        ref={wrapRef}
        className={joinClassNames(styles.wrap, extraClass, wrapClassName)}
        {...hoverHandlers}
      >
        {isValidElement(triggerNode) ? (
          <Menu.Trigger asChild>{triggerNode}</Menu.Trigger>
        ) : (
          <Menu.Trigger className={extraClass} style={triggerStyle}>
            {triggerNode}
          </Menu.Trigger>
        )}
        <Menu.Content
          className={joinClassNames(styles.content, extraClass, contentClassName)}
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={8}
          data-testid={contentTestId}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {panel ?? <MenuItems items={items} />}
        </Menu.Content>
      </div>
    </Menu.Root>
  );
}
