import { useEffect, useState, type KeyboardEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  fetchMe,
  loginWithCode,
  loginWithPassword,
  registerWithPassword,
  sendCode,
  toSessionUser,
  type LoginData,
} from '@/custom/api/auth';
import { fetchAdminSession } from '@/shared/api/adminSession';
import { isApiError } from '@/shared/api/http';
import Modal from '@/custom/components/Modal';
import { useAuthStore, type SessionUser } from '@/shared/stores/auth';
import { updateUser } from '@/shared/utils/auth';
import { isPasswordSettable, PASSWORD_RULE_HINT } from '@/custom/utils/password';
import styles from './index.module.css';
import {
  PLATFORM_PRIVACY_POLICY_HREF,
  USER_SERVICES_AGREEMENT_HREF,
} from './agreements';

export type LoginModalMode = 'password' | 'phone' | 'register';

interface LoginModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialMode?: LoginModalMode;
}

const PHONE_RE = /^1[3-9]\d{9}$/;
const SEND_CODE_COOLDOWN_SECONDS = 60;

function AgreementLinks() {
  return (
    <span className={styles.agreeText}>
      我已阅读并同意
      <a
        className={styles.link}
        href={USER_SERVICES_AGREEMENT_HREF}
        target="_blank"
        rel="noreferrer"
      >
        《用户协议》
      </a>
      和
      <a
        className={styles.link}
        href={PLATFORM_PRIVACY_POLICY_HREF}
        target="_blank"
        rel="noreferrer"
      >
        《隐私政策》
      </a>
    </span>
  );
}

function AgreementRow({
  agreed,
  onChange,
}: {
  agreed: boolean;
  onChange: (agreed: boolean) => void;
}) {
  return (
    <label className={styles.agreeRow}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={agreed}
        onChange={(event) => onChange(event.target.checked)}
      />
      <AgreementLinks />
    </label>
  );
}

interface PasswordFieldProps {
  placeholder: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggleVisible: () => void;
  showLabel?: string;
  hideLabel?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}

function PasswordField({
  placeholder,
  value,
  visible,
  onChange,
  onToggleVisible,
  showLabel = '显示密码',
  hideLabel = '隐藏密码',
  onKeyDown,
  ariaInvalid,
  ariaDescribedBy,
}: PasswordFieldProps) {
  return (
    <div className={styles.passwordField}>
      <input
        className={styles.input}
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
      <button
        type="button"
        className={styles.passwordToggle}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        onClick={onToggleVisible}
      >
        {visible ? <Eye size={20} /> : <EyeOff size={20} />}
      </button>
    </div>
  );
}

