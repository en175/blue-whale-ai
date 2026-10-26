import { useEffect, useState } from 'react';
import Modal from '@/custom/components/Modal';
import { changePassword } from '@/custom/api/auth';
import { isApiError } from '@/shared/api/http';
import styles from './index.module.css';
import {
  canSubmitPasswordChange,
  isNewPasswordLengthValid,
  NEW_PASSWORD_PLACEHOLDER,
} from './password';

interface PasswordModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  hasPassword?: boolean;
}

export default function PasswordModal({
  open,
  onClose,
  onSuccess,
  hasPassword = true,
}: PasswordModalProps) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setOldPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setShowOld(false);
    setShowNew(false);
    setShowConfirm(false);
    setLoading(false);
    setError('');
  }, [open]);

  const canSubmit = canSubmitPasswordChange({
    oldPassword: hasPassword ? oldPwd : null,
    newPassword: newPwd,
    confirmPassword: confirmPwd,
  });
  const passwordRuleError = newPwd.length > 0 && !isNewPasswordLengthValid(newPwd);
  const confirmMismatch = confirmPwd.length > 0 && confirmPwd !== newPwd;
  const heading = hasPassword ? '修改密码' : '设置密码';

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setError('');
    setLoading(true);
    try {
      await changePassword(hasPassword ? oldPwd : null, newPwd);
      (onSuccess ?? onClose)();
    } catch (e) {
      setError(isApiError(e) ? e.message : `${heading}失败，请稍后重试`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      footer={null}
      onCancel={onClose}
      width="min(640px, 92vw)"
      ariaLabel={heading}
      classNames={{
        container: styles.modal,
        body: styles.body,
      }}
      styles={{
        container: { padding: 0 },
      }}
    >
      <h2 className={styles.title}>{heading}</h2>

      {}
      {hasPassword && (
        <>
          <div className={styles.label}>旧密码</div>
          <div className={styles.inputWrap}>
            <input
              className={styles.input}
              type={showOld ? 'text' : 'password'}
              placeholder="请输入旧密码"
              autoComplete="current-password"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
            />
            <button className={styles.eye} type="button" onClick={() => setShowOld(!showOld)}>
              {showOld ? '隐藏' : '显示'}
            </button>
          </div>
        </>
      )}

      <div className={styles.label}>新密码</div>
      <div className={styles.inputWrap}>
        <input
          className={styles.input}
          type={showNew ? 'text' : 'password'}
          placeholder={NEW_PASSWORD_PLACEHOLDER}
          autoComplete="new-password"
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
        />
        <button className={styles.eye} type="button" onClick={() => setShowNew(!showNew)}>
          {showNew ? '隐藏' : '显示'}
        </button>
      </div>
      {passwordRuleError && <p className={styles.error}>密码至少 8 位（最长 72 字节，一个汉字算 3 字节）</p>}

      <div className={styles.label}>确认新密码</div>
      <div className={styles.inputWrap}>
        <input
          className={styles.input}
          type={showConfirm ? 'text' : 'password'}
          placeholder="再次输入新密码"
          autoComplete="new-password"
          value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)}
        />
        <button className={styles.eye} type="button" onClick={() => setShowConfirm(!showConfirm)}>
          {showConfirm ? '隐藏' : '显示'}
        </button>
      </div>
      {confirmMismatch && <p className={styles.error}>两次输入的新密码不一致</p>}
      {error && <p className={styles.error}>{error}</p>}

      <button
        className={styles.submitBtn}
        type="button"
        disabled={!canSubmit || loading}
        onClick={() => {
          void handleSubmit();
        }}
      >
        {loading ? '提交中…' : hasPassword ? '确认修改' : '确认设置'}
      </button>
    </Modal>
  );
}
