/**
 * ChatBubbles —— Agent 对话区的消息气泡与卡片组件（展示层）
 * 包含用户消息气泡、Agent 消息气泡、可折叠的「思考过程」块、以及素材/结果卡片。
 * 仅负责渲染，数据来源于 AgentChatPanel 传入的 ChatMessage。
 */
import { useId, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Image as ImageIcon } from "lucide-react";
import type { ChatMessage } from "../types";

export function UserMessageBubble({ text }: { text: string }) {
  return (
    <div className="self-end max-w-[82%] whitespace-pre-wrap break-words rounded-[18px] border border-white/[0.04] bg-white/[0.1] px-3.5 py-2 text-[13px] leading-normal text-white/[0.9]">
      {text}
    </div>
  );
}

export function AgentMessageBubble({ text }: { text: string }) {
  const segments = text.split("\n\n");
  while (segments.length > 0 && segments[segments.length - 1] === "") {
    segments.pop();
  }
  let nonEmptyIndex = 0;
  return (
    <div className="self-start max-w-[92%] whitespace-pre-wrap break-words rounded-[12px] rounded-bl-[2px] px-2.5 py-2 text-[13px] font-normal leading-[21px] text-white/[0.9]">
      {segments.map((segment, i) => {
        if (segment === "") {
          return <div key={i} style={{ height: 8 }} />;
        }
        const isFirst = nonEmptyIndex === 0;
        nonEmptyIndex += 1;
        return (
          <div key={i} style={{ marginTop: isFirst ? 0 : 2 }}>
            {segment}
          </div>
        );
      })}
    </div>
  );
}

export function ThinkingBlock({ msg }: { msg: Extract<ChatMessage, { type: "thinking" }> }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="tc-agent-thinking-block self-start">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={[
          "tc-agent-thinking-trigger inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.04] px-2.5 py-1 text-xs text-white/70 transition-colors hover:bg-white/[0.06]",
          expanded ? "tc-agent-thinking-trigger--expanded" : "",
        ].join(" ")}
      >
        <span className="tc-agent-thinking-trigger__label">{msg.text}</span>
        <ChevronRight
          width={13}
          height={13}
          className={["tc-agent-thinking-trigger__icon", expanded ? "rotate-90" : ""].join(" ")}
        />
      </button>
      {expanded && (
        <div className="tc-agent-thinking-content-wrap">
          <div className="tc-agent-thinking-content" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {msg.content}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentCard({ msg }: { msg: Extract<ChatMessage, { type: "card" }> }) {
  const [collapsed, setCollapsed] = useState(msg.collapsed ?? false);
  const maskId = useId().replace(/:/g, "");
  const failed = msg.status === "failed";
  return (
    <div className="self-stretch">
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-white/[0.03] p-3 text-xs leading-normal text-white/[0.92]">
        <div className="flex items-center justify-between gap-2">
          <div className="tc-agent-card-header-leading">
            <span className="tc-agent-card-badge">
              <ImageIcon width={13} height={13} stroke="currentColor" strokeWidth={1.8} />
            </span>
          </div>
          <div className="tc-agent-card-header-actions">
            <span className="tc-agent-card-meta">
              <span style={{ color: "rgba(255,255,255,0.55)" }}>{msg.meta}</span>
            </span>
            <button
              type="button"
              className={[
                "tc-agent-card-cta tc-agent-card-cta--reapply",
                failed ? "tc-agent-card-cta--reapply-failed" : "",
                "inline-flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-xs text-white/80 transition-colors hover:bg-white/[0.12]",
              ].join(" ")}
              data-tooltip={failed ? "积分不足，请升级套餐以继续使用。" : undefined}
              aria-label={failed ? "积分不足，请升级套餐以继续使用。" : "手动应用"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <defs>
                  <mask id={`tc-agent-card-reapply-plus-${maskId}`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                    <rect x="0" y="0" width="24" height="24" fill="black" />
                    <path d="M5 12h14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 5v14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </mask>
                </defs>
                <rect x="0" y="0" width="24" height="24" fill="currentColor" mask={`url(#tc-agent-card-reapply-plus-${maskId})`} />
              </svg>
              <span className="tc-agent-card-cta__label">手动应用</span>
            </button>
            <button
              type="button"
              className="tc-agent-card-collapse-btn inline-flex h-6 w-6 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/[0.06]"
              aria-expanded={!collapsed}
              aria-label="折叠卡片"
              title="折叠卡片"
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <ChevronDown width={14} height={14} /> : <ChevronUp width={14} height={14} />}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="break-words" style={{ overflowWrap: "anywhere" }}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
