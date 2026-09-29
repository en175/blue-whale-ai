/* ============================================
 * ConfirmModal 后台通用二次确认弹窗
 *
 * 只是 ui/Modal 的一层薄适配：把「警示图标 + 文案」摆进正文，把「取消 / 确认」摆进底栏。
 * 弹窗骨架（门户、遮罩、面板、头、关闭按钮，以及 role="dialog" / aria-modal）全部由
 * ui/Modal 承担——本文件不再自带一套遮罩与面板样式。
 *
 * 收编理由（也是 ui/Modal 文件头写的同一件事）：两套实现各写各的「遮罩颜色 / 圆角 /
 * 内边距 / 关闭行为」，改一处漏一处；且旧实现漏了无障碍属性——它是个弹窗，
 * 读屏软件却拿不到对话框语义。
 *
 * interface 不变：7 个调用页只传 title / content / confirmText / onConfirm / onClose。
 * ============================================ */
import { AlertTriangle } from 'lucide-react';
import { Button, Modal } from '../../ui';
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
  return (
    <Modal
      open
      title={title}
      width={420}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          {/* 确认侧是破坏性动作，用套件的 danger 变体，不再自带一套实心红按钮样式 */}
          <Button variant="danger" onClick={onConfirm}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <span className={styles.icon}>
          <AlertTriangle size={20} strokeWidth={2} />
        </span>
        <p className={styles.content}>{content}</p>
      </div>
    </Modal>
  );
}
