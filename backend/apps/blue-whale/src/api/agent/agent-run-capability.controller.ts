import { timingSafeEqual } from "node:crypto";
import { Body, Controller, Headers, Post } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { Public } from "@lib/infra/decorators/public.decorator.js";

/** New API（blue-whale-api 网关）内部铸券端点，broker 转发前剥离自身命名空间。 */
const NEW_API_BASE_URL = process.env.NEW_API_BASE_URL?.trim() || "http://115.190.244.91:3006";
const MINT_ENDPOINT = `${NEW_API_BASE_URL}/internal/v1/model-capabilities`;
const MINT_TIMEOUT_MS = 10_000;

/** Broker 的企业暴露上限：clamp 到这些值以内，防止 Agent 自报 bounds 超出产品策略。 */
/**
 * 花费边界是 MAX_TOTAL_TOKENS，不是调用次数。一次调用可能花 500 token，也可能花 5 万，
 * 用次数当预算从来没有度量过钱：既挡不住真正的花费，又会让一轮对话因为模型多想两步就断在
 * 中途（券用尽不允许续领，续领会让边界形同虚设）。次数上限保留，语义降级为跑飞熔断。
 * 两个值都必须低于 New API 侧的硬上限（64 次 / 2,000,000 token）。
 */
const MAX_MODEL_CALLS = 32;
const MAX_TOTAL_TOKENS = 200_000;
const MAX_INPUT_TOKENS = 40_000;
const MAX_OUTPUT_TOKENS = 8_000;
const MAX_EXPIRES_SECONDS = 600; // New API 硬上限 10 分钟

interface RunCapabilityRequestBody {
  run_id?: unknown;
  session_id?: unknown;
  tenant_id?: unknown;
  principal_id?: unknown;
  integration_id?: unknown;
  external_user_id?: unknown;
  external_project_id?: unknown;
  models?: unknown;
  requested_bounds?: unknown;
  expires_in_seconds?: unknown;
  idempotency_key?: unknown;
  trace_id?: unknown;
}

