/* 通用确认弹窗：保留既有调用参数，统一由 Modal 承担遮罩、焦点和键盘交互。 */
import Modal from '@/components/Modal';

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
  return (
    <Modal
      open={open}
      title={title}
      ariaLabel={title}
      width={420}
      okText={confirmText}
      cancelText={cancelText}
      okType="danger"
      onOk={onConfirm}
      onCancel={onCancel}
    >
      {message}
    </Modal>
  );
}
