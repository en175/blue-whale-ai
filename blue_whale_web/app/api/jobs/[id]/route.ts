import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createJobsDeps } from "@/lib/jobs/deps";
import { handleGetJobStatus } from "@/lib/jobs/handle-get-job-status";

// GET /api/jobs/{id} → 轮询任务状态
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    return Response.json(
      await handleGetJobStatus(userId, id, createJobsDeps()),
    );
  });
}
