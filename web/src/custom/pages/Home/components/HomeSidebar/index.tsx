import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, FolderOpen, Image, LayoutGrid, MessageSquare, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { getCurrentUser, subscribe } from '@/shared/utils/auth';
import LoginModal from '@/custom/components/LoginModal';
import { showToast } from '@/custom/components/Toast';
import {
  deleteProject,
  fetchProjectListQuery,
  projectPreviews,
  renameProject,
  type ProjectRecord,
  type ProjectSource,
} from '@/custom/api/projects';
import { resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { openCanvasTab } from '@/custom/utils/open-canvas-tab';
import styles from './index.module.css';

const menuItems = [
  { key: 'home', label: '首页', icon: Home, path: '/' },
  { key: 'projects', label: '项目', icon: FolderOpen, path: '/projects' },
  { key: 'assets', label: '资产', icon: Image, path: '/library' },
];

const PAGE_SIZE = 6;
const SEARCH_DEBOUNCE_MS = 1000;

const GROUPS: { key: ProjectSource; label: string }[] = [
  { key: 'dialog', label: '生成' },
  { key: 'canvas', label: '画布' },
];

interface GroupState {
  records: ProjectRecord[];
  page: number;
  total: number;
  loading: boolean;
}

const EMPTY_GROUP: GroupState = { records: [], page: 0, total: 0, loading: false };
const EMPTY: Record<ProjectSource, GroupState> = { dialog: EMPTY_GROUP, canvas: EMPTY_GROUP };

export default function HomeSidebar({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [showLogin, setShowLogin] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [groups, setGroups] = useState<Record<ProjectSource, GroupState>>(EMPTY);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const pendingItem = useRef<(typeof menuItems)[0] | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);

  const load = (source: ProjectSource, page: number, search: string) =>
    fetchProjectListQuery({ source, page, size: PAGE_SIZE, keyword: search || undefined });

  useEffect(() => {
    if (!user) return;
    const ticket = ++requestRef.current;
    const search = debouncedKeyword.trim();
    setGroups({ dialog: { ...EMPTY_GROUP, loading: true }, canvas: { ...EMPTY_GROUP, loading: true } });
    Promise.all(GROUPS.map((group) => load(group.key, 1, search).catch(() => null))).then((pages) => {
      if (ticket !== requestRef.current) return;
      setGroups({
        dialog: pages[0] ? { records: pages[0].records, page: 1, total: pages[0].total, loading: false } : EMPTY_GROUP,
        canvas: pages[1] ? { records: pages[1].records, page: 1, total: pages[1].total, loading: false } : EMPTY_GROUP,
      });
    });
  }, [debouncedKeyword, user]);

  const loadMore = async (source: ProjectSource) => {
    const group = groups[source];
    if (group.loading) return;
    setGroups((prev) => ({ ...prev, [source]: { ...prev[source], loading: true } }));
    const nextPage = group.page + 1;
    const data = await load(source, nextPage, debouncedKeyword.trim()).catch(() => null);
    setGroups((prev) =>
      data
        ? {
            ...prev,
            [source]: {
              records: [...prev[source].records, ...data.records],
              page: nextPage,
              total: data.total,
              loading: false,
            },
          }
        : { ...prev, [source]: { ...prev[source], loading: false } },
    );
  };

  const go = (item: (typeof menuItems)[0]) => {
    navigate(item.path);
    onExpandedChange(false);
  };

  const handleClick = (item: (typeof menuItems)[0]) => {
    if (item.key !== 'home' && !user) {
      pendingItem.current = item;
      setShowLogin(true);
      return;
    }
    go(item);
  };

  const handleLoginClose = () => {
    setShowLogin(false);
    const pending = pendingItem.current;
    pendingItem.current = null;
    if (pending && getCurrentUser()) go(pending);
  };

  const handleKeyword = (value: string) => {
    setKeyword(value);
    setMenuOpen(null);
  };

  const replaceRecord = (record: ProjectRecord, next: Partial<ProjectRecord>) => {
    setGroups((prev) => {
      const patch = (source: ProjectSource) => ({
        ...prev[source],
        records: prev[source].records.map((item) =>
          String(item.id) === String(record.id) ? { ...item, ...next } : item,
        ),
      });
      return { dialog: patch('dialog'), canvas: patch('canvas') };
    });
  };

  const removeRecord = (record: ProjectRecord) => {
    setGroups((prev) => {
      const patch = (source: ProjectSource) => ({
        ...prev[source],
        records: prev[source].records.filter((item) => String(item.id) !== String(record.id)),
        total: Math.max(0, prev[source].total - 1),
      });
      return { dialog: patch('dialog'), canvas: patch('canvas') };
    });
  };

  const handleRename = async (record: ProjectRecord) => {
    const next = window.prompt('重命名项目', record.name)?.trim();
    setMenuOpen(null);
    if (!next || next === record.name) return;
    try {
      await renameProject(record.id, next);
      replaceRecord(record, { name: next });
    } catch {
      showToast('warn', '重命名失败，请稍后再试');
    }
  };

  const handleDelete = async (record: ProjectRecord) => {
    setMenuOpen(null);
    if (!window.confirm(`确认删除「${record.name}」？删除后无法找回。`)) return;
    try {
      await deleteProject(record.id);
      removeRecord(record);
    } catch {
      showToast('warn', '删除失败，请稍后再试');
    }
  };

  const searching = debouncedKeyword.trim().length > 0;
  const pendingSearch = keyword !== debouncedKeyword;
  const hasHistory = GROUPS.some((group) => groups[group.key].records.length > 0);

  return (
    <aside className={`${styles.sidebar} ${expanded ? styles.expanded : ''}`}>
      <div className={styles.brandRow}>
        <button className={styles.brand} onClick={() => handleClick(menuItems[0])} aria-label="蓝鲸首页">
          <img src="/project.png" alt="" className={styles.logoIcon} />
          <span className={styles.brandWord}>蓝鲸 AI</span>
        </button>        <button
          className={styles.sidebarControl}
          onClick={() => onExpandedChange(!expanded)}
          aria-label={expanded ? '收起侧栏' : '展开侧栏'}
          aria-expanded={expanded}
        >
          {expanded ? <PanelLeftClose size={18} strokeWidth={1.8} /> : <PanelLeftOpen size={18} strokeWidth={1.8} />}
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

      <section className={styles.historyPanel} aria-label="历史项目">
        {expanded && (
          <label className={styles.search}>
            <Search size={14} strokeWidth={2} />
            <input
              value={keyword}
              onChange={(event) => handleKeyword(event.target.value)}
              placeholder="搜索项目"
              aria-label="搜索项目"
            />
          </label>
        )}
        <div className={styles.historyScroll}>
          {pendingSearch ? (
            <p className={styles.historyEmpty}>搜索中…</p>
          ) : searching && !hasHistory ? (
            <p className={styles.historyEmpty}>没有匹配的项目</p>
          ) : (
            GROUPS.map((group) => {
              const items = groups[group.key].records;
              return (
                <section key={group.key} className={styles.historyGroup} aria-label={group.label}>
                  <h3 className={styles.historyHeading} title={group.label}>
                    {group.key === 'dialog' ? (
                      <MessageSquare size={16} strokeWidth={1.8} aria-hidden="true" className={styles.headingIcon} />
                    ) : (
                      <LayoutGrid size={16} strokeWidth={1.8} aria-hidden="true" className={styles.headingIcon} />
                    )}
                    <span className={styles.headingLabel}>{group.label}</span>
                  </h3>
                  {items.length === 0 ? (
                    <p className={styles.historyEmpty}>
                      {groups[group.key].loading ? '加载中…' : `暂无${group.label}`}
                    </p>
                  ) : (
                    <ul className={styles.historyItems}>
                      {items.map((record) => {
                        const cover = projectPreviews(record)[0];
                        return (
                          <li key={record.id} className={styles.historyItem}>
                            <button
                              className={styles.historyRow}
                              title={record.name}
                              onClick={() => openCanvasTab(record.id)}
                            >
                              <span className={styles.historyThumb}>
                                {cover ? (
                                  cover.type === 'video' ? (
                                    <video
                                      src={resolveMediaSrc(cover.url)}
                                      muted
                                      playsInline
                                      preload="metadata"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <img src={resolveMediaSrc(cover.url)} alt="" loading="lazy" />
                                  )
                                ) : (
                                  <LayoutGrid size={16} strokeWidth={1.8} aria-hidden="true" />
                                )}
                              </span>
                              <span className={styles.historyName}>{record.name}</span>
                            </button>
                            <button
                              className={styles.itemMore}
                              onClick={() => setMenuOpen(menuOpen === String(record.id) ? null : String(record.id))}
                              aria-label={`${record.name} 的更多操作`}
                              aria-haspopup="menu"
                              aria-expanded={menuOpen === String(record.id)}
                            >
                              ···
                            </button>
                            {menuOpen === String(record.id) && (
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
                        );
                      })}
                    </ul>
                  )}
                  {groups[group.key].records.length < groups[group.key].total && (
                    <button className={styles.historyMore} onClick={() => loadMore(group.key)}>
                      更多
                    </button>
                  )}
                  </section>
                );
              })
            )}
          </div>
      </section>

      {showLogin && <LoginModal onClose={handleLoginClose} />}
    </aside>
  );
}
