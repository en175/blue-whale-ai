/* ============================================
 * PasswordModal 修改密码弹窗：旧/新密码 + 短信验证码
 * ============================================ */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './index.module.css';

interface PasswordModalProps {
  onClose: () => void;
}

export default function PasswordModal({ onClose }: PasswordModalProps) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [code, setCode] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const canSubmit = !!(oldPwd && newPwd && confirmPwd && code);

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} title="关闭">
          <X size={16} strokeWidth={2} />
        </button>
        <h2 className={styles.title}>修改密码</h2>

        {/* 旧密码 */}
        <div className={styles.label}>旧密码</div>
        <div className={styles.inputWrap}>
          <input
            className={styles.input}
            type={showOld ? 'text' : 'password'}
            placeholder="请输入旧密码"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
          />
          <button className={styles.eye} onClick={() => setShowOld(!showOld)}>
            {showOld ? '隐藏' : '显示'}
          </button>
        </div>

        {/* 新密码 */}
        <div className={styles.label}>新密码</div>
        <div className={styles.inputWrap}>
          <input
            className={styles.input}
            type={showNew ? 'text' : 'password'}
            placeholder="8-128 位，含字母和数字"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
          />
          <button className={styles.eye} onClick={() => setShowNew(!showNew)}>
            {showNew ? '隐藏' : '显示'}
          </button>
        </div>

        {/* 确认新密码 */}
        <div className={styles.label}>确认新密码</div>
        <div className={styles.inputWrap}>
          <input
            className={styles.input}
            type={showConfirm ? 'text' : 'password'}
            placeholder="再次输入新密码"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
          />
          <button className={styles.eye} onClick={() => setShowConfirm(!showConfirm)}>
            {showConfirm ? '隐藏' : '显示'}
          </button>
        </div>

        {/* 短信验证码 */}
        <div className={styles.label}>短信验证码</div>
        <div className={styles.codeRow}>
          <input
            className={styles.input}
            placeholder="6 位验证码"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className={styles.codeBtn}>获取验证码</button>
        </div>

        <button className={styles.submitBtn} disabled={!canSubmit} onClick={onClose}>
          确认修改
        </button>
      </div>
    </div>,
    document.body
  );
}
