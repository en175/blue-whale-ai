import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  agentServiceRequest,
  authorizeAgentProject,
  proxyAgentResponse,
} from "@/lib/agent-service/bff";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { projectId } = await context.params;
    if (!(await authorizeAgentProject(userId, projectId))) {
      return Response.json(
        { error: { code: "project_not_found", message: "Project 不存在" } },
        { status: 404 },
      );
    }
    const traceId = request.headers.get("x-trace-id") || crypto.randomUUID();
    const upstream = await agentServiceRequest(
      "/v1/sessions",
      { userId, projectId, traceId },
      { method: "POST", body: "{}" },
    );
    return proxyAgentResponse(upstream);
  });
}
