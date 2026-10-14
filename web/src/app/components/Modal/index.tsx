import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { joinClassNames } from '@/utils/class-names';
import styles from './index.module.css';

export type ModalSemanticDOM =
  | 'root'
  | 'mask'
  | 'wrapper'
  | 'container'
  | 'header'
  | 'title'
  | 'body'
  | 'footer';

export type ModalClassNames = Partial<Record<ModalSemanticDOM, string>>;
export type ModalStyles = Partial<Record<ModalSemanticDOM, CSSProperties>>;

export interface ModalProps {
  open: boolean;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode | null;
  okText?: ReactNode;
  cancelText?: ReactNode;
  onOk?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onCancel?: () => void;
  confirmLoading?: boolean;
  closable?: boolean;
  closeIcon?: ReactNode | false | null;
  keyboard?: boolean;
  centered?: boolean;
  width?: number | string;
  zIndex?: number;
  mask?: boolean | { enabled?: boolean; closable?: boolean };
  okType?: 'primary' | 'danger';
  okButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  cancelButtonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  className?: string;
  wrapClassName?: string;
  style?: CSSProperties;
  classNames?: ModalClassNames | ((info: { props: ModalProps }) => ModalClassNames);
  styles?: ModalStyles | ((info: { props: ModalProps }) => ModalStyles);
  portalContainer?: HTMLElement;
  ariaLabel?: string;
}

function resolveSemanticValue<T>(
  value: T | ((info: { props: ModalProps }) => T) | undefined,
  props: ModalProps,
): T | undefined {
  return typeof value === 'function'
    ? (value as (info: { props: ModalProps }) => T)({ props })
    : value;
}

function cssSize(value: number | string | undefined): number | string | undefined {
  return typeof value === 'number' ? `${value}px` : value;
}

export default function Modal(props: ModalProps) {
  const {
    open,
    title,
    children,
    footer,
    okText = '确定',
    cancelText = '取消',
    onOk,
    onCancel,
    confirmLoading = false,
    closable = true,
    closeIcon,
    keyboard = true,
    centered = true,
    width = 420,
    zIndex,
    mask = true,
    okType = 'primary',
    okButtonProps,
    cancelButtonProps,
    className,
    wrapClassName,
    style,
    portalContainer,
    ariaLabel = '对话框',
  } = props;

  const semanticClassNames = resolveSemanticValue(props.classNames, props) ?? {};
  const semanticStyles = resolveSemanticValue(props.styles, props) ?? {};
  const maskEnabled = typeof mask === 'object' ? mask.enabled !== false : mask;
  const maskClosable = typeof mask === 'object' ? mask.closable !== false : mask;
  const showClose = closable && closeIcon !== false && closeIcon !== null;

  const defaultFooter = (
    <>
      <Dialog.Close asChild>
        <button
          {...cancelButtonProps}
          type={cancelButtonProps?.type ?? 'button'}
          className={joinClassNames(styles.cancelButton, cancelButtonProps?.className)}
        >
          {cancelText}
        </button>
      </Dialog.Close>
      <button
        {...okButtonProps}
        type={okButtonProps?.type ?? 'button'}
        className={joinClassNames(
          styles.okButton,
          okType === 'danger' && styles.dangerButton,
          okButtonProps?.className,
        )}
        disabled={confirmLoading || okButtonProps?.disabled}
        aria-busy={confirmLoading || undefined}
        onClick={(event) => {
          okButtonProps?.onClick?.(event);
          if (!event.defaultPrevented) onOk?.(event);
        }}
      >
        {confirmLoading && <span className={styles.spinner} aria-hidden="true" />}
        {okText}
      </button>
    </>
  );

  const footerContent = footer === undefined ? defaultFooter : footer;

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel?.()}>
      <Dialog.Portal container={portalContainer}>
        <div
          className={joinClassNames(styles.root, semanticClassNames.root)}
          style={{ ...semanticStyles.root, zIndex: zIndex ?? semanticStyles.root?.zIndex }}
          data-semantic="root"
        >
          {maskEnabled && (
            <Dialog.Overlay
              className={joinClassNames(styles.mask, semanticClassNames.mask)}
              style={semanticStyles.mask}
              data-semantic="mask"
            />
          )}

          <div
            className={joinClassNames(
              styles.wrapper,
              centered ? styles.centered : styles.topAligned,
              wrapClassName,
              semanticClassNames.wrapper,
            )}
            style={semanticStyles.wrapper}
            data-semantic="wrapper"
          >
            <Dialog.Content
              className={joinClassNames(styles.container, className, semanticClassNames.container)}
              style={{ ...style, ...semanticStyles.container, width: cssSize(width) }}
              data-semantic="container"
              aria-label={title == null ? ariaLabel : undefined}
              onClick={(event) => event.stopPropagation()}
              onEscapeKeyDown={(event) => {
                if (!keyboard) event.preventDefault();
              }}
              onPointerDownOutside={(event) => {
                if (!maskClosable) event.preventDefault();
              }}
            >
              {title != null && (
                <div
                  className={joinClassNames(styles.header, semanticClassNames.header)}
                  style={semanticStyles.header}
                  data-semantic="header"
                >
                  <Dialog.Title
                    className={joinClassNames(styles.title, semanticClassNames.title)}
                    style={semanticStyles.title}
                    data-semantic="title"
                  >
                    {title}
                  </Dialog.Title>
                  {showClose && (
                    <Dialog.Close asChild>
                      <button className={styles.closeButton} type="button" aria-label="关闭">
                        {closeIcon === undefined ? <X size={18} strokeWidth={2} /> : closeIcon}
                      </button>
                    </Dialog.Close>
                  )}
                </div>
              )}

              {title == null && showClose && (
                <>
                  <Dialog.Title className={styles.visuallyHidden}>{ariaLabel}</Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      className={joinClassNames(styles.closeButton, styles.closeButtonFloating)}
                      type="button"
                      aria-label="关闭"
                    >
                      {closeIcon === undefined ? <X size={18} strokeWidth={2} /> : closeIcon}
                    </button>
                  </Dialog.Close>
                </>
              )}

              {title == null && !showClose && (
                <Dialog.Title className={styles.visuallyHidden}>{ariaLabel}</Dialog.Title>
              )}

              <Dialog.Description asChild>
                <div
                  className={joinClassNames(styles.body, semanticClassNames.body)}
                  style={semanticStyles.body}
                  data-semantic="body"
                >
                  {children}
                </div>
              </Dialog.Description>

              {footerContent != null && (
                <div
                  className={joinClassNames(styles.footer, semanticClassNames.footer)}
                  style={semanticStyles.footer}
                  data-semantic="footer"
                >
                  {footerContent}
                </div>
              )}
            </Dialog.Content>
          </div>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
