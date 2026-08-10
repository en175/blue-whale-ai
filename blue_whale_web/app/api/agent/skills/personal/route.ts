import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSkillsDeps } from "@/lib/skills/deps";
import { handleCreateSkill } from "@/lib/skills/handle-skill-writes";

// POST /api/agent/skills/personal  body: { content: string }（SKILL.md 原文，IK60WU）
export async function POST(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const body = (await request.json().catch(() => ({}))) as {
      content?: string;
    };
    if (!body.content || typeof body.content !== "string") {
      return Response.json({ code: 400, msg: "content 参数缺失" });
    }
    return Response.json(
      await handleCreateSkill(userId, body.content, createSkillsDeps()),
    );
  });
}
