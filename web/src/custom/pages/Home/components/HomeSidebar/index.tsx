import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, FolderOpen, Image, PanelLeft, Search } from 'lucide-react';
import { useAppStore } from '@/custom/stores';
import { getCurrentUser, subscribe } from '@/shared/utils/auth';
import LoginModal from '@/custom/components/LoginModal';
import { showToast } from '@/custom/components/Toast';
import { MOCK_CANVAS_PROJECTS, MOCK_GENERATE_PROJECTS, type MockHistoryProject } from './mockHistoryProjects';
import styles from './index.module.css';

const menuItems = [
  { key: 'home', label: '首页', icon: Home, path: '/' },
  { key: 'projects', label: '项目', icon: FolderOpen, path: '/projects' },
  { key: 'assets', label: '资产', icon: Image, path: '/library' },
];

const PAGE_SIZE = 6;

type HistoryKind = 'generate' | 'canvas';

const GROUPS: { key: HistoryKind; label: string }[] = [
  { key: 'generate', label: '生成' },
  { key: 'canvas', label: '画布' },
];

const MOCK_SOURCE: Record<HistoryKind, MockHistoryProject[]> = {
  generate: MOCK_GENERATE_PROJECTS,
  canvas: MOCK_CANVAS_PROJECTS,
};

export default function HomeSidebar({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { setActiveMenu } = useAppStore();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [showLogin, setShowLogin] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [pages, setPages] = useState<Record<HistoryKind, number>>({ generate: 1, canvas: 1 });
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
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

  const handleKeyword = (value: string) => {
    setKeyword(value);
    setPages({ generate: 1, canvas: 1 });
    setMenuOpen(null);
  };

  const query = keyword.trim().toLowerCase();
  const groups = useMemo(() => {
    const build = (kind: HistoryKind) =>
      MOCK_SOURCE[kind]
        .filter((item) => !deleted.has(item.id))
        .map((item) => ({ id: item.id, name: renamed[item.id] ?? item.name }))
        .filter((item) => !query || item.name.toLowerCase().includes(query));
    return { generate: build('generate'), canvas: build('canvas') };
  }, [deleted, renamed, query]);

  const handleRename = (record: { id: string; name: string }) => {
    const next = window.prompt('重命名项目', record.name)?.trim();
    setMenuOpen(null);
    if (!next || next === record.name) return;
    setRenamed((prev) => ({ ...prev, [record.id]: next }));
  };

  const handleDelete = (record: { id: string; name: string }) => {
    setMenuOpen(null);
    if (!window.confirm(`确认删除「${record.name}」？删除后无法找回。`)) return;
    setDeleted((prev) => new Set(prev).add(record.id));
  };

  const handleOpen = (record: { id: string }) => {
    if (record.id.startsWith('mock-')) {
      showToast('warn', '示例数据，联调后可打开项目');
      return;
    }
    navigate(`/canvas?project=${record.id}`);
  };

  const searching = query.length > 0;
  const hasHistory = GROUPS.some((group) => groups[group.key].length > 0);

  return (
    <aside className={`${styles.sidebar} ${styles.onGlass} ${expanded ? styles.expanded : ''}`}>
      <div className={styles.brandRow}>
        <button className={styles.brand} onClick={() => handleClick(menuItems[0])} aria-label="蓝鲸首页">
          <img src="/blue_whale.svg" alt="" className={styles.logoIcon} />
        </button>
        <button
          className={styles.sidebarControl}
          onClick={() => onExpandedChange(!expanded)}
          aria-label={expanded ? '收起侧栏' : '展开侧栏'}
          aria-expanded={expanded}
        >
          <PanelLeft size={16} strokeWidth={2} />
        </button>
      </div>

      <nav className={styles.menu}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.path;
          return (
            <button
              key={item.key}
              className={`${styles.menuItem} ${active ? styles.active : ''}`}
              onClick={() => handleClick(item)}
              title={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={26} strokeWidth={2} />
              <span className={styles.label}>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {expanded && (
        <section className={styles.historyPanel} aria-label="历史项目">
          <label className={styles.search}>
            <Search size={14} strokeWidth={2} />
            <input
              value={keyword}
              onChange={(event) => handleKeyword(event.target.value)}
              placeholder="搜索项目"
              aria-label="搜索项目"
            />
          </label>
          <div className={styles.historyScroll}>
            {searching && !hasHistory ? (
              <p className={styles.historyEmpty}>没有匹配的项目</p>
            ) : (
              GROUPS.map((group) => {
                const items = groups[group.key];
                const visible = items.slice(0, pages[group.key] * PAGE_SIZE);
                return (
                  <section key={group.key} className={styles.historyGroup} aria-label={group.label}>
                    <h3 className={styles.historyHeading}>{group.label}</h3>
                    {visible.length === 0 ? (
                      <p className={styles.historyEmpty}>暂无{group.label}</p>
                    ) : (
                      <ul className={styles.historyItems}>
                        {visible.map((record) => (
                          <li key={record.id} className={styles.historyItem}>
                            <button
                              className={styles.historyRow}
                              title={record.name}
                              onClick={() => handleOpen(record)}
                            >
                              <span className={styles.historyName}>{record.name}</span>
                            </button>
                            <button
                              className={styles.itemMore}
                              onClick={() => setMenuOpen(menuOpen === record.id ? null : record.id)}
                              aria-label={`${record.name} 的更多操作`}
                              aria-haspopup="menu"
                              aria-expanded={menuOpen === record.id}
                            >
                              ···
                            </button>
                            {menuOpen === record.id && (
                              <div className={styles.itemMenu} role="menu">
                                <button role="menuitem" onClick={() => handleRename(record)}>
                                  重命名
                                </button>
                                <button role="menuitem" onClick={() => handleDelete(record)}>
                                  删除
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {items.length > visible.length && (
                      <button
                        className={styles.historyMore}
                        onClick={() => setPages((prev) => ({ ...prev, [group.key]: prev[group.key] + 1 }))}
                      >
                        更多
                      </button>
                    )}
                  </section>
                );
              })
            )}
          </div>
        </section>
      )}

      {showLogin && <LoginModal onClose={handleLoginClose} />}
    </aside>
  );
}
