import { createProjectAssetsDeps } from "@/lib/assets/deps";
import { handleAccessAsset } from "@/lib/assets/handle-access-asset";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

// GET /api/projects/{projectId}/assets/{assetId} —— 签发资产短期可访问 URL。
// 对齐 Java ProjectAssetController#access → AssetAccessResponse { url, expires_at }。
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id: projectId, assetId } = await ctx.params;
    return Response.json(
      await handleAccessAsset(
        userId,
        projectId,
        assetId,
        createProjectAssetsDeps(),
      ),
    );
  });
}
