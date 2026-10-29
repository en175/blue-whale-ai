import { createHash } from "node:crypto";

export type ConversationMentionInput =
  | {
      type: "asset";
      asset_id: string;
      display_name: string;
    };
export type ConversationMentionType = ConversationMentionInput["type"];
export type MentionFailureReason =
  "deleted" | "stale" | "permission_lost" | "wrong_project";

export interface MentionFailure {
  index: number;
  type: ConversationMentionType;
  reason: MentionFailureReason;
}

export interface AcceptedConversationMention {
  mention_id: string;
  index: number;
  type: ConversationMentionType;
}

export interface ConversationCommandStoreInput {
  userId: string;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
  clientMessageId: string;
  content: string;
  conversationId: string | null;
  replyToInputRequestId: string | null;
  mentions: ConversationMentionInput[];
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
      mentions: AcceptedConversationMention[];
    }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "input_request_conflict" }
  | { kind: "agent_run_conflict" }
  | { kind: "creative_skill_unavailable" }
  | { kind: "creative_skill_conflict" }
  | { kind: "mention_unavailable"; mentions: MentionFailure[] };

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
  mentions: ConversationMentionInput[];
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

function canonicalRequest(
  body: Record<string, unknown>,
  content: string,
  mentions: ConversationMentionInput[],
) {
  return JSON.stringify({
    client_message_id: body.client_message_id,
    content,
    conversation_id: positiveId(body.conversation_id),
    reply_to_input_request_id: positiveId(body.reply_to_input_request_id),
    mentions,
    forced_creative_skill_id:
      typeof body.forced_creative_skill_id === "string"
        ? body.forced_creative_skill_id
        : null,
    skill_summarize: body.skill_summarize === true,
  });
}

function mentionDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 255 ? name : null;
}

function parseMentions(
  body: Record<string, unknown>,
): ConversationMentionInput[] | null {
  if (body.referenced_asset_ids !== undefined) return null;
  if (body.mentions === undefined) return [];
  if (!Array.isArray(body.mentions) || body.mentions.length > 10) return null;

  const mentions: ConversationMentionInput[] = [];
  const identities = new Set<string>();
  for (const raw of body.mentions) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const mention = raw as Record<string, unknown>;
    const displayName = mentionDisplayName(mention.display_name);
    if (!displayName) return null;
    if (mention.type === "asset") {
      const assetId = positiveId(mention.asset_id);
      if (!assetId || identities.has(`asset:${assetId}`)) return null;
      identities.add(`asset:${assetId}`);
      mentions.push({
        type: "asset",
        asset_id: assetId,
        display_name: displayName,
      });
      continue;
    }
    return null;
  }
  return mentions;
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
  const mentions = parseMentions(body);
  if (mentions === null) {
    return { kind: "invalid", message: "mentions 无效" };
  }

  const requestHash = createHash("sha256")
    .update(canonicalRequest(body, content, mentions))
    .digest("hex");
  return {
    idempotencyKey,
    requestHash,
    clientMessageId,
    content,
    conversationId: positiveId(body.conversation_id),
    replyToInputRequestId: positiveId(body.reply_to_input_request_id),
    mentions,
    skillSummarize: body.skill_summarize === true,
    forcedCreativeSkillId: forcedCreativeSkillIdOf(body),
  };
}
