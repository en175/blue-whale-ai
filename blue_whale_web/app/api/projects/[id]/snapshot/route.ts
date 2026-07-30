import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSnapshotDeps } from "@/lib/snapshot/deps";
import { handleGetSnapshot } from "@/lib/snapshot/handle-get-snapshot";

// GET /api/projects/{id}/snapshot：画布恢复快照（project + canvas + 关联 generation_jobs 摘要）。
// 动态段沿用 [id]（与同级 [id]/route.ts 同名，避免 Next.js 动态段命名冲突）。
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    return Response.json(
      await handleGetSnapshot(userId, id, createSnapshotDeps()),
    );
  });
}
