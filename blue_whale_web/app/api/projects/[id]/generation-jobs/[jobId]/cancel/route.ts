import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createGenerationCommandDeps } from "@/lib/generation/deps";
import { handleCancelGenerationJob } from "@/lib/generation/handle-cancel-generation-job";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// POST /api/projects/{id}/generation-jobs/{jobId}/cancel
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; jobId: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const { id, jobId } = await ctx.params;
  return Response.json(
    await handleCancelGenerationJob(userId, id, jobId, createGenerationCommandDeps()),
  );
}
