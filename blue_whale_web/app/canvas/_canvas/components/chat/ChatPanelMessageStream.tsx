"use client";

// IK74V6：Agent 对话面板消息流（从 AgentChatPanel 下沉）。
// 技能推荐 + 欢迎预设 + 消息气泡 + 临时交付 + 实时/事后思考 + 失败提示。
import { ChevronDown } from "lucide-react";
import {
  UserMessageBubble,
  AgentMessageBubble,
  ThinkingBlock,
  AgentCard,
  PlanCard,
} from "../ChatBubbles";
import { SkillRecommendationSection } from "../SkillRecommendationSection";
import { AgentRunFailureNotice } from "../AgentRunFailureNotice";
import type { CreativeSkillRecommendation } from "@/components/api/skills";
import type { UseSkillSelection } from "@/components/skill/SkillPanel";
import type { ChatMessage } from "../../types";
import type { CardMessage } from "../../nodeFromCard";
import { WELCOME_PRESETS } from "../chat-panel-lib";
import type { PlanAvailabilityOverride } from "./use-plan-apply";

export interface ChatPanelMessageStreamProps {
  skillRecommendations?: CreativeSkillRecommendation[];
  skillRecommendationsLoading: boolean;
  onUseSkill: (skill: UseSkillSelection) => void;
  messages: ChatMessage[];
  onWelcomePreset: (text: string) => void;
  retryingCards: ReadonlySet<string>;
  onReapply: (card: CardMessage) => void;
  provisionalContent?: string | null;
  agentRunStatus?: string | null;
  reasoningSummary?: string | null;
  canRetryRun: boolean;
  onRetryAgentRun?: () => Promise<unknown>;
  /** 计划应用等待态（IK6KQB）：请求已发出、权威 applied 投影未到的计划 message_id */
  applyingPlanIds: ReadonlySet<string>;
  /** 业务错误到卡片可用性的本地覆盖（IK6KQB）；权威态到达即失效 */
  planAvailabilityOverrides: ReadonlyMap<string, PlanAvailabilityOverride>;
  onApplyPlan: (msg: Extract<ChatMessage, { type: "plan-card" }>) => void;
}

export function ChatPanelMessageStream({
  skillRecommendations,
  skillRecommendationsLoading,
  onUseSkill,
  messages,
  onWelcomePreset,
  retryingCards,
  onReapply,
  provisionalContent,
  agentRunStatus,
  reasoningSummary,
  canRetryRun,
  onRetryAgentRun,
  applyingPlanIds,
  planAvailabilityOverrides,
  onApplyPlan,
}: ChatPanelMessageStreamProps) {
  return (
    <>
    {skillRecommendations !== undefined && (
      <SkillRecommendationSection
        recommendations={skillRecommendations}
        loading={skillRecommendationsLoading ?? false}
        onUse={onUseSkill}
      />
    )}
    {messages.length === 0 && (
      <div
        className="tc-agent-welcome flex flex-col gap-3 px-2 pt-8 pb-4"
        lang="zh-CN"
        dir="ltr"
      >
        <div className="tc-agent-welcome__title text-base font-medium text-white/90">
          让 Agent 帮你创作
        </div>
        <div className="tc-agent-welcome__desc text-xs leading-5 text-white/55">
          描述你想生成的图片或视频，发送第一条消息即可开始。未发送的草稿会自动保留。
        </div>
        <div className="tc-agent-welcome__presets mt-1 flex flex-col gap-2">
          {WELCOME_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onWelcomePreset(preset.text)}
              className="tc-agent-welcome-preset rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-left text-xs text-white/80 transition-colors hover:bg-white/[0.08]"
            >
              <span className="mb-0.5 block font-medium text-white/85">
                {preset.label}
              </span>
              <span className="block text-white/45">{preset.text}</span>
            </button>
          ))}
        </div>
      </div>
    )}
    {messages.map((msg) => {
      if (msg.type === "user")
        return <UserMessageBubble key={msg.id} text={msg.text} />;
      if (msg.type === "thinking")
        return <ThinkingBlock key={msg.id} msg={msg} />;
      if (msg.type === "plan-card") {
        const planKey = String(msg.planMessageId);
        const override = planAvailabilityOverrides.get(planKey);
        return (
          <PlanCard
            key={msg.id}
            msg={override ? { ...msg, applicationAvailability: override } : msg}
            applying={applyingPlanIds.has(planKey)}
            onApply={onApplyPlan}
          />
        );
      }
      if (msg.type === "card")
        return (
          <AgentCard
            key={msg.id}
            msg={msg}
            busy={retryingCards.has(String(msg.id))}
            onReapply={onReapply}
          />
        );
      return <AgentMessageBubble key={msg.id} text={msg.text} />;
    })}
    {provisionalContent && (
      <div
        className="tc-agent-provisional"
        data-provisional-delivery="true"
        aria-label="生成中的临时文本"
        aria-live="polite"
        style={{ opacity: 0.85 }}
      >
        <AgentMessageBubble text={provisionalContent} />
      </div>
    )}
    {/* 运行中实时思考块：流光「思考中」+ 思考内容默认展开；思考内容来自运行摘要（Snapshot/SSE 权威） */}
    {(agentRunStatus === "queued" || agentRunStatus === "running") &&
      !provisionalContent && (
        <div
          className="tc-agent-thinking-block tc-agent-thinking-live self-start"
          role="status"
          aria-label="思考中"
        >
          <div className="tc-agent-thinking-trigger inline-flex items-center gap-1 py-0.5 text-xs">
            <span className="tc-agent-thinking-live__label">
              思考中
            </span>
            {reasoningSummary ? (
              <ChevronDown
                width={13}
                height={13}
                style={{ color: "var(--tc-text-tertiary)" }}
              />
            ) : null}
          </div>
          {reasoningSummary && (
            <div className="tc-agent-thinking-content-wrap">
              <div
                className="tc-agent-thinking-content"
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {reasoningSummary}
              </div>
            </div>
          )}
        </div>
      )}
    {/* Run 结束后思考摘要自动折叠为「思考过程」，保留在对话流末尾 */}
    {agentRunStatus !== "queued" &&
      agentRunStatus !== "running" &&
      reasoningSummary && (
        <ThinkingBlock
          msg={{
            id: "agent-run-reasoning",
            type: "thinking",
            text: "思考过程",
            content: reasoningSummary,
          }}
        />
      )}
    {/* AgentRun 失败落点：对话流末尾内联提示条（契约 §8.3） */}
    {canRetryRun && (
      <AgentRunFailureNotice
        onRetry={() => void onRetryAgentRun?.().catch(() => undefined)}
      />
    )}
    </>
  );
}
