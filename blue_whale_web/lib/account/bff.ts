import {
  NewApiError,
  type NewApiAccountCapabilities,
  type NewApiAccountIdentity,
  type NewApiLoginInput,
  type NewApiLoginResult,
  type NewApiRegisterInput,
  type NewApiUsage,
} from "@blue-whale/core";
import { createWebNewApiClient } from "@/lib/logging";

import { parseNewApiBearerToken } from "@/lib/auth/bearer-token";
import { userAuthFailureHeaders } from "@/lib/auth/session-failure";

export interface AccountClient {
  getAccountCapabilities(): Promise<NewApiAccountCapabilities>;
  register(input: NewApiRegisterInput): Promise<NewApiLoginResult>;
  login(input: NewApiLoginInput): Promise<NewApiLoginResult>;
  resolveTokenIdentity(token: string): Promise<NewApiAccountIdentity>;
  getTokenUsage(token: string): Promise<NewApiUsage>;
}

type AuthenticationErrorStatus = 401 | 403 | 502 | 503;

const authenticationErrorMessages: Record<AuthenticationErrorStatus, string> = {
  401: "登录凭证无效",
  403: "账户已停用",
  502: "账户服务响应异常",
  503: "账户服务暂不可用",
};

export function authenticationErrorResponse(
  status: AuthenticationErrorStatus,
): Response {
  // 401 带用户会话失效标记（IK8N1S）：前端只在该标记存在时才登出。
  return Response.json(
    { code: status, msg: authenticationErrorMessages[status], data: null },
    { status, headers: status === 401 ? userAuthFailureHeaders() : undefined },
  );
}

/** 请求缺少用户凭证时的统一 401（带用户会话失效标记，IK8N1S）。 */
export function userCredentialRequiredResponse(message: string): Response {
  return Response.json(
    { code: 401, msg: message, data: null },
    { status: 401, headers: userAuthFailureHeaders() },
  );
}

export function createAccountClient(): AccountClient {
  const baseUrl = process.env.NEW_API_BASE_URL;
  if (!baseUrl) {
    throw new NewApiError("账户服务未配置", 503, "account_service_unavailable");
  }
  return createWebNewApiClient({ baseUrl });
}

export function bearerToken(request: Request): string | null {
  return parseNewApiBearerToken(request.headers.get("authorization"));
}

export function accountErrorResponse(error: unknown): Response {
  if (error instanceof NewApiError) {
    switch (error.status) {
      case 401:
      case 403:
      case 502:
      case 503:
        return authenticationErrorResponse(error.status);
    }
  }

  return authenticationErrorResponse(502);
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
