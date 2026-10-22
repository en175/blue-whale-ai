import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ApiError } from "@lib/core";
import type { Request } from "express";
import { AccountDirectoryService } from "@lib/shared/identity/index.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

type RequestWithUser = Request & { user?: AuthenticatedUser };

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly directory: AccountDirectoryService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new ApiError("缺少登录凭证", 401, "unauthorized");
    }
    if (!(await this.directory.isAdmin(user.userId))) {
      throw new ApiError("需要管理员权限", 403, "forbidden");
    }
    user.isAdmin = true;
    return true;
  }
}
