import { withAdminUser } from "@/lib/auth/product-route-auth";
import { createTemplateUploadDeps } from "@/lib/template-admin/deps";
import {
  handlePresignTemplateUpload,
  type PresignTemplateUploadInput,
} from "@/lib/template-admin/upload";

/**
 * POST /api/admin/templates/uploads/presign —— 模板媒体上传签名（IK7JVE）
 *
 * 入参 {type: image|video, mime, size}，校验通过签发 TOS PUT URL；
 * 对象 key 前缀 admin/templates/，与用户 Asset（uploads/…）隔离。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withAdminUser(request, async () => {
    let input: PresignTemplateUploadInput;
    try {
      const body = await request.json();
      input = (body ?? {}) as PresignTemplateUploadInput;
    } catch {
      return Response.json(
        { success: false, error: "请求体须为 JSON" },
        { status: 400 },
      );
    }
    try {
      const result = await handlePresignTemplateUpload(
        input,
        createTemplateUploadDeps(),
      );
      if (!result.ok) {
        const status = result.error === "对象存储未配置" ? 503 : 400;
        return Response.json(
          { success: false, error: result.error },
          { status },
        );
      }
      return Response.json({ success: true, data: result.data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  });
}
