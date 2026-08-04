import { authenticationErrorResponse } from "@/lib/account/bff";

import {
  AuthenticationError,
  getAuthenticatedUser,
  type AuthenticatedUser,
} from "./authenticated-user";

export async function withAuthenticatedUser(
  request: Request,
  handler: (user: AuthenticatedUser) => Promise<Response> | Response,
): Promise<Response> {
  let user: AuthenticatedUser;

  try {
    user = await getAuthenticatedUser(request);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return authenticationErrorResponse(error.status);
    }
    throw error;
  }

  return handler(user);
}

// 管理端统一入口：fresh 策略实时校验（安全操作不走身份缓存），非管理身份 403。
export async function withAdminUser(
  request: Request,
  handler: (user: AuthenticatedUser) => Promise<Response> | Response,
): Promise<Response> {
  let user: AuthenticatedUser;

  try {
    user = await getAuthenticatedUser(request, { policy: "fresh" });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return authenticationErrorResponse(error.status);
    }
    throw error;
  }

  if (!user.isAdmin) {
    return Response.json(
      { code: 403, msg: "需要管理员权限", data: null },
      { status: 403 },
    );
  }

  return handler(user);
}

// 公开路由统一入口（IK6GTT）：游客可访问；有有效 token 时解析身份传给 handler。
// 无 token / 无效 token（401/403）按游客放行；上游不可用（502/503）如实抛出，不静默降级。
export async function withOptionalUser(
  request: Request,
  handler: (user: AuthenticatedUser | null) => Promise<Response> | Response,
): Promise<Response> {
  let user: AuthenticatedUser | null = null;

  try {
    user = await getAuthenticatedUser(request);
  } catch (error) {
    if (error instanceof AuthenticationError && error.status !== 502 && error.status !== 503) {
      return handler(null);
    }
    throw error;
  }

  return handler(user);
}
