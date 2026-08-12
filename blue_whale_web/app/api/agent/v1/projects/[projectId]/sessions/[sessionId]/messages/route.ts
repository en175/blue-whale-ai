import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  agentServiceRequest,
  authorizeAgentProject,
  proxyAgentResponse,
} from "@/lib/agent-service/bff";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; sessionId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { projectId, sessionId } = await context.params;
    if (!(await authorizeAgentProject(userId, projectId))) {
      return Response.json(
        { error: { code: "project_not_found", message: "Project 不存在" } },
        { status: 404 },
      );
    }
    const traceId = request.headers.get("x-trace-id") || crypto.randomUUID();
    const upstream = await agentServiceRequest(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      { userId, projectId, traceId },
      { method: "POST", body: await request.text(), signal: request.signal },
    );
    return proxyAgentResponse(upstream);
  });
}
