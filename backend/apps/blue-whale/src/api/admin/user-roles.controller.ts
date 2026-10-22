import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  AccountDirectoryService,
  LastSuperAdminError,
  UnknownRoleError,
} from "@lib/shared/identity/index.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { SuperAdminGuard } from "@lib/infra/guard/super-admin.guard.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const BIGINT_ID_RE = /^\d{1,19}$/;

function parseUserId(raw: string): string {
  if (!BIGINT_ID_RE.test(raw)) throw new AdminException(400, "userId 须为正整数");
  return raw;
}

@Controller("admin/users")
@UseGuards(AdminGuard)
export class AdminUserRolesController {
  constructor(
    private readonly directory: AccountDirectoryService,
    private readonly operationLog: OperationLogService,
  ) {}

  @Get(":userId/roles")
  async list(@Param("userId") rawUserId: string) {
    const userId = parseUserId(rawUserId);
    return { success: true, data: { roles: await this.directory.listRoleCodes(userId) } };
  }

  @Post(":userId/roles")
  @UseGuards(SuperAdminGuard)
  async grant(
    @CurrentUser() operator: AuthenticatedUser,
    @Param("userId") rawUserId: string,
    @Body() body: Record<string, unknown>,
    @Headers("x-forwarded-for") xForwardedFor?: string,
  ) {
    const userId = parseUserId(rawUserId);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) throw new AdminException(400, "code 必填");

    try {
      await this.directory.grantRole(userId, code, String(operator.userId));
    } catch (error) {
      if (error instanceof UnknownRoleError) throw new AdminException(400, error.message);
      throw error;
    }

    await this.recordLog(operator, xForwardedFor, "user.role_grant", userId, `授予角色 ${code}`);
    return { success: true, data: { roles: await this.directory.listRoleCodes(userId) } };
  }

  @Delete(":userId/roles/:code")
  @UseGuards(SuperAdminGuard)
  async revoke(
    @CurrentUser() operator: AuthenticatedUser,
    @Param("userId") rawUserId: string,
    @Param("code") code: string,
    @Headers("x-forwarded-for") xForwardedFor?: string,
  ) {
    const userId = parseUserId(rawUserId);

    try {
      await this.directory.revokeRole(userId, code);
    } catch (error) {
      if (error instanceof LastSuperAdminError) {
        throw new AdminException(409, error.message);
      }
      if (error instanceof UnknownRoleError) throw new AdminException(400, error.message);
      throw error;
    }

    await this.recordLog(operator, xForwardedFor, "user.role_revoke", userId, `撤销角色 ${code}`);
    return { success: true, data: { roles: await this.directory.listRoleCodes(userId) } };
  }

  private async recordLog(
    operator: AuthenticatedUser,
    xForwardedFor: string | undefined,
    action: string,
    targetUserId: string,
    detail: string,
  ): Promise<void> {
    try {
      await this.operationLog.create({
        category: "user",
        action,
        target: `用户 #${targetUserId}`,
        targetUserId,
        detail,
        operator: operator.username,
        operatorId: String(operator.userId),
        ipAddress: xForwardedFor?.split(",")[0]?.trim() ?? null,
      });
    } catch {
    }
  }
}
