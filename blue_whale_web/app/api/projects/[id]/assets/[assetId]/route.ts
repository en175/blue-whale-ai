import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createProjectAssetsDeps } from "@/lib/assets/deps";
import { handleAccessAsset } from "@/lib/assets/handle-access-asset";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/projects/{projectId}/assets/{assetId} —— 签发资产短期可访问 URL。
// 对齐 Java ProjectAssetController#access → AssetAccessResponse { url, expires_at }。
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const { id: projectId, assetId } = await ctx.params;
  return Response.json(
    await handleAccessAsset(userId, projectId, assetId, createProjectAssetsDeps()),
  );
}
