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
