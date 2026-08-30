/* ============================================
 * LoginModal 登录弹窗：登录 / 注册双模式
 * 外壳走共用 Modal（Portal / 遮罩 / ESC / 关闭），表单与鉴权逻辑保持不变
 * ============================================ */
import { useState } from 'react';
import {
  loginWithPassword,
  registerWithPassword,
  fetchMe,
  toSessionUser,
  type LoginData,
} from '@/api/auth';
import { fetchAdminSession } from '@/api/admin';
import { isApiError } from '@/api/http';
import Modal from '@/components/Modal';
import { useAuthStore, type SessionUser } from '@/stores/auth';
import { updateUser } from '@/utils/auth';
import styles from './index.module.css';
import { isRegisterPasswordValid } from './password';

interface LoginModalProps {
  onClose: () => void;
  /** 登录/注册成功后、关闭弹窗前调用（会话过期续接用） */
  onSuccess?: () => void;
  /** 初始模式：'login' 登录 | 'register' 注册 */
  initialMode?: 'login' | 'register';
}

type Mode = 'login' | 'register';

export default function LoginModal({ onClose, onSuccess, initialMode = 'login' }: LoginModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const heading = mode === 'login' ? '登录' : '创建账号';

  /* ---------- 表单校验 ---------- */
  const loginValid = username.trim().length > 0 && password.length > 0 && agreed;
  const passwordRuleError = mode === 'register' && password.length > 0 && !isRegisterPasswordValid(password);
  const registerValid =
    username.trim().length >= 3 &&
    isRegisterPasswordValid(password) &&
    password === confirmPwd &&
    agreed;

  /* ---------- 登录/注册共用：登录态写入 ---------- */
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
        };
    useAuthStore.getState().applyLogin(login, user);
    fetchAdminSession()
      .then((session) => updateUser({ isAdmin: session.isAdmin }))
      .catch(() => undefined);
    onSuccess?.();
    onClose();
  };

  /* ---------- 登录提交 ---------- */
  const submitLogin = async () => {
    if (!loginValid || loading) return;
    setLoading(true);
    setError('');
    try {
      const login = await loginWithPassword(username.trim(), password);
      await applyAuth(login);
    } catch (e) {
      setError(isApiError(e) ? e.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  /* ---------- 注册提交 ---------- */
  const submitRegister = async () => {
    if (!registerValid || loading) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const login = await registerWithPassword(username.trim(), password, email.trim() || undefined);
      setSuccess('注册成功，正在登录…');
      await applyAuth(login);
    } catch (e) {
      setError(isApiError(e) ? e.message : '注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  /* ---------- 切换模式时清空状态 ---------- */
  const switchMode = (target: Mode) => {
    setMode(target);
    setError('');
    setSuccess('');
  };

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

      {mode === 'login' ? (
        /* ========== 登录表单 ========== */
        <>
          <input
            className={styles.input}
            placeholder="请输入账号"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <input
            className={styles.input}
            type="password"
            placeholder="请输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitLogin();
            }}
          />

          {error && <div className={styles.error}>{error}</div>}

          <label className={styles.agreeRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span className={styles.agreeText}>
              我已阅读并同意
              <a className={styles.link} href="#" onClick={(e) => e.preventDefault()}>
                《用户协议》
              </a>
              和
              <a className={styles.link} href="#" onClick={(e) => e.preventDefault()}>
                《隐私政策》
              </a>
            </span>
          </label>

          <button
            className={styles.submitBtn}
            disabled={!loginValid || loading}
            onClick={submitLogin}
          >
            {loading ? '登录中…' : '登录'}
          </button>

          {/* 创建账号（带灰色边框） */}
          <button
            className={styles.createBtn}
            onClick={() => switchMode('register')}
          >
            创建账号
          </button>
        </>
      ) : (
        /* ========== 注册表单 ========== */
        <>
          <input
            className={styles.input}
            placeholder="账号（至少3位）"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <input
            className={styles.input}
            type="password"
            placeholder="密码（8-20位）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={passwordRuleError}
            aria-describedby={passwordRuleError ? 'register-password-error' : undefined}
          />
          {passwordRuleError && (
            <div id="register-password-error" className={styles.error}>
              密码长度需为 8-20 个字符
            </div>
          )}
          <input
            className={styles.input}
            type="password"
            placeholder="确认密码"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
          />
          <input
            className={styles.input}
            type="email"
            placeholder="邮箱（选填）"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {error && <div className={styles.error}>{error}</div>}
          {success && <div className={styles.success}>{success}</div>}

          <label className={styles.agreeRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span className={styles.agreeText}>
              我已阅读并同意
              <a className={styles.link} href="#" onClick={(e) => e.preventDefault()}>
                《用户协议》
              </a>
              和
              <a className={styles.link} href="#" onClick={(e) => e.preventDefault()}>
                《隐私政策》
              </a>
            </span>
          </label>

          <button
            className={styles.submitBtn}
            disabled={!registerValid || loading}
            onClick={submitRegister}
          >
            {loading ? '注册中…' : '注册'}
          </button>

          {/* 返回登录 */}
          <button
            className={styles.createBtn}
            onClick={() => switchMode('login')}
          >
            已有账号？返回登录
          </button>
        </>
      )}
    </Modal>
  );
}
