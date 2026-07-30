import { createAssetPresignDeps } from "@/lib/assets/deps";
import {
  handlePresignAsset,
  type PresignAssetInput,
} from "@/lib/assets/handle-upload";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const input = (await request.json().catch(() => ({}))) as PresignAssetInput;
    return Response.json(
      await handlePresignAsset(userId, input, createAssetPresignDeps()),
    );
  });
}
