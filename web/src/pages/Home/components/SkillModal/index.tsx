/* ============================================
 * SkillModal 技能弹窗：我的技能/技能库/创建技能三标签
 * 技能库/我的技能走 /api/agent/skills 接口，滚动分页加载
 * ============================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Plus,
  Search,
  ChevronDown,
  Store,
  BookMarked,
  AtSign,
  Sparkles,
  Check,
  Upload,
} from 'lucide-react';
import styles from './index.module.css';
import {
  fetchSkillLibrary,
  addLibrarySkill,
  fetchMySkills,
  deletePersonalSkill,
  createPersonalSkill,
  formatPersonalSkill,
  type SkillRecord,
} from '@/api/skills';
import { isApiError } from '@/api/http';

interface SkillModalProps {
  open: boolean;
  onClose: () => void;
  /** 用户点击「直接使用」：宿主决定去向（AgentPanel 置一次性强制技能 / Home 跳画布携带技能意图） */
  onUseSkill?: (skill: SkillRecord) => void;
}

/** 每页数量 */
const PAGE_SIZE = 50;

/** 语言：默认按 navigator.language 检测 */
const LANG: 'zh' | 'en' = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';

/** 排序选项（key 对应接口 sort 参数） */
const sortOptions = [
  { key: 'featured', label: '精选' },
  { key: 'most_used', label: '最多使用' },
  { key: 'newest', label: '最新发布' },
] as const;

/** 接口错误提示（透传后端 msg） */
function errMsg(e: unknown): string {
  return isApiError(e) ? e.message : '请求失败，请稍后重试';
}

/** SKILL.md 初始模板 */
const SKILL_TEMPLATE = `---
name:
description:
---
`;

