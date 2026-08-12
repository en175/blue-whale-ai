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
        { error: { code: "agent_service_unavailable", message: "Agent 服务未配置" } },
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
      resource_id: `run_${crypto.randomUUID()}`,
      models: ["MiniMax-M3"],
      max_model_calls: 1,
      max_input_tokens: 40_000,
      max_output_tokens: 8_000,
      expires_at: Math.floor(Date.now() / 1000) + 300,
      idempotency_key: `${input.sessionId}:${crypto.randomUUID()}`,
      trace_id: input.traceId,
    }),
  });
  if (!response.ok) return { ok: false, response };
  const body = (await response.json()) as { capability?: unknown; capability_id?: unknown };
  if (typeof body.capability !== "string" || typeof body.capability_id !== "string") {
    return { ok: false, response: Response.json({ error: { code: "capability_invalid" } }, { status: 502 }) };
  }
  return { ok: true, capability: body.capability, capabilityId: body.capability_id };
}

export function proxyAgentResponse(upstream: Response): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "cache-control": upstream.headers.get("cache-control") ?? "no-cache",
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-trace-id": upstream.headers.get("x-trace-id") ?? "",
    },
  });
}
