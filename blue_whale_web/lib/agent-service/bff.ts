import { createProjectDeps } from "@/lib/project/deps";

export type AgentBffContext = {
  userId: string;
  projectId: string;
  traceId: string;
};

function config() {
  const baseUrl = process.env.AGENT_SERVICE_BASE_URL?.replace(/\/+$/, "");
  const serviceToken = process.env.AGENT_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken) return null;
  return { baseUrl, serviceToken };
}

export async function authorizeAgentProject(userId: string, projectId: string) {
  return createProjectDeps().db.findOwnedById(projectId, userId);
}

export function agentServiceRequest(
  path: string,
  context: AgentBffContext,
  init: RequestInit = {},
): Promise<Response> {
  const current = config();
  if (!current) {
    return Promise.resolve(
      Response.json(
        {
          error: {
            code: "agent_service_unavailable",
            message: "Agent 服务未配置",
          },
        },
        { status: 503 },
      ),
    );
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${current.serviceToken}`);
  headers.set("content-type", "application/json");
  headers.set("x-blue-whale-tenant-id", `personal:${context.userId}`);
  headers.set("x-blue-whale-user-id", context.userId);
  headers.set("x-blue-whale-project-id", context.projectId);
  headers.set("x-trace-id", context.traceId);
  return fetch(`${current.baseUrl}${path}`, { ...init, headers });
}

export async function issueAgentRunCapability(input: {
  userId: string;
  sessionId: string;
  traceId: string;
  idempotencyKey: string;
}): Promise<
  | null
  | { ok: true; capability: string; capabilityId: string }
  | { ok: false; response: Response }
> {
  const baseUrl = process.env.NEW_API_BASE_URL?.replace(/\/+$/, "");
  const serviceToken = process.env.BLUE_WHALE_INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken) return null;
  const response = await fetch(`${baseUrl}/internal/v1/model-capabilities`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceToken}`,
      "content-type": "application/json",
      "x-trace-id": input.traceId,
    },
    body: JSON.stringify({
      subject_user_id: Number(input.userId),
      consumer: "blue-whale-agent-runtime",
      purpose: "agent_run",
      resource_id: `session:${input.sessionId}:message:${input.idempotencyKey}`,
      models: ["MiniMax-M3"],
      max_model_calls: 4,
      max_input_tokens: 40_000,
      max_output_tokens: 8_000,
      expires_at: Math.floor(Date.now() / 1000) + 300,
      idempotency_key: `${input.sessionId}:${input.idempotencyKey}`,
      trace_id: input.traceId,
    }),
  });
  if (!response.ok) return { ok: false, response };
  const body = (await response.json()) as {
    capability?: unknown;
    capability_id?: unknown;
  };
  if (
    typeof body.capability !== "string" ||
    typeof body.capability_id !== "string"
  ) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: "capability_invalid" } },
        { status: 502 },
      ),
    };
  }
  return {
    ok: true,
    capability: body.capability,
    capabilityId: body.capability_id,
  };
}

/**
 * Capability 签发失败映射（IK8N1S）：new-api 的 401/403/5xx 都是依赖侧故障，
 * 不是浏览器调用者的身份问题，统一归 502，避免前端把服务间鉴权失败误判为
 * 用户登录失效。402（余额不足）是用户可行动的真实信息，保持透传。
 */
export function capabilityFailureResponse(
  upstream: Response,
  traceId: string,
): Response {
  if (upstream.status === 402) {
    return Response.json(
      {
        error: {
          code: "payment_required",
          message: "余额不足，请充值后继续",
          trace_id: traceId,
        },
      },
      { status: 402 },
    );
  }
  return Response.json(
    {
      error: {
        code: "capability_upstream_unauthorized",
        message: "模型授权服务暂时不可用，请稍后重试",
        trace_id: traceId,
      },
    },
    { status: 502 },
  );
}

export function proxyAgentResponse(upstream: Response): Response {
  // Agent 服务的 401（unauthorized / capability_required）是服务身份失败，
  // 与浏览器用户凭证无关；映射为 502，前端不会触发登出（IK8N1S）。
  if (upstream.status === 401) {
    return Response.json(
      {
        error: {
          code: "agent_upstream_unauthorized",
          message: "Agent 服务暂时不可用，请稍后重试",
          trace_id: upstream.headers.get("x-trace-id") ?? "",
        },
      },
      { status: 502 },
    );
  }
  const etag = upstream.headers.get("etag");
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "cache-control": upstream.headers.get("cache-control") ?? "no-cache",
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "x-trace-id": upstream.headers.get("x-trace-id") ?? "",
      ...(etag ? { etag } : {}),
    },
  });
}
