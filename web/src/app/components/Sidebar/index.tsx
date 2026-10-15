import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, FolderOpen, Image, History as HistoryIcon, Layout } from 'lucide-react';
import { useAppStore } from '@/app/stores';
import { getCurrentUser, subscribe } from '@/shared/utils/auth';
import LoginModal from '@/app/components/LoginModal';
import styles from './index.module.css';

const menuItems = [
  { key: 'home', label: '首页', icon: Home, path: '/' },
  { key: 'projects', label: '项目', icon: FolderOpen, path: '/projects' },
  { key: 'assets', label: '资产', icon: Image, path: '/library' },
  { key: 'history', label: '历史', icon: HistoryIcon, path: '/history' },
  { key: 'canvas', label: '画布', icon: Layout, path: '/canvas' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setActiveMenu } = useAppStore();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [showLogin, setShowLogin] = useState(false);
  const pendingItem = useRef<(typeof menuItems)[0] | null>(null);

  useEffect(() => {
    const matched = menuItems.find((item) => item.path === location.pathname);
    if (matched) setActiveMenu(matched.key);
  }, [location.pathname, setActiveMenu]);

  const handleClick = (item: (typeof menuItems)[0]) => {
    if (item.key !== 'home' && !user) {
      pendingItem.current = item;
      setShowLogin(true);
      return;
    }
    setActiveMenu(item.key);
    navigate(item.path);
  };

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
  const hasGlassBackground = ['/', '/projects', '/library', '/history'].includes(location.pathname);

  return (
    <aside className={`${styles.sidebar} ${hasGlassBackground ? styles.onGlass : ''}`}>
      {}
      <div className={styles.tabLogo}>
        <img src="/blue_whale.svg" alt="Blue Whale" className={styles.logoIcon} />
      </div>

      {}
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

      {}
      {showLogin && <LoginModal onClose={handleLoginClose} />}
    </aside>
  );
}
