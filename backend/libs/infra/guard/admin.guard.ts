import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import type { Request } from "express";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

type RequestWithUser = Request & { user?: AuthenticatedUser };

/** 管理端守卫：要求 AuthGuard 已解析出的当前用户 isAdmin，否则 403（对齐 withAdminUser）。 */
@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    if (!user.isAdmin) {
      throw new NewApiError("需要管理员权限", 403, "forbidden");
    }
    return true;
  }
}
