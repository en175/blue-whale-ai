/* ============================================
 * UserDropdown 右上角用户下拉菜单：账号信息/积分充值入口
 * 未登录时渲染「登录」按钮并弹出登录弹窗
 * IKBL2I：个人资料入口暂时隐藏，ProfileModal 保留以便恢复
 * ============================================ */
import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Wallet,
  Settings,
  LogOut,
  Coins,
  ChevronDown,
} from 'lucide-react';
import styles from './index.module.css';
import { getCurrentUser, subscribe, isAdmin, setSession } from '@/utils/auth';
import { logout, fetchQuota, quotaToPoints } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { useRechargeUiStore } from '@/stores/recharge';
import AccountModal from './AccountModal';
import RechargeModal from './RechargeModal';
import LoginModal from '@/components/LoginModal';
import { USER_DROPDOWN_MENU_ITEMS } from './menuItems';

const menuIcons = {
  account: FileText,
  recharge: Wallet,
  settings: Settings,
} as const;

export default function UserDropdown() {
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [open, setOpen] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const showRecharge = useRechargeUiStore((s) => s.open);
  const openRecharge = useRechargeUiStore((s) => s.openRecharge);
  const closeRecharge = useRechargeUiStore((s) => s.closeRecharge);
  const [showLogin, setShowLogin] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const quota = useAuthStore((s) => s.quota);
  const setQuota = useAuthStore((s) => s.setQuota);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // 登录后拉取积分配额写入全局存储（下拉余额/账号弹窗/画布顶栏共用）
  useEffect(() => {
    if (!user) {
      setQuota(null);
      return;
    }
    let alive = true;
    fetchQuota()
      .then((d) => {
        if (alive) setQuota(d.quota);
      })
      .catch(() => {
        if (alive) setQuota(null);
      });
    return () => {
      alive = false;
    };
  }, [user, setQuota]);

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 未登录：展示「登录」按钮，点击弹出登录弹窗
  if (!user) {
    return (
      <div className={styles.wrapper} ref={ref}>
        <button className={styles.loginBtn} onClick={() => setShowLogin(true)}>
          登录
        </button>
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      </div>
    );
  }

  // 退出登录：调用退出接口后清空会话
  const handleLogout = async () => {
    setOpen(false);
    closeRecharge();
    setLoggingOut(true);
    await logout().catch(() => undefined);
    setSession(null);
    setLoggingOut(false);
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      {/* 触发按钮 */}
      <button className={styles.trigger} onClick={() => setOpen(!open)}>
        <div className={styles.triggerAvatar}>{user.username.charAt(0).toUpperCase()}</div>
        <span className={styles.triggerName}>{user.username}</span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={`${styles.triggerArrow} ${open ? styles.arrowUp : ''}`}
        />
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className={styles.dropdown}>
          {/* 用户头部：用户名 + 用户ID + 邮箱（/api/me） */}
          <div className={styles.userHeader}>
            <div className={styles.avatar}>{user.username.charAt(0).toUpperCase()}</div>
            <div className={styles.userHeaderInfo}>
              <span className={styles.username}>{user.username}</span>
              <span className={styles.userMeta}>ID：{user.userId}</span>
              {user.email && <span className={styles.userMeta}>{user.email}</span>}
            </div>
          </div>

          {/* 积分余额 */}
          <div className={styles.pointsRow}>
            <div className={styles.pointsLeft}>
              <div className={styles.pointsIcon}>
                <Coins size={16} strokeWidth={2} />
              </div>
              <span className={styles.pointsLabel}>积分余额</span>
            </div>
            <span className={styles.pointsValue}>
              {quota === null ? '--' : quotaToPoints(quota)}
            </span>
          </div>

          {/* 分隔线 */}
          <div className={styles.divider} />

          {/* 菜单列表 */}
          <div className={styles.menuList}>
            {USER_DROPDOWN_MENU_ITEMS.map((item) => {
              const Icon = menuIcons[item.key];
              // 系统设置仅管理员可见
              if (item.key === 'settings' && !isAdmin()) return null;
              return (
                <button
                  key={item.key}
                  className={styles.menuItem}
                  onClick={() => {
                    setOpen(false);
                    if (item.key === 'account') setShowAccount(true);
                    if (item.key === 'recharge') openRecharge();
                    if (item.key === 'settings') navigate('/admin');
                  }}
                >
                  <Icon
                    size={18}
                    strokeWidth={2}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* 分隔线 */}
          <div className={styles.divider} />

          {/* 退出登录 */}
          <button
            className={`${styles.menuItem} ${styles.logoutItem}`}
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut size={18} strokeWidth={2} />
            <span>{loggingOut ? '退出中…' : '退出登录'}</span>
          </button>
        </div>
      )}

      {/* IKBL2I：个人资料弹窗暂不挂载，入口隐藏后无法打开 */}
      {/* 账号信息弹窗 */}
      {showAccount && (
        <AccountModal
          userId={user.userId}
          nickname={user.username}
          balance={quota === null ? null : quota / 50000}
          onClose={() => setShowAccount(false)}
          onOpenRecharge={openRecharge}
        />
      )}
      {/* 积分充值弹窗（用户菜单与生成前余额拦截共用） */}
      {showRecharge && <RechargeModal onClose={closeRecharge} />}
    </div>
  );
}
