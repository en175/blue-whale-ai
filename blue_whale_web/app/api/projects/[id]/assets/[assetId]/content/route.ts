import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createProjectAssetsDeps } from "@/lib/assets/deps";
import { handleContentAsset } from "@/lib/assets/handle-content-asset";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/projects/{projectId}/assets/{assetId}/content —— 返回资产原始字节。
// 对齐 Java ProjectAssetController#content：成功直接返字节 + content-type，失败才返信封。
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const { id: projectId, assetId } = await ctx.params;
  const result = await handleContentAsset(
    userId,
    projectId,
    assetId,
    createProjectAssetsDeps(),
  );
  if (!result.ok) {
    return Response.json({ code: result.code, msg: result.msg, data: null });
  }
  // TS lib 的 BodyInit 对泛型 Uint8Array<ArrayBufferLike> 收窄，运行时直接吃 Uint8Array；
  // 拷一份独立 ArrayBuffer 让类型与运行时都对齐（BodyInit 接受 ArrayBuffer）。
  const body = new Uint8Array(result.content).slice();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": result.mime,
      "content-length": String(result.content.byteLength),
    },
  });
}
