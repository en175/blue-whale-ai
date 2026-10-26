import { useState, useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { showToast } from '@/shared/components/Toast';
import { getCurrentUser, subscribe, isAdmin, setSession } from '@/shared/utils/auth';
import { BROWSER_LOGOUT_MESSAGE } from '@/shared/utils/sessionNotice';
import { publishSessionSync } from '@/shared/utils/sessionSync';
import { accountProfileKeys, logout, fetchCredits } from '@/custom/api/auth';
import { useAuthStore } from '@/shared/stores/auth';
import { useRechargeUiStore } from '@/custom/stores/recharge';
import AccountModal from './AccountModal';
import RechargeModal from './RechargeModal';
import LoginModal from '@/custom/components/LoginModal';
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
  const [loginOpen, setLoginOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const credits = useAuthStore((s) => s.credits);
  const setUsage = useAuthStore((s) => s.setUsage);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      setUsage(null);
      queryClient.removeQueries({ queryKey: accountProfileKeys.all });
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
  }, [user, setUsage, queryClient]);

  if (!user) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.guestActions}>
          <button type="button" className={styles.loginBtn} onClick={() => setLoginOpen(true)}>
            <span className={styles.loginLabel}>注册/登录</span>
          </button>
        </div>
        {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      </div>
    );
  }

  const handleLogout = async () => {
    setMenuOpen(false);
    closeRecharge();
    setLoggingOut(true);
    await logout().catch(() => undefined);
    setSession(null);
    publishSessionSync({ kind: 'logout' });
    showToast('success', BROWSER_LOGOUT_MESSAGE);
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
          <button type="button" className={styles.trigger} aria-label={user.nickname || user.username}>
            <div className={styles.triggerAvatar}>{(user.nickname || user.username).charAt(0).toUpperCase()}</div>
          </button>
        }
        panel={
          <>
            <div className={styles.userHeader}>
              <div className={styles.avatar}>{(user.nickname || user.username).charAt(0).toUpperCase()}</div>
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
          nickname={user.nickname || user.username}
          phone={user.phone ?? ''}
          hasPassword={user.hasPassword}
          balance={credits}
          onClose={() => setShowAccount(false)}
          onRequireLogin={() => {
            setShowAccount(false);
            setLoginOpen(true);
          }}
        />
      )}
      {showRecharge && <RechargeModal onClose={closeRecharge} />}
    </>
  );
}
