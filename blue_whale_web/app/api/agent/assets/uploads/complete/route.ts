import { createAssetCommitDeps } from "@/lib/assets/deps";
import {
  handleCompleteAsset,
  type CompleteAssetInput,
} from "@/lib/assets/handle-upload";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const input = (await request
      .json()
      .catch(() => ({}))) as CompleteAssetInput;
    return Response.json(
      await handleCompleteAsset(userId, input, createAssetCommitDeps()),
    );
  });
}
