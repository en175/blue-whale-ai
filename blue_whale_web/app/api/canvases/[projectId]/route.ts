import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createCanvasDeps } from "@/lib/canvas/deps";
import { handleSaveCanvas } from "@/lib/canvas/handle-canvas";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// PUT /api/canvases/{projectId}  body: {viewport, nodes}（JSON 字符串）
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const { projectId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    viewport?: unknown;
    nodes?: unknown;
  };
  return Response.json(
    await handleSaveCanvas(userId, projectId, body, createCanvasDeps()),
  );
}
