import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createProjectDeps } from "@/lib/project/deps";
import { handleDeleteProject } from "@/lib/project/handle-delete-project";
import { handleGetProject } from "@/lib/project/handle-get-project";
import { handleRenameProject } from "@/lib/project/handle-rename-project";

// GET /api/projects/{id} / PUT(重命名) / DELETE(逻辑删)
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    return Response.json(
      await handleGetProject(userId, id, createProjectDeps()),
    );
  });
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    return Response.json(
      await handleRenameProject(userId, id, body, createProjectDeps()),
    );
  });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    return Response.json(
      await handleDeleteProject(userId, id, createProjectDeps()),
    );
  });
}
