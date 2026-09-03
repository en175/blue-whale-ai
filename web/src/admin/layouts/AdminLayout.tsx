/* ============================================
 * AdminLayout 后台布局：侧边菜单 + 内容出口
 * ============================================ */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import {
  Shield,
  LayoutDashboard,
  Layers,
  LayoutTemplate,
  Boxes,
  Users,
  ReceiptText,
  FileText,
  Settings,
  Sparkles,
  Images,
} from 'lucide-react';
import { getCurrentUser, subscribe, updateUser } from '@/utils/auth';
import { fetchAdminSession } from '@/api/admin';
import { useDocumentTitle } from '@/seo/useDocumentTitle';
import styles from './index.module.css';

/** 后台侧边菜单 */
const navItems = [
  { to: '/admin', end: true, label: '仪表盘', icon: LayoutDashboard },
  { to: '/admin/recharge-plans', end: false, label: '充值档位', icon: Layers },
  { to: '/admin/templates', end: false, label: '模板管理', icon: LayoutTemplate },
  { to: '/admin/skills', end: false, label: '技能管理', icon: Sparkles },
  { to: '/admin/models', end: false, label: '模型列表', icon: Boxes },
  { to: '/admin/users', end: false, label: '用户管理', icon: Users },
  { to: '/admin/orders', end: false, label: '订单管理', icon: ReceiptText },
  { to: '/admin/logs', end: false, label: '操作日志', icon: FileText },
  { to: '/admin/site-config', end: false, label: '通用配置', icon: Images },
  { to: '/admin/settings', end: false, label: '系统管理', icon: Settings },
];

export default function AdminLayout() {
  useDocumentTitle();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [checking, setChecking] = useState(true);

  // 布局加载时实时校验管理员身份：非管理员置 isAdmin=false 由 RequireAdmin 守卫跳回首页
  // 401 时 http 层已清空会话，守卫同样会拦截
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

  // 未登录直接回首页
  if (!user) return <Navigate to="/" replace />;

  // 身份校验中：不先渲染后台内容，避免非管理员闪现
  if (checking) return <div className={styles.guardLoading}>身份校验中…</div>;

  return (
    <div className={styles.layout}>
      {/* 侧边栏 */}
      <aside className={styles.sidebar}>
        {/* 品牌区 */}
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <Shield size={20} strokeWidth={2} />
          </div>
          <div className={styles.brandText}>
            <div className={styles.brandName}>管理后台</div>
            <div className={styles.brandSub}>Blue-Whale Admin</div>
          </div>
        </div>

        {/* 菜单 */}
        <nav className={styles.nav}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `${styles.navItem} ${isActive ? styles.navActive : ''}`
                }
              >
                <Icon size={18} strokeWidth={2} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* 底部管理员信息 */}
        <div className={styles.footer}>
          <div className={styles.avatar}>{user.username.charAt(0).toUpperCase()}</div>
          <div className={styles.footerText}>
            <div className={styles.footerName}>管理员</div>
            <div className={styles.footerMail}>{user.email}</div>
          </div>
        </div>
      </aside>

      {/* 内容区 */}
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
