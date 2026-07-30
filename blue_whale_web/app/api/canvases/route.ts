import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createCanvasDeps } from "@/lib/canvas/deps";
import { handleGetCanvas } from "@/lib/canvas/handle-canvas";

// GET /api/canvases?projectId=
export async function GET(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    return Response.json(
      await handleGetCanvas(userId, projectId, createCanvasDeps()),
    );
  });
}
