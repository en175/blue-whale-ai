import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createSkillsDeps } from "@/lib/skills/deps";
import { handleRemoveSkill, handleUpdateSkillAuto } from "@/lib/skills/handle-skill-writes";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// DELETE /api/agent/skills/mine/{id}（移除） / PATCH（切 auto）
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const { id } = await ctx.params;
  return Response.json(await handleRemoveSkill(userId, id, createSkillsDeps()));
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { auto?: unknown };
  const auto = body.auto === true;
  return Response.json(await handleUpdateSkillAuto(userId, id, auto, createSkillsDeps()));
}
