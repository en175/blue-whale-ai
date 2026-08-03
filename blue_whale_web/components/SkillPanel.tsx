"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AtSign,
  BookMarked,
  Check,
  ChevronDown,
  Plus,
  Search,
  Store,
  X,
} from "lucide-react";
import {
  skillsApi,
  type SkillLibraryCategory,
  type SkillLibraryItem,
  type SkillLibraryLang,
  type SkillLibrarySort,
  type SkillMineItem,
} from "./api/skills";
import { rememberCreativeSkillName } from "@/lib/creative-skill-names";
import { generateSkillCover } from "@/lib/skill-cover";

/**
 * Skill 面板（IJZ7Z8；IK60WT 改三页签近全屏工作区 + 官方技能库浏览）。
 *
 * 三页签：我的技能 / 技能库 / 创建技能（占位）。每次打开默认进技能库；
 * 关闭时整棵卸载 → 技能库查询与滚动状态重置。打开期间页签首次激活才挂载、
 * 之后保持挂载（hidden），切换页签不丢查询与滚动状态。
 * - 「我的技能」：mine API（POST 分页，join skill 返完整内容快照 + auto）。本票只做
 *   视觉一致性调整（移除无菜单的占位省略号按钮、窄屏网格防横向溢出），功能归 05 工单。
 * - 「技能库」：library API（POST 分页，keyword + category + sort + lang，
 *   IO + sentinel 无限滚动，reqId 防过期），竖版卡片网格（3/2/1 列）。
 * add/remove 在 library tab 内（乐观 + 回滚）；auto 在 my tab 内（乐观 + 回滚）。
 * 封面取 cover_url，空走默认图。Use 传 skill.name（forced_skill_id 真接入原依赖 IJZ7Z7；
 * IJZ7Z7 已由 IK2D8R 替代，见 docs/wayfinder/IK2D8R-first-runtime-bundle-migration.md）。
 *
 * 交互（IK60WT）：背景滚动锁定 + 焦点陷阱 + 初始焦点落面板 + 关闭后焦点还触发按钮；
 * 关闭三路径：ESC / 遮罩按压（onMouseDown 范式，规避拖选误关 IK2AKU）/ 右上 X。
 */

const COVER_PLACEHOLDER =
  "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill";
const PAGE_SIZE = 50;

/** SKILL.md 编辑器初始模板（IK60WU）。 */
const SKILL_MD_TEMPLATE = `---
name: 
description: 
---

`;

const CATEGORY_OPTIONS: { key: SkillLibraryCategory; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "film", label: "影视" },
  { key: "marketing", label: "营销" },
  { key: "other", label: "其他" },
];

const SORT_OPTIONS: { key: SkillLibrarySort; label: string }[] = [
  { key: "featured", label: "精选" },
  { key: "most_used", label: "最多使用" },
  { key: "newest", label: "最新发布" },
];

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** library lang 参数：navigator.language 以 zh 开头 → zh，其余 → en（契约 §11.5） */
function detectLibraryLang(): SkillLibraryLang {
  if (typeof navigator === "undefined") return "zh";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** Use 选择：稳定 Creative Skill 身份（可空，库外项无）+ 展示名。 */
export type UseSkillSelection = {
  creative_skill_id: string | null;
  name: string;
};

interface SkillPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onUseSkill: (skill: UseSkillSelection) => void;
}

type TabKey = "my" | "library" | "create";

export default function SkillPanel({
  isOpen,
  onClose,
  onUseSkill,
}: SkillPanelProps) {
  // 关闭时整棵卸载：打开会话状态（页签、技能库查询/滚动）随之重置
  if (!isOpen) return null;
  return <SkillPanelDialog onClose={onClose} onUseSkill={onUseSkill} />;
}

