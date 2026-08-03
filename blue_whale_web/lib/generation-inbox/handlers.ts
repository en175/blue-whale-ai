import {
  acceptGenerationInboxMessage,
  createGenerationInboxConversation,
} from "@blue-whale/core";
import {
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import type { GenerationInboxRepo } from "@blue-whale/persistence";
import { wireInteger, wireNullableInteger } from "../wire-integer";

const AGENT_RUN_CONFLICT_CODE = 100303;
/** Creative Skill 不可用（资产契约 §7：跨用户 forced 个人技能/未知 ID，不泄露存在性）。 */
const CREATIVE_SKILL_UNAVAILABLE_CODE = 100306;

export async function handleGetGenerationInbox(
  userId: string,
  deps: GenerationInboxRepo,
) {
  const inbox = await deps.get(userId);
  if (!inbox) return ok(null);
  return ok({
    project: {
      ...inbox.project,
      id: wireInteger(inbox.project.id),
    },
    active_conversation_id: wireNullableInteger(inbox.active_conversation_id),
  });
}

export async function handleAcceptGenerationInboxMessage(
  userId: string,
  body: Record<string, unknown>,
  idempotencyKey: string | null,
  deps: GenerationInboxRepo,
) {
  const result = await acceptGenerationInboxMessage(
    { userId, body, idempotencyKey },
    deps,
  );
  switch (result.kind) {
    case "accepted":
    case "replayed":
      return ok({
        project_id: wireInteger(result.project_id),
        conversation_id: wireInteger(result.conversation_id),
        message_id: wireInteger(result.message_id),
        agent_run_id: wireInteger(result.agent_run_id),
        accepted_cursor: wireInteger(result.cursor),
      });
    case "not_found":
      return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    case "idempotency_conflict":
      return fail(
        IDEMPOTENCY_KEY_REUSED_CODE,
        "Idempotency-Key 已被其他请求使用",
      );
    case "input_request_conflict":
      return fail(AGENT_RUN_CONFLICT_CODE, "输入请求已失效或不匹配");
    case "agent_run_conflict":
      return fail(AGENT_RUN_CONFLICT_CODE, "AgentRun 正在运行");
    case "creative_skill_conflict":
      return fail(
        AGENT_RUN_CONFLICT_CODE,
        "活动中的 AgentRun 已冻结 Skill 配置",
      );
    case "creative_skill_unavailable":
      return fail(CREATIVE_SKILL_UNAVAILABLE_CODE, "Creative Skill 不可用");
    case "invalid":
      return fail(
        result.message === "缺少 Idempotency-Key" ? PARAM_MISSING_CODE : 400,
        result.message,
      );
  }
}

export async function handleListGenerationInboxConversations(
  userId: string,
  deps: GenerationInboxRepo,
) {
  const conversations = await deps.listConversations(userId);
  if (!conversations) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  return ok(
    conversations.map((conversation) => ({
      ...conversation,
      id: wireInteger(conversation.id),
    })),
  );
}

export async function handleCreateGenerationInboxConversation(
  userId: string,
  idempotencyKey: string | null,
  deps: GenerationInboxRepo,
) {
  const result = await createGenerationInboxConversation(
    userId,
    idempotencyKey,
    deps,
  );
  if (result.kind === "invalid") {
    return fail(PARAM_MISSING_CODE, result.message);
  }
  if (result.kind === "not_found") {
    return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }
  if (result.kind === "idempotency_conflict") {
    return fail(
      IDEMPOTENCY_KEY_REUSED_CODE,
      "Idempotency-Key 已被其他请求使用",
    );
  }
  return ok({
    ...result.conversation,
    id: wireInteger(result.conversation.id),
  });
}

export async function handleDeleteGenerationInbox(
  userId: string,
  deps: GenerationInboxRepo,
) {
  return (await deps.delete(userId))
    ? ok()
    : fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
}
