import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  agentServiceRequest,
  authorizeAgentProject,
  proxyAgentResponse,
} from "@/lib/agent-service/bff";

async function authorize(projectId: string, userId: string) {
  if (!(await authorizeAgentProject(userId, projectId))) {
    return Response.json(
      { error: { code: "project_not_found", message: "Project 不存在" } },
      { status: 404 },
    );
  }
  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { projectId } = await context.params;
    const denied = await authorize(projectId, userId);
    if (denied) return denied;
    const traceId = request.headers.get("x-trace-id") || crypto.randomUUID();
    const upstream = await agentServiceRequest(
      `/v1/sessions?context_kind=blue_whale_project&external_project_id=${encodeURIComponent(projectId)}&lifecycle=active`,
      { userId, projectId, traceId },
      { method: "GET" },
    );
    return proxyAgentResponse(upstream);
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { projectId } = await context.params;
    const denied = await authorize(projectId, userId);
    if (denied) return denied;
    const traceId = request.headers.get("x-trace-id") || crypto.randomUUID();
    const idempotencyKey =
      request.headers.get("idempotency-key") || crypto.randomUUID();
    const upstream = await agentServiceRequest(
      "/v1/sessions",
      { userId, projectId, traceId },
      {
        method: "POST",
        body: JSON.stringify({
          context: {
            kind: "blue_whale_project",
            external_project_id: projectId,
          },
        }),
        headers: { "idempotency-key": idempotencyKey },
      },
    );
    return proxyAgentResponse(upstream);
  });
}
