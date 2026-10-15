import Modal from '@/custom/components/Modal';

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
