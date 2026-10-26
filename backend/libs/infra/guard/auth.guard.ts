import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError } from "@lib/core";
import {
  ACCOUNT_ERROR_ACCOUNT_DISABLED,
  ACCOUNT_ERROR_SESSION_EVICTED,
  ACCOUNT_ERROR_SESSION_EXPIRED,
} from "@lib/contracts";
import type { Request, Response } from "express";
import { AccountDirectoryService } from "@lib/shared/identity/index.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import { extractLoginToken } from "@lib/shared/session/login-token.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import { toAuthError } from "@lib/shared/errors/auth-error.js";
import { IS_PUBLIC_KEY } from "@lib/infra/decorators/public.decorator.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const ADMIN_ROLE_THRESHOLD = 10;
const ENABLED_STATUS = 1;

type RequestWithUser = Request & {
  user: AuthenticatedUser;
  loginToken?: string;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly directory: AccountDirectoryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const token = extractLoginToken(request);
    if (!token) {
      throw new ApiError("缺少登录凭证", 401, "unauthorized");
    }
    (request as RequestWithUser).loginToken = token;

    let claims;
    try {
      claims = await this.sessions.verifyToken(token);
    } catch {
      throw new ApiError(
        "登录已过期，请重新验证",
        401,
        ACCOUNT_ERROR_SESSION_EXPIRED,
      );
    }

    let session;
    try {
      session = await this.sessions.resolveSession(token);
    } catch (error) {
      if (error instanceof ApiError) throw toAuthError(error);
      throw new ApiError("会话服务暂不可用", 503, "session_service_error");
    }
    if (!session) {
      if (await this.sessions.wasEvicted(token)) {
        throw new ApiError(
          "登录已失效，账号已在其他浏览器登录，请重新验证",
          401,
          ACCOUNT_ERROR_SESSION_EVICTED,
        );
      }
      throw new ApiError(
        "登录已过期，请重新验证",
        401,
        ACCOUNT_ERROR_SESSION_EXPIRED,
      );
    }

    if (session.needsRecheck) {
      try {
        const { role, status } = await this.directory.resolveAccessState(
          session.userId,
        );
        session = {
          ...session,
          role,
          status,
          needsRecheck: false,
        };
        await this.sessions.updateSessionIdentity(token, { role, status });
      } catch {
      }
    }
    if (session.status !== ENABLED_STATUS) {
      throw new ApiError("账户已停用", 403, ACCOUNT_ERROR_ACCOUNT_DISABLED);
    }

    const remainingMs = claims.expiresAt - Date.now();
    if (remainingMs > 0) {
      response.cookie(SESSION_COOKIE_NAME, token, {
        ...sessionCookieOptions(),
        maxAge: remainingMs,
      });
    }

    (request as RequestWithUser).user = {
      userId: String(session.userId),
      status: "enabled",
      isAdmin: session.role >= ADMIN_ROLE_THRESHOLD,
      username: session.username,
      email: session.email,
    };
    return true;
  }
}
