import { createHash } from "node:crypto";
import {
  AGENT_RUN_ALREADY_TERMINAL_CODE,
  AGENT_RUN_CONFLICT_CODE,
  AGENT_RUN_NOT_RETRYABLE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import type { AgentRunRepo } from "@blue-whale/persistence";
import { wireInteger } from "../wire-integer";

export function isDecimalId(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

/** 空 body 命令的请求摘要：方法 + 命令语义 + 资源路径（契约 §8.2/§8.3）。 */
export function agentRunCommandRequestHash(
  operation: string,
  projectId: string,
  agentRunId: string,
): string {
  return createHash("sha256")
    .update(`POST:${operation}:/projects/${projectId}/agent-runs/${agentRunId}`)
    .digest("hex");
}

export function missingKeyOrRun(
  agentRunId: string,
  idempotencyKey: string | null,
) {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key");
  }
  if (!isDecimalId(agentRunId)) {
    return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }
  return null;
}

export async function handleStopAgentRun(
  userId: string,
  projectId: string,
  agentRunId: string,
  idempotencyKey: string | null,
  deps: AgentRunRepo,
) {
  const invalid = missingKeyOrRun(agentRunId, idempotencyKey);
  if (invalid) return invalid;
  const result = await deps.acceptUserStop({
    userId,
    projectId,
    agentRunId,
    idempotencyKey: idempotencyKey!,
    requestHash: agentRunCommandRequestHash("stop", projectId, agentRunId),
  });
  switch (result.kind) {
    case "stopped":
    case "replayed":
      return ok({
        agent_run_id: wireInteger(agentRunId),
        status: result.status,
        cursor: wireInteger(result.cursor),
      });
    case "not_found":
      return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    case "idempotency_conflict":
      return fail(
        IDEMPOTENCY_KEY_REUSED_CODE,
        "Idempotency-Key 已被其他请求使用",
      );
    case "already_terminal":
      return fail(AGENT_RUN_ALREADY_TERMINAL_CODE, "AgentRun 已结束");
    case "not_stoppable":
      return fail(AGENT_RUN_CONFLICT_CODE, "AgentRun 当前状态不可停止");
  }
}

export async function handleRetryAgentRun(
  userId: string,
  projectId: string,
  agentRunId: string,
  idempotencyKey: string | null,
  deps: AgentRunRepo,
) {
  const invalid = missingKeyOrRun(agentRunId, idempotencyKey);
  if (invalid) return invalid;
  const result = await deps.acceptUserRetry({
    userId,
    projectId,
    agentRunId,
    idempotencyKey: idempotencyKey!,
    requestHash: agentRunCommandRequestHash("retry", projectId, agentRunId),
  });
  switch (result.kind) {
    case "retried":
    case "replayed":
      return ok({
        agent_run_id: wireInteger(agentRunId),
        status: result.status,
        retry_count: result.retryCount,
        cursor: wireInteger(result.cursor),
      });
    case "not_found":
      return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    case "idempotency_conflict":
      return fail(
        IDEMPOTENCY_KEY_REUSED_CODE,
        "Idempotency-Key 已被其他请求使用",
      );
    case "not_retryable":
      return fail(AGENT_RUN_NOT_RETRYABLE_CODE, "AgentRun 当前状态不可重试");
  }
}
