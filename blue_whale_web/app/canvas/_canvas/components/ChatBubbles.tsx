/**
 * ChatBubbles —— Agent 对话区的消息气泡与卡片组件（展示层）
 * 包含用户消息气泡、Agent 消息气泡、可折叠的「思考过程」块、以及素材/结果卡片。
 * 仅负责渲染，数据来源于 AgentChatPanel 传入的 ChatMessage。
 */
import { useId, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Image as ImageIcon,
} from "lucide-react";
import type { ChatMessage } from "../types";
import { MarkdownBody } from "../../_scene-card/components/MarkdownBody";
import { AuthenticatedImage } from "./AuthenticatedImage";

/** 卡片外壳共享样式（AgentCard / PlanCard）：token 边框 + 抬升底 + 正文层级。 */
const CARD_SHELL_CLASS =
  "flex flex-col gap-2 rounded-[var(--tc-radius-xl)] border border-[var(--tc-border-subtle)] bg-[var(--tc-agent-card-bg)] p-3 text-xs leading-normal text-[var(--tc-agent-card-text)]";

/** 卡片主操作共享样式（AgentCard / PlanCard）。 */
const CARD_CTA_CLASS =
  "inline-flex items-center gap-1 rounded-md bg-[var(--tc-agent-card-cta-bg)] px-2 py-1 text-xs text-[var(--tc-agent-card-cta-text)] transition-colors hover:bg-[var(--tc-agent-card-cta-bg-hover)] disabled:cursor-default disabled:opacity-50";

/** 卡片折叠按钮（AgentCard / PlanCard 共享）。 */
function CardCollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="tc-agent-card-collapse-btn inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--tc-agent-card-icon)] transition-colors hover:bg-[var(--tc-agent-card-icon-hover-bg)]"
      aria-expanded={!collapsed}
      aria-label="折叠卡片"
      title="折叠卡片"
      onClick={onToggle}
    >
      {collapsed ? (
        <ChevronDown width={14} height={14} />
      ) : (
        <ChevronUp width={14} height={14} />
      )}
    </button>
  );
}

export function UserMessageBubble({ text }: { text: string }) {
  return (
    <div className="tc-agent-user-bubble self-end max-w-[82%] whitespace-pre-wrap break-words rounded-[18px] border border-white/[0.04] bg-white/[0.1] px-3.5 py-2 text-[13px] leading-normal text-white/[0.9]">
      {text}
    </div>
  );
}

export function AgentMessageBubble({ text }: { text: string }) {
  const segments = text.split("\n\n");
  while (segments.length > 0 && segments[segments.length - 1] === "") {
    segments.pop();
  }
  // 提前为每个 segment 标注是否为「首个非空段」，渲染期不再修改共享变量。
  const segmentFlags = segments.map((segment) => {
    if (segment === "") return { segment, isFirst: false, isSpacer: true };
    const priorNonEmpty = segments
      .slice(0, segments.indexOf(segment))
      .filter((s) => s !== "").length;
    return { segment, isFirst: priorNonEmpty === 0, isSpacer: false };
  });
  return (
    <div className="tc-agent-agent-bubble self-start max-w-[92%] whitespace-pre-wrap break-words rounded-[12px] rounded-bl-[2px] px-2.5 py-2 text-[13px] font-normal leading-[21px] text-white/[0.9]">
      {segmentFlags.map(({ segment, isFirst, isSpacer }, i) => {
        if (isSpacer) {
          return <div key={i} style={{ height: 8 }} />;
        }
        return (
          <div key={i} style={{ marginTop: isFirst ? 0 : 2 }}>
            {segment}
          </div>
        );
      })}
    </div>
  );
}

