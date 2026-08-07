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
    const ifMatch = request.headers.get("If-Match");
    let expectedVersion: number | null | undefined;
    if (ifMatch === '"missing"') {
      expectedVersion = null;
    } else if (ifMatch !== null) {
      const match = /^"([0-9]+)"$/.exec(ifMatch);
      if (!match?.[1]) {
        return Response.json(
          { code: 400, msg: "无效的 If-Match", data: null },
          { status: 400 },
        );
      }
      expectedVersion = Number(match[1]);
    }
    const result = await handleSaveCanvas(
      userId,
      projectId,
      { ...body, expectedVersion },
      createCanvasDeps(),
    );
    return Response.json(result, { status: result.code === 412 ? 412 : 200 });
  });
}
