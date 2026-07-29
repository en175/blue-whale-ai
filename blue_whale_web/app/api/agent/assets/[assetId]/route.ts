import { createAssetsDeps } from "@/lib/assets/deps";
import { handleGetAsset } from "@/lib/assets/handle-get-asset";
import { getUserIdFromRequest } from "@/lib/auth/user-from-request";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) {
    return Response.json(
      { code: 401, msg: "未登录或 token 已过期", data: null },
      { status: 401 },
    );
  }
  const { assetId } = await context.params;
  return Response.json(await handleGetAsset(userId, assetId, createAssetsDeps()));
}
