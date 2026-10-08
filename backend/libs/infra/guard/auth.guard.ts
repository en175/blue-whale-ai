import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NewApiError } from "@lib/core";
import type { Request, Response } from "express";
import { IdentityService } from "@lib/shared/identity/index.js";
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
    private readonly identity: IdentityService,
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
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    (request as RequestWithUser).loginToken = token;

    // 第一道：验签与有效期（IKJAZL）。篡改过 / 过期的令牌在**碰 Redis 之前**就被挡掉——
    // 否则每一次伪造请求都要打一次 Redis，而鉴权是最容易被刷的那条路径。
    try {
      await this.sessions.verifyToken(token);
    } catch {
      throw new NewApiError("登录已过期，请重新登录", 401, "unauthorized");
    }

    let session;
    try {
      session = await this.sessions.resolveSession(token);
    } catch (error) {
      if (error instanceof NewApiError) throw toAuthError(error);
      throw new NewApiError("会话服务暂不可用", 503, "session_service_error");
    }
    if (!session) {
      throw new NewApiError("登录已过期，请重新登录", 401, "unauthorized");
    }

    // role/status 定期复核（冻结/降权近实时生效；我方身份库不可达时沿用缓存身份，不阻断请求）
    if (session.needsRecheck) {
      try {
        // ⚠️ 复核的是**会话里的 userId**，不是会话里的 sk——那把 key 是项目级统一
        //    key，拿它去问上游只会问出统一 key 属主一个人的 role/status。
        const { role, status } = await this.identity.resolveAccessState(
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
        // 身份库不可达：沿用缓存 role/status
      }
    }
    if (session.status !== ENABLED_STATUS) {
      throw new NewApiError("账户已停用", 403, "account_disabled");
    }

    // 滑动续期：刷新 HttpOnly cookie maxAge，与 Redis TTL 对齐（活跃用户不被 7 天硬踢）
    response.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());

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
