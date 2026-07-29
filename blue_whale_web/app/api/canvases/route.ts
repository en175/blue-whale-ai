import { getUserIdFromRequest } from "@/lib/auth/user-from-request";
import { createCanvasDeps } from "@/lib/canvas/deps";
import { handleGetCanvas } from "@/lib/canvas/handle-canvas";

const JWT_SECRET =
  process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";

// GET /api/canvases?projectId=
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request, JWT_SECRET);
  if (!userId) return Response.json({ code: 401, msg: "未登录或 token 已过期", data: null });
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  return Response.json(await handleGetCanvas(userId, projectId, createCanvasDeps()));
}
