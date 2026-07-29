import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createProjectDeps } from "@/lib/project/deps";
import { handleCreateProject } from "@/lib/project/handle-create-project";
import { handleListProjects } from "@/lib/project/handle-list-projects";

// GET /api/projects  → 列出当前用户画布
export async function GET(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) =>
    Response.json(await handleListProjects(userId, createProjectDeps())),
  );
}

// POST /api/projects → 新建画布 {name}
export async function POST(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    return Response.json(
      await handleCreateProject(userId, body, createProjectDeps()),
    );
  });
}
