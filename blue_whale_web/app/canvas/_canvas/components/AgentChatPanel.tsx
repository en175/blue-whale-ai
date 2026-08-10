/**
 * AgentChatPanel —— 右侧 Agent 对话面板（容器层）
 * 承载消息列表（复用 ChatBubbles）、输入器（复用 Composer）、技能面板（SkillPanel），
 * 处理对话流、@ 素材提及、模型/技能开关等交互，并通过 createPortal 渲染浮层。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BookOpenText, ChevronDown } from "lucide-react";
import { SmoothCorners } from "@/components/SmoothCorners";
import SkillPanel, { type UseSkillSelection } from "@/components/skill/SkillPanel";
import { squirclePath } from "../utils";
import { CreditIcon, IconClose, IconPlus, IconSend } from "../icons";
import type { ChatMessage, PendingMentionBatch } from "../types";
import type { WireInteger } from "@/lib/wire-integer";
import type {
  ConversationMentionInput,
  MentionFailure,
} from "@blue-whale/core";
import type { CardStatus } from "@/types/domain";
import { buildMockReplyForMode } from "../messages";
import { createMessageIdGenerator } from "../idGen";
import type { MessageIdGenerator } from "../idGen";
import { useAuth } from "@/components/auth/AuthContext";
import type { CardMessage } from "../nodeFromCard";
import {
  extractEditor,
  insertMention,
  markMentionFailures,
  removeMention,
} from "./dock/mention";
import { UPLOAD_ACCEPT, selectUploadFiles } from "@/lib/uploadRules";
import { toast } from "@/components/Toast";
import { wireInteger } from "@/lib/wire-integer";
import type { MediaKind } from "@/lib/mediaSize";
import {
  MENTION_LIMIT,
  WELCOME_PRESETS,
  SKILL_SUMMARIZE_PROMPT,
  mentionFailuresOf,
  AGENT_MODELS,
  type ComposerUploadEntry,
} from "./chat-panel-lib";
import { useComposerUploads } from "./use-composer-uploads";
import { ChatPanelComposer } from "./chat/ChatPanelComposer";
import { ChatPanelMessageStream } from "./chat/ChatPanelMessageStream";
import { usePlanApply } from "./chat/use-plan-apply";
import type { CreativeSkillRecommendation } from "@/components/api/skills";
import {
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
} from "@/lib/composer-draft";


export function AgentChatPanel({
  messages,
  isOpen,
  onClose,
  pendingMention,
  onMentionConsumed,
  onCardGenerated,
  onAppendMessages,
  onSubmitMessage,
  onUploadFile,
  onSetCardStatus,
  onRetryGenerationJob,
  prompt,
  initialSkillId,
  projectId,
  activeSkillName,
  agentRunStatus,
  reasoningSummary,
  answerableActive,
  provisionalContent,
  onRetryAgentRun,
  onApplyPlanMessage,
  skillRecommendations,
  skillRecommendationsLoading,
}: {
  /** 受控消息流：来自当前 Project.messages（切换项目随 key remount 更换） */
  messages: ChatMessage[];
  isOpen: boolean;
  onClose: () => void;
  pendingMention?: PendingMentionBatch | null;
  onMentionConsumed?: () => void;
  onCardGenerated?: (card: CardMessage) => void;
  /** 追加消息到当前项目（user 消息 + 逐条生成的 agent 回复均经此上抛） */
  onAppendMessages?: (messages: ChatMessage[]) => void;
  /** 后端可用时提交权威 Conversation 命令；缺省时保留既有离线 mock。 */
  onSubmitMessage?: (
    text: string,
    mentions?: ConversationMentionInput[],
    forcedCreativeSkillId?: string,
    skillSummarize?: boolean,
  ) => Promise<void>;
  /**
   * 后端可用时执行输入区文件上传（持久化 Asset + 创建 NodeItem + Canvas 首次放置）。
   * 缺省（离线）时上传按钮不启用。IK67GX T03。
   */
  onUploadFile?: (
    file: File,
  ) => Promise<{ assetId: string; url: string; kind: MediaKind }>;
  /** 设置当前项目内某 card 的状态（重试链推进） */
  onSetCardStatus?: (cardId: number | string, status: CardStatus) => void;
  /** 权威失败 Card 的真实重试命令；新 Job 由 Snapshot/SSE 恢复。 */
  onRetryGenerationJob?: (generationJobId: WireInteger) => Promise<void>;
  /** 首页续上 / 模板卡点击带入的 prompt，填入 composer（可编辑后发送） */
  prompt?: string;
  /** IK74TX 1.3：首页「视频智能体」Tab 提交带入的一次性技能 id——挂载时作为 forced skill
   *  初始上下文（对齐首页「直接使用」IK60WY 语义；SSE 确认后由 activeSkillName 接管）。 */
  initialSkillId?: string;
  /** 当前 Project 身份；传入后未发送草稿按 Project 持久化到本浏览器（IK67GD T02） */
  projectId?: string;
  /** 当前 Run 已激活 Creative Skill 的展示名（forced/auto 统一，Snapshot/SSE 权威） */
  activeSkillName?: string | null;
  /** 当前 Run 的公开状态（Snapshot/SSE 权威） */
  agentRunStatus?: string | null;
  /** 安全的用户可见运行摘要；不包含内部思维链。 */
  reasoningSummary?: string | null;
  /** 是否存在可回答创作澄清（true 时 forced 与 reply 互斥，pending 保留不清） */
  answerableActive?: boolean;
  /** 临时助手文本（IK67GZ T07）：非正式消息，RunCommit 后消失 */
  provisionalContent?: string | null;
  /** 手动重试失败 Run（IK67GZ，契约 §8.3）；缺省（离线）不渲染重试按钮 */
  onRetryAgentRun?: () => Promise<void>;
  /** 手动应用冻结计划（IK6KQB，契约 §9）；缺省（离线）计划卡按钮无动作。
   *  拒绝时抛 ApiError，业务码映射：100405→余额不足（可重试），100403/100202/100407→需新计划。 */
  onApplyPlanMessage?: (planMessageId: WireInteger) => Promise<unknown>;
  /** 当前 Run 的 Creative Skill 推荐列表（IK3NPI）；未传则不渲染推荐区 */
  skillRecommendations?: CreativeSkillRecommendation[];
  /** 推荐列表拉取中（仅配合 skillRecommendations 展示加载态） */
  skillRecommendationsLoading?: boolean;
}) {
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [panelSize, setPanelSize] = useState({ w: 468, h: 600 });
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  // Use 选择的 pending forced skill：点 Use 立刻乐观展示，SSE 确认后由 activeSkillName 接管
  // IK74TX 1.3：initialSkillId 为首页「视频智能体」Tab 带入的一次性技能——用 lazy initializer
  // 在挂载时初始化（组件由 CanvasProjectRuntime 渲染时传入，挂载后不变），避免 effect 内 setState。
  const [pendingForcedSkill, setPendingForcedSkill] = useState<{
    id: string;
    name: string;
  } | null>(() =>
    initialSkillId ? { id: initialSkillId, name: initialSkillId } : null,
  );
  // 总结当前对话的一次性意图标记（IK60X1）：预填时置位，发送成功后清除，失败保留供重试
  const skillSummarizePendingRef = useRef(false);
  const [retryingCards, setRetryingCards] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 手动应用计划（IK6KQB）：交互态下沉到 chat/use-plan-apply，权威态仍由 Snapshot/SSE 校准。
  const { applyingPlanIds, planAvailabilityOverrides, handleApplyPlan } =
    usePlanApply({ messages, onApplyPlanMessage });

  const CREATION_MODES = useMemo(
    () => [
      { id: "agent", label: "Agent", description: "对话拆解，逐步完善。" },
      {
        id: "direct",
        label: "Direct Gen",
        description: "根据提示词直接生成图片或视频卡片。",
      },
    ],
    [],
  );


  const [selectedMode] = useState(CREATION_MODES[0]);
  const [selectedModel, setSelectedModel] = useState(AGENT_MODELS[3]);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  // 挂载/展开时恢复本项目未发送草稿（IK67GD T02）；草稿优先于外部 prompt 带入。
  // 依赖 isOpen：收起时组件返回 null、composer DOM 不存在，展开时才真正填充。
  const draftRestoredRef = useRef(false);
  useLayoutEffect(() => {
    if (!isOpen || !projectId || !composerRef.current) return;
    const draft = loadComposerDraft(projectId);
    if (draft && draft.trim().length > 0) {
      composerRef.current.innerText = draft;
      // 恢复草稿必须在首帧绘制前置位 composerEmpty，否则发送按钮状态错误
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setComposerEmpty(false);
      draftRestoredRef.current = true;
    }
  }, [projectId, isOpen]);

  // prompt 带入 composer（首页续上 / 模板卡点击），可编辑后发送；同理由 isOpen 触发
  useEffect(() => {
    if (prompt && isOpen && composerRef.current && !draftRestoredRef.current) {
      composerRef.current.innerText = prompt;
      setComposerEmpty(false);
    }
  }, [prompt, isOpen]);

  const { requireAuth } = useAuth();
  const modelSettingsTriggerRef = useRef<HTMLButtonElement>(null);
  const modelSettingsMenuRef = useRef<HTMLDivElement>(null);
  const pendingTimers = useRef<number[]>([]);
  // 消息 ID 生成器：用户消息与 mock 回复共用，单调自增，根除同 tick 内 Date.now() 碰撞
  const nextMessageIdRef = useRef<MessageIdGenerator | null>(null);
  if (nextMessageIdRef.current === null)
    nextMessageIdRef.current = createMessageIdGenerator();
  const nextMessageId = nextMessageIdRef.current;

  // 依赖 isOpen：面板关闭时组件返回 null、panelRef 为 null，
  // 仅挂载时运行会永远停在 panelSize 初始值，背景壳（SmoothCorners）高度失真。
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      if (cr.width === 0 || cr.height === 0) return;
      setPanelSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setPanelSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    }
  }, [isOpen]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollButton(gap > 48);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [messages]);

  useEffect(() => {
    if (!modelSettingsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const menu = modelSettingsMenuRef.current;
      const trigger = modelSettingsTriggerRef.current;
      if (
        menu &&
        !menu.contains(event.target as Node) &&
        trigger &&
        !trigger.contains(event.target as Node)
      ) {
        setModelSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelSettingsOpen]);

  // 组件卸载时清掉尚未触发的逐条追加定时器，避免 setState-on-unmounted
  useEffect(() => {
    return () => {
      for (const id of pendingTimers.current) clearTimeout(id);
      pendingTimers.current = [];
    };
  }, []);

  const handleComposerInput = useCallback(() => {
    const text = composerRef.current?.innerText ?? "";
    setComposerEmpty(text.trim().length === 0);
    if (projectId) saveComposerDraft(projectId, text);
  }, [projectId]);

  // 输入区上传（IK67GX T03）：条目状态流 uploading → success/error；
  // 成功即插可移除 pill（Asset 已持久化），失败条目可单独重试/移除，不损文字与其他上传。

  // IK74V6：输入区上传逻辑（状态与回调下沉 use-composer-uploads）。
  const {
    composerUploads,
    composerFileInputRef,
    handleComposerFilePick,
    handleComposerUploadRetry,
    handleComposerUploadRemove,
    clearComposerUploads,
    anyComposerUploading,
  } = useComposerUploads({
    onUploadFile,
    composerRef,
    onComposerInput: handleComposerInput,
  });

  // 欢迎预设：只填入输入框供用户审阅编辑，不发送、不创建产品事实（IK67GD T02）
  const handleWelcomePreset = (text: string) => {
    if (!composerRef.current) return;
    composerRef.current.innerText = text;
    handleComposerInput();
    composerRef.current.focus();
  };

  const insertTextIntoComposer = useCallback(
    (text: string) => {
      const editor = composerRef.current;
      if (!editor) return;

      editor.focus();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          editor.appendChild(document.createTextNode(text));
        }
      } else {
        editor.appendChild(document.createTextNode(text));
      }

      handleComposerInput();
      setSkillPanelOpen(false);
    },
    [handleComposerInput],
  );

  // Skill 面板 Use：有稳定 creative_skill_id 则记 pending（随下一条允许创建目标 Run 的消息下发），
  // 输入框上方出现可移除技能标签（DirectSkillTag，对齐首页 IK60WY 交互）；不往输入框插 @ 文本；
  // 无 id（库外项）仅关面板。
  const handleUseSkill = useCallback((skill: UseSkillSelection) => {
    if (skill.creative_skill_id) {
      setPendingForcedSkill({ id: skill.creative_skill_id, name: skill.name });
    }
    setSkillPanelOpen(false);
  }, []);

  // 「总结当前对话」（IK60X1，契约 §15.1）：关面板 → 预填固定提示词（可编辑、必须手动发送）
  // → 置一次性意图标记，发送时随消息体携带 skill_summarize: true，绝不自动提交。
  const handleSummarizeConversation = () => {
    skillSummarizePendingRef.current = true;
    handleWelcomePreset(SKILL_SUMMARIZE_PROMPT);
    setSkillPanelOpen(false);
  };

  // 外部（画布节点操作菜单「添加到对话」）请求把素材插入输入框：
  // 带 assetId 走 pill 路径（发送时写入 referenced_asset_ids），无 assetId 回退纯文本。
  useEffect(() => {
    if (!pendingMention) return;
    const editor = composerRef.current;
    for (const mention of pendingMention.mentions) {
      if (mention.assetId != null && editor) {
        const existing = editor.querySelectorAll("[data-mention-id]").length;
        const dup = editor.querySelector(
          `[data-mention-asset-id="${mention.assetId}"]`,
        );
        if (existing >= MENTION_LIMIT) {
          console.warn(
            "[canvas] mention pill 超过上限，已忽略",
            MENTION_LIMIT,
            mention.name,
          );
        } else if (dup) {
          console.warn(
            "[canvas] mention pill 已存在，忽略重复插入",
            mention.name,
          );
        } else {
          insertMention(editor, {
            id: String(mention.assetId),
            type: mention.type ?? "image",
            name: mention.name,
            src: mention.src,
            assetId: mention.assetId,
          });
        }
      } else {
        insertTextIntoComposer(`@${mention.name} `);
      }
    }
    handleComposerInput();
    onMentionConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMention?.batchId]);

  const handleSend = () => {
    const { prompt, mentions } = composerRef.current
      ? extractEditor(composerRef.current)
      : { prompt: "", mentions: [] as ConversationMentionInput[] };
    if (!prompt && mentions.length === 0) return;
    // 未完成上传门禁：发送按钮禁用 + Enter 路径同样拦截（IK67GX T03）
    if (anyComposerUploading) return;

    requireAuth({ kind: "canvas-send", text: prompt }, () => {
      // 重新发送前清掉上一轮尚未触发的逐条追加定时器
      for (const id of pendingTimers.current) clearTimeout(id);
      pendingTimers.current = [];

      if (onSubmitMessage) {
        // 请求飞行期锁定发送按钮，防止重复提交（清空延后到成功回调）
        setSubmitting(true);
        // forced 仅在无活动澄清时附上（reply 互斥）；成功才清 pending，失败保留供重试
        const attachForced = !!pendingForcedSkill && !answerableActive;
        // 总结意图一次性消费（IK60X1）：同 forced 语义，成功才清除
        const attachSummarize = skillSummarizePendingRef.current;
        void onSubmitMessage(
          prompt,
          mentions,
          attachForced ? pendingForcedSkill!.id : undefined,
          attachSummarize ? true : undefined,
        )
          .then(() => {
            if (composerRef.current) composerRef.current.innerHTML = "";
            setComposerEmpty(true);
            clearComposerUploads();
            if (projectId) clearComposerDraft(projectId);
            if (attachForced) setPendingForcedSkill(null);
            if (attachSummarize) skillSummarizePendingRef.current = false;
          })
          .catch((error) => {
            const failures = mentionFailuresOf(error);
            if (failures.length > 0 && composerRef.current) {
              markMentionFailures(composerRef.current, failures);
              handleComposerInput();
            }
            console.error("[canvas] conversation message failed:", error);
          })
          .finally(() => {
            setSubmitting(false);
          });
        return;
      }

      const userMsg: ChatMessage = {
        id: nextMessageId(),
        type: "user",
        text: prompt,
      };
      onAppendMessages?.([userMsg]);
      if (composerRef.current) composerRef.current.innerHTML = "";
      setComposerEmpty(true);
      clearComposerUploads();
      if (projectId) clearComposerDraft(projectId);

      // 按当前创作模式生成 mock 回复，错开逐条追加模拟逐步生成
      const reply = buildMockReplyForMode(
        selectedMode.id as "agent" | "direct",
        prompt,
        nextMessageId,
      );
      reply.forEach((msg, index) => {
        const timer = window.setTimeout(
          () => {
            onAppendMessages?.([msg]);
            // card 出现的同一 tick 触发回调：对话出 card ⇔ 画布出 NodeItem，原子同步
            if (msg.type === "card") onCardGenerated?.(msg);
            bodyRef.current?.scrollTo({
              top: bodyRef.current.scrollHeight,
              behavior: "smooth",
            });
          },
          (index + 1) * 400,
        );
        pendingTimers.current.push(timer);
      });
    });
  };

  /**
   * 手动应用 / 重试：用户点 card 主按钮的统一入口。
   * 按 card 当前 status 分发：
   *   权威 failed → 创建仅含缺失槽的新 Job，原 Card 保持失败事实
   *   离线 failed/generating → 保留既有 DEMO 状态机
   *   normal            → 把 card 作为 NodeItem 应用到画布（复用既有 onCardGenerated，page.tsx 零改）
   */
  const handleReapply = (card: CardMessage) => {
    const current = card.status ?? "normal";
    if (current === "cancelled") return;
    if (current === "normal") {
      onCardGenerated?.(card);
      return;
    }
    if (
      current === "failed" &&
      card.generationJobId !== undefined &&
      onRetryGenerationJob
    ) {
      const cardKey = String(card.id);
      if (retryingCards.has(cardKey)) return;
      setRetryingCards((currentCards) => new Set(currentCards).add(cardKey));
      void onRetryGenerationJob(card.generationJobId)
        .catch((error) => {
          console.error("[canvas] generation retry failed:", error);
        })
        .finally(() => {
          setRetryingCards((currentCards) => {
            const next = new Set(currentCards);
            next.delete(cardKey);
            return next;
          });
        });
      return;
    }
    // 重试链：清掉上一轮残留 timer，立即进入 generating，再排一步推进到终态 normal
    for (const id of pendingTimers.current) clearTimeout(id);
    pendingTimers.current = [];

    onSetCardStatus?.(card.id, "generating");

    // DEMO 固定成功：generating 800ms 后落到终态 normal（状态机不变量由 cardStatus.test.ts 覆盖）
    const timer = window.setTimeout(() => {
      onSetCardStatus?.(card.id, "normal");
    }, 800);
    pendingTimers.current.push(timer);
  };

  const handleScrollToBottom = () => {
    bodyRef.current?.scrollTo({
      top: bodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  };

  if (!isOpen) return null;

  // 已选技能标签：乐观名（刚点 Use）→ 权威名（Run 已激活）→ 不显示
  const skillLabel = pendingForcedSkill?.name ?? activeSkillName ?? null;
  const skillStateLabel = pendingForcedSkill ? "已选技能" : "已激活技能";
  // 失败重试可用性：失败提示落在对话流末尾（契约 §8.3）
  const canRetryRun = !!onRetryAgentRun && agentRunStatus === "failed";

  const panelPath = squirclePath(panelSize.w, panelSize.h, 28.8);

  return (
    <div
      ref={panelRef}
      className="tc-agent-chat-panel tc-agent-chat-panel--fixed fixed right-4 top-[68px] bottom-[70px] z-[2147483600] flex flex-col overflow-hidden"
      style={{
        width: "var(--tc-agent-panel-width, 468px)",
        boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
      }}
      role="dialog"
      aria-label="Canvas Agent 对话"
    >
      <SmoothCorners
        width={panelSize.w}
        height={panelSize.h}
        path={panelPath}
        overlay={false}
        className="tc-agent-panel-shell absolute inset-0"
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          background: "rgba(41, 41, 41, 0.75)",
          backdropFilter: "blur(40px)",
          boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.04)",
        }}
      >
        {null}
      </SmoothCorners>

      <div
        className="relative flex h-full flex-col overflow-hidden rounded-[28.8px]"
        style={{ flex: "1 1 0%", minHeight: 0 }}
      >
        <div className="tc-agent-chat-header flex flex-shrink-0 items-center justify-between gap-2 px-1.5 py-1.5">
          <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
            <div className="tc-agent-session-credit-badge group relative">
              <span
                className="tc-agent-session-credit-badge__trigger inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-xs text-white/75 transition-colors group-hover:bg-white/[0.06]"
                aria-label="当前 Agent 对话累计消耗 0.12 积分"
              >
                <CreditIcon size={12} />
                <span>0.1</span>
              </span>
              <div
                className="tc-agent-session-credit-badge__tooltip pointer-events-none absolute left-1/2 -top-2 z-[10] -translate-x-1/2 -translate-y-full opacity-0 transition-opacity group-hover:opacity-100"
                role="tooltip"
              >
                <div className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-[#1a1a1a]/95 px-2.5 py-1.5 text-[11px] leading-4 shadow-lg">
                  <div className="tc-agent-session-credit-badge__tooltip-title text-white/55">
                    当前 Agent 对话累计消耗积分
                  </div>
                  <div className="tc-agent-session-credit-badge__tooltip-value text-white/90">
                    0.12 积分
                  </div>
                </div>
              </div>
            </div>
          </div>
          {skillLabel && (
            <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
              <span
                className="tc-agent-forced-skill-badge inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.06] px-2 py-1 text-xs text-white/75"
                aria-label={`${skillStateLabel}：${skillLabel}`}
              >
                <BookOpenText size={12} />
                <span className="max-w-[120px] truncate">{skillLabel}</span>
                {pendingForcedSkill && (
                  <button
                    type="button"
                    onClick={() => setPendingForcedSkill(null)}
                    className="text-white/45 hover:text-white"
                    aria-label="取消已选技能"
                  >
                    <IconClose size={12} />
                  </button>
                )}
              </span>
            </div>
          )}
          <div className="inline-flex items-center gap-0.5">
            <div className="relative inline-flex">
              <div className="relative">
                <button
                  type="button"
                  className="tc-agent-chrome-btn inline-flex h-6 w-6 items-center justify-center p-1 text-white/45 hover:text-white"
                  aria-label="浮动"
                  title="浮动"
                  style={{
                    background: "transparent",
                    border: "none",
                    transition: "color 120ms ease",
                    clipPath: `path('${squirclePath(24, 24, 10.8)}')`,
                  }}
                >
                  <svg
                    width={16}
                    height={16}
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                    className="block"
                  >
                    <rect
                      x="3.5"
                      y="9.5"
                      width="7"
                      height="5"
                      rx="1"
                      fill="currentColor"
                    />
                    <rect
                      x="2"
                      y="4"
                      width="16"
                      height="12"
                      rx="2"
                      stroke="currentColor"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <div className="relative inline-flex">
              <div className="relative">
                <button
                  type="button"
                  onClick={onClose}
                  className="tc-agent-chrome-btn inline-flex h-6 w-6 items-center justify-center p-1 text-white/45 hover:text-white"
                  aria-label="关闭"
                  title="关闭"
                  style={{
                    background: "transparent",
                    border: "none",
                    transition: "color 120ms ease",
                    clipPath: `path('${squirclePath(24, 24, 10.8)}')`,
                  }}
                >
                  <IconClose size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          className="tc-agent-chat-body-wrap"
          style={{
            flex: "1 1 0%",
            position: "relative",
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            ref={bodyRef}
            className="tc-agent-chat-body tc-panel-textarea-scrollbar flex flex-col gap-2 overflow-y-auto overflow-x-hidden px-3 py-2"
            style={{ flex: "1 1 0%", minHeight: 0 }}
          >
            <ChatPanelMessageStream
              skillRecommendations={skillRecommendations}
              skillRecommendationsLoading={skillRecommendationsLoading ?? false}
              onUseSkill={handleUseSkill}
              messages={messages}
              onWelcomePreset={handleWelcomePreset}
              retryingCards={retryingCards}
              onReapply={handleReapply}
              provisionalContent={provisionalContent}
              agentRunStatus={agentRunStatus}
              reasoningSummary={reasoningSummary}
              canRetryRun={canRetryRun}
              onRetryAgentRun={onRetryAgentRun}
              applyingPlanIds={applyingPlanIds}
              planAvailabilityOverrides={planAvailabilityOverrides}
              onApplyPlan={handleApplyPlan}
            />
          </div>
        </div>

        {showScrollButton && (
          <button
            type="button"
            onClick={handleScrollToBottom}
            className="absolute bottom-24 left-1/2 z-[20] -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.1] px-2.5 py-1 text-[11px] text-white/90 backdrop-blur-md shadow-lg transition-all hover:bg-white/[0.15]"
            aria-label="滚动到底部"
          >
            <ChevronDown width={12} height={12} />
            <span>新消息</span>
          </button>
        )}

        <div
          className="tc-agent-composer-outer flex-shrink-0"
          style={{ padding: "0 4px 4px" }}
        >
          <div style={{ position: "relative" }}>
            <ChatPanelComposer
              composerRef={composerRef}
              composerEmpty={composerEmpty}
              onComposerInput={handleComposerInput}
              onSend={handleSend}
              submitting={submitting}
              fileInputRef={composerFileInputRef}
              uploadEnabled={!!onUploadFile}
              uploads={composerUploads}
              anyUploading={anyComposerUploading}
              onFilePick={handleComposerFilePick}
              onUploadRetry={handleComposerUploadRetry}
              onUploadRemove={handleComposerUploadRemove}
              pendingForcedSkill={pendingForcedSkill}
              onRemoveForcedSkill={() => setPendingForcedSkill(null)}
              skillPanelOpen={skillPanelOpen}
              onOpenSkillPanel={() => setSkillPanelOpen(true)}
              selectedModel={selectedModel}
              models={AGENT_MODELS}
              onModelChange={setSelectedModel}
              modelSettingsOpen={modelSettingsOpen}
              onToggleModelSettings={() => setModelSettingsOpen((v) => !v)}
              modelSettingsMenuRef={modelSettingsMenuRef}
              modelSettingsTriggerRef={modelSettingsTriggerRef}
            />
          </div>
        </div>
      </div>

      <SkillPanel
        isOpen={skillPanelOpen}
        onClose={() => setSkillPanelOpen(false)}
        onUseSkill={handleUseSkill}
        onSummarizeConversation={handleSummarizeConversation}
      />
    </div>
  );
}
