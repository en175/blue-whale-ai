/**
 * POST /api/upload/complete（IK3PKB）：合并分片，完成上传。
 *
 * 前端把各分片 { PartNumber, ETag } 列表传来，调 completeMultipartUpload 合并。
 * 成功后前端再调后端 POST /api/agent/assets/upload/commit 落 Asset（HEAD 校验）。
 *
 * TODO(IK3PKB): completeMultipartUpload 入参/字段名以 @volcengine/tos-sdk v2.9.0 实际为准核实。
 */
import { NextRequest, NextResponse } from "next/server";
import { tosClient, TOS_BUCKET } from "@/lib/tos-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Part = { PartNumber: number; ETag: string };

export async function POST(req: NextRequest) {
  let body: { storageKey?: string; uploadId?: string; parts?: Part[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: 400, msg: "请求体非 JSON" });
  }
  const { storageKey, uploadId, parts } = body;
  if (!storageKey || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json({ code: 400, msg: "缺少 storageKey/uploadId/parts" });
  }
  try {
    const client = tosClient();
    // completeMultipartUpload 入参：parts[{eTag,partNumber}]（小写，直接数组）
    await client.completeMultipartUpload({
      bucket: TOS_BUCKET,
      key: storageKey,
      uploadId,
      parts: parts.map((p) => ({ partNumber: p.PartNumber, eTag: p.ETag })),
    });
    return NextResponse.json({ code: 200, data: { ok: true } });
  } catch (e) {
    return NextResponse.json({ code: 500, msg: "complete 失败: " + (e as Error).message });
  }
}
