import { createAssetsDeps } from "@/lib/assets/deps";
import { handleListAssets } from "@/lib/assets/handle-list-assets";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

// GET /api/assets?type=&page=&size=
export async function GET(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
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
  });
}
