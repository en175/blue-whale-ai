"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { skillsApi, type SkillMineItem } from "../api/skills";
import {
  PAGE_SIZE,
  StateHint,
  SkillCover,
  UseButton,
  type UseSkillSelection,
} from "./SkillPanelShared";
import {
  PersonalSkillViewer,
  PersonalSkillDeleteDialog,
} from "./SkillPanelModals";

/** 我的技能：分页 + 滚动加载 + auto 乐观开关（自管 state；refreshTrigger 变化重拉第 1 页） */
export function MyContent({
  onUse,
  refreshTrigger = 0,
  onToast,
  onRemovedOfficial,
}: {
  onUse: (skill: UseSkillSelection) => void;
  refreshTrigger?: number;
  onToast: (text: string) => void;
  onRemovedOfficial: () => void;
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

  // 移出我的技能（IK60WX，仅官方引用行）：立即生效、无确认。乐观删行 → API 移除 →
  // 成功 toast + 通知 library 刷新 added 状态；失败重拉当前页恢复服务端状态。
  const handleRemove = (creativeSkillId: string) => {
    setItems((prev) =>
      prev.filter((s) => s.creative_skill_id !== creativeSkillId),
    );
    skillsApi
      .remove(creativeSkillId)
      .then(() => {
        onToast("已从我的技能移出");
        onRemovedOfficial();
      })
      .catch(() => {
        fetchPage(page, false);
        setError("移除失败，已回滚");
      });
  };

  // 个人技能查看/删除（IK60WZ，契约 §13）：弹层状态；删除需先过确认框。
  const [viewerSkill, setViewerSkill] = useState<SkillMineItem | null>(null);
  const [deleteSkill, setDeleteSkill] = useState<SkillMineItem | null>(null);

  // 永久删除：确认框确认后调用；成功立即移除卡片 + toast，失败在确认框内显示错误。
  const handleDeleteConfirmed = async (creativeSkillId: string) => {
    await skillsApi.deletePersonalSkill(creativeSkillId);
    setItems((prev) =>
      prev.filter((s) => s.creative_skill_id !== creativeSkillId),
    );
    setDeleteSkill(null);
    onToast("技能已删除");
  };

  return (
    <div className="tc-agent-skill-panel__content flex flex-col flex-1 min-h-0 overflow-hidden bg-[var(--tc-login-modal-bg)]">
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
          <div className="tc-agent-skill-panel__section-list grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((skill, index) => (
              <MySkillRow
                key={skill.creative_skill_id ?? index}
                skill={skill}
                onToggleAuto={() =>
                  skill.creative_skill_id &&
                  handleToggleAuto(skill.creative_skill_id)
                }
                onRemove={() =>
                  skill.creative_skill_id &&
                  handleRemove(skill.creative_skill_id)
                }
                onView={() => setViewerSkill(skill)}
                onDelete={() => setDeleteSkill(skill)}
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
      {viewerSkill && (
        <PersonalSkillViewer
          skill={viewerSkill}
          onClose={() => setViewerSkill(null)}
        />
      )}
      {deleteSkill && (
        <PersonalSkillDeleteDialog
          skill={deleteSkill}
          onCancel={() => setDeleteSkill(null)}
          onConfirm={handleDeleteConfirmed}
        />
      )}
    </div>
  );
}

/** 我的技能横版卡片（横版卡片改版定稿）：左方形封面 + 右侧标题（2 行截断，旁挂
 *  官方/个人徽标）/简介（3 行截断），底部 直接使用 + 自动开关（label 在开关外左侧）；
 *  悬停封面左上角浮现「…」菜单：官方引用行仅「移出我的技能」，个人行「查看技能」+
 *  「删除技能」（确认框 + 永久删除，IK60WZ）；悬停卡片时简介全文以向下展开的大浮层呈现。 */
function MySkillRow({
  skill,
  onToggleAuto,
  onRemove,
  onView,
  onDelete,
  onUse,
}: {
  skill: SkillMineItem;
  onToggleAuto: () => void;
  onRemove: () => void;
  onView: () => void;
  onDelete: () => void;
  onUse: () => void;
}) {
  const auto = skill.auto;
  // 目录行缺版本化映射时 creative_skill_id 为 null：注册命令按不存在处理（契约 §3）。
  // 官方（引用 auto）与个人（本体 auto_match，§16.1）都可独立开关自动匹配。
  const canToggleAuto = skill.creative_skill_id !== null;
  const displayName = skill.name ?? "—";
  // 省略号菜单（IK60WX/IK60WZ）：悬停封面浮现，官方引用行仅「移出我的技能」；
  // 个人行「查看技能」（只读正文 + 复制）与「删除技能」（确认框 + 永久删除）。
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);
  return (
    <div
      data-testid="skill-my-row"
      className={`tc-agent-skill-row ${
        auto ? "tc-agent-skill-row--checked " : ""
      }tc-agent-skill-row--switch-control tc-agent-skill-row--with-cover group relative flex gap-3 rounded-xl bg-white/[0.035] border border-white/[0.08] transition-colors duration-150 hover:bg-white/[0.05] hover:border-white/[0.18] hover:z-20 p-3`}
    >
      <div className="relative w-[112px] h-[112px] shrink-0 self-center">
        <SkillCover url={skill.cover_url} name={skill.name} />
        {/* 悬停浮现的「…」菜单（封面左上角） */}
        <span
          ref={menuRef}
          className={`tc-agent-skill-row__menu absolute left-1 top-1 z-20 transition-opacity ${
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          onKeyDown={(e) => {
            // 菜单打开时 ESC 先收菜单（stopPropagation 防冒到 window 关面板）
            if (e.key === "Escape" && menuOpen) {
              e.stopPropagation();
              setMenuOpen(false);
            }
          }}
        >
          <button
            type="button"
            data-testid="skill-my-row-menu"
            aria-label={`更多操作：${displayName}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-black/55 text-white/80 hover:bg-black/75 hover:text-white transition-colors"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={13} aria-hidden="true" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label={`技能操作：${displayName}`}
              className="absolute left-0 top-full z-20 mt-1 w-36 rounded-lg border border-white/[0.1] bg-[var(--tc-menu-bg)] py-1 shadow-[var(--tc-dropdown-shadow)]"
            >
              {skill.asset_domain === "official" ? (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="skill-my-row-remove"
                  className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-colors"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove();
                  }}
                >
                  移出我的技能
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="skill-my-row-view"
                    className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-white/60 hover:bg-white/[0.06] hover:text-white/90 transition-colors"
                    onClick={() => {
                      setMenuOpen(false);
                      onView();
                    }}
                  >
                    查看技能
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="skill-my-row-delete"
                    className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-[var(--tc-destructive)] hover:bg-white/[0.06] transition-colors"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                  >
                    删除技能
                  </button>
                </>
              )}
            </div>
          )}
        </span>
      </div>
      <div className="tc-agent-skill-row__toggle flex flex-col flex-1 min-w-0">
        <span className="tc-agent-skill-row__title-line flex items-center gap-1.5">
          <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 line-clamp-2 break-words leading-snug">
            {displayName}
          </span>
          <span className="shrink-0 self-start rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] leading-none text-white/45">
            {skill.asset_domain === "personal" ? "个人" : "官方"}
          </span>
        </span>
        <span className="tc-agent-skill-row__desc mt-1 text-xs text-white/50 line-clamp-3 leading-relaxed break-words">
          {skill.description || "—"}
        </span>
        <span className="tc-agent-skill-row__controls mt-auto pt-2 flex items-center justify-end gap-2">
          <span className="tc-agent-skill-row__quick-actions flex items-center gap-2">
            <UseButton
              onClick={onUse}
              disabled={skill.creative_skill_id === null}
            />
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] text-white/60">自动</span>
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
                <span
                  className="tc-agent-skill-row__switch-thumb"
                  aria-hidden="true"
                />
              </button>
            </span>
          </span>
        </span>
      </div>
      {/* 悬停展开浮层（与技能库同款）：简介全文向下展开 */}
      <div
        aria-hidden="true"
        className="tc-agent-skill-card__desc-overlay pointer-events-none absolute left-[136px] -right-4 top-12 z-30 rounded-xl border border-white/[0.14] bg-[#1b1b1e] p-3.5 text-[12.5px] leading-relaxed text-white/85 shadow-[0_16px_40px_rgba(0,0,0,0.65)] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      >
        {skill.description || ""}
      </div>
    </div>
  );
}
