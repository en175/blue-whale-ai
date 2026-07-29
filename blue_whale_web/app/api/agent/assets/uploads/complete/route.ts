import { createAssetCommitDeps } from "@/lib/assets/deps";
import {
  handleCompleteAsset,
  type CompleteAssetInput,
} from "@/lib/assets/handle-upload";
import { getUserIdFromRequest } from "@/lib/auth/user-from-request";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) {
    return Response.json(
      { code: 401, msg: "未登录或 token 已过期", data: null },
      { status: 401 },
    );
  }
  const input = (await request.json().catch(() => ({}))) as CompleteAssetInput;
  return Response.json(
    await handleCompleteAsset(userId, input, createAssetCommitDeps()),
  );
}
