import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import type { Request } from "express";
import { IdentityService } from "@lib/shared/identity/index.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

type RequestWithUser = Request & { user?: AuthenticatedUser };

/** 管理端守卫：要求 AuthGuard 已解析出的当前用户 isAdmin，否则 403（对齐 withAdminUser）。 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    if (!(await this.identity.isAdmin(user.userId))) {
      throw new NewApiError("需要管理员权限", 403, "forbidden");
    }
    // 判定结果回写：`AdminController.session` 等下游直接读它，
    // 既不必再查一次，也不会出现「守卫放行了、但 session 报 isAdmin=false」的自相矛盾。
    user.isAdmin = true;
    return true;
  }
}
