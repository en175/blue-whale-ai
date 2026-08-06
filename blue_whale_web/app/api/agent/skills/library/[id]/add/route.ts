import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSkillsDeps } from "@/lib/skills/deps";
import { handleAddSkill } from "@/lib/skills/handle-skill-writes";

// POST /api/agent/skills/library/{id}/add（{id} 即 creative_skill_id，稳定身份）
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const { id } = await ctx.params;
    return Response.json(await handleAddSkill(userId, id, createSkillsDeps()));
  });
}
