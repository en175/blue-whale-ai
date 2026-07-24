/**
 * POST /api/upload/prepare（IK3PKB）：校验 + 生成 storageKey + 初始化分片上传拿 uploadId。
 *
 * 前端拿 { storageKey, uploadId, partSize } 后，逐片调 /api/upload/sign-part 拿预签名 URL 上传。
 *
 * TODO(IK3PKB): TosClient.createMultipartUpload 返回的 uploadId 字段路径以 @volcengine/tos-sdk
 * v2.9.0 实际返回为准核实（此处兼容 data.UploadId / UploadId）。配好 AK/SK 后联调校正。
 */
import { NextRequest, NextResponse } from "next/server";
import { MAX_SIZE, PART_SIZE, buildStorageKey, tosClient, TOS_BUCKET } from "@/lib/tos-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { projectId?: number; type?: string; contentType?: string; size?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: 400, msg: "请求体非 JSON" });
  }
  const { projectId, type, contentType, size } = body;
  if (!projectId || !type || !contentType || !size) {
    return NextResponse.json({ code: 400, msg: "缺少 projectId/type/contentType/size" });
  }
  const max = MAX_SIZE[type];
  if (!max) {
    return NextResponse.json({ code: 400, msg: "不支持的资源类型: " + type });
  }
  if (!contentType.startsWith(type + "/")) {
    return NextResponse.json({ code: 400, msg: "文件类型与声明类型不匹配" });
  }
  if (size > max) {
    return NextResponse.json({ code: 400, msg: `文件超出大小限制（${type}≤${max / 1024 / 1024}MB）` });
  }
  try {
    const key = buildStorageKey(projectId, type, contentType);
    const client = tosClient();
    // acl=public-read：对齐后端中转 putObject 的 ACL_PUBLIC_READ，对象可裸 GET（<img src>）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await client.createMultipartUpload({ bucket: TOS_BUCKET, key, acl: "public-read" });
    const uploadId = res?.data?.UploadId ?? res?.UploadId ?? res?.data?.uploadId;
    if (!uploadId) {
      return NextResponse.json({ code: 500, msg: "初始化分片上传失败：未拿到 uploadId" });
    }
    return NextResponse.json({ code: 200, data: { storageKey: key, uploadId, partSize: PART_SIZE } });
  } catch (e) {
    return NextResponse.json({ code: 500, msg: "prepare 失败: " + (e as Error).message });
  }
}
