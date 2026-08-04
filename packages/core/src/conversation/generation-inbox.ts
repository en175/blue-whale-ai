import { createHash } from "node:crypto";

import {
  prepareConversationMessage,
  type ConversationCommandStoreResult,
} from "./accept-conversation-message.js";

export interface GenerationInboxProjectView {
  id: string;
  name: string;
  thumb: string | null;
  created_at: string;
  purpose: string;
}

export interface GenerationInboxView {
  project: GenerationInboxProjectView;
  active_conversation_id: string | null;
}

export interface InboxConversationView {
  id: string;
  created_at: string;
  preview: string;
}

export interface GenerationInboxStore {
  get(userId: string): Promise<GenerationInboxView | null>;
  acceptMessage(input: {
    userId: string;
    idempotencyKey: string;
    requestHash: string;
    clientMessageId: string;
    content: string;
    conversationId: string | null;
    replyToInputRequestId: string | null;
    forcedCreativeSkillId: string | null;
  }): Promise<ConversationCommandStoreResult>;
  listConversations(userId: string): Promise<InboxConversationView[] | null>;
  createConversation(
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<
    | { kind: "created" | "replayed"; conversation: InboxConversationView }
    | { kind: "not_found" }
    | { kind: "idempotency_conflict" }
  >;
  delete(userId: string): Promise<boolean>;
}

export type AcceptGenerationInboxMessageResult =
  ConversationCommandStoreResult | { kind: "invalid"; message: string };

/**
 * 收件箱消息接纳（IK67GG）：forced 选择随消息一起交给持久层，
 * 由同一事务完成权限校验、RunPin 冻结、消息接纳和激活事实写入。
 */
export async function acceptGenerationInboxMessage(
  input: {
    userId: string;
    idempotencyKey: string | null;
    body: Record<string, unknown>;
  },
  store: GenerationInboxStore,
): Promise<AcceptGenerationInboxMessageResult> {
  const prepared = prepareConversationMessage(input.body, input.idempotencyKey);
  if ("kind" in prepared) return prepared;
  if (prepared.mentions.length > 0) {
    return { kind: "invalid", message: "生成收件箱不支持显式引用" };
  }
  return store.acceptMessage({ userId: input.userId, ...prepared });
}

export function createGenerationInboxConversation(
  userId: string,
  idempotencyKey: string | null,
  store: GenerationInboxStore,
) {
  if (!idempotencyKey?.trim()) {
    return Promise.resolve({
      kind: "invalid" as const,
      message: "缺少 Idempotency-Key",
    });
  }
  const requestHash = createHash("sha256")
    .update("inbox.conversation.create")
    .digest("hex");
  return store.createConversation(userId, idempotencyKey, requestHash);
}
