/* ============================================
 * LoginModal 登录弹窗：账号密码 + 协议勾选 + 创建账号
 * ============================================ */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { loginWithPassword, fetchMe, toSessionUser } from '@/api/auth';
import { fetchAdminSession } from '@/api/admin';
import { isApiError } from '@/api/http';
import { useAuthStore, type SessionUser } from '@/stores/auth';
import { updateUser } from '@/utils/auth';
import styles from './index.module.css';

interface LoginModalProps {
  onClose: () => void;
}

export default function LoginModal({ onClose }: LoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const valid = username.trim().length > 0 && password.length > 0 && agreed;

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError('');
    try {
      const login = await loginWithPassword(username.trim(), password);
      // 登录成功后拉取 /api/me 补全角色信息，失败时降级用登录返回
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
      // 登录响应完整信息（token/refresh/expires/is_new_user）+ 用户信息写入全局状态存储
      useAuthStore.getState().applyLogin(login, user);
      // 登录提交后调 /api/admin/session 确认管理员身份，结果写回会话（非管理员/失败保持原状）
      fetchAdminSession()
        .then((session) => updateUser({ isAdmin: session.isAdmin }))
        .catch(() => undefined);
      onClose();
    } catch (e) {
      setError(isApiError(e) ? e.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 关闭 */}
        <button className={styles.closeBtn} onClick={onClose} title="关闭">
          <X size={18} strokeWidth={2} />
        </button>

        <h2 className={styles.title}>登录</h2>

        {/* 账号 / 密码 */}
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
            if (e.key === 'Enter') submit();
          }}
        />

        {error && <div className={styles.error}>{error}</div>}

        {/* 协议勾选 */}
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

        {/* 登录按钮 */}
        <button className={styles.submitBtn} disabled={!valid || loading} onClick={submit}>
          {loading ? '登录中…' : '登录'}
        </button>

        {/* 创建账号 */}
        <button
          className={styles.createBtn}
          onClick={() => setNotice('注册通道即将开放，敬请期待')}
        >
          创建账号
        </button>
        {notice && <div className={styles.notice}>{notice}</div>}
      </div>
    </div>,
    document.body
  );
}
