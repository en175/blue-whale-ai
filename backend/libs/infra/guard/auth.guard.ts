import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NewApiError } from "@lib/core";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import type { Request, Response } from "express";
import { IdentityService } from "@lib/shared/identity/index.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import { extractLoginToken } from "@lib/shared/session/login-token.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@lib/shared/session/cookie.js";
import { toAuthError } from "@lib/shared/errors/auth-error.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { IS_PUBLIC_KEY } from "@lib/infra/decorators/public.decorator.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const ADMIN_ROLE_THRESHOLD = 10;
const ENABLED_STATUS = 1;

type RequestWithUser = Request & { user: AuthenticatedUser };

/**
 * 全局守卫（ADR-0062 #19 凭证分层）：浏览器登录态走 HttpOnly 会话 cookie
 * （`bw_session`），BFF 本地校验会话后把**项目统一 key** 回注请求头，下游业务接口
 * 继续以 `Bearer sk-...` 自解析、代打 new-api，无需逐处改动。
 * - 每次鉴权刷新 cookie maxAge，与 Redis 7 天滑动 TTL 对齐（活跃用户不踢）
 * - role/status 超 ROLE_STATUS_RECHECK_MS 回源**我们自己的身份库**复核，冻结/降权近实时生效
 *
 * <h2>回注的那把 key 从哪来：**当前配置**，不是会话快照</h2>
 *
 * 它一度随会话存放在 Redis 里，于是「管理端换了 key」对已登录用户不生效——每个人手里
 * 都是登录那一刻的快照，最长 7 天。现在每请求按当前配置取
 * （`SystemSettingsService.requireUpstreamKey()`），轮换对全部在线会话立即生效。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly identity: IdentityService,
    private readonly settings: SystemSettingsService,
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

    // 回注项目统一 key，下游 `parseBearerToken` 拿到上游执行凭证代打 new-api（浏览器永不接触）。
    //
    // ⚠️ **取不到时既不注入也不拦**，理由是一条不能破的启动链：key 现在配在管理端，而
    //    管理端要先登得进来。若这里对「没配 key」直接 503，新部署将**永远起不来**——
    //    没人能进门去配它。缺失的 fail-closed 落在**真正打上游的地方**：下游
    //    `parseBearerToken` 拿到 null 即 401（缺 header），直接调用点抛
    //    `UpstreamCredentialMissingError`（503）。两者都不会让空串流到上游。
    //    读配置本身失败（库/主密钥不可用）同样只记 error：那是运维问题，不该让
    //    整个已登录界面全 500；日志里有原因，且它必然与真正打上游的报错同时出现。
    try {
      request.headers.authorization = `Bearer ${await this.settings.requireUpstreamKey()}`;
    } catch (error) {
      logger.error(
        `AuthGuard: 上游凭证不可用，本次请求不回注 Authorization（下游打上游会 401）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
