/* ============================================
 * Sidebar 全局左侧导航栏：页面切换入口
 * ============================================ */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, FolderOpen, Image, Layout } from 'lucide-react';
import { useAppStore } from '@/stores';
import { getCurrentUser, subscribe } from '@/utils/auth';
import LoginModal from '@/components/LoginModal';
import styles from './index.module.css';

const menuItems = [
  { key: 'home', label: '首页', icon: Home, path: '/' },
  { key: 'projects', label: '项目', icon: FolderOpen, path: '/projects' },
  { key: 'assets', label: '资产', icon: Image, path: '/library' },
  { key: 'canvas', label: '画布', icon: Layout, path: '/canvas' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setActiveMenu } = useAppStore();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  /** 未登录点击非首页菜单时弹出登录框 */
  const [showLogin, setShowLogin] = useState(false);
  /** 登录成功后需跳转的目标菜单 */
  const pendingItem = useRef<(typeof menuItems)[0] | null>(null);

  // 路由变化时自动同步 activeMenu
  useEffect(() => {
    const matched = menuItems.find((item) => item.path === location.pathname);
    if (matched) setActiveMenu(matched.key);
  }, [location.pathname, setActiveMenu]);

  const handleClick = (item: (typeof menuItems)[0]) => {
    // 除首页外均需登录态：未登录弹出登录框，登录后自动跳转
    if (item.key !== 'home' && !user) {
      pendingItem.current = item;
      setShowLogin(true);
      return;
    }
    setActiveMenu(item.key);
    navigate(item.path);
  };

  /** 关闭登录框：若已登录成功则跳转之前点击的菜单 */
  const handleLoginClose = () => {
    setShowLogin(false);
    const pending = pendingItem.current;
    pendingItem.current = null;
    if (pending && getCurrentUser()) {
      setActiveMenu(pending.key);
      navigate(pending.path);
    }
  };

  const isActive = (item: (typeof menuItems)[0]) => {
    return location.pathname === item.path;
  };

  return (
    <aside className={`${styles.sidebar} ${location.pathname === '/' ? styles.onHome : ''}`}>
      {/* Logo */}
      <div className={styles.tabLogo}>
        <img src="/blue_whale.svg" alt="Blue Whale" className={styles.logoIcon} />
      </div>

      {/* 主菜单 */}
      <nav className={styles.menu}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={`${styles.menuItem} ${isActive(item) ? styles.active : ''}`}
              onClick={() => handleClick(item)}
              title={item.label}
            >
              <Icon
                size={26}
                strokeWidth={2}
              />
              <span className={styles.label}>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* 未登录拦截弹窗 */}
      {showLogin && <LoginModal onClose={handleLoginClose} />}
    </aside>
  );
}
