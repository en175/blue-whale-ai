import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createProjectDeps } from "@/lib/project/deps";
import { handleDeleteProject } from "@/lib/project/handle-delete-project";
import { handleGetProject } from "@/lib/project/handle-get-project";
import { handleRenameProject } from "@/lib/project/handle-rename-project";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

function unauthorized() {
  return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
}

// GET /api/projects/{id} / PUT(重命名) / DELETE(逻辑删)
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) return unauthorized();
  const { id } = await ctx.params;
  return Response.json(await handleGetProject(userId, id, createProjectDeps()));
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) return unauthorized();
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  return Response.json(await handleRenameProject(userId, id, body, createProjectDeps()));
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) return unauthorized();
  const { id } = await ctx.params;
  return Response.json(await handleDeleteProject(userId, id, createProjectDeps()));
}
