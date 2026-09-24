/* ============================================
 * Modal —— 通用浮层
 *
 * 管理端原来每页自己写弹窗（ConfirmModal 是一份，各页还有各自的），
 * 于是「遮罩颜色 / 圆角 / 内边距 / 关闭行为」各写各的——浅色化时也是各漏各的。
 *
 * 这里只做骨架（遮罩 + 面板 + 头/体/脚）；确认类弹窗的文案与危险色由调用方给。
 * ============================================ */
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './index.module.css';

interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  /** 底部操作区（按钮） */
  footer?: ReactNode;
  /** 面板宽度，默认 480 */
  width?: number;
  children: ReactNode;
}

export default function Modal({ open, title, onClose, footer, width = 480, children }: ModalProps) {
  if (!open) return null;

  // 挂到 body：避免被页面上任何 overflow/transform 的祖先裁掉或错位
  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        // 阻止冒泡，否则点面板内部会触发遮罩的关闭
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
