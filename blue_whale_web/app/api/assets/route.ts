import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createAssetsDeps } from "@/lib/assets/deps";
import { handleListAssets } from "@/lib/assets/handle-list-assets";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/assets?type=&page=&size=
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const q = new URL(request.url).searchParams;
  return Response.json(
    await handleListAssets(
      userId,
      {
        type: q.get("type") ?? undefined,
        page: Math.max(1, Number(q.get("page") ?? "1") || 1),
        size: Math.max(1, Number(q.get("size") ?? "24") || 24),
      },
      createAssetsDeps(),
    ),
  );
}
