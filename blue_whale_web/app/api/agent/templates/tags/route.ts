import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { handleListTags } from "@/lib/templates/handle-templates";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/agent/templates/tags
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  return Response.json(handleListTags());
}