export default function LoginModal({
  onClose,
  onSuccess,
  initialMode = 'password',
}: LoginModalProps) {
  const [mode, setMode] = useState<LoginModalMode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPwd, setConfirmPwd] = useState('');
  const [confirmPwdVisible, setConfirmPwdVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const phoneValid = PHONE_RE.test(phone.trim());
  const passwordValid = username.trim().length > 0 && password.length > 0 && agreed;
  const phoneLoginValid = phoneValid && code.trim().length > 0 && agreed;
  const passwordRuleError = mode === 'register' && password.length > 0 && !isPasswordSettable(password);
  const registerValid =
    username.trim().length >= 3 &&
    isPasswordSettable(password) &&
    password === confirmPwd &&
    agreed;

  const applyAuth = async (login: LoginData) => {
    const me = await fetchMe().catch(() => null);
    const user: SessionUser = me
      ? toSessionUser(me)
      : {
          userId: login.user_id,
          username: login.username,
          email: login.email,
          phone: login.phone,
          hasPassword: login.has_password,
          isAdmin: false,
          roles: [],
        };
    useAuthStore.getState().applyLogin(login, user);
    fetchAdminSession()
      .then((session) => updateUser({ isAdmin: session.isAdmin }))
      .catch(() => undefined);
    onSuccess?.();
    onClose();
  };

  const submitPasswordLogin = async () => {
    if (!passwordValid || loading) return;
    setLoading(true);
    setError('');
    try {
      await applyAuth(await loginWithPassword(username.trim(), password));
    } catch (e) {
      setError(isApiError(e) ? e.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    if (!phoneValid || cooldown > 0 || sendingCode) return;
    setSendingCode(true);
    setError('');
    try {
      await sendCode(phone.trim());
      setCooldown(SEND_CODE_COOLDOWN_SECONDS);
    } catch (e) {
      setError(isApiError(e) ? e.message : '验证码发送失败，请稍后重试');
    } finally {
      setSendingCode(false);
    }
  };

  const submitPhoneLogin = async () => {
    if (!phoneLoginValid || loading) return;
    setLoading(true);
    setError('');
    try {
      await applyAuth(await loginWithCode(phone.trim(), code.trim()));
    } catch (e) {
      setError(isApiError(e) ? e.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const submitRegister = async () => {
    if (!registerValid || loading) return;
    setLoading(true);
    setError('');
    try {
      await applyAuth(
        await registerWithPassword(username.trim(), password, email.trim() || undefined),
      );
    } catch (e) {
      setError(isApiError(e) ? e.message : '注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (target: LoginModalMode) => {
    setMode(target);
    setPasswordVisible(false);
    setConfirmPwdVisible(false);
    setError('');
  };

  const sendCodeLabel = cooldown > 0 ? `${cooldown} 秒后重发` : sendingCode ? '发送中…' : '发送验证码';
  const heading = mode === 'register' ? '注册' : '登录';

  return (
    <Modal
      open
      footer={null}
      onCancel={onClose}
      width="min(620px, calc(100vw - 48px))"
      ariaLabel={heading}
      classNames={{
        container: styles.modal,
        body: styles.body,
      }}
      styles={{
        container: { padding: 0 },
        mask: {
          backgroundColor: 'rgba(0, 0, 0, 0.72)',
          backdropFilter: 'blur(4px)',
        },
      }}
    >
      <h2 className={styles.title}>{heading}</h2>

      {mode === 'register' ? (
        <>
          <input
            className={styles.input}
            placeholder="账号（至少3位）"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <PasswordField
            placeholder="密码（8 位以上）"
            value={password}
            visible={passwordVisible}
            onChange={setPassword}
            onToggleVisible={() => setPasswordVisible((visible) => !visible)}
            ariaInvalid={passwordRuleError}
            ariaDescribedBy={passwordRuleError ? 'register-password-error' : undefined}
          />
          {passwordRuleError && (
            <div id="register-password-error" className={styles.error}>
              {PASSWORD_RULE_HINT}
            </div>
          )}
          <PasswordField
            placeholder="确认密码"
            value={confirmPwd}
            visible={confirmPwdVisible}
            onChange={setConfirmPwd}
            onToggleVisible={() => setConfirmPwdVisible((visible) => !visible)}
            showLabel="显示确认密码"
            hideLabel="隐藏确认密码"
          />
          <input
            className={styles.input}
            type="email"
            placeholder="邮箱（选填）"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {error && <div className={styles.error}>{error}</div>}

          <AgreementRow agreed={agreed} onChange={setAgreed} />

          <button
            className={styles.submitBtn}
            disabled={!registerValid || loading}
            onClick={submitRegister}
          >
            {loading ? '注册中…' : '注册'}
          </button>

          <button
            className={styles.createBtn}
            onClick={() => switchMode('password')}
          >
            已有账号？返回登录
          </button>
        </>
      ) : mode === 'password' ? (
        <>
          <input
            className={styles.input}
            placeholder="请输入账号"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <PasswordField
            placeholder="请输入密码"
            value={password}
            visible={passwordVisible}
            onChange={setPassword}
            onToggleVisible={() => setPasswordVisible((visible) => !visible)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitPasswordLogin();
            }}
          />

          {error && <div className={styles.error}>{error}</div>}

          <AgreementRow agreed={agreed} onChange={setAgreed} />

          <button
            className={styles.submitBtn}
            disabled={!passwordValid || loading}
            onClick={submitPasswordLogin}
          >
            {loading ? '登录中…' : '登录'}
          </button>

          <button
            className={styles.createBtn}
            onClick={() => switchMode('register')}
          >
            创建账号
          </button>
        </>
      ) : (
        <>
          <input
            className={styles.input}
            placeholder="请输入手机号"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus
          />
          <div className={styles.codeRow}>
            <input
              className={styles.input}
              placeholder="请输入验证码"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitPhoneLogin();
              }}
            />
            <button
              type="button"
              className={styles.sendCodeBtn}
              disabled={!phoneValid || cooldown > 0 || sendingCode}
              onClick={handleSendCode}
            >
              {sendCodeLabel}
            </button>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <AgreementRow agreed={agreed} onChange={setAgreed} />

          <button
            className={styles.submitBtn}
            disabled={!phoneLoginValid || loading}
            onClick={submitPhoneLogin}
          >
            {loading ? '登录中…' : '登录'}
          </button>

          <button
            className={styles.createBtn}
            onClick={() => switchMode('register')}
          >
            创建账号
          </button>
        </>
      )}

      {mode !== 'register' && (
        <>
          <div className={styles.divider}>其他登录方式</div>
          <button
            className={styles.createBtn}
            onClick={() => switchMode(mode === 'password' ? 'phone' : 'password')}
          >
            {mode === 'password' ? '手机号登录' : '账号密码登录'}
          </button>
        </>
      )}
    </Modal>
  );
}
