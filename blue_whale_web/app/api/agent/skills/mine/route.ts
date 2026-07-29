import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSkillsDeps } from "@/lib/skills/deps";
import { handleListMine } from "@/lib/skills/handle-skills";

// POST /api/agent/skills/mine  body: {pageNum?, pageSize?}
export async function POST(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const body = (await request.json().catch(() => ({}))) as {
      pageNum?: number;
      pageSize?: number;
    };
    return Response.json(
      await handleListMine(userId, body, createSkillsDeps()),
    );
  });
}
