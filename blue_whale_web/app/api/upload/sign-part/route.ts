/**
 * POST /api/upload/sign-part（IK3PKB）：为指定分片签预签名 PUT URL。
 *
 * 前端拿 url 后直接 fetch PUT 文件分片字节到该 URL（直传 TOS，不经任何后端中转），
 * 从响应头取 ETag，complete 时回传。
 *
 * TODO(IK3PKB): preSignedURL 入参/返回字段以 @volcengine/tos-sdk v2.9.0 实际为准核实。
 */
import { NextRequest, NextResponse } from "next/server";
import { tosClient, TOS_BUCKET } from "@/lib/tos-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { storageKey?: string; uploadId?: string; partNumber?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: 400, msg: "请求体非 JSON" });
  }
  const { storageKey, uploadId, partNumber } = body;
  if (!storageKey || !uploadId || !partNumber) {
    return NextResponse.json({ code: 400, msg: "缺少 storageKey/uploadId/partNumber" });
  }
  try {
    const client = tosClient();
    // getPreSignedUrl 返回 string（预签名 URL）；字段 method/expires/query
    const url: string = await client.getPreSignedUrl({
      bucket: TOS_BUCKET,
      key: storageKey,
      method: "PUT",
      query: { uploadId: String(uploadId), partNumber: String(partNumber) },
      expires: 3600,
    });
    if (!url) {
      return NextResponse.json({ code: 500, msg: "签发分片 URL 失败" });
    }
    return NextResponse.json({ code: 200, data: { url } });
  } catch (e) {
    return NextResponse.json({ code: 500, msg: "sign-part 失败: " + (e as Error).message });
  }
}