function SkillPanelDialog({
  onClose,
  onUseSkill,
}: Omit<SkillPanelProps, "isOpen">) {
  const [activeTab, setActiveTab] = useState<TabKey>("library");
  // 页签首次激活才挂载，之后保持挂载（hidden）以保留查询与滚动状态
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<TabKey>>(
    () => new Set<TabKey>(["library"]),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const createDirtyRef = useRef<() => boolean>(() => false);
  const [myRefreshTrigger, setMyRefreshTrigger] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const confirmDirtyClose = (): boolean => {
    if (mountedTabs.has("create") && createDirtyRef.current()) {
      return window.confirm("放弃当前草稿？");
    }
    return true;
  };

  const switchTab = (tab: TabKey) => {
    if (activeTab === "create" && tab !== "create" && !confirmDirtyClose())
      return;
    setActiveTab(tab);
    setMountedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  };

  const handleClose = () => {
    if (!confirmDirtyClose()) return;
    onClose();
  };

  const handleSkillSaved = () => {
    setMyRefreshTrigger((v) => v + 1);
    setToast("技能已保存");
    setTimeout(() => setToast(null), 3000);
    setActiveTab("my");
    setMountedTabs((prev) => (prev.has("my") ? prev : new Set(prev).add("my")));
  };

  // 打开生命周期：记录触发元素、锁定背景滚动、初始焦点落到面板；
  // 卸载（关闭）时恢复滚动、焦点还给触发按钮
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  // ESC 关闭（排序下拉等内部控件先消费并 stopPropagation 时不会冒到 window）
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // 焦点陷阱：Tab / Shift+Tab 在面板内循环（hidden 页签内元素不参与）
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const root = panelRef.current;
    if (!root) return;
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((n) => n.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    const outside = !active || !root.contains(active);
    if (e.shiftKey ? outside || active === first : outside || active === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };

  const tabBtn = (
    tab: TabKey,
    Icon: React.ComponentType<{ size?: number; className?: string }>,
    label: string,
  ) => {
    const selected = activeTab === tab;
    return (
      <button
        key={tab}
        type="button"
        data-testid={`skill-tab-${tab}`}
        className={`tc-agent-skill-panel__tab inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium rounded-lg transition-colors duration-150 ${
          selected
            ? "tc-agent-skill-panel__tab--selected text-white/95"
            : "text-white/45 hover:text-white/70 hover:bg-white/[0.05]"
        }`}
        role="tab"
        aria-selected={selected}
        onClick={() => switchTab(tab)}
      >
        <span className="tc-agent-skill-panel__tab-icon">
          <Icon size={14} />
        </span>
        <span className="tc-agent-skill-panel__tab-label">{label}</span>
      </button>
    );
  };

  return (
    <div
      className="tc-agent-skill-modal-backdrop fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none"
      onMouseDown={(e) => {
        // 遮罩按压关闭用 onMouseDown 而非 onClick：拖选文本移出面板后松开不误关（IK2AKU）；
        // preventDefault：阻止 mousedown 默认焦点转移（事件后浏览器会把焦点 blur 到 body），
        // 否则卸载 cleanup 里的焦点还给触发按钮会被随后的默认行为覆盖（IK60WT 焦点恢复验收）
        if (e.button === 0) {
          e.preventDefault();
          handleClose();
        }
      }}
    >
      <div
        id="home-canvas-skill-panel"
        ref={panelRef}
        tabIndex={-1}
        data-testid="skill-panel"
        className="tc-agent-skill-panel bg-[#141414] border border-white/[0.12] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.5)] w-[calc(100vw-64px)] h-[calc(100vh-64px)] flex flex-col overflow-hidden focus:outline-none animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
        role="dialog"
        aria-modal="true"
        aria-label="技能面板"
        onKeyDown={trapTab}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tc-agent-skill-panel__header flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
          <div
            className="tc-agent-skill-panel__tabs flex items-center gap-1"
            role="tablist"
            aria-label="技能视图"
          >
            {tabBtn("my", BookMarked, "我的技能")}
            {tabBtn("library", Store, "技能库")}
            {tabBtn("create", Plus, "创建技能")}
          </div>
          <button
            type="button"
            data-testid="skill-panel-close"
            className="tc-agent-skill-panel__icon-btn inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors duration-150"
            aria-label="关闭技能面板"
            onClick={handleClose}
          >
            <X size={16} />
          </button>
        </div>

        {toast && (
          <div className="flex items-center gap-2 px-4 py-2 text-[12px] text-white/80 bg-success/10 border-b border-success/20">
            <Check size={14} className="text-success" />
            {toast}
          </div>
        )}

        {mountedTabs.has("my") && (
          <TabPane visible={activeTab === "my"}>
            <MyContent onUse={onUseSkill} refreshTrigger={myRefreshTrigger} />
          </TabPane>
        )}
        {mountedTabs.has("library") && (
          <TabPane visible={activeTab === "library"}>
            <LibraryContent onUse={onUseSkill} />
          </TabPane>
        )}
        {mountedTabs.has("create") && (
          <TabPane visible={activeTab === "create"}>
            <CreateContent
              onSaved={handleSkillSaved}
              registerDirtyCheck={(fn) => {
                createDirtyRef.current = fn;
              }}
            />
          </TabPane>
        )}
      </div>
    </div>
  );
}

/** 页签容器：保持挂载，仅切换可见性（保留列表数据与滚动位置） */
function TabPane({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      className={
        visible ? "flex flex-col flex-1 min-h-0 overflow-hidden" : "hidden"
      }
    >
      {children}
    </div>
  );
}

/** 创建技能：SKILL.md 编辑器（IK60WU）。
 *  用户编写含 YAML frontmatter 的完整 SKILL.md，显式保存创建个人技能。
 *  草稿在 tab 切换/面板关闭时保留；脏草稿离开需确认。 */
function CreateContent({
  onSaved,
  registerDirtyCheck,
}: {
  onSaved: () => void;
  registerDirtyCheck: (fn: () => boolean) => void;
}) {
  const [draft, setDraft] = useState(SKILL_MD_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = draft !== SKILL_MD_TEMPLATE;

  useEffect(() => {
    registerDirtyCheck(() => draft !== SKILL_MD_TEMPLATE);
  }, [draft, registerDirtyCheck]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await skillsApi.createPersonalSkill(draft);
      setDraft(SKILL_MD_TEMPLATE);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="skill-create-editor"
      className="tc-agent-skill-panel__content flex flex-col flex-1 min-h-0 overflow-hidden bg-[#141414]"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.08]">
        <span className="text-[12px] text-white/40">
          编写 SKILL.md（name / description / 正文）
        </span>
        <button
          type="button"
          data-testid="skill-save-btn"
          disabled={saving || !isDirty}
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 h-8 px-3.5 text-[13px] font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <Check size={14} />
          保存到我的技能
        </button>
      </div>
      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-[12px] text-white/60 bg-white/[0.04] border-b border-white/[0.08]">
          <span className="truncate">{error}</span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2 hover:text-white/90"
            onClick={() => setError(null)}
          >
            关闭
          </button>
        </div>
      )}
      <textarea
        data-testid="skill-md-editor"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="skill-md-textarea flex-1 w-full resize-none bg-transparent p-4 text-[13px] leading-relaxed text-white/90 font-mono outline-none placeholder:text-white/30 overflow-y-auto"
        placeholder={SKILL_MD_TEMPLATE}
      />
    </div>
  );
}

