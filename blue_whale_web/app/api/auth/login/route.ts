import { createNewApiClient, NewApiError } from "@blue-whale/core";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    username?: unknown;
    password?: unknown;
  };
  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return Response.json(
      { code: 400, msg: "用户名和密码不能为空", data: null },
      { status: 400 },
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
    const result = await createNewApiClient({ baseUrl }).login({
      username,
      password,
    });
    return Response.json({
      code: 200,
      msg: null,
      data: {
        access_token: result.token,
        refresh_token: "",
        expires_in: 0,
        user_id: result.userId ?? 0,
        username: result.username ?? username,
        phone: "",
        is_new_user: false,
        has_password: true,
      },
    });
  } catch (error) {
    const status =
      error instanceof NewApiError &&
      (error.status === 200 || (error.status >= 400 && error.status < 500))
        ? error.status === 200
          ? 401
          : error.status
        : 502;
    const message = error instanceof Error ? error.message : "登录服务不可用";
    return Response.json(
      { code: status, msg: message, data: null },
      { status },
    );
  }
}
