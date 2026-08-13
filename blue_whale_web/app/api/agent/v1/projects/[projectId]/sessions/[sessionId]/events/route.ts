import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  agentServiceRequest,
  authorizeAgentProject,
  proxyAgentResponse,
} from "@/lib/agent-service/bff";

export async function GET(
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
    const after = new URL(request.url).searchParams.get("after");
    const path = `/v1/sessions/${encodeURIComponent(sessionId)}/events${after ? `?after=${encodeURIComponent(after)}` : ""}`;
    const upstream = await agentServiceRequest(
      path,
      { userId, projectId, traceId },
      {
        method: "GET",
        signal: request.signal,
        headers: { accept: "text/event-stream" },
      },
    );
    return proxyAgentResponse(upstream);
  });
}
