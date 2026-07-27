import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createSkillsDeps } from "@/lib/skills/deps";
import { handleListLibrary } from "@/lib/skills/handle-skills";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// POST /api/agent/skills/library  body: {keyword?, pageNum?, pageSize?}
export async function POST(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const body = (await request.json().catch(() => ({}))) as {
    keyword?: string;
    pageNum?: number;
    pageSize?: number;
  };
  return Response.json(await handleListLibrary(userId, body, createSkillsDeps()));
}
