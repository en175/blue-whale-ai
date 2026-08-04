"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  skillsApi,
  type SkillLibraryCategory,
  type SkillLibraryItem,
  type SkillLibraryLang,
  type SkillLibrarySort,
} from "./api/skills";
import {
  PAGE_SIZE,
  StateHint,
  SkillCover,
  UseButton,
  type UseSkillSelection,
} from "./SkillPanelShared";

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

/** library lang 参数：navigator.language 以 zh 开头 → zh，其余 → en（契约 §11.5） */
function detectLibraryLang(): SkillLibraryLang {
  if (typeof navigator === "undefined") return "zh";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** 技能库：分类 + 搜索 + 排序 + 分页滚动加载（自管 state；refreshTrigger 变化重拉第 1 页） */
export function LibraryContent({
  onUse,
  onToast,
  refreshTrigger = 0,
}: {
  onUse: (skill: UseSkillSelection) => void;
  onToast: (text: string) => void;
  refreshTrigger?: number;
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

  // 我的侧移除官方引用后 refreshTrigger+1 → 重拉第 1 页同步 added 状态（IK60WX）
  useEffect(() => {
    if (refreshTrigger === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部触发重新分页获取
    fetchPage(1, false);
  }, [refreshTrigger, fetchPage]);

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
    skillsApi
      .add(creativeSkillId)
      .then(() => {
        onToast("技能已添加");
      })
      .catch((e: unknown) => {
        setItems((prev) =>
          prev.map((s) =>
            s.creative_skill_id === creativeSkillId
              ? { ...s, added: false }
              : s,
          ),
        );
        // 同名冲突（100103）等业务失败展示服务端解释文案（契约 §5.4，IK60WX）
        setError(
          e instanceof Error && e.message ? e.message : "添加失败，已回滚",
        );
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
                className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-white/[0.1] bg-[var(--tc-menu-bg)] py-1 shadow-[var(--tc-dropdown-shadow)]"
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

/** 官方技能库竖版卡片：封面 + 名称 + 简介（悬停完整提示）+ @Blue Whale + 使用人数 + 操作。
 *  卡片本体不可点击，无详情入口、无省略号菜单（IK60WT）；
 *  「已添加」不可点击，移出去「我的技能」省略号菜单（IK60WX）。 */
function LibrarySkillCard({
  skill,
  onUse,
  onAdd,
}: {
  skill: SkillLibraryItem;
  onUse: () => void;
  onAdd: () => void;
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
        <SkillCover url={skill.cover_url} name={skill.name} />
      </div>
      <div className="tc-agent-skill-row__toggle flex flex-col flex-1 min-w-0 gap-1 p-3.5">
        <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 line-clamp-1 break-words">
          {skill.name}
        </span>
        {/* data-tooltip 挂在未裁剪的包裹元素上：line-clamp 的 overflow:hidden 会裁剪
            定位到元素上方的 ::before 提示（IK6H3Q，US19） */}
        <span
          className="tc-agent-skill-row__desc-tooltip"
          data-tooltip={desc || undefined}
          data-tooltip-multiline={desc ? "" : undefined}
        >
          <span className="tc-agent-skill-row__desc text-xs text-white/50 line-clamp-2 leading-relaxed break-words">
            {desc || "—"}
          </span>
        </span>
        <span className="tc-agent-skill-row__library-meta flex items-center gap-3 mt-1 text-[11px] text-white/40">
          <span className="tc-agent-skill-row__contributor">@Blue Whale</span>
          <span data-testid="skill-usage-count">
            {skill.usage_count} 人使用
          </span>
        </span>
        <span className="tc-agent-skill-row__controls flex items-center gap-2 mt-auto pt-2">
          <UseButton onClick={onUse} disabled={!hasStableId} />
          <button
            type="button"
            data-testid="skill-library-add-btn"
            className={`tc-agent-skill-row__action h-7 px-2.5 rounded-md text-[11px] font-medium border border-white/[0.08] transition-colors ${
              added
                ? "text-white/45"
                : "text-white/70 hover:bg-white/[0.08] hover:text-white"
            } disabled:opacity-40 disabled:pointer-events-none`}
            disabled={added || !hasStableId}
            onClick={onAdd}
          >
            {added ? "已添加" : "添加"}
          </button>
        </span>
      </div>
    </div>
  );
}
