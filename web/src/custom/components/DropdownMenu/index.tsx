import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronRight } from 'lucide-react';
import {
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

export interface DropdownMenuItem {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  loading?: boolean;
  title?: string;
  onSelect?: () => void;
  children?: DropdownMenuItem[];
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownMenuItem[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  canvasSafe?: boolean;
  modal?: boolean;
  contentClassName?: string;
  triggerStyle?: CSSProperties;
}

function itemLabel(item: DropdownMenuItem): ReactNode {
  const text =
    item.loading && typeof item.label === 'string' ? `${item.label}中…` : item.label;
  return <span className={styles.label}>{text}</span>;
}

function MenuItems({ items }: { items: DropdownMenuItem[] }) {
  return items.map((item) => {
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
          <Menu.Portal>
            <Menu.SubContent
              className={styles.content}
              sideOffset={2}
              alignOffset={-6}
              collisionPadding={8}
            >
              <MenuItems items={item.children} />
            </Menu.SubContent>
          </Menu.Portal>
        </Menu.Sub>
      );
    }

    return (
      <Menu.Item
        key={item.key}
        asChild
        disabled={item.disabled || item.loading}
        onSelect={() => item.onSelect?.()}
      >
        <button
          type="button"
          className={joinClassNames(styles.item, item.danger && styles.danger)}
          title={item.title}
          disabled={item.disabled || item.loading}
        >
          {itemLabel(item)}
        </button>
      </Menu.Item>
    );
  });
}

export default function DropdownMenu({
  trigger,
  items,
  open,
  defaultOpen,
  onOpenChange,
  align = 'start',
  side = 'bottom',
  canvasSafe = false,
  modal = true,
  contentClassName,
  triggerStyle,
}: DropdownMenuProps) {
  const extraClass = canvasSafe ? 'nodrag nopan' : undefined;
  const triggerNode = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<{ className?: string; style?: CSSProperties }>, {
        className: joinClassNames(
          (trigger.props as { className?: string }).className,
          extraClass,
        ),
        style: { ...(trigger.props as { style?: CSSProperties }).style, ...triggerStyle },
      })
    : trigger;

  return (
    <Menu.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} modal={modal}>
      {isValidElement(triggerNode) ? (
        <Menu.Trigger asChild>{triggerNode}</Menu.Trigger>
      ) : (
        <Menu.Trigger className={extraClass} style={triggerStyle}>
          {triggerNode}
        </Menu.Trigger>
      )}
      <Menu.Portal>
        <Menu.Content
          className={joinClassNames(styles.content, contentClassName)}
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={8}
        >
          <MenuItems items={items} />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
