import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createAgentRunCommandDeps } from "@/lib/conversation/deps";
import { handleRetryAgentRun } from "@/lib/conversation/handle-agent-run-commands";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, runId } = await ctx.params;
    const result = await handleRetryAgentRun(
      userId,
      id,
      runId,
      request.headers.get("Idempotency-Key"),
      createAgentRunCommandDeps(),
    );
    return Response.json(result, {
      status: result.code === 200 ? 202 : 200,
    });
  });
}
