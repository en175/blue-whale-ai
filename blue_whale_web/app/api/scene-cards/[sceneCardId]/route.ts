import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSceneCardResourceDeps } from "@/lib/conversation/deps";
import {
  handleDeleteSceneCardResource,
  handleGetSceneCardResource,
} from "@/lib/conversation/handle-scene-card-resource";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ sceneCardId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { sceneCardId } = await ctx.params;
    const result = await handleGetSceneCardResource(
      userId,
      sceneCardId,
      createSceneCardResourceDeps(),
    );
    return Response.json(result.body, {
      status: result.status,
      headers: result.etag ? { ETag: result.etag } : undefined,
    });
  });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ sceneCardId: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { sceneCardId } = await ctx.params;
    const result = await handleDeleteSceneCardResource(
      userId,
      sceneCardId,
      request.headers.get("If-Match"),
      request.headers.get("Idempotency-Key"),
      createSceneCardResourceDeps(),
    );
    if (result.status === 204) return new Response(null, { status: 204 });
    return Response.json(result.body, { status: result.status });
  });
}
