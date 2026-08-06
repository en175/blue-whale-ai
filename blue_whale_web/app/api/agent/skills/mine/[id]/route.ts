import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSkillsDeps } from "@/lib/skills/deps";
import {
  handleRemoveSkill,
  handleUpdateSkillAuto,
} from "@/lib/skills/handle-skill-writes";

// DELETE /api/agent/skills/mine/{id}（移除） / PATCH（切 auto）；{id} 即 creative_skill_id（稳定身份）
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    return Response.json(
      await handleRemoveSkill(userId, id, createSkillsDeps()),
    );
  });
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { auto?: unknown };
    const auto = body.auto === true;
    return Response.json(
      await handleUpdateSkillAuto(userId, id, auto, createSkillsDeps()),
    );
  });
}
