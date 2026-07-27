import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createUserDeps } from "@/lib/user/deps";
import { handleGetMe } from "@/lib/user/handle-get-me";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/me
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  return Response.json(await handleGetMe(userId, createUserDeps()));
}
