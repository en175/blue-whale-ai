import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createSkillsDeps } from "@/lib/skills/deps";
import { handleListLibrary } from "@/lib/skills/handle-skills";

// POST /api/agent/skills/library  body: {keyword?, category?, sort?, lang?, pageNum?, pageSize?}（契约 §11.5）
export async function POST(request: Request) {
  return withAuthenticatedUser(request, async ({ userId }) => {
    const body = (await request.json().catch(() => ({}))) as {
      keyword?: string;
      category?: "all" | "film" | "marketing" | "other";
      sort?: "featured" | "most_used" | "newest";
      lang?: "zh" | "en";
      pageNum?: number;
      pageSize?: number;
    };
    return Response.json(
      await handleListLibrary(userId, body, createSkillsDeps()),
    );
  });
}
