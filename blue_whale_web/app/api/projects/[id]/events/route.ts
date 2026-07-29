import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createProjectEventDeps } from "@/lib/project-events/deps";
import { handleProjectEvents } from "@/lib/project-events/handle-project-events";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    const after = new URL(request.url).searchParams.get("after") ?? "0";
    return handleProjectEvents(
      userId,
      id,
      after,
      createProjectEventDeps(),
      request.signal,
    );
  });
}
