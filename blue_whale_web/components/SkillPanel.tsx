"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookMarked, Check, Plus, Store, X } from "lucide-react";
import { CreateContent } from "./SkillPanelCreate";
import { LibraryContent } from "./SkillPanelLibrary";
import { MyContent } from "./SkillPanelMine";
import type { UseSkillSelection } from "./SkillPanelShared";

export type { UseSkillSelection } from "./SkillPanelShared";

/**
 * Skill 面板（IJZ7Z8；IK60WT 改三页签近全屏工作区 + 官方技能库浏览）。
 *
 * 三页签：我的技能 / 技能库 / 创建技能（占位）。每次打开默认进技能库；
 * 关闭时整棵卸载 → 技能库查询与滚动状态重置。打开期间页签首次激活才挂载、
 * 之后保持挂载（hidden），切换页签不丢查询与滚动状态。
 * - 「我的技能」：mine API（POST 分页，官方引用 ∪ 个人技能并集 + auto）。官方引用行
 *   带省略号菜单，仅「移出我的技能」（IK60WX：立即生效、无确认、成功提示）；
 *   个人技能行菜单为「查看技能」（只读 SKILL.md + 复制）与「删除技能」（确认框 +
 *   永久删除，IK60WZ，契约 §13）。
 * - 「技能库」：library API（POST 分页，keyword + category + sort + lang，
 *   IO + sentinel 无限滚动，reqId 防过期），竖版卡片网格（3/2/1 列）。
 * add 在 library tab 内（乐观 + 回滚；成功后按钮变不可点击「已添加」+ toast，IK60WX）；
 * remove 统一在 my tab 菜单内，成功后经 refreshTrigger 重拉 library 同步 added 状态；
 * auto 在 my tab 内（乐观 + 回滚）。同名冲突（100103）展示服务端解释文案（契约 §5.4）。
 * 封面取 cover_url，空走默认图。Use 即「直接使用」（IK60WY）：传稳定 creative_skill_id
 * 绑定下一次 Agent 请求（一次性，不建引用、不改 auto）；无稳定 ID 的目录行禁用。
 *
 * 交互（IK60WT）：背景滚动锁定 + 焦点陷阱 + 初始焦点落面板 + 关闭后焦点还触发按钮；
 * 面板经 portal 挂 body 顶层 + 背景 inert（IK693G，spec 故事 7，通知列表豁免）；
 * 关闭三路径：ESC / 遮罩按压（onMouseDown 范式，规避拖选误关 IK2AKU）/ 右上 X。
 */

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface SkillPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onUseSkill: (skill: UseSkillSelection) => void;
  /** 「总结当前对话」入口回调（IK60X1，契约 §15.1）；仅 canvas AgentChatPanel 宿主传入，
   *  未传时创建技能页签不渲染该入口（首页/generate 无「当前对话」）。 */
  onSummarizeConversation?: () => void;
}

type TabKey = "my" | "library" | "create";

export default function SkillPanel({
  isOpen,
  onClose,
  onUseSkill,
  onSummarizeConversation,
}: SkillPanelProps) {
  // 关闭时整棵卸载：打开会话状态（页签、技能库查询/滚动）随之重置
  if (!isOpen) return null;
  // portal 到 body（IK693G）：配合背景 inert——面板成为 body 顶层子节点，
  // 其余顶层子树可整体 inert 而不误伤面板。SSR 首屏 isOpen 恒为 false，不触 document。
  if (typeof document === "undefined") return null;
  return createPortal(
    <SkillPanelDialog
      onClose={onClose}
      onUseSkill={onUseSkill}
      onSummarizeConversation={onSummarizeConversation}
    />,
    document.body,
  );
}

function SkillPanelDialog({
  onClose,
  onUseSkill,
  onSummarizeConversation,
}: Omit<SkillPanelProps, "isOpen">) {
  const [activeTab, setActiveTab] = useState<TabKey>("library");
  // 页签首次激活才挂载，之后保持挂载（hidden）以保留查询与滚动状态
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<TabKey>>(
    () => new Set<TabKey>(["library"]),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const createDirtyRef = useRef<() => boolean>(() => false);
  const [myRefreshTrigger, setMyRefreshTrigger] = useState(0);
  const [libraryRefreshTrigger, setLibraryRefreshTrigger] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 统一成功提示：3 秒自动消失；连续触发重置定时器（防旧定时器提前清掉新 toast）
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const confirmDirtyClose = (): boolean => {
    if (mountedTabs.has("create") && createDirtyRef.current()) {
      return window.confirm("放弃当前草稿？");
    }
    return true;
  };

  const switchTab = (tab: TabKey) => {
    // 切页签静默保留草稿（IK693G，spec 故事 4/46）：草稿守卫只拦关闭路径，不拦页签切换。
    setActiveTab(tab);
    setMountedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  };

  const handleClose = () => {
    if (!confirmDirtyClose()) return;
    onClose();
  };

  // 总结当前对话（IK60X1）：与任一关闭路径一致，脏草稿先确认再交给宿主关面板+预填
  const handleSummarizeConversation = () => {
    if (!onSummarizeConversation) return;
    if (!confirmDirtyClose()) return;
    onSummarizeConversation();
  };

  const handleSkillSaved = () => {
    setMyRefreshTrigger((v) => v + 1);
    showToast("技能已保存");
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

  // 背景 inert（IK693G，spec 故事 7）：面板经 portal 挂在 body 顶层；打开期间 body
  // 其余顶层子树全部 inert（背景对指针/键盘/辅助技术不可达），通知列表豁免
  // （面板内的成功提示仍需对辅助技术可达）；卸载时恢复原状。
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const inerted: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el.contains(panel)) continue;
      if (el.getAttribute("aria-label") === "通知列表") continue;
      el.setAttribute("inert", "");
      inerted.push(el);
    }
    return () => {
      for (const el of inerted) el.removeAttribute("inert");
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
        className="tc-agent-skill-panel bg-[var(--tc-login-modal-bg)] border border-white/[0.12] rounded-2xl shadow-[var(--tc-modal-shadow)] w-[calc(100vw-64px)] h-[calc(100vh-64px)] flex flex-col overflow-hidden focus:outline-none animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
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
            <MyContent
              onUse={onUseSkill}
              refreshTrigger={myRefreshTrigger}
              onToast={showToast}
              onRemovedOfficial={() => setLibraryRefreshTrigger((v) => v + 1)}
            />
          </TabPane>
        )}
        {mountedTabs.has("library") && (
          <TabPane visible={activeTab === "library"}>
            <LibraryContent
              onUse={onUseSkill}
              onToast={showToast}
              onAddedOfficial={() => setMyRefreshTrigger((v) => v + 1)}
              refreshTrigger={libraryRefreshTrigger}
            />
          </TabPane>
        )}
        {mountedTabs.has("create") && (
          <TabPane visible={activeTab === "create"}>
            <CreateContent
              onSaved={handleSkillSaved}
              registerDirtyCheck={(fn) => {
                createDirtyRef.current = fn;
              }}
              onSummarizeConversation={
                onSummarizeConversation
                  ? handleSummarizeConversation
                  : undefined
              }
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
