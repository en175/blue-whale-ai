import { createAssetsDeps } from "@/lib/assets/deps";
import { handleGetAsset } from "@/lib/assets/handle-get-asset";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { assetId } = await context.params;
    return Response.json(
      await handleGetAsset(userId, assetId, createAssetsDeps()),
    );
  });
}