export default function SkillModal({ open, onClose, onUseSkill }: SkillModalProps) {
  const [tab, setTab] = useState<'mine' | 'library' | 'create'>('library');

  /* ---- 技能库状态 ---- */
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<(typeof sortOptions)[number]['key']>('featured');
  const [sortOpen, setSortOpen] = useState(false);
  const [libraryList, setLibraryList] = useState<SkillRecord[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryHasMore, setLibraryHasMore] = useState(true);
  const libPageRef = useRef(1);
  const libGridRef = useRef<HTMLDivElement>(null);

  /* ---- 我的技能状态 ---- */
  const [mySkills, setMySkills] = useState<SkillRecord[]>([]);
  const [mineHasMore, setMineHasMore] = useState(true);
  const minePageRef = useRef(1);
  const mineLoadedRef = useRef(false);
  const mineGridRef = useRef<HTMLDivElement>(null);

  /* ---- 创建技能状态 ---- */
  const [createTab, setCreateTab] = useState<'edit' | 'upload'>('edit');
  const [skillContent, setSkillContent] = useState(SKILL_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const mdInputRef = useRef<HTMLInputElement>(null);

  const currentSort = sortOptions.find((s) => s.key === sortKey);

  /** 产品要求：无封面 skill 整卡隐藏，列表只展示有 cover_url 的 */
  const coverLibrary = libraryList.filter((s) => s.cover_url);
  const coverMine = mySkills.filter((s) => s.cover_url);

  /** name / description 是否已填写（同一行存在非空内容） */
  const nameFilled = /^name:[ \t]*\S/m.test(skillContent);
  const descFilled = /^description:[ \t]*\S/m.test(skillContent);
  /** 两项都不是初始状态时才允许保存 */
  const canSave = nameFilled && descFilled && !saving;

  /** 弹框打开时重置两个列表，重新拉取 */
  useEffect(() => {
    if (!open) return;
    libPageRef.current = 1;
    setLibraryList([]);
    setLibraryHasMore(true);
    mineLoadedRef.current = false;
    minePageRef.current = 1;
    setMySkills([]);
    setMineHasMore(true);
  }, [open]);

  /** 加载技能库指定页（append=true 追加，否则重置） */
  const loadLibrary = useCallback(
    async (pageNum: number, append: boolean) => {
      setLibraryLoading(true);
      try {
        const data = await fetchSkillLibrary({
          pageNum,
          pageSize: PAGE_SIZE,
          keyword: searchQuery.trim() || undefined,
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
    [searchQuery, sortKey],
  );

  /** 筛选/排序/搜索变化时重新拉取第一页 */
  useEffect(() => {
    if (!open) return;
    loadLibrary(1, false);
  }, [open, loadLibrary]);

  /** 技能库滚动加载下一页 */
  const handleLibraryScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (libraryLoading || !libraryHasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      loadLibrary(libPageRef.current + 1, true);
    }
  };

  /** 加载我的技能（进入 Tab 或滚动分页时） */
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

  /** 我的技能滚动加载下一页 */
  const handleMineScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!mineHasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      loadMySkills(minePageRef.current + 1);
    }
  };

  if (!open) return null;

  /** 添加技能到「我的」（接口仅提供 add，已添加时不重复请求） */
  const handleAddSkill = (s: SkillRecord) => {
    if (!s.creative_skill_id || s.added) return;
    const id = s.creative_skill_id;
    // 乐观更新，失败回滚
    setLibraryList((prev) => prev.map((r) => (r.creative_skill_id === id ? { ...r, added: true } : r)));
    addLibrarySkill(id).catch((e) => {
      setLibraryList((prev) => prev.map((r) => (r.creative_skill_id === id ? { ...r, added: false } : r)));
      window.alert(errMsg(e));
    });
  };

  /** 删除个人技能（永久删除，需确认） */
  const handleDeletePersonal = (s: SkillRecord) => {
    if (!s.creative_skill_id) return;
    const id = s.creative_skill_id;
    if (!window.confirm(`确认删除个人技能「${s.name ?? ''}」？删除后不可恢复。`)) return;
    deletePersonalSkill(id)
      .then(() => setMySkills((prev) => prev.filter((r) => r.creative_skill_id !== id)))
      .catch((e) => window.alert(errMsg(e)));
  };

  /** 上传 SKILL.md */
  const handleMdSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setSkillContent(text);
      setCreateTab('edit');
    });
    e.target.value = '';
  };

  /** AI 格式化：调用后端接口返回完整替换文本 */
  const handleAiFormat = () => {
    if (formatting || !skillContent.trim()) return;
    setFormatting(true);
    formatPersonalSkill(skillContent)
      .then((data) => setSkillContent(data.content))
      .catch((e) => window.alert(errMsg(e)))
      .finally(() => setFormatting(false));
  };

  /** 保存到我的技能：提交完整 SKILL.md 文本创建个人技能 */
  const handleSaveSkill = () => {
    if (!canSave) return;
    setSaving(true);
    createPersonalSkill(skillContent)
      .then(() => {
        setSkillContent(SKILL_TEMPLATE);
        mineLoadedRef.current = false; // 切回「我的技能」时重新拉取
        setTab('mine');
      })
      .catch((e) => window.alert(errMsg(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 头部标签栏 */}
        <div className={styles.header}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === 'mine' ? styles.tabActive : ''}`}
              onClick={() => setTab('mine')}
            >
              <BookMarked size={15} strokeWidth={2} />
              <span>我的技能</span>
            </button>
            <button
              className={`${styles.tab} ${tab === 'library' ? styles.tabActive : ''}`}
              onClick={() => setTab('library')}
            >
              <Store size={15} strokeWidth={2} />
              <span>技能库</span>
            </button>
            <button
              className={`${styles.tab} ${tab === 'create' ? styles.tabActive : ''}`}
              onClick={() => setTab('create')}
            >
              <Plus size={15} strokeWidth={2} />
              <span>创建技能</span>
            </button>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* ============ 技能库 ============ */}
        {tab === 'library' && (
          <>
            <div className={styles.libToolbar}>
              <div className={styles.searchWrap}>
                <Search size={15} strokeWidth={2} className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  placeholder="搜索技能"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSearchQuery(searchInput);
                  }}
                />
              </div>
              <button className={styles.searchBtn} onClick={() => setSearchQuery(searchInput)}>
                搜索
              </button>
              <div className={styles.sortWrap}>
                <button className={styles.sortBtn} onClick={() => setSortOpen(!sortOpen)}>
                  <span className={styles.sortLabel}>排序</span>
                  <span>{currentSort?.label}</span>
                  <ChevronDown
                    size={13}
                    strokeWidth={2}
                    className={`${styles.sortArrow} ${sortOpen ? styles.sortArrowUp : ''}`}
                  />
                </button>
                {sortOpen && (
                  <div className={styles.sortDropdown}>
                    {sortOptions.map((opt) => (
                      <button
                        key={opt.key}
                        className={`${styles.sortOption} ${opt.key === sortKey ? styles.sortOptionActive : ''}`}
                        onClick={() => {
                          setSortKey(opt.key);
                          setSortOpen(false);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div ref={libGridRef} className={styles.cardGrid} onScroll={handleLibraryScroll}>
              {coverLibrary.map((s) => {
                const added = !!s.added;
                const sid = s.creative_skill_id ?? s.name ?? '';
                return (
                  <div key={sid} className={styles.card}>
                    <img className={styles.coverImg} src={s.cover_url!} alt={s.name ?? ''} />
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

        {/* ============ 我的技能 ============ */}
        {tab === 'mine' && (
          <div className={styles.mineWrap}>
            <div ref={mineGridRef} className={styles.cardGrid} onScroll={handleMineScroll}>
              {coverMine.map((s) => {
                const sid = s.creative_skill_id ?? s.name ?? '';
                return (
                  <div key={sid} className={styles.card}>
                    <img className={styles.coverImg} src={s.cover_url!} alt={s.name ?? ''} />
                    <div className={styles.cardBody}>
                      <div className={styles.cardTitleRow}>
                        <h4 className={styles.cardTitle}>{s.name ?? ''}</h4>
                        {s.asset_domain === 'official' && <span className={styles.officialTag}>官方</span>}
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
          </div>
        )}

        {/* ============ 创建技能 ============ */}
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
      </div>
    </div>
  );
}
