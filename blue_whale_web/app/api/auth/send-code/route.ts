import { createAuthDeps } from "@/lib/auth/deps";
import { handleSendCode } from "@/lib/auth/handle-send-code";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { phone?: unknown };
  const fwd = request.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() ?? "unknown";
  const result = await handleSendCode({ phone: body.phone, ip }, createAuthDeps());
  return Response.json(result);
}
