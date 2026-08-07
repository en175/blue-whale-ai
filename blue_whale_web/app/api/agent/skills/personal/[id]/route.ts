import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSkillsDeps } from "@/lib/skills/deps";
import {
  handleDeletePersonalSkill,
  handleGetPersonalSkill,
} from "@/lib/skills/handle-skill-writes";

// GET /api/agent/skills/personal/{id}（owner 只读正文） / DELETE（owner 永久删除）；
// {id} 即 creative_skill_id（契约 §13，IK60WZ）
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    return Response.json(
      await handleGetPersonalSkill(userId, id, createSkillsDeps()),
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
      await handleDeletePersonalSkill(userId, id, createSkillsDeps()),
    );
  });
}
