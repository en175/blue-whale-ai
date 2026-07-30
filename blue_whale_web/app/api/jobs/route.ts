import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createJobsDeps } from "@/lib/jobs/deps";
import { handleListJobs } from "@/lib/jobs/handle-list-jobs";

// GET /api/jobs?type=&status=&projectId=&ids=&page=&size=
// IK50GB 断链：统一认证（withAuthenticatedUser），无 JWT_SECRET；
// ids 批量查询参数合入自 origin 视频/canvas 批量轮询特性。
export async function GET(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const q = new URL(request.url).searchParams;
    const rawIds = q.get("ids");
    const ids =
      rawIds === null ? undefined : rawIds.split(",").map((id) => id.trim());
    return Response.json(
      await handleListJobs(
        userId,
        {
          type: q.get("type") ?? undefined,
          status: q.get("status") ?? undefined,
          projectId: q.get("projectId") ?? undefined,
          ids,
          page: Math.max(1, Number(q.get("page") ?? "1") || 1),
          size: Math.max(1, Number(q.get("size") ?? "20") || 20),
        },
        createJobsDeps(),
      ),
    );
  });
}
