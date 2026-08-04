"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AtSign,
  BookMarked,
  Check,
  ChevronDown,
  FileText,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Store,
  Upload,
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
import {
  validateSkillUpload,
  type SkillUploadValidation,
} from "@/lib/skills/validate-skill-upload";

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

/** 上传模式的已选文件状态（IK60WW）：原文独立持有，不进编写编辑器。 */
type UploadState = {
  fileName: string;
  content: string;
  validation: SkillUploadValidation;
};

/** 创建技能：编写 SKILL.md（IK60WU）/ 上传 SKILL.md（IK60WW）双模式 + 总结当前对话入口（IK60X1）。
 *  编写：手写含 YAML frontmatter 的完整 SKILL.md。
 *  上传：选择或拖入单个 .md 文件，客户端预校验后显式保存。
 *  总结当前对话：仅 canvas 宿主提供回调时渲染；点击交给宿主关面板并预填固定提示词，
 *  由用户在对话输入框审阅后手动发送，面板内不产出本地草稿（契约 §15.1）。
 *  模式切换不清除两边状态；仅明确点击「保存到我的技能」才创建资产；
 *  草稿/已选文件在 tab 切换/面板关闭时保留，脏态离开需确认。 */
function CreateContent({
  onSaved,
  registerDirtyCheck,
  onSummarizeConversation,
}: {
  onSaved: () => void;
  registerDirtyCheck: (fn: () => boolean) => void;
  onSummarizeConversation?: () => void;
}) {
  const [mode, setMode] = useState<"write" | "upload">("write");
  const [draft, setDraft] = useState(SKILL_MD_TEMPLATE);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const draftDirty = draft !== SKILL_MD_TEMPLATE;
  const uploadValid = upload !== null && upload.validation.ok;
  const canSave = mode === "write" ? draftDirty : uploadValid;

  useEffect(() => {
    registerDirtyCheck(() => draft !== SKILL_MD_TEMPLATE || upload !== null);
  }, [draft, upload, registerDirtyCheck]);

  const acceptFile = async (file: File) => {
    setError(null);
    const content = await file.text();
    setUpload({
      fileName: file.name,
      content,
      validation: validateSkillUpload({ fileName: file.name, content }),
    });
  };

  const handleSave = async () => {
    let content: string;
    if (mode === "upload") {
      if (!upload || !upload.validation.ok) return;
      content = upload.content;
    } else {
      content = draft;
    }
    setSaving(true);
    setError(null);
    try {
      await skillsApi.createPersonalSkill(content);
      setDraft(SKILL_MD_TEMPLATE);
      setUpload(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  /** AI 格式化（IK60X0）：仅编写模式、显式点击触发；成功整段替换草稿，
   *  不保存、不创建资产，用户可继续编辑；失败保留原草稿并显示错误。 */
  const handleFormat = async () => {
    setFormatting(true);
    setError(null);
    try {
      const res = await skillsApi.formatSkillDraft(draft);
      setDraft(res.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 格式化失败");
    } finally {
      setFormatting(false);
    }
  };

  const modeBtn = (m: "write" | "upload", label: string) => (
    <button
      type="button"
      data-testid={`skill-create-mode-${m}`}
      aria-pressed={mode === m}
      className={`h-7 px-3 rounded-full text-[12px] font-medium transition-colors ${
        mode === m
          ? "bg-white/[0.14] text-white/90"
          : "text-white/45 hover:text-white/75 hover:bg-white/[0.06]"
      }`}
      onClick={() => setMode(m)}
    >
      {label}
    </button>
  );

  return (
    <div
      data-testid="skill-create-editor"
      className="tc-agent-skill-panel__content flex flex-col flex-1 min-h-0 overflow-hidden bg-[var(--tc-login-modal-bg)]"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.08]">
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="创建模式"
        >
          {modeBtn("write", "编写")}
          {modeBtn("upload", "上传 SKILL.md")}
        </div>
        <div className="flex items-center gap-2">
          {onSummarizeConversation && (
            <button
              type="button"
              data-testid="skill-summarize-entry"
              onClick={onSummarizeConversation}
              className="inline-flex items-center gap-1.5 h-8 px-3.5 text-[13px] font-medium rounded-lg border border-white/[0.12] text-white/75 hover:bg-white/[0.06] transition-colors"
            >
              <MessageSquareText size={14} />
              总结当前对话
            </button>
          )}
          {mode === "write" && (
            <button
              type="button"
              data-testid="skill-ai-format-btn"
              disabled={saving || formatting || !draftDirty}
              onClick={handleFormat}
              className="inline-flex items-center gap-1.5 h-8 px-3.5 text-[13px] font-medium rounded-lg border border-white/[0.12] text-white/75 hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <Sparkles size={14} />
              {formatting ? "格式化中…" : "AI 格式化"}
            </button>
          )}
          <button
            type="button"
            data-testid="skill-save-btn"
            disabled={saving || formatting || !canSave}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 text-[13px] font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <Check size={14} />
            保存到我的技能
          </button>
        </div>
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
      {mode === "write" ? (
        <textarea
          data-testid="skill-md-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="skill-md-textarea flex-1 w-full resize-none bg-transparent p-4 text-[13px] leading-relaxed text-white/90 font-mono outline-none placeholder:text-white/30 overflow-y-auto"
          placeholder={SKILL_MD_TEMPLATE}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,text/markdown"
            data-testid="skill-upload-input"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void acceptFile(file);
              e.target.value = "";
            }}
          />
          {upload === null ? (
            <div
              data-testid="skill-upload-dropzone"
              role="button"
              tabIndex={0}
              aria-label="选择或拖入 SKILL.md 文件"
              className="flex flex-col items-center justify-center gap-2 h-full min-h-[240px] rounded-xl border border-dashed border-white/[0.16] text-white/45 hover:text-white/70 hover:bg-white/[0.03] transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void acceptFile(file);
              }}
            >
              <Upload size={20} aria-hidden="true" />
              <span className="text-[13px]">选择或拖入单个 .md 文件</span>
              <span className="text-[12px] text-white/30">
                需包含 YAML frontmatter（name / description）与正文
              </span>
            </div>
          ) : (
            <div
              data-testid="skill-upload-file"
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void acceptFile(file);
              }}
            >
              <div className="flex items-center gap-2.5">
                <FileText
                  size={16}
                  className="shrink-0 text-white/60"
                  aria-hidden="true"
                />
                <span className="text-[13px] font-medium text-white/90 truncate">
                  {upload.fileName}
                </span>
                <button
                  type="button"
                  data-testid="skill-upload-remove"
                  aria-label="移除已选文件"
                  className="ml-auto shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
                  onClick={() => {
                    setUpload(null);
                    setError(null);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="mt-2 text-[12px]">
                {upload.validation.ok ? (
                  <span
                    data-testid="skill-upload-status-ok"
                    className="inline-flex items-center gap-1.5 text-success"
                  >
                    <Check size={12} aria-hidden="true" />
                    校验通过 · {upload.validation.name} /{" "}
                    {upload.validation.description}
                  </span>
                ) : (
                  <span
                    data-testid="skill-upload-status-error"
                    className="text-[var(--tc-destructive)]"
                  >
                    {upload.validation.error}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="mt-3 text-[12px] text-white/60 underline underline-offset-2 hover:text-white/90"
                onClick={() => fileInputRef.current?.click()}
              >
                重新选择文件
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 我的技能：分页 + 滚动加载 + auto 乐观开关（自管 state；refreshTrigger 变化重拉第 1 页） */
function MyContent({
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
          <div className="tc-agent-skill-panel__section-list grid grid-cols-1 md:grid-cols-2 gap-3">
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

/** 技能库：分类 + 搜索 + 排序 + 分页滚动加载（自管 state；refreshTrigger 变化重拉第 1 页） */
function LibraryContent({
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
  // cover_url 有值 → 背景图；空 → 名称驱动的确定性渐变 + 首字母（IK60WU/IK693G），
  // 不依赖第三方外链占位图。name 缺失时 generateSkillCover 回退 "?"。
  if (!url) {
    const { gradient, initials } = generateSkillCover(name ?? "");
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
      style={{ backgroundImage: `url("${url}")` }}
      aria-hidden="true"
    />
  );
}

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
  // 省略号菜单（IK60WX/IK60WZ）：官方引用行仅「移出我的技能」；
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
      }tc-agent-skill-row--switch-control tc-agent-skill-row--with-cover grid grid-cols-[112px_minmax(0,1fr)] gap-3.5 min-h-[142px] p-3.5 rounded-xl bg-white/[0.035] border border-white/[0.08] transition-colors duration-150 hover:bg-white/[0.05]`}
    >
      <SkillCover url={skill.cover_url} name={skill.name} />
      <div className="tc-agent-skill-row__toggle flex flex-col min-w-0">
        <span className="tc-agent-skill-row__body flex flex-col gap-1">
          <span className="tc-agent-skill-row__title-line flex items-center gap-1">
            <span className="tc-agent-skill-row__title text-[13px] font-semibold text-white/90 truncate">
              {displayName}
            </span>
            <span
              ref={menuRef}
              className="tc-agent-skill-row__menu relative inline-flex ml-auto shrink-0"
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
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MoreHorizontal size={14} aria-hidden="true" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  aria-label={`技能操作：${displayName}`}
                  className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-white/[0.1] bg-[var(--tc-menu-bg)] py-1 shadow-[var(--tc-dropdown-shadow)]"
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
            <UseButton
              onClick={onUse}
              disabled={skill.creative_skill_id === null}
            />
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

function UseButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="tc-agent-skill-row__action tc-agent-skill-row__action--use inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-white/80 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
      onClick={onClick}
      disabled={disabled}
    >
      <AtSign size={12} aria-hidden="true" />
      <span>直接使用</span>
    </button>
  );
}

/** 个人技能只读视图（IK60WZ，契约 §13.1）：拉取重建的完整 SKILL.md 原文展示，
 *  可复制 Markdown 到剪贴板；不可编辑、不提供下载。非 owner 端点返回 100100 → 错误态。 */
function PersonalSkillViewer({
  skill,
  onClose,
}: {
  skill: SkillMineItem;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 个人行正常都有稳定身份；缺失属异常数据，渲染期直接给错误态，不发请求
  const missingId = skill.creative_skill_id === null;

  useEffect(() => {
    if (missingId) return;
    let cancelled = false;
    skillsApi
      .getPersonalSkill(skill.creative_skill_id as string)
      .then((res) => {
        if (!cancelled) setContent(res.content);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [missingId, skill.creative_skill_id]);

  const handleCopy = async () => {
    if (content === null) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择文本复制");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 motion-reduce:animate-none"
      onMouseDown={(e) => {
        if (e.button === 0) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        data-testid="skill-personal-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`查看技能：${skill.name ?? ""}`}
        className="bg-[var(--tc-login-modal-bg)] border border-white/[0.12] rounded-2xl shadow-[var(--tc-modal-shadow)] w-[640px] max-w-[calc(100vw-96px)] max-h-[calc(100vh-128px)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // ESC 只关本弹层，不冒到 window 关掉整个技能面板
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-semibold text-white/90 truncate">
              {skill.name ?? "—"}
            </span>
            <span className="shrink-0 text-[11px] text-white/40">
              SKILL.md · 只读
            </span>
          </div>
          <button
            type="button"
            data-testid="skill-personal-viewer-close"
            aria-label="关闭查看"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {missingId ? (
            <div
              data-testid="skill-personal-viewer-error"
              className="text-[12px] text-white/60"
            >
              该技能缺少稳定身份，无法查看
            </div>
          ) : error ? (
            <div
              data-testid="skill-personal-viewer-error"
              className="text-[12px] text-white/60"
            >
              {error}
            </div>
          ) : content === null ? (
            <div className="text-[12px] text-white/40">加载中…</div>
          ) : (
            <pre
              data-testid="skill-personal-viewer-content"
              className="text-[12px] leading-relaxed text-white/80 font-mono whitespace-pre-wrap break-words select-text"
            >
              {content}
            </pre>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/[0.08]">
          <button
            type="button"
            className="h-8 px-3 rounded-lg text-[12px] text-white/70 border border-white/[0.08] hover:bg-white/[0.06] hover:text-white transition-colors"
            onClick={onClose}
          >
            关闭
          </button>
          <button
            type="button"
            data-testid="skill-personal-viewer-copy"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={content === null}
            onClick={handleCopy}
          >
            {copied ? <Check size={13} aria-hidden="true" /> : null}
            {copied ? "已复制" : "复制 Markdown"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 个人技能永久删除确认框（IK60WZ，契约 §13.2）：显示技能名并明确不可逆后果；
 *  确认后调删除端点，成功由调用方移除卡片；失败在框内显示错误、不关闭。 */
function PersonalSkillDeleteDialog({
  skill,
  onCancel,
  onConfirm,
}: {
  skill: SkillMineItem;
  onCancel: () => void;
  onConfirm: (creativeSkillId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayName = skill.name ?? "—";

  const handleConfirm = async () => {
    if (!skill.creative_skill_id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(skill.creative_skill_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败，请重试");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 motion-reduce:animate-none"
      onMouseDown={(e) => {
        if (e.button === 0 && !busy) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div
        data-testid="skill-personal-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={`删除技能：${displayName}`}
        className="bg-[var(--tc-login-modal-bg)] border border-white/[0.12] rounded-2xl shadow-[var(--tc-modal-shadow)] w-[400px] max-w-[calc(100vw-96px)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="px-4 pt-4 pb-2">
          <div className="text-[14px] font-semibold text-white/90">
            删除技能
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-white/70 break-words">
            确认删除「{displayName}」？
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/50">
            删除后该技能的正文不可查看、复制或复用，且无法恢复。
          </p>
          {error && (
            <p
              data-testid="skill-personal-delete-error"
              className="mt-2 text-[12px] text-[var(--tc-destructive)]"
            >
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <button
            type="button"
            data-testid="skill-personal-delete-cancel"
            className="h-8 px-3 rounded-lg text-[12px] text-white/70 border border-white/[0.08] hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="skill-personal-delete-confirm"
            className="h-8 px-3 rounded-lg text-[12px] font-medium text-white bg-[var(--tc-destructive)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none"
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy ? "删除中…" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
