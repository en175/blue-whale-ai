import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ApiError } from "@lib/core";
import { isSuperAdmin } from "@lib/core/identity/roles.js";
import type { Request } from "express";
import { AccountDirectoryService } from "@lib/shared/identity/index.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

type RequestWithUser = Request & { user?: AuthenticatedUser };

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly directory: AccountDirectoryService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new ApiError("缺少登录凭证", 401, "unauthorized");
    }
    if (!isSuperAdmin(await this.directory.listRoleCodes(user.userId))) {
      throw new ApiError("需要超级管理员权限", 403, "forbidden");
    }
    return true;
  }
}
