import { withAdminUser } from "@/lib/auth/product-route-auth";
import { createTemplateUploadDeps } from "@/lib/template-admin/deps";
import {
  handleCompleteTemplateUpload,
  type CompleteTemplateUploadInput,
} from "@/lib/template-admin/upload";

/**
 * POST /api/admin/templates/uploads/complete —— 模板媒体上传提交（IK7JVE）
 *
 * HEAD 比对 size/mime → 置对象 public-read → 记审计日志 → 返回公网 URL。
 * 不创建 Asset 行（ADR-0071）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withAdminUser(request, async () => {
    let input: CompleteTemplateUploadInput;
    try {
      const body = await request.json();
      input = (body ?? {}) as CompleteTemplateUploadInput;
    } catch {
      return Response.json(
        { success: false, error: "请求体须为 JSON" },
        { status: 400 },
      );
    }
    try {
      const result = await handleCompleteTemplateUpload(
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
