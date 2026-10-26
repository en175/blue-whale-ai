import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './index.module.css';

interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
  children: ReactNode;
}

export default function Modal({ open, title, onClose, footer, width = 480, children }: ModalProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.overlay}>
          <DialogPrimitive.Content
            className={styles.modal}
            style={{ width }}
            aria-modal="true"
            aria-describedby={undefined}
          >
            <div className={styles.head}>
              <DialogPrimitive.Title asChild>
                <h2 className={styles.title}>{title}</h2>
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <button type="button" className={styles.closeBtn} aria-label="关闭">
                  <X size={16} strokeWidth={2} />
                </button>
              </DialogPrimitive.Close>
            </div>
            <div className={styles.body}>{children}</div>
            {footer !== undefined && <div className={styles.foot}>{footer}</div>}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
