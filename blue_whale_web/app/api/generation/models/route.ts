import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createGenerationDeps } from "@/lib/generation/deps";
import { handleListModels } from "@/lib/generation/handle-list-models";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/generation/models?capability=image
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId)
    return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const capability =
    new URL(request.url).searchParams.get("capability") ?? "image";
  return Response.json(await handleListModels(capability, createGenerationDeps()));
}
