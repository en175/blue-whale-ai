import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createCanvasDeps } from "@/lib/canvas/deps";
import { handleSaveCanvas } from "@/lib/canvas/handle-canvas";

// PUT /api/canvases/{projectId}  body: {viewport, nodes}（JSON 字符串）
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ projectId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { projectId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      viewport?: unknown;
      nodes?: unknown;
    };
    return Response.json(
      await handleSaveCanvas(userId, projectId, body, createCanvasDeps()),
    );
  });
}
