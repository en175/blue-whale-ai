import { useEffect, useState, useSyncExternalStore } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import {
  Layers,
  SlidersHorizontal,
  Shield,
  LayoutDashboard,
  LayoutTemplate,
  Boxes,
  Users,
  FileText,
  Settings,
  Sparkles,
  Images,
  PanelLeftClose,
  PanelLeftOpen,
  Wallet,
  History,
  ListChecks,
  Megaphone,
  BadgePercent,
} from 'lucide-react';
import { getCurrentUser, subscribe, updateUser } from '@/utils/auth';
import { fetchAdminSession } from '@/api/adminSession';
import { useDocumentTitle } from '@/seo/useDocumentTitle';
import '../styles/admin.css';
import styles from './index.module.css';

const navItems = [
  { to: '/admin', end: true, label: '仪表盘', icon: LayoutDashboard },
  { to: '/admin/recharge-plans', end: false, label: '充值档位', icon: Layers },
  { to: '/admin/recharge-custom-config', end: false, label: '自定义充值', icon: SlidersHorizontal },
  { to: '/admin/billing-promotions', end: false, label: '限时活动', icon: Megaphone },
  { to: '/admin/billing-member-discounts', end: false, label: '会员折扣', icon: BadgePercent },
  { to: '/admin/recharge-records', end: false, label: '充值记录', icon: Wallet },
  { to: '/admin/consumption-records', end: false, label: '积分记录', icon: History },
  { to: '/admin/job-records', end: false, label: '任务记录', icon: ListChecks },
  { to: '/admin/templates', end: false, label: '模板管理', icon: LayoutTemplate },
  { to: '/admin/skills', end: false, label: '技能管理', icon: Sparkles },
  { to: '/admin/models', end: false, label: '模型列表', icon: Boxes },
  { to: '/admin/users', end: false, label: '用户管理', icon: Users },
  { to: '/admin/logs', end: false, label: '操作日志', icon: FileText },
  { to: '/admin/site-config', end: false, label: '通用配置', icon: Images },
  { to: '/admin/settings', end: false, label: '系统管理', icon: Settings },
];

const COLLAPSE_KEY = 'admin-sidebar-collapsed';

export default function AdminLayout() {
  useDocumentTitle();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [checking, setChecking] = useState(true);
  const [collapsed, setCollapsed] = useState(
    () => globalThis.localStorage?.getItem(COLLAPSE_KEY) === '1',
  );

  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        globalThis.localStorage?.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
      }
      return next;
    });

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.colorScheme;
    root.style.colorScheme = 'light';
    return () => {
      root.style.colorScheme = previous;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAdminSession()
      .then((session) => {
        if (!cancelled) updateUser({ isAdmin: session.isAdmin });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return <Navigate to="/" replace />;

  if (checking) return <div className={styles.guardLoading}>身份校验中…</div>;

  return (
    <div className={`adminRoot ${styles.layout}`}>
      {}
      <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
        {}
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <Shield size={18} strokeWidth={2} />
          </div>
          {!collapsed && (
            <div className={styles.brandText}>
              <div className={styles.brandName}>管理后台</div>
              <div className={styles.brandSub}>Blue-Whale Admin</div>
            </div>
          )}
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={toggleCollapsed}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {}
        <nav className={styles.nav}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                className={({ isActive }) =>
                  `${styles.navItem} ${isActive ? styles.navActive : ''}`
                }
              >
                <Icon size={18} strokeWidth={2} />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {}
        <div className={styles.footer}>
          <div className={styles.avatar}>{user.username.charAt(0).toUpperCase()}</div>
          {!collapsed && (
            <div className={styles.footerText}>
              <div className={styles.footerName}>管理员</div>
              <div className={styles.footerMail}>{user.email}</div>
            </div>
          )}
        </div>
      </aside>

      {}
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
