/* ============================================
 * ProfileModal 个人资料弹窗：昵称编辑与首字占位头像
 * ============================================ */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import BindPhoneModal from '@/components/UserDropdown/BindPhoneModal';
import { updateUser } from '@/utils/auth';
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
  const [showBindPhone, setShowBindPhone] = useState(false);

  /** 昵称非空且与当前不同才允许保存 */
  const canSave = name.trim().length > 0 && name.trim() !== nickname;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const ok = await onSave(name.trim());
    setSaving(false);
    if (ok) onClose();
  };

  return createPortal(
    <div className={styles.overlay} onClick={() => { if (!saving) onClose(); }}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className={styles.header}>
          <h3 className={styles.title}>个人资料</h3>
          <button className={styles.closeBtn} onClick={() => { if (!saving) onClose(); }} title="关闭">
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
            onChange={(e) => { setName(e.target.value); onErrorClear?.(); }}
            placeholder="请输入昵称"
            disabled={saving}
          />
        </div>

        {/* 手机号码（IKJA4R）：未绑定时可点绑定；已绑定只读——本单不做换绑 */}
        <div className={styles.field}>
          <span className={styles.label}>手机号码</span>
          {phone ? (
            <input
              className={`${styles.input} ${styles.inputDisabled}`}
              value={phone}
              disabled
              title="已绑定的手机号暂不支持更换"
            />
          ) : (
            <button
              type="button"
              className={styles.bindPhoneBtn}
              onClick={() => setShowBindPhone(true)}
              disabled={saving}
            >
              绑定手机号
            </button>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className={styles.errorMsg}>{error}</div>
        )}

        {/* 底部按钮 */}
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={() => { if (!saving) onClose(); }} disabled={saving}>
            取消
          </button>
          <button
            className={`${styles.saveBtn} ${canSave && !saving ? styles.saveBtnActive : ''}`}
            onClick={handleSave}
            disabled={!canSave || saving}
          >
            {saving ? <><Loader2 size={14} className={styles.spinner} /> 保存中…</> : '保存'}
          </button>
        </div>

        {/* 绑定手机号（IKJA4R）：成功后立刻回写本地用户信息，弹窗不用重开就能看到号码 */}
        {showBindPhone && (
          <BindPhoneModal
            onClose={() => setShowBindPhone(false)}
            onBound={(bound) => updateUser({ phone: bound })}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
