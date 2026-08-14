import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  agentServiceRequest,
  authorizeAgentProject,
  capabilityFailureResponse,
  issueAgentRunCapability,
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
    const idempotencyKey =
      request.headers.get("idempotency-key") || crypto.randomUUID();
    const grant = await issueAgentRunCapability({
      userId,
      sessionId,
      traceId,
      idempotencyKey,
    });
    if (!grant) {
      return Response.json(
        {
          error: {
            code: "capability_service_unavailable",
            message: "模型授权服务未配置",
            trace_id: traceId,
          },
        },
        { status: 503 },
      );
    }
    if (!grant.ok) {
      return capabilityFailureResponse(grant.response, traceId);
    }
    const upstream = await agentServiceRequest(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      { userId, projectId, traceId },
      {
        method: "POST",
        body: await request.text(),
        signal: request.signal,
        headers: {
          "idempotency-key": idempotencyKey,
          "x-blue-whale-run-capability": grant.capability,
          "x-blue-whale-run-capability-id": grant.capabilityId,
        },
      },
    );
    return proxyAgentResponse(upstream);
  });
}
