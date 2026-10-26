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
          {}
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
