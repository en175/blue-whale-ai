import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createSkillsDeps } from "@/lib/skills/deps";
import { handleAddSkill } from "@/lib/skills/handle-skill-writes";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// POST /api/agent/skills/library/{id}/add
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const { id } = await ctx.params;
  return Response.json(await handleAddSkill(userId, id, createSkillsDeps()));
}
