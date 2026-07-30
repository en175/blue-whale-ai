import { NewApiError } from "@blue-whale/core";

import {
  accountErrorResponse,
  createAccountClient,
  loginEnvelope,
  type AccountClient,
} from "@/lib/account/bff";

export function createLoginHandler(client: Pick<AccountClient, "login">) {
  return async function POST(request: Request) {
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
    try {
      const result = await client.login({ username, password });
      return Response.json(loginEnvelope(result, false));
    } catch (error) {
      if (error instanceof NewApiError && error.status === 200) {
        return accountErrorResponse(
          new NewApiError("登录凭证无效", 401, "invalid_credentials"),
        );
      }
      return accountErrorResponse(error);
    }
  };
}

export async function POST(request: Request) {
  try {
    return await createLoginHandler(createAccountClient())(request);
  } catch (error) {
    return accountErrorResponse(error);
  }
}
