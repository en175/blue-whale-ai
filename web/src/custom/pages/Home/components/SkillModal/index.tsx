import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  MoreHorizontal,
  Eye,
  Store,
  BookMarked,
  AtSign,
  Sparkles,
  Check,
  Upload,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import styles from './index.module.css';
import {
  fetchSkillContent,
  fetchSkillLibrary,
  fetchSkillCategories,
  addLibrarySkill,
  fetchMySkills,
  deletePersonalSkill,
  removeMySkill,
  createPersonalSkill,
  formatPersonalSkill,
  fetchPersonalSkill,
  type SkillRecord,
} from '@/custom/api/skills';
import { isApiError } from '@/shared/api/http';
import SearchInput from '@/custom/components/SearchInput';
import Select from '@/custom/components/Select';
import Tabs from '@/custom/components/Tabs';
import ConfirmModal from '@/custom/components/ConfirmModal';
import DropdownMenu from '@/custom/components/DropdownMenu';
import Empty from '@/custom/components/Empty';

interface SkillModalProps {
  open: boolean;
  onClose: () => void;
  onUseSkill?: (skill: SkillRecord) => void;
}

const PAGE_SIZE = 50;

const LANG: 'zh' | 'en' = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';

const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  film: '影视',
  marketing: '营销',
  other: '其他',
};

const sortOptions = [
  { key: 'featured', label: '精选' },
  { key: 'most_used', label: '最多使用' },
  { key: 'newest', label: '最新发布' },
] as const;

function errMsg(e: unknown): string {
  return isApiError(e) ? e.message : '请求失败，请稍后重试';
}

const SKILL_TEMPLATE = `---
name:
description:
---
`;