/** 我的技能：分页 + 滚动加载 + auto 乐观开关（自管 state；refreshTrigger 变化重拉第 1 页） */
function MyContent({
  onUse,
  refreshTrigger = 0,
}: {
  onUse: (skill: UseSkillSelection) => void;
  refreshTrigger?: number;
}) {
  const [items, setItems] = useState<SkillMineItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const fetchPage = useCallback(async (pageNum: number, append: boolean) => {
    const id = ++reqId.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await skillsApi.mine({ pageNum, pageSize: PAGE_SIZE });
      if (id !== reqId.current) return; // 过期请求忽略
      for (const r of res.records) {
        rememberCreativeSkillName(r.creative_skill_id, r.name);
      }
      setItems((prev) => (append ? [...prev, ...res.records] : res.records));
      setPage(res.current);
      setHasMore(res.current * res.size < res.total);
    } catch (e) {
      if (id === reqId.current)
        setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (id === reqId.current) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, []);

  // 首屏 + refreshTrigger 变化（创建技能后刷新）：StrictMode dev 双 mount → 两次 fetchPage(1)，reqId 让首次响应失效
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 首屏分页数据获取（异步 loading）
    fetchPage(1, false);
  }, [fetchPage, refreshTrigger]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchPage(page + 1, true);
  }, [loading, loadingMore, hasMore, page, fetchPage]);

  // IO 只 mount 一次，回调走 ref（防 state 变 → loadMore 新引用 → IO 重连重复触发）
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // auto 开关：乐观切换，失败回滚（creative_skill_id 为 null 的行不触发，UI 已禁用）
  const handleToggleAuto = (creativeSkillId: string) => {
    const cur =
      items.find((s) => s.creative_skill_id === creativeSkillId)?.auto ?? false;
    const next = !cur;
    setItems((prev) =>
      prev.map((s) =>
        s.creative_skill_id === creativeSkillId ? { ...s, auto: next } : s,
      ),
    );
    skillsApi.setAuto(creativeSkillId, next).catch(() => {
      setItems((prev) =>
        prev.map((s) =>
          s.creative_skill_id === creativeSkillId ? { ...s, auto: cur } : s,
        ),
      );
      setError("自动开关更新失败，已回滚");
    });
  };

  return (
    <div className="tc-agent-skill-panel__content flex flex-col flex-1 min-h-0 overflow-hidden bg-[#141414]">
      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-[12px] text-white/60 bg-white/[0.04] border-b border-white/[0.08]">
          <span className="truncate">{error}</span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2 hover:text-white/90"
            onClick={() => {
              setError(null);
              fetchPage(page, false);
            }}
          >
            重试
          </button>
        </div>
      )}
      <div className="tc-agent-skill-panel__my-scroll flex-1 overflow-y-auto pt-4 px-[18px] pb-5">
        {loading ? (
          <StateHint text="加载中…" />
        ) : items.length === 0 ? (
          <StateHint text="还没有添加技能，去技能库逛逛。" />
        ) : (
          <div className="tc-agent-skill-panel__section-list grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map((skill, index) => (
              <MySkillRow
                key={skill.creative_skill_id ?? index}
                skill={skill}
                onToggleAuto={() =>
                  skill.creative_skill_id &&
                  handleToggleAuto(skill.creative_skill_id)
                }
                onUse={() =>
                  onUse({
                    creative_skill_id: skill.creative_skill_id ?? null,
                    name: skill.name ?? "",
                  })
                }
              />
            ))}
          </div>
        )}
        <div
          ref={sentinelRef}
          className="tc-agent-skill-panel__load-more-sentinel h-4"
          aria-hidden="true"
        />
        {loadingMore && (
          <div className="py-3 text-center text-[12px] text-white/40">
            加载更多…
          </div>
        )}
        {!hasMore && !loading && items.length > 0 && (
          <div className="py-3 text-center text-[12px] text-white/30">
            没有更多了
          </div>
        )}
      </div>
    </div>
  );
}

