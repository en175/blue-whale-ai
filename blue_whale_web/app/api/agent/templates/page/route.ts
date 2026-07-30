import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createTemplatesDeps } from "@/lib/templates/deps";
import { handlePageTemplates } from "@/lib/templates/handle-templates";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/agent/templates/page?tagCode=&page=&size=
export async function GET(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request, JWT_SECRET);
    if (!userId)
      return Response.json({
        code: 401,
        msg: "未登录或 token 已过期",
        data: null,
      });
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
}