export default function SkillModal({ open, onClose, onUseSkill }: SkillModalProps) {
  const [tab, setTab] = useState<'mine' | 'library' | 'create'>('library');

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<(typeof sortOptions)[number]['key']>('featured');
  const [category, setCategory] = useState('all');
  const [categoryList, setCategoryList] = useState<string[]>([]);
  const [libraryList, setLibraryList] = useState<SkillRecord[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryHasMore, setLibraryHasMore] = useState(true);
  const libPageRef = useRef(1);
  const libGridRef = useRef<HTMLDivElement>(null);

  const [mySkills, setMySkills] = useState<SkillRecord[]>([]);
  const [removalTarget, setRemovalTarget] = useState<SkillRecord | null>(null);
  const [mineHasMore, setMineHasMore] = useState(true);
  const minePageRef = useRef(1);
  const mineLoadedRef = useRef(false);
  const mineGridRef = useRef<HTMLDivElement>(null);

  const [detailTarget, setDetailTarget] = useState<SkillRecord | null>(null);
  const [detailContent, setDetailContent] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const [createTab, setCreateTab] = useState<'edit' | 'upload'>('edit');
  const [skillContent, setSkillContent] = useState(SKILL_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const mdInputRef = useRef<HTMLInputElement>(null);

  const currentSort = sortOptions.find((s) => s.key === sortKey);

  const coverLibrary = libraryList.filter((s) => s.cover_url);
  const coverMine = mySkills.filter((s) => s.cover_url);

  const nameFilled = /^name:[ \t]*\S/m.test(skillContent);
  const descFilled = /^description:[ \t]*\S/m.test(skillContent);
  const canSave = nameFilled && descFilled && !saving;

  useEffect(() => {
    if (!open) {
      setRemovalTarget(null);
      return;
    }
    libPageRef.current = 1;
    setLibraryList([]);
    setLibraryHasMore(true);
    mineLoadedRef.current = false;
    minePageRef.current = 1;
    setMySkills([]);
    setMineHasMore(true);
    fetchSkillCategories()
      .then((list) => {
        setCategoryList(list);
        setCategory((prev) => (prev !== 'all' && !list.includes(prev) ? 'all' : prev));
      })
      .catch(() => setCategoryList([]));
  }, [open]);

  const loadLibrary = useCallback(
    async (pageNum: number, append: boolean) => {
      setLibraryLoading(true);
      try {
        const data = await fetchSkillLibrary({
          pageNum,
          pageSize: PAGE_SIZE,
          keyword: searchQuery.trim() || undefined,
          category,
          sort: sortKey,
          lang: LANG,
        });
        if (!append) libPageRef.current = pageNum;
        libPageRef.current = Math.max(libPageRef.current, data.current);
        setLibraryList((prev) => (append ? [...prev, ...data.records] : data.records));
        setLibraryHasMore(data.records.length >= PAGE_SIZE && data.current * PAGE_SIZE < data.total);
      } catch (e) {
        console.warn('加载技能库失败:', e);
        window.alert(errMsg(e));
      } finally {
        setLibraryLoading(false);
      }
    },
    [searchQuery, category, sortKey],
  );

  useEffect(() => {
    if (!open) return;
    loadLibrary(1, false);
  }, [open, loadLibrary]);

  const handleLibraryScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (libraryLoading || !libraryHasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      loadLibrary(libPageRef.current + 1, true);
    }
  };

  const loadMySkills = useCallback(async (pageNum: number) => {
    try {
      const data = await fetchMySkills(pageNum, PAGE_SIZE);
      minePageRef.current = Math.max(minePageRef.current, data.current);
      mineLoadedRef.current = true;
      setMySkills((prev) => (pageNum === 1 ? data.records : [...prev, ...data.records]));
      setMineHasMore(data.records.length >= PAGE_SIZE && data.current * PAGE_SIZE < data.total);
    } catch (e) {
      console.warn('加载我的技能失败:', e);
      window.alert(errMsg(e));
    }
  }, []);

  useEffect(() => {
    if (open && tab === 'mine' && !mineLoadedRef.current) loadMySkills(1);
  }, [open, tab, loadMySkills]);

  const handleMineScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!mineHasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      loadMySkills(minePageRef.current + 1);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (removalTarget) return;
      if (detailTarget) {
        setDetailTarget(null);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, detailTarget, removalTarget, onClose]);

  if (!open) return null;

  function SkillMarkdown({ text }: { text: string }) {
    return (
      <div className={styles.md}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: ({ children }) => (
              <div className={styles.mdTableWrap}>
                <table>{children}</table>
              </div>
            ),
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    );
  }

  const handleAddSkill = (s: SkillRecord) => {
    if (!s.creative_skill_id || s.added) return;
    const id = s.creative_skill_id;
    setLibraryList((prev) => prev.map((r) => (r.creative_skill_id === id ? { ...r, added: true } : r)));
    addLibrarySkill(id)
      .then(() => {
        mineLoadedRef.current = false;
      })
      .catch((e) => {
        setLibraryList((prev) => prev.map((r) => (r.creative_skill_id === id ? { ...r, added: false } : r)));
        window.alert(errMsg(e));
      });
  };

  const handleDeletePersonal = (s: SkillRecord) => {
    if (!s.creative_skill_id) return;
    setRemovalTarget(s);
  };

  const handleRemoveOfficial = (s: SkillRecord) => {
    if (!s.creative_skill_id) return;
    setRemovalTarget(s);
  };

  const confirmRemoval = () => {
    const target = removalTarget;
    const id = target?.creative_skill_id;
    if (!target || !id) return;

    setRemovalTarget(null);
    const request = target.asset_domain === 'personal' ? deletePersonalSkill(id) : removeMySkill(id);
    request
      .then(() => {
        setMySkills((prev) => prev.filter((skill) => skill.creative_skill_id !== id));
        setLibraryList((prev) =>
          prev.map((skill) => (skill.creative_skill_id === id ? { ...skill, added: false } : skill)),
        );
      })
      .catch((e) => window.alert(errMsg(e)));
  };

  const openDetail = (s: SkillRecord) => {
    const id = s.creative_skill_id;
    if (!id) return;
    setDetailTarget(s);
    setDetailLoading(true);
    setDetailContent('');
    const request = s.asset_domain === 'personal' ? fetchPersonalSkill(id) : fetchSkillContent(id);
    request
      .then((data) => setDetailContent(data.content))
      .catch((e) => window.alert(errMsg(e)))
      .finally(() => setDetailLoading(false));
  };

  const useDetailSkill = () => {
    const s = detailTarget;
    if (!s?.creative_skill_id) return;
    setDetailTarget(null);
    onUseSkill?.(s);
  };

  const handleMdSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setSkillContent(text);
      setCreateTab('edit');
    });
    e.target.value = '';
  };

  const handleAiFormat = () => {
    if (formatting || !skillContent.trim()) return;
    setFormatting(true);
    formatPersonalSkill(skillContent)
      .then((data) => setSkillContent(data.content))
      .catch((e) => window.alert(errMsg(e)))
      .finally(() => setFormatting(false));
  };

  const handleSaveSkill = () => {
    if (!canSave) return;
    setSaving(true);
    createPersonalSkill(skillContent)
      .then(() => {
        setSkillContent(SKILL_TEMPLATE);
        mineLoadedRef.current = false;
        setTab('mine');
      })
      .catch((e) => window.alert(errMsg(e)))
      .finally(() => setSaving(false));
  };

  return createPortal(
    <>
      <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {}
        <div className={styles.header}>
          <Tabs
            className={styles.tabs}
            triggerClassName={styles.tab}
            activeTriggerClassName={styles.tabActive}
            value={tab === 'create' ? '' : tab}
            onChange={setTab}
            items={[
              {
                key: 'library',
                label: (
                  <>
                    <Store size={15} strokeWidth={2} />
                    <span>技能库</span>
                  </>
                ),
              },
              {
                key: 'mine',
                label: (
                  <>
                    <BookMarked size={15} strokeWidth={2} />
                    <span>我的技能</span>
                  </>
                ),
              },
            ]}
          />
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {}
        {tab === 'library' && (
          <>
            <div className={styles.libToolbar}>
              <SearchInput
                className={styles.searchWrap}
                variant="field"
                placeholder="搜索技能"
                value={searchInput}
                onChange={setSearchInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSearchQuery(searchInput);
                }}
              />
              <button className={styles.searchBtn} onClick={() => setSearchQuery(searchInput)}>
                搜索
              </button>
              <div className={styles.sortWrap}>
                <Select
                  value={sortKey}
                  onChange={(next) => setSortKey(next as (typeof sortOptions)[number]['key'])}
                  size="sm"
                  side="bottom"
                  ariaLabel="排序方式"
                  triggerClassName={styles.sortBtn}
                  triggerRender={
                    <>
                      <span className={styles.sortLabel}>排序</span>
                      <span>{currentSort?.label}</span>
                    </>
                  }
                  options={sortOptions.map((opt) => ({ value: opt.key, label: opt.label }))}
                />
              </div>
            </div>

            <div className={styles.catRow}>
              <button
                className={`${styles.catChip} ${category === 'all' ? styles.catChipActive : ''}`}
                onClick={() => setCategory('all')}
              >
                全部
              </button>
              {categoryList.map((c) => (
                <button
                  key={c}
                  className={`${styles.catChip} ${category === c ? styles.catChipActive : ''}`}
                  onClick={() => setCategory(c)}
                >
                  {LEGACY_CATEGORY_LABELS[c] ?? c}
                </button>
              ))}
            </div>

            <div ref={libGridRef} className={styles.cardGrid} onScroll={handleLibraryScroll}>
              {coverLibrary.map((s) => {
                const added = !!s.added;
                const sid = s.creative_skill_id ?? s.name ?? '';
                return (
                  <div key={sid} className={styles.card}>
                    <div className={styles.cardMenu}>
                      <DropdownMenu
                        trigger={
                          <button className={styles.menuBtn} type="button" title="更多操作">
                            <MoreHorizontal size={14} strokeWidth={2} />
                          </button>
                        }
                        items={[
                          {
                            key: 'view',
                            title: '查看技能详情',
                            label: (
                              <>
                                <Eye size={13} strokeWidth={2} />
                                <span>查看</span>
                              </>
                            ),
                            onSelect: () => openDetail(s),
                          },
                        ]}
                      />
                    </div>
                    <img className={styles.coverImg} src={resolveMediaSrc(s.cover_url)} crossOrigin={remoteImageCrossOrigin(s.cover_url)} alt={s.name ?? ''} />
                    <div className={styles.cardBody}>
                      <h4 className={styles.cardTitle}>{s.name ?? ''}</h4>
                      <p className={styles.cardDesc} title={s.description ?? ''}>{s.description ?? ''}</p>
                      <div className={styles.cardFooter}>
                        <span className={styles.cardMeta}>{s.usage_count ?? 0} 人使用 @Blue Whale</span>
                        <button
                          className={styles.cardAction}
                          onClick={() => s.creative_skill_id && onUseSkill?.(s)}
                          title={s.creative_skill_id ? '直接使用（强制激活该技能）' : '该技能暂不可直接使用'}
                        >
                          <AtSign size={12} strokeWidth={2} />
                          <span>直接使用</span>
                        </button>
                        <button
                          className={`${styles.cardAction} ${added ? styles.cardActionDone : ''}`}
                          onClick={() => handleAddSkill(s)}
                        >
                          {added ? '已添加' : '添加'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {coverLibrary.length === 0 && !libraryLoading && (
                <div className={styles.emptyTip}>没有找到相关技能</div>
              )}
              {libraryLoading && <div className={styles.emptyTip}>加载中…</div>}
            </div>
          </>
        )}

        {tab === 'mine' && (
          <div className={styles.mineWrap}>
            {mineLoadedRef.current && coverMine.length === 0 ? (
              <div className={styles.mineEmpty}>
                <Empty
                  icon={
                    <span className={styles.mineEmptyIcon} aria-hidden="true">
                      <Sparkles size={22} strokeWidth={1.8} />
                    </span>
                  }
                  title="暂无技能"
                  description="前往技能库，添加你需要的技能"
                  action={
                    <button className={styles.emptyAction} onClick={() => setTab('library')}>
                      去技能库
                    </button>
                  }
                />
              </div>
            ) : (
              <>
                <div ref={mineGridRef} className={styles.cardGrid} onScroll={handleMineScroll}>
                  {coverMine.map((s) => {
                  const sid = s.creative_skill_id ?? s.name ?? '';
                  return (
                    <div key={sid} className={styles.card}>
                      <div className={styles.cardMenu}>
                        <DropdownMenu
                          trigger={
                            <button className={styles.menuBtn} type="button" title="更多操作">
                              <MoreHorizontal size={14} strokeWidth={2} />
                            </button>
                          }
                          items={[
                            {
                              key: 'view',
                              title: '查看技能详情',
                              label: (
                                <>
                                  <Eye size={13} strokeWidth={2} />
                                  <span>查看</span>
                                </>
                              ),
                              onSelect: () => openDetail(s),
                            },
                          ]}
                        />
                      </div>
                      <img className={styles.coverImg} src={resolveMediaSrc(s.cover_url)} crossOrigin={remoteImageCrossOrigin(s.cover_url)} alt={s.name ?? ''} />
                      <div className={styles.cardBody}>
                        <div className={styles.cardTitleRow}>
                          <h4 className={styles.cardTitle}>{s.name ?? ''}</h4>
                          {s.asset_domain === 'official' && <span className={styles.officialTag}>官方</span>}
                          {s.asset_domain === 'official' && (
                            <button
                              className={styles.cardAction}
                              onClick={() => handleRemoveOfficial(s)}
                              title="从我的技能移除"
                            >
                              <span>移除</span>
                            </button>
                          )}
                          {s.asset_domain === 'personal' && (
                            <button
                              className={styles.cardAction}
                              onClick={() => handleDeletePersonal(s)}
                              title="删除个人技能"
                            >
                              <span>删除</span>
                            </button>
                          )}
                        </div>
                        <p className={styles.cardDesc} title={s.description ?? ''}>{s.description ?? ''}</p>
                        <div className={`${styles.cardFooter} ${styles.cardFooterEnd}`}>
                          <button
                            className={styles.cardAction}
                            onClick={() => s.creative_skill_id && onUseSkill?.(s)}
                            title={s.creative_skill_id ? '直接使用（强制激活该技能）' : '该技能暂不可直接使用'}
                          >
                            <AtSign size={12} strokeWidth={2} />
                            <span>直接使用</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
                <div className={styles.noMore}>{mineHasMore ? '滚动加载更多' : '没有更多了'}</div>
              </>
            )}
          </div>
        )}

        {}
        {tab === 'create' && (
          <div className={styles.createWrap}>
            <div className={styles.createToolbar}>
              <div className={styles.createLeft}>
                <button
                  className={`${styles.createTab} ${createTab === 'edit' ? styles.createTabActive : ''}`}
                  onClick={() => setCreateTab('edit')}
                >
                  编写
                </button>
                <button
                  className={`${styles.createTab} ${createTab === 'upload' ? styles.createTabActive : ''}`}
                  onClick={() => setCreateTab('upload')}
                >
                  上传 SKILL.md
                </button>
              </div>
              <div className={styles.createRight}>
                <button className={styles.aiFormatBtn} onClick={handleAiFormat} disabled={formatting}>
                  <Sparkles size={14} strokeWidth={2} />
                  <span>{formatting ? '格式化中…' : 'AI 格式化'}</span>
                </button>
                <button
                  className={`${styles.saveBtn} ${canSave ? styles.saveBtnActive : ''}`}
                  onClick={handleSaveSkill}
                  disabled={!canSave}
                >
                  <Check size={14} strokeWidth={2} />
                  <span>{saving ? '保存中…' : '保存到我的技能'}</span>
                </button>
              </div>
            </div>

            {createTab === 'edit' ? (
              <textarea
                className={styles.skillEditor}
                value={skillContent}
                onChange={(e) => setSkillContent(e.target.value)}
                spellCheck={false}
              />
            ) : (
              <div className={styles.uploadZone} onClick={() => mdInputRef.current?.click()}>
                <Upload size={28} strokeWidth={1.5} />
                <span className={styles.uploadTitle}>点击上传 SKILL.md 文件</span>
                <span className={styles.uploadHint}>支持用户自定义技能，上传后自动解析名称与描述</span>
              </div>
            )}
            <input
              ref={mdInputRef}
              type="file"
              accept=".md,text/markdown"
              className={styles.hiddenInput}
              onChange={handleMdSelect}
            />
          </div>
        )}

        <ConfirmModal
          open={removalTarget !== null}
          title={removalTarget?.asset_domain === 'personal' ? '删除个人技能' : '移除技能'}
          message={
            removalTarget?.asset_domain === 'personal'
              ? `确认删除个人技能「${removalTarget.name ?? ''}」？删除后不可恢复。`
              : `确认从「我的技能」移除「${removalTarget?.name ?? ''}」？`
          }
          confirmText={removalTarget?.asset_domain === 'personal' ? '删除' : '移除'}
          onConfirm={confirmRemoval}
          onCancel={() => setRemovalTarget(null)}
        />
      </div>
    </div>
      {}
      {detailTarget && (
        <div className={styles.detailOverlay} onClick={() => setDetailTarget(null)}>
          <div className={styles.detailModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.detailHeader}>
              <div className={styles.detailTitle}>
                <h3 className={styles.detailName}>{detailTarget.name ?? ''}</h3>
                {detailTarget.asset_domain === 'official' && <span className={styles.officialTag}>官方</span>}
              </div>
              <div className={styles.detailActions}>
                <button
                  className={`${styles.cardAction} ${styles.detailUseBtn}`}
                  onClick={useDetailSkill}
                  title={detailTarget.creative_skill_id ? '直接使用（强制激活该技能）' : '该技能暂不可直接使用'}
                >
                  <AtSign size={12} strokeWidth={2} />
                  <span>使用</span>
                </button>
                <button className={styles.closeBtn} onClick={() => setDetailTarget(null)} title="关闭">
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
            </div>
            <div className={styles.detailBody}>
              {detailLoading ? (
                <div className={styles.emptyTip}>加载中…</div>
              ) : (
                <SkillMarkdown text={detailContent} />
              )}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
