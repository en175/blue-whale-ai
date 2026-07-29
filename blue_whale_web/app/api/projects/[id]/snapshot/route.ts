import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createSnapshotDeps } from "@/lib/snapshot/deps";
import { handleGetSnapshot } from "@/lib/snapshot/handle-get-snapshot";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

function unauthorized() {
  return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
}

// GET /api/projects/{id}/snapshot：画布恢复快照（project + canvas + 关联 generation_jobs 摘要）。
// 动态段沿用 [id]（与同级 [id]/route.ts 同名，避免 Next.js 动态段命名冲突）。
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) return unauthorized();
  const { id } = await ctx.params;
  return Response.json(await handleGetSnapshot(userId, id, createSnapshotDeps()));
}
