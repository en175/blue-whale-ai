import { useState, useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Wallet,
  Settings,
  LogOut,
} from 'lucide-react';
import DropdownMenu from '@/custom/components/DropdownMenu';
import { joinClassNames } from '@/custom/utils/class-names';
import styles from './index.module.css';
import { getCurrentUser, subscribe, isAdmin, setSession } from '@/shared/utils/auth';
import { logout, fetchCredits } from '@/custom/api/auth';
import { useAuthStore } from '@/shared/stores/auth';
import { useRechargeUiStore } from '@/custom/stores/recharge';
import AccountModal from './AccountModal';
import RechargeModal from './RechargeModal';
import LoginModal, { type LoginModalMode } from '@/custom/components/LoginModal';
import { USER_DROPDOWN_MENU_ITEMS } from './menuItems';

const menuIcons = {
  account: FileText,
  credits: Wallet,
  settings: Settings,
} as const;

export default function UserDropdown() {
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const showRecharge = useRechargeUiStore((s) => s.open);
  const closeRecharge = useRechargeUiStore((s) => s.closeRecharge);
  const [loginMode, setLoginMode] = useState<LoginModalMode | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const credits = useAuthStore((s) => s.credits);
  const setUsage = useAuthStore((s) => s.setUsage);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      setUsage(null);
      return;
    }
    let alive = true;
    fetchCredits()
      .then((d) => {
        if (alive) setUsage(d);
      })
      .catch(() => {
        if (alive) setUsage(null);
      });
    return () => {
      alive = false;
    };
  }, [user, setUsage]);

  if (!user) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.guestActions}>
          <button className={styles.loginBtn} onClick={() => setLoginMode('password')}>
            登录
          </button>
          <button className={styles.loginBtn} onClick={() => setLoginMode('register')}>
            注册
          </button>
        </div>
        {loginMode && (
          <LoginModal initialMode={loginMode} onClose={() => setLoginMode(null)} />
        )}
      </div>
    );
  }

  const handleLogout = async () => {
    setMenuOpen(false);
    closeRecharge();
    setLoggingOut(true);
    await logout().catch(() => undefined);
    setSession(null);
    setLoggingOut(false);
  };

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        openOnHover
        align="end"
        wrapClassName={styles.wrapper}
        contentClassName={styles.dropdown}
        trigger={
          <button type="button" className={styles.trigger} aria-label={user.username}>
            <div className={styles.triggerAvatar}>{user.username.charAt(0).toUpperCase()}</div>
          </button>
        }
        panel={
          <>
            <div className={styles.userHeader}>
              <div className={styles.avatar}>{user.username.charAt(0).toUpperCase()}</div>
              <div className={styles.userHeaderInfo}>
                <span className={styles.username}>{user.username}</span>
                <span className={styles.userMeta}>ID：{user.userId}</span>
                {user.email && <span className={styles.userMeta}>{user.email}</span>}
              </div>
            </div>
            <div className={styles.divider} />
            <div className={styles.menuList}>
              {USER_DROPDOWN_MENU_ITEMS.map((item) => {
                const Icon = menuIcons[item.key];
                if (item.key === 'settings' && !isAdmin()) return null;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuOpen(false);
                      if (item.key === 'account') setShowAccount(true);
                      if (item.key === 'credits') window.open('/account/credits', '_blank', 'noopener,noreferrer');
                      if (item.key === 'settings') navigate('/admin');
                    }}
                  >
                    <Icon size={18} strokeWidth={2} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.divider} />
            <button
              type="button"
              className={joinClassNames(styles.menuItem, styles.logoutItem)}
              onClick={handleLogout}
              disabled={loggingOut}
            >
              <LogOut size={18} strokeWidth={2} />
              <span>{loggingOut ? '退出中…' : '退出登录'}</span>
            </button>
          </>
        }
      />
      {showAccount && (
        <AccountModal
          userId={user.userId}
          nickname={user.username}
          phone={user.phone ?? ''}
          hasPassword={user.hasPassword}
          balance={credits}
          onClose={() => setShowAccount(false)}
        />
      )}
      {showRecharge && <RechargeModal onClose={closeRecharge} />}
    </>
  );
}
