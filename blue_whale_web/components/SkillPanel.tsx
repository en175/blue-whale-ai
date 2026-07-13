"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AtSign,
  BookMarked,
  ChevronDown,
  Ellipsis,
  Search,
  Store,
  X,
} from "lucide-react";
import {
  skillsApi,
  type SkillLibraryItem,
  type SkillMineItem,
} from "./api/skills";

/**
 * Skill 面板（IJZ7Z8）。
 *
 * 两 tab 各自分页滚动加载（50/页，IntersectionObserver）：
 * - 「我的 Skills」：mine API（POST 分页，join skill 返完整内容快照 + auto）。
 * - 「Skill 库」：library API（POST 分页，可 keyword 搜 name/description）。
 * add/remove 在 library tab 内（乐观 + 回滚）；auto 在 my tab 内（乐观 + 回滚）。
 * 封面取 coverUrl，空走默认图。Use 传 skill.name（forced_skill_id 真接入依赖 IJZ7Z7）。
 */

const COVER_PLACEHOLDER =
  "https://placehold.co/200x200/1a1a1a/FFFFFF?text=Skill";
const PAGE_SIZE = 50;

interface SkillPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onUseSkill: (title: string) => void;
}

type TabKey = "my" | "library";

export default function SkillPanel({
  isOpen,
  onClose,
  onUseSkill,
}: SkillPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("my");

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabBtn = (
    tab: TabKey,
    Icon: React.ComponentType<{ size?: number; className?: string }>,
    label: string
  ) => {
    const selected = activeTab === tab;
    return (
      <button
        key={tab}
        type="button"
        className={`tc-agent-skill-panel__tab inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium rounded-lg transition-colors duration-150 ${
          selected
            ? "tc-agent-skill-panel__tab--selected text-white/95"
            : "text-white/45 hover:text-white/70 hover:bg-white/[0.05]"
        }`}
        role="tab"
        aria-selected={selected}
        onClick={() => setActiveTab(tab)}
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
      onClick={onClose}
    >
      <div
        id="home-canvas-skill-panel"
        className="tc-agent-skill-panel bg-[#141414] border border-white/[0.12] rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.5)] w-[calc(100vw-56px)] max-w-[1440px] h-[calc(100vh-56px)] max-h-[920px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
        role="dialog"
        aria-modal="true"
        aria-label="Skills"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tc-agent-skill-panel__header flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
          <div
            className="tc-agent-skill-panel__tabs flex items-center gap-1"
            role="tablist"
            aria-label="Skill 视图"
          >
            {tabBtn("my", BookMarked, "我的 Skills")}
            {tabBtn("library", Store, "Skill 库")}
          </div>
          <button
            type="button"
            className="tc-agent-skill-panel__icon-btn inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors duration-150"
            aria-label="关闭 Skills"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {activeTab === "my" && <MyContent onUse={onUseSkill} />}
        {activeTab === "library" && <LibraryContent onUse={onUseSkill} />}
      </div>
    </div>
  );
}

/** 我的 Skills：分页 + 滚动加载 + auto 乐观开关（自管 state） */
function MyContent({ onUse }: { onUse: (title: string) => void }) {
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
      setItems((prev) => (append ? [...prev, ...res.records] : res.records));
      setPage(res.current);
      setHasMore(res.current < res.pages);
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

  // 首屏（StrictMode dev 双 mount → 两次 fetchPage(1)，reqId 让首次响应失效，prod 单次）
  useEffect(() => {
    fetchPage(1, false);
  }, [fetchPage]);

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
      { rootMargin: "240px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // auto 开关：乐观切换，失败回滚
  const handleToggleAuto = (skillId: number) => {
    const cur = items.find((s) => s.skillId === skillId)?.auto ?? false;
    const next = !cur;
    setItems((prev) =>
      prev.map((s) => (s.skillId === skillId ? { ...s, auto: next } : s))
    );
    skillsApi.setAuto(skillId, next).catch(() => {
      setItems((prev) =>
        prev.map((s) => (s.skillId === skillId ? { ...s, auto: cur } : s))
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
          <StateHint text="还没有添加 Skill，去 Skill 库逛逛。" />
        ) : (
          <div className="tc-agent-skill-panel__section-list grid grid-cols-2 gap-3">
            {items.map((skill) => (
              <MySkillRow
                key={skill.skillId}
                skill={skill}
                onToggleAuto={() => handleToggleAuto(skill.skillId)}
                onUse={() => onUse(skill.name)}
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

/** Skill 库：分页 + 滚动加载 + 后端搜索（自管 state） */
function LibraryContent({ onUse }: { onUse: (title: string) => void }) {
  const [items, setItems] = useState<SkillLibraryItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [inputKw, setInputKw] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const fetchPage = useCallback(
    async (pageNum: number, kw: string, append: boolean) => {
      const id = ++reqId.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await skillsApi.library({
          pageNum,
          pageSize: PAGE_SIZE,
          keyword: kw || undefined,
        });
        if (id !== reqId.current) return; // 过期请求（keyword 已变）忽略
        setItems((prev) => (append ? [...prev, ...res.records] : res.records));
        setPage(res.current);
        setHasMore(res.current < res.pages);
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
    []
  );

  // 首次 + keyword 变 → 重置第 1 页
  useEffect(() => {
    fetchPage(1, keyword, false);
  }, [keyword, fetchPage]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    fetchPage(page + 1, keyword, true);
  }, [loading, loadingMore, hasMore, page, keyword, fetchPage]);

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
      { rootMargin: "240px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const handleAdd = (id: number) => {
    setItems((prev) =>
      prev.map((s) => (s.id === id ? { ...s, added: true } : s))
    );
    skillsApi.add(id).catch(() => {
      setItems((prev) =>
        prev.map((s) => (s.id === id ? { ...s, added: false } : s))
      );
      setError("添加失败，已回滚");
    });
  };

  const handleRemove = (id: number) => {
    setItems((prev) =>
      prev.map((s) => (s.id === id ? { ...s, added: false } : s))
    );
    skillsApi.remove(id).catch(() => {
      setItems((prev) =>
        prev.map((s) => (s.id === id ? { ...s, added: true } : s))
      );
      setError("移除失败，已回滚");
    });
  };

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(inputKw.trim());
  };

  return (
    <div className="tc-agent-skill-panel__content tc-agent-skill-panel__content--store flex-1 min-h-0 overflow-hidden flex flex-col">
      <div className="tc-agent-skill-panel__library-tools flex items-center gap-3 p-4 border-b border-white/[0.08]">
        <form className="tc-agent-skill-panel__search-group flex flex-1 items-center gap-2" onSubmit={onSubmitSearch}>
          <label className="tc-agent-skill-panel__search flex flex-1 items-center gap-2 bg-white/[0.05] rounded-lg px-3 py-2 border border-white/[0.06]">
            <Search size={14} className="text-white/40" />
            <input
              type="text"
              className="bg-transparent outline-none text-[13px] text-white/90 placeholder:text-white/30 w-full"
              placeholder="搜索 Skills"
              value={inputKw}
              onChange={(e) => setInputKw(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="tc-agent-skill-panel__search-submit h-8 px-3 text-[13px] font-medium text-white/80 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] transition-colors"
          >
            搜索
          </button>
        </form>
        <div className="tc-agent-skill-panel__sort">
          <button
            type="button"
            className="tc-agent-skill-panel__sort-trigger inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-white/70 rounded-lg border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
            aria-label="排序 Skills"
            aria-expanded="false"
            aria-haspopup="menu"
          >
            <span className="tc-agent-skill-panel__sort-label">排序</span>
            <span className="tc-agent-skill-panel__sort-value text-white/90">
              精选
            </span>
            <ChevronDown size={14} />
          </button>
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
              fetchPage(page, keyword, false);
            }}
          >
            重试
          </button>
        </div>
      )}

      <div className="tc-agent-skill-panel__store-scroll flex-1 overflow-y-auto p-4">
        {loading ? (
          <StateHint text="加载中…" />
        ) : items.length === 0 ? (
          <StateHint
            text={keyword ? "没有匹配的 Skill。" : "Skill 库为空。"}
          />
        ) : (
          <div className="tc-agent-skill-panel__store-grid grid grid-cols-2 gap-3">
            {items.map((skill) => (
              <LibrarySkillRow
                key={skill.id}
                skill={skill}
                onUse={() => onUse(skill.name)}
                onAdd={() => handleAdd(skill.id)}
                onRemove={() => handleRemove(skill.id)}
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

function SkillCover({ url }: { url?: string | null }) {
  // 封面直取 coverUrl；空 → 默认图。
  return (
    <span
      className="tc-agent-skill-row__cover w-full h-full rounded-lg bg-cover bg-center bg-no-repeat"
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
  return (
    <div
      className={`tc-agent-skill-row ${
        auto ? "tc-agent-skill-row--checked " : ""
      }tc-agent-skill-row--switch-control tc-agent-skill-row--with-cover grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 min-h-[142px] p-3.5 rounded-xl bg-white/[0.035] border border-white/[0.08] transition-colors duration-150 hover:bg-white/[0.05]`}
    >
      <SkillCover url={skill.coverUrl} />
      <div className="tc-agent-skill-row__toggle flex flex-col min-w-0">
        <span className="tc-agent-skill-row__body flex flex-col gap-1">
          <span className="tc-agent-skill-row__title-line">
            <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 truncate">
              {skill.name}
            </span>
          </span>
          <span className="tc-agent-skill-row__desc text-xs text-white/50 line-clamp-2 leading-relaxed">
            {skill.description || "—"}
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
              aria-label={`${auto ? "关闭" : "开启"}自动应用：${skill.name}`}
              aria-busy="false"
              data-tooltip="开启后，Agent 会在合适时机自动应用此 Skill。"
              onClick={onToggleAuto}
            >
              <span className="tc-agent-skill-row__switch-label">自动</span>
              <span
                className="tc-agent-skill-row__switch-thumb"
                aria-hidden="true"
              />
            </button>
          </span>
          <span className="tc-agent-skill-row__more-wrap ml-auto">
            <MoreButton label={`${skill.name} 的更多选项`} />
          </span>
        </span>
      </div>
    </div>
  );
}

function LibrarySkillRow({
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
  return (
    <div
      className={`tc-agent-skill-row tc-agent-skill-row--no-control tc-agent-skill-row--with-cover ${
        added ? "tc-agent-skill-row--checked" : ""
      } grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 min-h-[142px] p-3.5 rounded-xl bg-white/[0.035] border border-white/[0.08] hover:bg-white/[0.05] transition-colors`}
    >
      <SkillCover url={skill.coverUrl} />
      <div className="tc-agent-skill-row__toggle flex flex-col min-w-0">
        <span className="tc-agent-skill-row__body flex flex-col gap-1">
          <span className="tc-agent-skill-row__title-line">
            <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 line-clamp-1">
              {skill.name}
            </span>
          </span>
          <span className="tc-agent-skill-row__desc text-xs text-white/50 line-clamp-2 leading-relaxed">
            {skill.description || "—"}
          </span>
          <span className="tc-agent-skill-row__library-meta flex items-center gap-3 mt-1 text-[11px] text-white/40">
            <span className="tc-agent-skill-row__contributor">
              @{skill.source === "official" ? "官方" : skill.source}
            </span>
          </span>
        </span>
        <span className="tc-agent-skill-row__controls flex items-center gap-2 mt-auto">
          <UseButton onClick={onUse} />
          <button
            type="button"
            className={`tc-agent-skill-row__action h-7 px-2.5 rounded-md text-[11px] font-medium border border-white/[0.08] transition-colors ${
              added
                ? "text-white/45 hover:bg-white/[0.08] hover:text-white/90"
                : "text-white/70 hover:bg-white/[0.08] hover:text-white"
            }`}
            title={added ? "点击从我的 Skills 移除" : undefined}
            onClick={added ? onRemove : onAdd}
          >
            {added ? "已添加" : "添加"}
          </button>
          <span className="tc-agent-skill-row__more-wrap ml-auto">
            <MoreButton label={`${skill.name} 的更多选项`} />
          </span>
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

function MoreButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="tc-agent-skill-row__more inline-flex items-center justify-center w-7 h-7 rounded-md text-white/50 hover:bg-white/[0.08] hover:text-white transition-colors"
      aria-label={label}
      aria-expanded="false"
    >
      <Ellipsis size={15} />
    </button>
  );
}
