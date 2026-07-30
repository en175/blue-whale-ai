import { createAssetsDeps } from "@/lib/assets/deps";
import { handleDeleteAsset } from "@/lib/assets/handle-delete-asset";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { assetId } = await context.params;
    return Response.json(
      await handleDeleteAsset(userId, assetId, createAssetsDeps()),
    );
  });
}
