/* ============================================
 * BindPhoneModal 绑定手机号（IKJA4R）
 *
 * 只做**首次绑定**，不做换绑——换绑要回答「旧号还作不作数」「换绑期间旧号能不能登」，
 * 那是一套独立状态机，不是这个弹窗的附加项。已经有手机号的账号在界面上根本看不到入口。
 * ============================================ */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { bindPhone, sendCode } from '@/api/auth';
import { isApiError } from '@/api/http';
import styles from './index.module.css';

interface BindPhoneModalProps {
  onClose: () => void;
  /** 绑定成功回调（带上刚绑定的号码，供上层立刻刷新展示） */
  onBound: (phone: string) => void;
}

/** 与后端同一条口径（`libs/core/auth/phone.ts`）。 */
const PHONE_RE = /^1[3-9]\d{9}$/;
/** 与登录弹窗同一条冷却口径。 */
const SEND_CODE_COOLDOWN_SECONDS = 60;

export default function BindPhoneModal({ onClose, onBound }: BindPhoneModalProps) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const phoneValid = PHONE_RE.test(phone.trim());
  const canSubmit = phoneValid && code.trim().length > 0 && !submitting;

  const handleSendCode = async () => {
    if (!phoneValid || cooldown > 0 || sending) return;
    setSending(true);
    setError('');
    try {
      await sendCode(phone.trim());
      setCooldown(SEND_CODE_COOLDOWN_SECONDS);
    } catch (e) {
      setError(isApiError(e) ? e.message : '验证码发送失败，请稍后重试');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await bindPhone(phone.trim(), code.trim());
      onBound(phone.trim());
      onClose();
    } catch (e) {
      setError(isApiError(e) ? e.message : '绑定失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const sendLabel =
    cooldown > 0 ? `${cooldown} 秒后重发` : sending ? '发送中…' : '发送验证码';

  return (
    <div className={styles.overlay} onClick={() => { if (!submitting) onClose(); }}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>绑定手机号</h3>
          <button
            className={styles.closeBtn}
            onClick={() => { if (!submitting) onClose(); }}
            title="关闭"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <p className={styles.hint}>
          绑定后可以用手机号验证码登录，忘记密码时也能自己进来。
        </p>

        <div className={styles.field}>
          <input
            className={styles.input}
            placeholder="请输入手机号"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <div className={styles.codeRow}>
            <input
              className={styles.input}
              placeholder="请输入验证码"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSubmit();
              }}
            />
            <button
              type="button"
              className={styles.sendBtn}
              disabled={!phoneValid || cooldown > 0 || sending}
              onClick={handleSendCode}
            >
              {sendLabel}
            </button>
          </div>
        </div>

        {error && <div className={styles.errorMsg}>{error}</div>}

        <div className={styles.footer}>
          <button
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? '绑定中…' : '绑定'}
          </button>
        </div>
      </div>
    </div>
  );
}
