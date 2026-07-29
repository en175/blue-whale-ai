import { createNewApiClient, NewApiError } from "@blue-whale/core";

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token.startsWith("sk-")) {
    return Response.json(
      { code: 401, msg: "缺少 sk-xxx token", data: null },
      { status: 401 },
    );
  }
  const baseUrl = process.env.NEW_API_BASE_URL;
  if (!baseUrl) {
    return Response.json(
      { code: 503, msg: "NEW_API_BASE_URL 未配置", data: null },
      { status: 503 },
    );
  }
  try {
    const usage = await createNewApiClient({ baseUrl }).getTokenUsage(token);
    return Response.json({
      code: 200,
      msg: null,
      data: { quota: usage.userQuota },
    });
  } catch (error) {
    const status =
      error instanceof NewApiError && error.status >= 400 && error.status < 500
        ? error.status
        : 502;
    return Response.json(
      {
        code: status,
        msg: error instanceof Error ? error.message : "余额服务不可用",
        data: null,
      },
      { status },
    );
  }
}