/** 校验 Agent 服务凭证：x-agent-service-token，与 internal/agent-assets、agent-model 网关同一凭证。 */
function authorizedAgentService(header: string | undefined): boolean {
  const expected = process.env.AGENT_SERVICE_TOKEN?.trim();
  const supplied = header?.trim();
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function decimalPositive(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[1-9][0-9]*$/.test(trimmed) ? Number(trimmed) : null;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isInteger(value) ? value : fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Capability Broker —— Agent Run 能力券签发（IK9DWX / auth-context-and-billing-v1.md）。
 * Agent 在 run 认领后、首次可计费模型动作前调用本端点领取 Run 绑定的有界能力券。
 * 本层做两件事：校验 Agent 服务身份 + 转调 New API 铸券端点；不持有、不落库 opaque 券。
 */
@Public()
@Controller("internal/v1/runtime-capabilities")
export class AgentRunCapabilityController {
  @Post("agent-runs")
  async issue(
    @Headers("x-agent-service-token") agentServiceToken: string | undefined,
    @Body() body: RunCapabilityRequestBody,
  ) {
    if (!authorizedAgentService(agentServiceToken)) {
      throw new NewApiError("服务凭证无效", 401, "unauthorized");
    }
    const bodyRecord = body && typeof body === "object" ? body : {};
    const runId = typeof bodyRecord.run_id === "string" ? bodyRecord.run_id.trim() : "";
    const sessionId = typeof bodyRecord.session_id === "string" ? bodyRecord.session_id.trim() : "";
    const tenantId = typeof bodyRecord.tenant_id === "string" ? bodyRecord.tenant_id.trim() : "";
    const principalId = typeof bodyRecord.principal_id === "string" ? bodyRecord.principal_id.trim() : "";
    const externalUserId = decimalPositive(bodyRecord.external_user_id);
    const externalProjectId =
      typeof bodyRecord.external_project_id === "string" ? bodyRecord.external_project_id.trim() : "";
    const models = Array.isArray(bodyRecord.models)
      ? bodyRecord.models.filter((m): m is string => typeof m === "string" && m.trim().length > 0).map(m => m.trim())
      : [];
    const integrationId =
      typeof bodyRecord.integration_id === "string" && bodyRecord.integration_id.trim()
        ? bodyRecord.integration_id.trim()
        : "blue-whale";
    const idempotencyKey =
      typeof bodyRecord.idempotency_key === "string" ? bodyRecord.idempotency_key.trim() : "";
    const traceId = typeof bodyRecord.trace_id === "string" ? bodyRecord.trace_id.trim() : "";

    if (!runId || !sessionId || !tenantId || !principalId || externalUserId === null || !externalProjectId || models.length === 0 || !idempotencyKey) {
      throw new NewApiError("能力券请求参数不完整", 422, "invalid_capability_request");
    }

    const bounds = (bodyRecord.requested_bounds ?? {}) as Record<string, unknown>;
    const maxModelCalls = clampInt(bounds.max_model_calls, 4, 1, MAX_MODEL_CALLS);
    const maxInputTokens = clampInt(bounds.max_input_tokens, 40_000, 1, MAX_INPUT_TOKENS);
    const maxOutputTokens = clampInt(bounds.max_output_tokens, 8_000, 1, MAX_OUTPUT_TOKENS);
    // 不带该字段的旧 Agent 不在这里补默认值：New API 会按其余边界推导预算，推导只应有一处。
    const maxTotalTokens =
      typeof bounds.max_total_tokens === "number" && Number.isInteger(bounds.max_total_tokens)
        ? clampInt(bounds.max_total_tokens, MAX_TOTAL_TOKENS, 1, MAX_TOTAL_TOKENS)
        : null;
    const expiresInSeconds = clampInt(bodyRecord.expires_in_seconds, 480, 60, MAX_EXPIRES_SECONDS);
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

    const internalToken = process.env.BLUE_WHALE_INTERNAL_SERVICE_TOKEN?.trim();
    if (!internalToken) {
      throw new NewApiError("内部铸券凭证未配置", 503, "capability_issuer_unavailable");
    }

    let response: globalThis.Response;
    try {
      response = await fetch(MINT_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${internalToken}`,
        },
        body: JSON.stringify({
          subject_user_id: externalUserId,
          consumer: "blue-whale-agent-runtime",
          purpose: "agent_run",
          resource_id: runId,
          models,
          max_model_calls: maxModelCalls,
          max_input_tokens: maxInputTokens,
          max_output_tokens: maxOutputTokens,
          ...(maxTotalTokens === null ? {} : { max_total_tokens: maxTotalTokens }),
          expires_at: expiresAt,
          idempotency_key: idempotencyKey,
          ...(traceId ? { trace_id: traceId } : {}),
        }),
        signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "New API 铸券超时"
          : "New API 铸券服务不可用";
      throw new NewApiError(message, 502, "capability_issuer_unavailable");
    }

    if (response.status !== 201) {
      let code = "capability_denied";
      if (response.status === 401) {
        code = "capability_issuer_unauthorized";
        throw new NewApiError("内部铸券凭证校验失败", 502, code);
      }
      if (response.status === 422) {
        code = "capability_bounds_denied";
      }
      throw new NewApiError("能力券请求被拒绝", response.status === 422 ? 422 : 403, code);
    }

    const grant = (await response.json().catch(() => null)) as {
      capability_id?: unknown;
      capability?: unknown;
      expires_at?: unknown;
    } | null;
    if (
      !grant ||
      typeof grant.capability_id !== "string" ||
      typeof grant.capability !== "string" ||
      typeof grant.expires_at !== "number"
    ) {
      throw new NewApiError("New API 铸券响应无效", 502, "invalid_capability_response");
    }
    return {
      capability_id: grant.capability_id,
      capability: grant.capability,
      expires_at: grant.expires_at,
    };
  }
}