/** 技能库：分类 + 搜索 + 排序 + 分页滚动加载（自管 state） */
function LibraryContent({
  onUse,
}: {
  onUse: (skill: UseSkillSelection) => void;
}) {
  const [items, setItems] = useState<SkillLibraryItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [inputKw, setInputKw] = useState("");
  const [category, setCategory] = useState<SkillLibraryCategory>("all");
  const [sort, setSort] = useState<SkillLibrarySort>("featured");
  const [sortOpen, setSortOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean) => {
      const id = ++reqId.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await skillsApi.library({
          pageNum,
          pageSize: PAGE_SIZE,
          keyword: keyword || undefined,
          category,
          sort,
          lang: detectLibraryLang(),
        });
        if (id !== reqId.current) return; // 过期请求（查询条件已变）忽略
        for (const r of res.records) {
          rememberCreativeSkillName(r.creative_skill_id, r.name);
        }
        setItems((prev) => (append ? [...prev, ...res.records] : res.records));
        setPage(res.current);
        setHasMore(res.current * res.size < res.total);
      } catch (e) {
        if (id === reqId.current)
          setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (id === reqId.current) {
          if (append) setLoadingMore(false);
          else setLoading(false);
        }
      }
    },
    [keyword, category, sort],
  );

  // 首次 + 查询条件（keyword/category/sort）变 → 重置第 1 页
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 查询条件变重新分页获取
    fetchPage(1, false);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchPage(page + 1, true);
  }, [loading, loadingMore, hasMore, page, fetchPage]);

  // 滚动到底加载下一页。IO 只 mount 一次，回调走 ref 拿最新 loadMore
  // （否则 fetchPage 完成 state 变 → loadMore 新引用 → IO effect 重连 → sentinel 仍在视口时重复触发拉第二页）
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 排序下拉：点击面板内其他位置收起
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [sortOpen]);

  const handleAdd = (creativeSkillId: string) => {
    setItems((prev) =>
      prev.map((s) =>
        s.creative_skill_id === creativeSkillId ? { ...s, added: true } : s,
      ),
    );
    skillsApi.add(creativeSkillId).catch(() => {
      setItems((prev) =>
        prev.map((s) =>
          s.creative_skill_id === creativeSkillId ? { ...s, added: false } : s,
        ),
      );
      setError("添加失败，已回滚");
    });
  };

  const handleRemove = (creativeSkillId: string) => {
    setItems((prev) =>
      prev.map((s) =>
        s.creative_skill_id === creativeSkillId ? { ...s, added: false } : s,
      ),
    );
    skillsApi.remove(creativeSkillId).catch(() => {
      setItems((prev) =>
        prev.map((s) =>
          s.creative_skill_id === creativeSkillId ? { ...s, added: true } : s,
        ),
      );
      setError("移除失败，已回滚");
    });
  };

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(inputKw.trim());
  };

  const sortLabel = SORT_OPTIONS.find((o) => o.key === sort)?.label ?? "精选";

  return (
    <div className="tc-agent-skill-panel__content tc-agent-skill-panel__content--store flex-1 min-h-0 overflow-hidden flex flex-col">
      <div className="tc-agent-skill-panel__library-tools border-b border-white/[0.08]">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <form
            className="tc-agent-skill-panel__search-group flex flex-1 items-center gap-2"
            onSubmit={onSubmitSearch}
          >
            <label className="tc-agent-skill-panel__search flex flex-1 items-center gap-2 bg-white/[0.05] rounded-lg px-3 py-2 border border-white/[0.06]">
              <Search size={14} className="text-white/40" />
              <input
                type="text"
                data-testid="skill-search-input"
                className="bg-transparent outline-none text-[13px] text-white/90 placeholder:text-white/30 w-full"
                placeholder="搜索技能"
                value={inputKw}
                onChange={(e) => setInputKw(e.target.value)}
              />
            </label>
            <button
              type="submit"
              data-testid="skill-search-submit"
              className="tc-agent-skill-panel__search-submit h-8 px-3 text-[13px] font-medium text-white/80 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] transition-colors"
            >
              搜索
            </button>
          </form>
          <div
            className="tc-agent-skill-panel__sort relative"
            ref={sortRef}
            onKeyDown={(e) => {
              // 下拉打开时 ESC 先收下拉（stopPropagation 防冒到 window 关面板）
              if (e.key === "Escape" && sortOpen) {
                e.stopPropagation();
                setSortOpen(false);
              }
            }}
          >
            <button
              type="button"
              data-testid="skill-sort-trigger"
              className="tc-agent-skill-panel__sort-trigger inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-white/70 rounded-lg border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
              aria-label="排序方式"
              aria-expanded={sortOpen}
              aria-haspopup="menu"
              onClick={() => setSortOpen((v) => !v)}
            >
              <span className="tc-agent-skill-panel__sort-label">排序</span>
              <span className="tc-agent-skill-panel__sort-value text-white/90">
                {sortLabel}
              </span>
              <ChevronDown
                size={14}
                className={`transition-transform ${sortOpen ? "rotate-180" : ""}`}
              />
            </button>
            {sortOpen && (
              <div
                role="menu"
                aria-label="排序方式"
                className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-white/[0.1] bg-[#1c1c1c] py-1 shadow-[0_8px_30px_rgba(0,0,0,0.45)]"
              >
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={sort === o.key}
                    data-testid={`skill-sort-option-${o.key}`}
                    className={`flex w-full items-center px-3 py-1.5 text-left text-[12px] transition-colors ${
                      sort === o.key
                        ? "text-white bg-white/[0.08]"
                        : "text-white/60 hover:bg-white/[0.06] hover:text-white/90"
                    }`}
                    onClick={() => {
                      setSort(o.key);
                      setSortOpen(false);
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div
          className="tc-agent-skill-panel__categories flex items-center gap-2 px-4 pb-3"
          role="group"
          aria-label="技能分类"
        >
          {CATEGORY_OPTIONS.map((c) => {
            const selected = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                data-testid={`skill-category-chip-${c.key}`}
                aria-pressed={selected}
                className={`h-7 px-3 rounded-full text-[12px] font-medium transition-colors ${
                  selected
                    ? "bg-white/[0.14] text-white/90"
                    : "text-white/45 hover:text-white/75 hover:bg-white/[0.06]"
                }`}
                onClick={() => setCategory(c.key)}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-[12px] text-white/60 bg-white/[0.04] border-b border-white/[0.08]">
          <span className="truncate">{error}</span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2 hover:text-white/90"
            onClick={() => {
              setError(null);
              fetchPage(page, false);
            }}
          >
            重试
          </button>
        </div>
      )}

      <div className="tc-agent-skill-panel__store-scroll flex-1 overflow-y-auto overflow-x-hidden p-4">
        {loading ? (
          <StateHint text="加载中…" />
        ) : items.length === 0 ? (
          <StateHint text={keyword ? "没有匹配的技能。" : "技能库为空。"} />
        ) : (
          <div className="tc-agent-skill-panel__store-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((skill) => (
              <LibrarySkillCard
                key={skill.creative_skill_id ?? skill.name}
                skill={skill}
                onUse={() =>
                  onUse({
                    creative_skill_id: skill.creative_skill_id ?? null,
                    name: skill.name,
                  })
                }
                onAdd={() =>
                  skill.creative_skill_id && handleAdd(skill.creative_skill_id)
                }
                onRemove={() =>
                  skill.creative_skill_id &&
                  handleRemove(skill.creative_skill_id)
                }
              />
            ))}
          </div>
        )}
        <div
          ref={sentinelRef}
          className="tc-agent-skill-panel__load-more-sentinel h-4"
          aria-hidden="true"
        />
        {loadingMore && (
          <div className="py-3 text-center text-[12px] text-white/40">
            加载更多…
          </div>
        )}
        {!hasMore && !loading && items.length > 0 && (
          <div className="py-3 text-center text-[12px] text-white/30">
            没有更多了
          </div>
        )}
      </div>
    </div>
  );
}

function StateHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-[13px] text-white/40">
      {text}
    </div>
  );
}

