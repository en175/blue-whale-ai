/* ============================================
 * AdminLayout 后台布局：侧边菜单 + 内容出口
 * ============================================ */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import {
  Layers,
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
  ReceiptText,
  ListChecks,
  Coins,
} from 'lucide-react';
import { getCurrentUser, subscribe, updateUser } from '@/utils/auth';
import { fetchAdminSession } from '@/api/admin';
import { useDocumentTitle } from '@/seo/useDocumentTitle';
import '../styles/admin.css';
import styles from './index.module.css';

/** 后台侧边菜单 */
const navItems = [
  { to: '/admin', end: true, label: '仪表盘', icon: LayoutDashboard },
  { to: '/admin/recharge-plans', end: false, label: '充值档位', icon: Layers },
  { to: '/admin/billing', end: false, label: '模型计费', icon: Coins },
  { to: '/admin/recharge-records', end: false, label: '充值记录', icon: Wallet },
  { to: '/admin/consumption-records', end: false, label: '消费记录', icon: ReceiptText },
  { to: '/admin/job-records', end: false, label: '任务记录', icon: ListChecks },
  { to: '/admin/templates', end: false, label: '模板管理', icon: LayoutTemplate },
  { to: '/admin/skills', end: false, label: '技能管理', icon: Sparkles },
  { to: '/admin/models', end: false, label: '模型列表', icon: Boxes },
  { to: '/admin/users', end: false, label: '用户管理', icon: Users },
  { to: '/admin/logs', end: false, label: '操作日志', icon: FileText },
  { to: '/admin/site-config', end: false, label: '通用配置', icon: Images },
  { to: '/admin/settings', end: false, label: '系统管理', icon: Settings },
];

/** 侧栏收起状态存在本地：管理端是天天用的工具，每次进来都重新展开很烦。 */
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
        // 隐私模式下 localStorage 可能不可用；存不上只是记不住偏好，不影响功能
      }
      return next;
    });

  // ⚠️ 把根元素的 color-scheme 也设成 light。
  //    只写 .adminRoot 上的 CSS 变量不够：原生控件（下拉候选框、复选框、滚动条）
  //    的渲染由**该元素生效的 color-scheme** 决定，而 portal 到 document.body 的浮层
  //    压根不在 .adminRoot 子树里。设到根上最稳，且不影响前台——离开管理端时还原。
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.colorScheme;
    root.style.colorScheme = 'light';
    return () => {
      root.style.colorScheme = previous;
    };
  }, []);

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
    // adminRoot 是 admin.css 里的全局类：它把 --admin-* 一组变量挂在这一层，
    // 子树里所有样式都从它取值。挂在这里而不是 :root，是为了让这组变量
    // 只在后台生效——前台不该被管理端的样式影响。
    <div className={`adminRoot ${styles.layout}`}>
      {/* 侧边栏 */}
      <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
        {/* 品牌区 + 收起开关 */}
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

        {/* 菜单 */}
        <nav className={styles.nav}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                // 收起时只留图标：靠 title 提供可读名称，
                // 否则一列无字图标对不熟悉的人就是猜谜
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

        {/* 底部管理员信息 */}
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

      {/* 内容区 */}
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
