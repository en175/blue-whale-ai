/* ============================================
 * ConfirmModal 后台通用二次确认弹窗
 * ============================================ */
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import styles from './index.module.css';

interface ConfirmModalProps {
  title: string;
  content: string;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmModal({
  title,
  content,
  confirmText = '确认删除',
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.body}>
          <span className={styles.icon}>
            <AlertTriangle size={20} strokeWidth={2} />
          </span>
          <p className={styles.content}>{content}</p>
        </div>
        <div className={styles.foot}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button className={styles.confirmBtn} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
