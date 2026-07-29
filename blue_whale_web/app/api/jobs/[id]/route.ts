import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createJobsDeps } from "@/lib/jobs/deps";
import { handleGetJobStatus } from "@/lib/jobs/handle-get-job-status";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/jobs/{id} → 轮询任务状态
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const { id } = await ctx.params;
  return Response.json(await handleGetJobStatus(userId, id, createJobsDeps()));
}