function SkillCover({
  url,
  name,
}: {
  url?: string | null;
  name?: string | null;
}) {
  // cover_url 有值 → 背景图；空 + name 有值 → 确定性渐变 + 首字母（IK60WU）；否则默认图。
  if (!url && name) {
    const { gradient, initials } = generateSkillCover(name);
    return (
      <span
        className="tc-agent-skill-row__cover flex items-center justify-center w-full h-full rounded-lg"
        style={{ background: gradient }}
        aria-hidden="true"
      >
        <span className="text-[28px] font-bold text-white/80 select-none">
          {initials}
        </span>
      </span>
    );
  }
  return (
    <span
      className="tc-agent-skill-row__cover block w-full h-full rounded-lg bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url("${url || COVER_PLACEHOLDER}")` }}
      aria-hidden="true"
    />
  );
}

function MySkillRow({
  skill,
  onToggleAuto,
  onUse,
}: {
  skill: SkillMineItem;
  onToggleAuto: () => void;
  onUse: () => void;
}) {
  const auto = skill.auto;
  // 目录行缺版本化映射时 creative_skill_id 为 null：注册命令按不存在处理（契约 §3）；
  // 个人技能无引用关系，auto 不适用（契约 §4）——两种情形都禁用 auto 开关。
  const canToggleAuto =
    skill.creative_skill_id !== null && skill.asset_domain !== "personal";
  const displayName = skill.name ?? "—";
  return (
    <div
      className={`tc-agent-skill-row ${
        auto ? "tc-agent-skill-row--checked " : ""
      }tc-agent-skill-row--switch-control tc-agent-skill-row--with-cover grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 min-h-[142px] p-3.5 rounded-xl bg-white/[0.035] border border-white/[0.08] transition-colors duration-150 hover:bg-white/[0.05]`}
    >
      <SkillCover url={skill.cover_url} name={skill.name} />
      <div className="tc-agent-skill-row__toggle flex flex-col min-w-0">
        <span className="tc-agent-skill-row__body flex flex-col gap-1">
          <span className="tc-agent-skill-row__title-line">
            <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 truncate">
              {displayName}
            </span>
          </span>
          <span className="tc-agent-skill-row__desc text-xs text-white/50 line-clamp-2 leading-relaxed break-words">
            {skill.description || "—"}
          </span>
          <span className="tc-agent-skill-row__library-meta flex items-center gap-3 mt-1 text-[11px] text-white/40">
            <span className="tc-agent-skill-row__contributor">
              @{skill.asset_domain === "personal" ? "个人" : "官方"}
            </span>
          </span>
        </span>
        <span className="tc-agent-skill-row__controls flex items-center gap-2 mt-auto">
          <span className="tc-agent-skill-row__quick-actions flex items-center gap-2">
            <UseButton onClick={onUse} />
            <button
              type="button"
              className="tc-agent-skill-row__switch"
              role="switch"
              aria-checked={auto}
              aria-label={`${auto ? "关闭" : "开启"}自动应用：${displayName}`}
              aria-busy="false"
              data-tooltip="开启后，Agent 会在合适时机自动应用此 Skill。"
              disabled={!canToggleAuto}
              onClick={onToggleAuto}
            >
              <span className="tc-agent-skill-row__switch-label">自动</span>
              <span
                className="tc-agent-skill-row__switch-thumb"
                aria-hidden="true"
              />
            </button>
          </span>
        </span>
      </div>
    </div>
  );
}

