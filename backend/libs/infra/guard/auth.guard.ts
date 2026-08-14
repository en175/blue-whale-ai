import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NewApiError } from "@blue-whale/core";
import type { Request } from "express";
import { AccountService } from "@lib/shared/account/account.service.js";
import { toAuthError } from "@lib/shared/errors/auth-error.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import { IS_PUBLIC_KEY } from "@lib/infra/decorators/public.decorator.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const ADMIN_ROLE_THRESHOLD = 10;
const ENABLED_STATUS = 1;

type RequestWithUser = Request & { user: AuthenticatedUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly account: AccountService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = parseBearerToken(request.headers.authorization);
    if (!token) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }

    let identity;
    try {
      identity = await this.account.resolveTokenIdentity(token);
    } catch (error) {
      throw toAuthError(error);
    }

    if (!Number.isInteger(identity.userId) || identity.userId <= 0) {
      throw new NewApiError("账户服务响应异常", 502, "invalid_identity");
    }
    if (identity.status !== ENABLED_STATUS) {
      throw new NewApiError("账户已停用", 403, "account_disabled");
    }

    (request as RequestWithUser).user = {
      userId: String(identity.userId),
      status: "enabled",
      isAdmin: identity.role >= ADMIN_ROLE_THRESHOLD,
      username: identity.username,
    };
    return true;
  }
}
