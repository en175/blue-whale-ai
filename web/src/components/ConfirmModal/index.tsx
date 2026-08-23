/* ============================================
 * ConfirmModal 通用确认弹窗（项目/资产等删除确认共用）
 * ============================================ */
import styles from './index.module.css';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmText = '永久删除',
  cancelText = '取消',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      {/* role/aria-modal 不只是无障碍标注，它们是 AgentPanel 那个 ESC 守卫的**唯一识别依据**
          （`closest('[role="dialog"], [aria-modal="true"]')`）。此前整个 web/src 里没有任何
          组件产生这两个属性，于是守卫恒为假：流式进行中打开这个确认框、焦点在按钮上按 ESC，
          取消掉的是整轮回答，而弹窗自己没有 ESC 处理器，还停在原地（审查 W·A3）。
          cancelShortcut.ts 的注释写得很清楚：少取消一次再按一次就是了，多取消一次是
          一整轮回答没了——这两件事的代价不对称。 */}
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className={styles.header}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button className={styles.closeBtn} onClick={onCancel}>
            ✕
          </button>
        </div>

        {/* 内容 */}
        <p className={styles.modalMessage}>{message}</p>

        {/* 按钮区 */}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>
            {cancelText}
          </button>
          <button className={styles.confirmBtn} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
