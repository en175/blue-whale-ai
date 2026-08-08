import { withAdminUser } from "@/lib/auth/product-route-auth";
import { createTemplateAdminDeps } from "@/lib/template-admin/deps";
import { logImageMove } from "@/lib/template-admin/operation-log";
import {
  parseBigId,
  parseMoveDirection,
} from "@/lib/template-admin/validation";

/**
 * POST /api/admin/template-images/:id/move —— 卡片图片上移/下移（IK764F）
 * body: { direction: "up" | "down" }；已在边缘 → 409。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAdminUser(request, async () => {
    const { id: idRaw } = await params;
    const id = parseBigId(idRaw);
    if (!id) {
      return Response.json(
        { success: false, error: "id 无效" },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { success: false, error: "请求体须为 JSON" },
        { status: 400 },
      );
    }
    const direction = parseMoveDirection(
      (body as { direction?: unknown })?.direction,
    );
    if (!direction) {
      return Response.json(
        { success: false, error: "direction 须为 up/down" },
        { status: 400 },
      );
    }

    try {
      const { admin } = createTemplateAdminDeps();
      const result = await admin.moveImage(id, direction);
      if (!result.ok) {
        return Response.json(
          {
            success: false,
            error: result.reason === "boundary" ? "已在边缘" : "图片不存在",
          },
          { status: result.reason === "boundary" ? 409 : 404 },
        );
      }
      await logImageMove(`图片#${idRaw}`, direction);
      return Response.json({ success: true, data: { id: idRaw } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  });
}
