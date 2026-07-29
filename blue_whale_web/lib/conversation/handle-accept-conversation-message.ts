import { acceptConversationMessage } from "@blue-whale/core";
import {
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import type { ConversationRepo } from "@blue-whale/persistence";
import { wireInteger } from "../wire-integer";

const AGENT_RUN_CONFLICT_CODE = 100303;

export async function handleAcceptConversationMessage(
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
  idempotencyKey: string | null,
  deps: ConversationRepo,
) {
  const result = await acceptConversationMessage(
    { userId, projectId, body, idempotencyKey },
    deps,
  );
  switch (result.kind) {
    case "accepted":
    case "replayed":
      return ok({
        message_id: wireInteger(result.message_id),
        agent_run_id: wireInteger(result.agent_run_id),
        cursor: wireInteger(result.cursor),
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
    case "invalid":
      return fail(
        result.message === "缺少 Idempotency-Key" ? PARAM_MISSING_CODE : 400,
        result.message,
      );
  }
}
