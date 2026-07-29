import { createProjectAssetsDeps } from "@/lib/assets/deps";
import { handleCopyAsset } from "@/lib/assets/handle-copy-asset";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

// POST /api/projects/{projectId}/assets —— 跨项目复制资产（「添加到项目」）。
// body: { source_asset_id }，头 Idempotency-Key 必传。对齐 Java ProjectAssetController#copy。
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id: projectId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      source_asset_id?: unknown;
    };
    const idempotencyKey = request.headers.get("idempotency-key");
    return Response.json(
      await handleCopyAsset(
        userId,
        projectId,
        body,
        idempotencyKey,
        createProjectAssetsDeps(),
      ),
    );
  });
}
