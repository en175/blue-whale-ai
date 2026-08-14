import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  agentServiceRequest,
  authorizeAgentProject,
  capabilityFailureResponse,
  issueAgentRunCapability,
  proxyAgentResponse,
} from "@/lib/agent-service/bff";

const commands = new Set(["cancel", "retry", "resume", "skip"]);

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      projectId: string;
      sessionId: string;
      runId: string;
      command: string;
    }>;
  },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { projectId, sessionId, runId, command } = await context.params;
    if (!commands.has(command)) {
      return Response.json(
        {
          error: { code: "command_not_found", message: "Agent Run 命令不存在" },
        },
        { status: 404 },
      );
    }
    if (!(await authorizeAgentProject(userId, projectId))) {
      return Response.json(
        { error: { code: "project_not_found", message: "Project 不存在" } },
        { status: 404 },
      );
    }
    const traceId = request.headers.get("x-trace-id") || crypto.randomUUID();
    const idempotencyKey =
      request.headers.get("idempotency-key") || crypto.randomUUID();
    const actionId = request.headers.get("x-agent-action-id") || idempotencyKey;
    const headers: Record<string, string> = {
      "idempotency-key": idempotencyKey,
    };

    if (command === "retry" || command === "resume") {
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
      if (!grant.ok) return capabilityFailureResponse(grant.response, traceId);
      headers["x-blue-whale-run-capability"] = grant.capability;
      headers["x-blue-whale-run-capability-id"] = grant.capabilityId;
    }

    const upstream = await agentServiceRequest(
      `/v1/runs/${encodeURIComponent(runId)}/${command}`,
      { userId, projectId, traceId },
      {
        method: "POST",
        body: JSON.stringify({ action_id: actionId }),
        headers,
        signal: request.signal,
      },
    );
    return proxyAgentResponse(upstream);
  });
}
