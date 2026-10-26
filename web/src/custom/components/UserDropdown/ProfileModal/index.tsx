import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '@/custom/components/Modal';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';

interface ProfileModalProps {
  nickname: string;
  phone: string;
  onClose: () => void;
  onSave: (nickname: string) => Promise<boolean> | boolean;
  error?: string;
  onErrorClear?: () => void;
}

export default function ProfileModal({ nickname, phone, onClose, onSave, error, onErrorClear }: ProfileModalProps) {
  const [name, setName] = useState(nickname);
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && name.trim() !== nickname;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const ok = await onSave(name.trim());
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      title="个人资料"
      onCancel={() => {
        if (!saving) onClose();
      }}
      keyboard={!saving}
      mask={{ closable: !saving }}
      width={440}
      classNames={{ container: styles.modal }}
      footer={
        <>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => {
              if (!saving) onClose();
            }}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="button"
            className={joinClassNames(styles.saveBtn, canSave && !saving ? styles.saveBtnActive : '')}
            onClick={handleSave}
            disabled={!canSave || saving}
          >
            {saving ? (
              <>
                <Loader2 size={14} className={styles.spinner} /> 保存中…
              </>
            ) : (
              '保存'
            )}
          </button>
        </>
      }
    >
      <div className={styles.avatarRow}>
        <div className={styles.avatar}>{(name.trim() || nickname).charAt(0).toLowerCase() || 'u'}</div>
        <span className={styles.avatarHint}>昵称首字占位头像</span>
      </div>
      <div className={styles.field}>
        <span className={styles.label}>昵称</span>
        <input
          className={styles.input}
          value={name}
          maxLength={20}
          onChange={(e) => {
            setName(e.target.value);
            onErrorClear?.();
          }}
          placeholder="请输入昵称"
          disabled={saving}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>手机号码</span>
        <input
          className={`${styles.input} ${styles.inputDisabled}`}
          value={phone}
          disabled
          title="手机号码不可修改"
        />
      </div>
      {error && <div className={styles.errorMsg}>{error}</div>}
    </Modal>
  );
}
