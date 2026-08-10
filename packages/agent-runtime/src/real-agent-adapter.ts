/** IK7EU4：经 new-api 网关（OpenAI 兼容 relay）的真实 Agent 适配器。
 *  单次受控调用（runtime_budget_policy.max_provider_calls=1、
 *  protocol_repair_attempts=0）：模型按输出协议返回单个 JSON 对象，
 *  解析/校验失败即抛错（不修复），走 worker 既有失败与重试语义。
 *  密钥仅由服务端 env 注入（NEW_API_*），不落产品库、不写日志。 */
import type {
  AgentAction,
  AgentAdapter,
  AgentRequest,
  AgentResult,
  PlanCardCandidateCore,
  PlanGenerationParameterOverridesCore,
} from "@blue-whale/core";
import {
  planCardCandidateBatchSchema,
  type PlanCardCandidate,
  type PlanGenerationParameterOverrides,
} from "@blue-whale/contracts";
import { z } from "zod";

import { createControlledChatClient } from "./controlled-chat-client.js";

const realAgentResponseSchema = z
  .object({
    content: z.string().min(1),
    reasoning_summary: z.string().min(1),
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("respond") }).strict(),
      z
        .object({
          kind: z.literal("clarify"),
          question: z.string().min(1),
          stage: z.enum(["alignment", "awaiting_final_confirmation"]),
        })
        .strict(),
      z.object({ kind: z.literal("cancel") }).strict(),
      z
        .object({
          kind: z.literal("submit_plan"),
          cards: planCardCandidateBatchSchema,
        })
        .strict(),
    ]),
  })
  .strict();

type RealAgentResponse = z.infer<typeof realAgentResponseSchema>;
type RealPlanCard = PlanCardCandidate;
type RealParameterOverrides = PlanGenerationParameterOverrides;

/** 模型偶发用 ```json 围栏包裹输出：剥壳后再解析；其余情况必须整体是 JSON。 */
function extractJson(content: string): unknown {
  let text = content.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(text);
  if (fence) text = fence[1]!.trim();
  return JSON.parse(text);
}

function toParameterOverrides(
  overrides: RealParameterOverrides,
): PlanGenerationParameterOverridesCore {
  return {
    ...(overrides.size !== undefined ? { size: overrides.size } : {}),
    ...(overrides.aspect_ratio !== undefined
      ? { aspectRatio: overrides.aspect_ratio }
      : {}),
    ...(overrides.format !== undefined ? { format: overrides.format } : {}),
    ...(overrides.duration !== undefined
      ? { duration: overrides.duration }
      : {}),
    ...(overrides.count !== undefined ? { count: overrides.count } : {}),
    ...(overrides.first_frame_mention_seq !== undefined
      ? { firstFrameMentionSeq: overrides.first_frame_mention_seq }
      : {}),
    ...(overrides.last_frame_mention_seq !== undefined
      ? { lastFrameMentionSeq: overrides.last_frame_mention_seq }
      : {}),
  };
}

function toPlanCard(card: RealPlanCard): PlanCardCandidateCore {
  return {
    applicationKind: card.application_kind,
    title: card.title,
    contentMarkdown: card.content_markdown,
    ...(card.summary !== undefined ? { summary: card.summary } : {}),
    ...(card.sequence_label_noun !== undefined
      ? { sequenceLabelNoun: card.sequence_label_noun }
      : {}),
    ...(card.base_plan_message_id !== undefined
      ? { basePlanMessageId: card.base_plan_message_id }
      : {}),
    ...(card.source_plan_message_id !== undefined
      ? { sourcePlanMessageId: card.source_plan_message_id }
      : {}),
    ...(card.application_kind === "scene_card_replace"
      ? { targetSceneCardMentionId: card.target_scene_card_mention_id }
      : {}),
    ...(card.parameter_overrides !== undefined
      ? { parameterOverrides: toParameterOverrides(card.parameter_overrides) }
      : {}),
  };
}

function toAgentAction(action: RealAgentResponse["action"]): AgentAction {
  switch (action.kind) {
    case "respond":
      return { kind: "respond" };
    case "clarify":
      return { kind: "clarify", question: action.question, stage: action.stage };
    case "cancel":
      return { kind: "cancel" };
    case "submit_plan":
      return { kind: "submit_plan", cards: action.cards.map(toPlanCard) };
  }
}

/** 将历史 assistant 消息包装回输出协议 JSON 形态，保持多轮上下文与
 *  system 要求的 JSON 输出协议一致——否则 MiniMax-M3 等模型会模仿
 *  历史中的纯文本 assistant 回复，放弃 JSON 协议，导致解析必失败。
 *
 *  持久化层（commitSuccess）只存 content 字段的纯文本（给用户看的正式
 *  回复），这是正确的；协议一致性由适配器在发给模型前负责。user 消息
 *  原样透传。包装体必须与输出协议结构完全一致（含 reasoning_summary），
 *  否则模型会模仿历史中缺失的字段结构，同样导致 zod strict 校验失败。 */
function toHistoryMessage(message: {
  role: "user" | "assistant";
  content: string;
}): { role: string; content: string } {
  if (message.role !== "assistant") return message;
  return {
    role: "assistant",
    content: JSON.stringify({
      content: message.content,
      reasoning_summary: "历史回复。",
      action: { kind: "respond" },
    }),
  };
}

function buildSystemPrompt(request: AgentRequest): string {
  const sections = [...request.runtimeInstructions];
  if (request.creativeSkill) {
    sections.push(
      `# 已激活 Creative Skill「${request.creativeSkill.name}」\n${request.creativeSkill.body}`,
    );
  }
  if (request.mentionProjections.length > 0) {
    sections.push(
      `# 本轮可用引用投影\n${request.mentionProjections
        .map(
          (mention) =>
            `- mention_id=${mention.mention_id} type=${mention.type} availability=${mention.availability} projection=${JSON.stringify(mention.projection)}`,
        )
        .join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

export function createNewApiAgentAdapter(options: {
  baseUrl: string;
  token: string;
  model: string;
  provider?: string;
  fetchImpl?: typeof fetch;
  /** 单次请求超时（默认 30s，与受控 chat 客户端一致）；超时按失败处理。 */
  timeoutMs?: number;
}): AgentAdapter {
  const chat = createControlledChatClient({
    baseUrl: options.baseUrl,
    token: options.token,
    model: options.model,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
  });
  const provider = options.provider ?? "newapi";
  return {
    name: "newapi-agent-runtime",
    async ready() {
      // 网关可用性不在就绪探针中探测：故障由 invoke 失败暴露，
      // 走 worker 既有失败/重试语义（与 fake 适配器 ready 形状一致）。
      return true;
    },
    async invoke(request): Promise<AgentResult> {
      const content = await chat.complete({
        rules: buildSystemPrompt(request),
        messages: [
          ...request.historyMessages.map(toHistoryMessage),
          { role: "user", content: request.prompt },
        ],
      });
      const parsed = realAgentResponseSchema.parse(extractJson(content));
      return {
        provider,
        content: parsed.content,
        reasoningSummary: parsed.reasoning_summary,
        action: toAgentAction(parsed.action),
      };
    },
  };
}
