/* ============================================
 * ProfileModal 个人资料弹窗：昵称编辑与首字占位头像
 * ============================================ */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './index.module.css';

interface ProfileModalProps {
  nickname: string;
  phone: string;
  onClose: () => void;
  onSave: (nickname: string) => void;
}

export default function ProfileModal({ nickname, phone, onClose, onSave }: ProfileModalProps) {
  const [name, setName] = useState(nickname);

  /** 昵称非空且与当前不同才允许保存 */
  const canSave = name.trim().length > 0 && name.trim() !== nickname;

  const handleSave = () => {
    if (!canSave) return;
    onSave(name.trim());
    onClose();
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className={styles.header}>
          <h3 className={styles.title}>个人资料</h3>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* 头像：昵称首字占位 */}
        <div className={styles.avatarRow}>
          <div className={styles.avatar}>{(name.trim() || nickname).charAt(0).toLowerCase() || 'u'}</div>
          <span className={styles.avatarHint}>昵称首字占位头像</span>
        </div>

        {/* 昵称 */}
        <div className={styles.field}>
          <span className={styles.label}>昵称</span>
          <input
            className={styles.input}
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入昵称"
          />
        </div>

        {/* 手机号码（不可编辑） */}
        <div className={styles.field}>
          <span className={styles.label}>手机号码</span>
          <input
            className={`${styles.input} ${styles.inputDisabled}`}
            value={phone}
            disabled
            title="手机号码不可修改"
          />
        </div>

        {/* 底部按钮 */}
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button
            className={`${styles.saveBtn} ${canSave ? styles.saveBtnActive : ''}`}
            onClick={handleSave}
            disabled={!canSave}
          >
            保存
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
