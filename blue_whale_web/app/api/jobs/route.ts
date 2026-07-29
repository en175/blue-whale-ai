import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createJobsDeps } from "@/lib/jobs/deps";
import { handleListJobs } from "@/lib/jobs/handle-list-jobs";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/jobs?type=&status=&projectId=&page=&size=
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const q = new URL(request.url).searchParams;
  return Response.json(
    await handleListJobs(
      userId,
      {
        type: q.get("type") ?? undefined,
        status: q.get("status") ?? undefined,
        projectId: q.get("projectId") ?? undefined,
        page: Math.max(1, Number(q.get("page") ?? "1") || 1),
        size: Math.max(1, Number(q.get("size") ?? "20") || 20),
      },
      createJobsDeps(),
    ),
  );
}
