import { createHash } from "node:crypto";

import {
  acceptWithForcedCreativeSkill,
  prepareConversationMessage,
  type ConversationCommandStoreResult,
  type ForcedCreativeSkillGuard,
  type SkillActivationRecorder,
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
  | ConversationCommandStoreResult
  | { kind: "invalid"; message: string }
  | { kind: "creative_skill_unavailable" };

/**
 * 收件箱消息接纳（IK60WY）：与 conversation 路径同走 forced 共享缝——
 * 域/owner 守卫 fail-closed + 接纳后 forced 单次激活埋点（激活契约 §2/§4.1）。
 */
export async function acceptGenerationInboxMessage(
  input: {
    userId: string;
    idempotencyKey: string | null;
    body: Record<string, unknown>;
  },
  store: GenerationInboxStore,
  forcedSkillGuard?: ForcedCreativeSkillGuard,
  activationRecorder?: SkillActivationRecorder,
): Promise<AcceptGenerationInboxMessageResult> {
  const prepared = prepareConversationMessage(input.body, input.idempotencyKey);
  if ("kind" in prepared) return prepared;
  return acceptWithForcedCreativeSkill({
    userId: input.userId,
    body: input.body,
    guard: forcedSkillGuard,
    recorder: activationRecorder,
    accept: () => store.acceptMessage({ userId: input.userId, ...prepared }),
  });
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
