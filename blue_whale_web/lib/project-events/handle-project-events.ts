import { RESOURCE_NOT_FOUND_CODE, fail } from "@blue-whale/contracts";
import type { ProductEventRepo, ProjectRepo } from "@blue-whale/persistence";

import { createProjectEventStream } from "./project-event-stream";

export async function handleProjectEvents(
  userId: string,
  projectId: string,
  after: string,
  deps: {
    projects: Pick<ProjectRepo, "findOwnedById">;
    events: ProductEventRepo;
  },
  signal?: AbortSignal,
): Promise<Response> {
  if (!/^[0-9]+$/.test(after)) {
    return Response.json(fail(400, "after 游标无效"), { status: 400 });
  }
  const project = await deps.projects.findOwnedById(projectId, userId);
  if (!project) {
    return Response.json(fail(RESOURCE_NOT_FOUND_CODE, "资源不存在"), {
      status: 404,
    });
  }
  return new Response(
    createProjectEventStream({
      projectId,
      after,
      events: deps.events,
      signal,
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "private, no-store, no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    },
  );
}
