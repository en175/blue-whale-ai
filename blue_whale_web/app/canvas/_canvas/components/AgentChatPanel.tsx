/**
 * AgentChatPanel —— 右侧 Agent 对话面板（容器层）
 * 承载消息列表（复用 ChatBubbles）、输入器（复用 Composer）、技能面板（SkillPanel），
 * 处理对话流、@ 素材提及、模型/技能开关等交互，并通过 createPortal 渲染浮层。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Box, ChevronDown } from "lucide-react";
import { SmoothCorners } from "@/components/SmoothCorners";
import SkillPanel from "@/components/SkillPanel";
import { squirclePath } from "../utils";
import { CreditIcon, IconClose, IconPlus, IconSend } from "../icons";
import { ComposerShell, ModelSettingsMenu } from "./Composer";
import {
  UserMessageBubble,
  AgentMessageBubble,
  ThinkingBlock,
  AgentCard,
} from "./ChatBubbles";
import type { ChatMessage } from "../types";
import type { CardStatus } from "@/types/domain";
import { buildMockReplyForMode } from "../messages";
import { createMessageIdGenerator } from "../idGen";
import type { MessageIdGenerator } from "../idGen";
import { useAuth } from "@/components/auth/AuthContext";
import type { CardMessage } from "../nodeFromCard";

export function AgentChatPanel({
  messages,
  isOpen,
  onClose,
  pendingMention,
  onMentionConsumed,
  onCardGenerated,
  onAppendMessages,
  onSetCardStatus,
  prompt,
}: {
  /** 受控消息流：来自当前 Project.messages（切换项目随 key remount 更换） */
  messages: ChatMessage[];
  isOpen: boolean;
  onClose: () => void;
  pendingMention?: { name: string; nonce: number } | null;
  onMentionConsumed?: () => void;
  onCardGenerated?: (card: CardMessage) => void;
  /** 追加消息到当前项目（user 消息 + 逐条生成的 agent 回复均经此上抛） */
  onAppendMessages?: (messages: ChatMessage[]) => void;
  /** 设置当前项目内某 card 的状态（重试链推进） */
  onSetCardStatus?: (cardId: number | string, status: CardStatus) => void;
  /** 首页续上 / 模板卡点击带入的 prompt，填入 composer（可编辑后发送） */
  prompt?: string;
}) {
  const [composerEmpty, setComposerEmpty] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [panelSize, setPanelSize] = useState({ w: 468, h: 600 });
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);

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

  const AGENT_MODELS = useMemo(
    () => [
      { id: "claude-opus-4-7", label: "Claude Opus 4.7", costMultiplier: "5x" },
      {
        id: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        costMultiplier: "3x",
      },
      {
        id: "gemini-3-5-flash",
        label: "Gemini 3.5 Flash",
        costMultiplier: "2x",
      },
      { id: "qwen-3-7-max", label: "Qwen 3.7 Max", costMultiplier: "1.3x" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", costMultiplier: "1x" },
      {
        id: "gemini-3-1-flash-lite",
        label: "Gemini 3.1 Flash Lite",
        costMultiplier: "0.3x",
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

  // prompt 带入 composer（首页续上 / 模板卡点击），可编辑后发送
  useEffect(() => {
    if (prompt && composerRef.current) {
      composerRef.current.innerText = prompt;
      setComposerEmpty(false);
    }
  }, [prompt]);

  const { requireAuth } = useAuth();
  const modelSettingsTriggerRef = useRef<HTMLButtonElement>(null);
  const modelSettingsMenuRef = useRef<HTMLDivElement>(null);
  const pendingTimers = useRef<number[]>([]);
  // 消息 ID 生成器：用户消息与 mock 回复共用，单调自增，根除同 tick 内 Date.now() 碰撞
  const nextMessageIdRef = useRef<MessageIdGenerator | null>(null);
  if (nextMessageIdRef.current === null)
    nextMessageIdRef.current = createMessageIdGenerator();
  const nextMessageId = nextMessageIdRef.current;

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
  }, []);

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

  const handleComposerInput = () => {
    const text = composerRef.current?.innerText ?? "";
    setComposerEmpty(text.trim().length === 0);
  };

  const insertSkillIntoComposer = useCallback((skillName: string) => {
    const editor = composerRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const textNode = document.createTextNode(`@${skillName} `);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        editor.appendChild(document.createTextNode(`@${skillName} `));
      }
    } else {
      editor.appendChild(document.createTextNode(`@${skillName} `));
    }

    handleComposerInput();
    setSkillPanelOpen(false);
  }, []);

  // 外部（如画布节点操作面板）请求把素材名 @ 插入输入框
  useEffect(() => {
    if (!pendingMention) return;
    insertSkillIntoComposer(pendingMention.name);
    onMentionConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMention?.nonce]);

  const handleSend = () => {
    const text = composerRef.current?.innerText.trim() || "";
    if (!text) return;

    requireAuth({ kind: "canvas-send", text }, () => {
      // 重新发送前清掉上一轮尚未触发的逐条追加定时器
      for (const id of pendingTimers.current) clearTimeout(id);
      pendingTimers.current = [];

      const userMsg: ChatMessage = { id: nextMessageId(), type: "user", text };
      onAppendMessages?.([userMsg]);
      if (composerRef.current) composerRef.current.innerText = "";
      setComposerEmpty(true);

      // 按当前创作模式生成 mock 回复，错开逐条追加模拟逐步生成
      const reply = buildMockReplyForMode(
        selectedMode.id as "agent" | "direct",
        text,
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
   *   failed/generating → 走重试状态机 failed→generating→normal（DEMO 固定成功，不创建画布节点）
   *   normal            → 把 card 作为 NodeItem 应用到画布（复用既有 onCardGenerated，page.tsx 零改）
   */
  const handleReapply = (card: CardMessage) => {
    const current = card.status ?? "normal";
    if (current === "normal") {
      onCardGenerated?.(card);
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
                className="tc-agent-session-credit-badge__trigger inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.06] px-2 py-1 text-xs text-white/75"
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
            {messages.map((msg) => {
              if (msg.type === "user")
                return <UserMessageBubble key={msg.id} text={msg.text} />;
              if (msg.type === "thinking")
                return <ThinkingBlock key={msg.id} msg={msg} />;
              if (msg.type === "card")
                return (
                  <AgentCard key={msg.id} msg={msg} onReapply={handleReapply} />
                );
              return <AgentMessageBubble key={msg.id} text={msg.text} />;
            })}
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
            <ComposerShell>
              <div className="relative p-2">
                <div
                  ref={composerRef}
                  className="tc-agent-composer-editor min-h-[40px] max-h-[120px] overflow-y-auto px-3 py-2 text-sm text-white outline-none"
                  data-placeholder="描述你的想法，使用 @ 引用素材"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  data-empty={composerEmpty}
                  data-tour-editor="agent-composer-input"
                  spellCheck={false}
                  autoCorrect="off"
                  onInput={handleComposerInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <div
                  className="tc-agent-composer-actions mt-2 flex items-center justify-between"
                  aria-label="Composer actions"
                >
                  <div className="tc-agent-composer-actions__start flex items-center gap-1">
                    <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
                      <button
                        type="button"
                        className="tc-agent-upload-btn tc-agent-composer-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.08]"
                        aria-label="上传素材"
                        data-tooltip="上传图片、视频或音频"
                      >
                        <IconPlus size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSkillPanelOpen(true)}
                        className="tc-agent-skill-btn tc-agent-composer-pill-btn inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-medium text-white/85 transition-colors hover:bg-white/[0.08]"
                        aria-label="技能"
                        aria-haspopup="dialog"
                        aria-expanded={skillPanelOpen}
                        aria-controls="tc-agent-skill-panel"
                        data-tour-target="agent-skill-button"
                      >
                        <span className="tc-agent-skill-btn__content inline-flex items-center gap-1.5">
                          <BookOpenText size={16} />
                          <span className="tc-agent-skill-btn__label">
                            技能
                          </span>
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="tc-agent-composer-actions__end flex items-center gap-1">
                    <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
                      <div className="tc-model-settings-selector relative">
                        <button
                          type="button"
                          ref={modelSettingsTriggerRef}
                          onClick={() => setModelSettingsOpen((v) => !v)}
                          className="tc-model-settings-trigger tc-agent-composer-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.08]"
                          aria-haspopup="dialog"
                          aria-expanded={modelSettingsOpen}
                          aria-label={`模型: ${selectedModel.label}`}
                          title="模型"
                        >
                          <Box size={16} />
                        </button>

                        {modelSettingsOpen && (
                          <ModelSettingsMenu
                            model={selectedModel}
                            models={AGENT_MODELS}
                            onModelChange={setSelectedModel}
                            onClose={() => setModelSettingsOpen(false)}
                            menuRef={modelSettingsMenuRef}
                            triggerRef={modelSettingsTriggerRef}
                          />
                        )}
                      </div>
                    </div>
                    <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
                      <button
                        type="button"
                        onClick={handleSend}
                        disabled={composerEmpty}
                        className="tc-agent-send-btn tc-agent-composer-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-white/90 disabled:cursor-default disabled:bg-white/[0.1] disabled:text-white/[0.25]"
                        aria-label="发送"
                        aria-disabled={composerEmpty}
                      >
                        <IconSend size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </ComposerShell>
          </div>
        </div>
      </div>

      <SkillPanel
        isOpen={skillPanelOpen}
        onClose={() => setSkillPanelOpen(false)}
        onUseSkill={insertSkillIntoComposer}
      />
    </div>
  );
}
