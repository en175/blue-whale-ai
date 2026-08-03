import { createHash } from "node:crypto";

export interface ConversationCommandStoreInput {
  userId: string;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
  clientMessageId: string;
  content: string;
  conversationId: string | null;
  replyToInputRequestId: string | null;
  /** 总结当前对话意图（资产契约 §15.1）：仅 body.skill_summarize === true 置位。 */
  skillSummarize: boolean;
  forcedCreativeSkillId: string | null;
}

export type ConversationCommandStoreResult =
  | {
      kind: "accepted" | "replayed";
      project_id: string;
      conversation_id: string;
      message_id: string;
      agent_run_id: string;
      cursor: string;
      sequence_no: number;
    }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "input_request_conflict" }
  | { kind: "agent_run_conflict" }
  | { kind: "creative_skill_unavailable" }
  | { kind: "creative_skill_conflict" };

export interface ConversationCommandStore {
  acceptMessage(
    input: ConversationCommandStoreInput,
  ): Promise<ConversationCommandStoreResult>;
}

export type AcceptConversationMessageResult =
  ConversationCommandStoreResult | { kind: "invalid"; message: string };

export interface PreparedConversationMessage {
  idempotencyKey: string;
  requestHash: string;
  clientMessageId: string;
  content: string;
  conversationId: string | null;
  replyToInputRequestId: string | null;
  skillSummarize: boolean;
  forcedCreativeSkillId: string | null;
}

function positiveId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value)
    ? value
    : null;
}

function canonicalRequest(body: Record<string, unknown>, content: string) {
  return JSON.stringify({
    client_message_id: body.client_message_id,
    content,
    conversation_id: positiveId(body.conversation_id),
    reply_to_input_request_id: positiveId(body.reply_to_input_request_id),
    referenced_asset_ids: Array.isArray(body.referenced_asset_ids)
      ? body.referenced_asset_ids
      : [],
    forced_creative_skill_id:
      typeof body.forced_creative_skill_id === "string"
        ? body.forced_creative_skill_id
        : null,
    // 总结意图参与幂等哈希（§15.1）：带与不带该字段的相同文本是两个不同请求。
    skill_summarize: body.skill_summarize === true,
  });
}

export async function acceptConversationMessage(
  input: {
    userId: string;
    projectId: string;
    idempotencyKey: string | null;
    body: Record<string, unknown>;
  },
  store: ConversationCommandStore,
): Promise<AcceptConversationMessageResult> {
  const prepared = prepareConversationMessage(input.body, input.idempotencyKey);
  if ("kind" in prepared) return prepared;
  return store.acceptMessage({
    userId: input.userId,
    projectId: input.projectId,
    ...prepared,
  });
}

function forcedCreativeSkillIdOf(body: Record<string, unknown>): string | null {
  const value = body.forced_creative_skill_id;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function prepareConversationMessage(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): PreparedConversationMessage | { kind: "invalid"; message: string } {
  if (!idempotencyKey?.trim()) {
    return { kind: "invalid", message: "缺少 Idempotency-Key" };
  }
  const rawContent = typeof body.content === "string" ? body.content : "";
  const content = rawContent.trim();
  if (!content || content.length > 4000) {
    return { kind: "invalid", message: "消息内容无效" };
  }
  const clientMessageId =
    typeof body.client_message_id === "string"
      ? body.client_message_id.trim()
      : "";
  if (!clientMessageId || clientMessageId.length > 64) {
    return { kind: "invalid", message: "client_message_id 无效" };
  }

  const requestHash = createHash("sha256")
    .update(canonicalRequest(body, content))
    .digest("hex");
  return {
    idempotencyKey,
    requestHash,
    clientMessageId,
    content,
    conversationId: positiveId(body.conversation_id),
    replyToInputRequestId: positiveId(body.reply_to_input_request_id),
    skillSummarize: body.skill_summarize === true,
    forcedCreativeSkillId: forcedCreativeSkillIdOf(body),
  };
}
