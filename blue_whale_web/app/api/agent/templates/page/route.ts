import { withOptionalUser } from "@/lib/auth/product-route-auth";
import { createTemplatesDeps } from "@/lib/templates/deps";
import { handlePageTemplates } from "@/lib/templates/handle-templates";

// GET /api/agent/templates/page?tagCode=&page=&size= —— 公开接口（IK6GM6）：模板卡片游客可见；
// 有有效 token 时携带身份（可选鉴权，IK6GTT）。
export async function GET(request: Request) {
  return withOptionalUser(request, async () => {
    try {
      const q = new URL(request.url).searchParams;
      const tagCode = q.get("tagCode") ?? "";
      return Response.json(
        await handlePageTemplates(
          tagCode,
          Math.max(1, Number(q.get("page") ?? "1") || 1),
          Math.max(1, Number(q.get("size") ?? "10") || 10),
          createTemplatesDeps(),
        ),
      );
    } catch (e) {
      console.error("[templates/page] error:", e);
      return Response.json(
        {
          code: 500,
          msg: `模板加载失败: ${e instanceof Error ? e.message : "未知错误"}`,
          data: null,
        },
        { status: 500 },
      );
    }
  });
}