/** 官方技能库竖版卡片：封面 + 名称 + 简介（悬停完整提示）+ @Blue Whale + 使用人数 + 操作。
 *  卡片本体不可点击，无详情入口、无省略号菜单（IK60WT）。 */
function LibrarySkillCard({
  skill,
  onUse,
  onAdd,
  onRemove,
}: {
  skill: SkillLibraryItem;
  onUse: () => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const added = skill.added;
  // 目录行缺版本化映射时 creative_skill_id 为 null：注册命令按不存在处理（契约 §3），禁用添加按钮。
  const hasStableId = skill.creative_skill_id !== null;
  const desc = skill.description ?? "";
  return (
    <div
      data-testid="skill-library-card"
      className={`tc-agent-skill-row tc-agent-skill-row--no-control tc-agent-skill-row--with-cover ${
        added ? "tc-agent-skill-row--checked" : ""
      } flex flex-col overflow-hidden rounded-xl bg-white/[0.035] border border-white/[0.08] hover:bg-white/[0.05] transition-colors`}
    >
      <div className="tc-agent-skill-card__cover h-[140px] w-full shrink-0">
        <SkillCover url={skill.cover_url} />
      </div>
      <div className="tc-agent-skill-row__toggle flex flex-col flex-1 min-w-0 gap-1 p-3.5">
        <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 line-clamp-1 break-words">
          {skill.name}
        </span>
        <span
          className="tc-agent-skill-row__desc text-xs text-white/50 line-clamp-2 leading-relaxed break-words"
          data-tooltip={desc || undefined}
          data-tooltip-multiline={desc ? "" : undefined}
        >
          {desc || "—"}
        </span>
        <span className="tc-agent-skill-row__library-meta flex items-center gap-3 mt-1 text-[11px] text-white/40">
          <span className="tc-agent-skill-row__contributor">@Blue Whale</span>
          <span data-testid="skill-usage-count">
            {skill.usage_count} 人使用
          </span>
        </span>
        <span className="tc-agent-skill-row__controls flex items-center gap-2 mt-auto pt-2">
          <UseButton onClick={onUse} />
          <button
            type="button"
            className={`tc-agent-skill-row__action h-7 px-2.5 rounded-md text-[11px] font-medium border border-white/[0.08] transition-colors ${
              added
                ? "text-white/45 hover:bg-white/[0.08] hover:text-white/90"
                : "text-white/70 hover:bg-white/[0.08] hover:text-white"
            } disabled:opacity-40 disabled:pointer-events-none`}
            title={added ? "点击从我的技能移除" : undefined}
            disabled={!hasStableId}
            onClick={added ? onRemove : onAdd}
          >
            {added ? "已添加" : "添加"}
          </button>
        </span>
      </div>
    </div>
  );
}

function UseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="tc-agent-skill-row__action tc-agent-skill-row__action--use inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-white/80 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-colors"
      onClick={onClick}
    >
      <AtSign size={12} aria-hidden="true" />
      <span>直接使用</span>
    </button>
  );
}
