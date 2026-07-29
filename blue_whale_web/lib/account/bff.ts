import {
  createNewApiClient,
  NewApiError,
  type NewApiAccountCapabilities,
  type NewApiAccountIdentity,
  type NewApiLoginInput,
  type NewApiLoginResult,
  type NewApiRegisterInput,
  type NewApiUsage,
} from "@blue-whale/core";

export interface AccountClient {
  getAccountCapabilities(): Promise<NewApiAccountCapabilities>;
  register(input: NewApiRegisterInput): Promise<NewApiLoginResult>;
  login(input: NewApiLoginInput): Promise<NewApiLoginResult>;
  resolveTokenIdentity(token: string): Promise<NewApiAccountIdentity>;
  getTokenUsage(token: string): Promise<NewApiUsage>;
}

export function createAccountClient(): AccountClient {
  const baseUrl = process.env.NEW_API_BASE_URL;
  if (!baseUrl) {
    throw new NewApiError("账户服务未配置", 503, "account_service_unavailable");
  }
  return createNewApiClient({ baseUrl });
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  return token.startsWith("sk-") ? token : null;
}

export function accountErrorResponse(error: unknown): Response {
  const status =
    error instanceof NewApiError && [401, 403, 502, 503].includes(error.status)
      ? error.status
      : 502;
  const messages: Record<number, string> = {
    401: "登录凭证无效",
    403: "账户已停用",
    502: "账户服务响应异常",
    503: "账户服务暂不可用",
  };
  return Response.json(
    { code: status, msg: messages[status], data: null },
    { status },
  );
}

export function loginEnvelope(result: NewApiLoginResult, isNewUser: boolean) {
  return {
    code: 200,
    msg: null,
    data: {
      access_token: result.token,
      refresh_token: "",
      expires_in: 0,
      user_id: result.userId,
      username: result.username,
      email: result.email ?? null,
      phone: "",
      is_new_user: isNewUser,
      has_password: true,
    },
  };
}
