import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createGenerationCommandDeps } from "@/lib/generation/deps";
import { handleCancelGenerationJob } from "@/lib/generation/handle-cancel-generation-job";

// POST /api/projects/{id}/generation-jobs/{jobId}/cancel
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; jobId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id, jobId } = await ctx.params;
    return Response.json(
      await handleCancelGenerationJob(
        userId,
        id,
        jobId,
        createGenerationCommandDeps(),
      ),
    );
  });
}
