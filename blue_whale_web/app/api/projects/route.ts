import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createProjectDeps } from "@/lib/project/deps";
import { handleCreateProject } from "@/lib/project/handle-create-project";
import { handleListProjects } from "@/lib/project/handle-list-projects";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

function unauthorized() {
  return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
}

// GET /api/projects  → 列出当前用户画布
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) return unauthorized();
  return Response.json(await handleListProjects(userId, createProjectDeps()));
}

// POST /api/projects → 新建画布 {name}
export async function POST(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  return Response.json(await handleCreateProject(userId, body, createProjectDeps()));
}
