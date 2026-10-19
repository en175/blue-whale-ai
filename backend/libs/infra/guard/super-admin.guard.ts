import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { isSuperAdmin } from "@lib/core/identity/roles.js";
import type { Request } from "express";
import { IdentityService } from "@lib/shared/identity/index.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

type RequestWithUser = Request & { user?: AuthenticatedUser };

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    if (!isSuperAdmin(await this.identity.listRoleCodes(user.userId))) {
      throw new NewApiError("需要超级管理员权限", 403, "forbidden");
    }
    return true;
  }
}
