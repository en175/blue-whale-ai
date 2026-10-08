import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
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
  if (!open) return null;

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer !== undefined && <div className={styles.foot}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