export function ThinkingBlock({
  msg,
}: {
  msg: Extract<ChatMessage, { type: "thinking" }>;
}) {
  // ReAct 思考折叠块：纯文本「思考过程」折叠头，默认收起
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="tc-agent-thinking-block self-start">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={[
          "tc-agent-thinking-trigger inline-flex items-center gap-1 py-0.5 text-xs transition-opacity hover:opacity-80",
          expanded ? "tc-agent-thinking-trigger--expanded" : "",
        ].join(" ")}
        style={{ color: "var(--tc-text-tertiary)" }}
      >
        <span className="tc-agent-thinking-trigger__label">{msg.text}</span>
        <ChevronRight
          width={13}
          height={13}
          className={[
            "tc-agent-thinking-trigger__icon",
            expanded ? "rotate-90" : "",
          ].join(" ")}
        />
      </button>
      {expanded && (
        <div className="tc-agent-thinking-content-wrap">
          <div
            className="tc-agent-thinking-content"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {msg.content}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentCard({
  msg,
  busy = false,
  onReapply,
  hideCta = false,
}: {
  msg: Extract<ChatMessage, { type: "card" }>;
  busy?: boolean;
  /** 用户点击主按钮（手动应用 / 重试）的统一意图，由容器层按 card.status 分发 */
  onReapply?: (card: Extract<ChatMessage, { type: "card" }>) => void;
  /** 隐藏主按钮（生成页等无「应用到画布」语义的容器用）；缺省 false，画布行为不变 */
  hideCta?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(msg.collapsed ?? false);
  const maskId = useId().replace(/:/g, "");
  const status = msg.status ?? "normal";
  const generating = status === "generating";
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const ctaLabel = busy
    ? "重试中"
    : failed
      ? "重试"
      : cancelled
        ? "已取消"
        : "手动应用";
  return (
    <div className="self-stretch">
      <div className={CARD_SHELL_CLASS} data-asset-id={msg.assetId}>
        <div className="flex items-center justify-between gap-2">
          <div className="tc-agent-card-header-leading">
            <span className="tc-agent-card-badge">
              <ImageIcon
                width={13}
                height={13}
                stroke="currentColor"
                strokeWidth={1.8}
              />
            </span>
          </div>
          <div className="tc-agent-card-header-actions">
            <span className="tc-agent-card-meta">
              <span style={{ color: "var(--tc-text-tertiary)" }}>
                {msg.meta}
              </span>
            </span>
            {!hideCta && (
              <button
                type="button"
                disabled={generating || cancelled || busy}
                onClick={() => onReapply?.(msg)}
                className={[
                  "tc-agent-card-cta tc-agent-card-cta--reapply",
                  failed ? "tc-agent-card-cta--reapply-failed" : "",
                  CARD_CTA_CLASS,
                ].join(" ")}
                aria-label={failed ? "生成失败，可重试" : ctaLabel}
                aria-busy={generating || busy}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width={12}
                  height={12}
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <defs>
                    <mask
                      id={`tc-agent-card-reapply-plus-${maskId}`}
                      maskUnits="userSpaceOnUse"
                      x="0"
                      y="0"
                      width="24"
                      height="24"
                    >
                      <rect x="0" y="0" width="24" height="24" fill="black" />
                      <path
                        d="M5 12h14"
                        fill="none"
                        stroke="white"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M12 5v14"
                        fill="none"
                        stroke="white"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </mask>
                  </defs>
                  <rect
                    x="0"
                    y="0"
                    width="24"
                    height="24"
                    fill="currentColor"
                    mask={`url(#tc-agent-card-reapply-plus-${maskId})`}
                  />
                </svg>
                <span className="tc-agent-card-cta__label">{ctaLabel}</span>
              </button>
            )}
            <CardCollapseButton
              collapsed={collapsed}
              onToggle={() => setCollapsed((v) => !v)}
            />
          </div>
        </div>
        {!collapsed && (
          <>
            {msg.imageUrl && (
              <AuthenticatedImage
                accessUrl={msg.imageUrl}
                alt={msg.text}
                className="max-h-64 w-full rounded-lg object-contain"
              />
            )}
            <div className="break-words" style={{ overflowWrap: "anywhere" }}>
              {msg.text}
            </div>
            {failed && msg.errorMessage && (
              <div
                className="tc-agent-card-error break-words"
                style={{
                  overflowWrap: "anywhere",
                  color: "var(--tc-destructive)",
                }}
                role="status"
              >
                {msg.errorMessage}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * PlanCard —— 冻结计划卡（IK6KQ2）：权威正文（MarkdownBody）+ 分镜序号 + 可用性徽标。
 * 首图 GenerationJob 产出成功后随 thumbnailUrl 显示首图缩略图（IK7EP1，鉴权路径、附加展示）。
 * 未应用卡显示单一「手动应用」主操作（IK6KQB 接通 apply 命令，无二次确认）；
 * applying 期间按钮禁用显示「应用中…」；requires_new_plan 置灰并提示重新生成；
 * retryable_blocked 提示余额不足、保持可重试；已应用显示徽标、不显示按钮。
 */
export function PlanCard({
  msg,
  onApply,
  applying = false,
}: {
  msg: Extract<ChatMessage, { type: "plan-card" }>;
  /** 手动应用回调（IK6KQB）：仅未应用且可操作时由按钮触发，重复点击由父层防重。 */
  onApply?: (msg: Extract<ChatMessage, { type: "plan-card" }>) => void;
  /** 应用请求进行中：按钮禁用并显示「应用中…」。 */
  applying?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const applied = msg.appliedAt !== null;
  const requiresNewPlan = msg.applicationAvailability === "requires_new_plan";
  const retryableBlocked = msg.applicationAvailability === "retryable_blocked";
  return (
    <div className="self-stretch">
      <div className={CARD_SHELL_CLASS}>
        <div className="flex items-center justify-between gap-2">
          <div className="tc-agent-card-header-leading flex items-center gap-2">
            <span className="tc-agent-card-badge">
              <ImageIcon
                width={13}
                height={13}
                stroke="currentColor"
                strokeWidth={1.8}
              />
            </span>
            {msg.sequenceLabel ? (
              <span
                className="tc-agent-plan-sequence"
                style={{ color: "var(--tc-text-tertiary)" }}
              >
                {msg.sequenceLabel}
              </span>
            ) : null}
          </div>
          <div className="tc-agent-card-header-actions flex items-center gap-2">
            <span
              className="tc-agent-plan-availability"
              style={{
                color:
                  requiresNewPlan || retryableBlocked
                    ? "var(--tc-destructive)"
                    : applied
                      ? "var(--tc-success)"
                      : "var(--tc-text-tertiary)",
              }}
            >
              {requiresNewPlan
                ? "需新计划"
                : applied
                  ? "已应用"
                  : retryableBlocked
                    ? "余额不足"
                    : "可应用"}
            </span>
            <span className="tc-agent-card-meta">
              <span style={{ color: "var(--tc-text-tertiary)" }}>
                {msg.meta}
              </span>
            </span>
            {!applied && (
              <button
                type="button"
                disabled={requiresNewPlan || applying}
                onClick={() => onApply?.(msg)}
                className={`tc-agent-card-cta tc-agent-card-cta--apply ${CARD_CTA_CLASS}`}
                aria-label="手动应用"
              >
                <span className="tc-agent-card-cta__label">
                  {applying ? "应用中…" : "手动应用"}
                </span>
              </button>
            )}
            <CardCollapseButton
              collapsed={collapsed}
              onToggle={() => setCollapsed((v) => !v)}
            />
          </div>
        </div>
        {!collapsed && (
          <>
            <div className="break-words" style={{ overflowWrap: "anywhere" }}>
              <MarkdownBody markdown={msg.text} />
            </div>
            {msg.thumbnailUrl && (
              <AuthenticatedImage
                accessUrl={msg.thumbnailUrl}
                alt={msg.sequenceLabel ?? "计划首图"}
                className="max-h-64 w-full rounded-lg object-contain"
              />
            )}
            {requiresNewPlan && (
              <div
                className="tc-agent-plan-renew break-words"
                style={{
                  overflowWrap: "anywhere",
                  color: "var(--tc-destructive)",
                }}
                role="status"
              >
                计划已失效，请重新生成
              </div>
            )}
            {retryableBlocked && !applied && (
              <div
                className="tc-agent-plan-quota break-words"
                style={{
                  overflowWrap: "anywhere",
                  color: "var(--tc-destructive)",
                }}
                role="status"
              >
                余额不足，充值后可重试应用
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
