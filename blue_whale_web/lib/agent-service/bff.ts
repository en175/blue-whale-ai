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
