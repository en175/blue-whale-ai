import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createProjectAssetsDeps } from "@/lib/assets/deps";
import { handleCopyAsset } from "@/lib/assets/handle-copy-asset";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// POST /api/projects/{projectId}/assets —— 跨项目复制资产（「添加到项目」）。
// body: { source_asset_id }，头 Idempotency-Key 必传。对齐 Java ProjectAssetController#copy。
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const { id: projectId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    source_asset_id?: unknown;
  };
  const idempotencyKey = request.headers.get("idempotency-key");
  return Response.json(
    await handleCopyAsset(userId, projectId, body, idempotencyKey, createProjectAssetsDeps()),
  );
}
