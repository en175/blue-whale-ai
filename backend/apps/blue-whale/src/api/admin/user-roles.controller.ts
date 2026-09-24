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
import { LastSuperAdminError } from "@lib/core/identity/roles.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { UnknownRoleError } from "@lib/shared/persistence/identity-role-repo.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** BigInt 入参守卫：仅十进制正整数串。 */
const BIGINT_ID_RE = /^\d{1,19}$/;

function parseUserId(raw: string): string {
  if (!BIGINT_ID_RE.test(raw)) throw new AdminException(400, "userId 须为正整数");
  return raw;
}

/**
 * 用户角色的授予 / 撤销（管理端）。
 *
 * <p>在它之前，`identity_user_roles` **只有读者没有写者**——角色只能靠写库给。
 * 而这个接口同时也是「超管锁死保护」的落点：没有撤销入口，那条规则就无从谈起。
 *
 * <p>⚠️ 权限判定在 {@link AdminGuard}（查我们的角色表），不是 new-api 的 role。
 */
@Controller("admin/users")
@UseGuards(AdminGuard)
export class AdminUserRolesController {
  constructor(
    private readonly identity: IdentityService,
    private readonly operationLog: OperationLogService,
  ) {}

  /** 该用户当前持有的角色 code。 */
  @Get(":userId/roles")
  async list(@Param("userId") rawUserId: string) {
    const userId = parseUserId(rawUserId);
    return { success: true, data: { roles: await this.identity.listRoleCodes(userId) } };
  }

  /**
   * 授予角色。幂等：已持有（含撤销后再授予）时是空操作。
   *
   * <p>授予**不需要**保护——加权限不会把谁锁在外面。
   */
  @Post(":userId/roles")
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
      await this.identity.grantRole(userId, code, String(operator.userId));
    } catch (error) {
      if (error instanceof UnknownRoleError) throw new AdminException(400, error.message);
      throw error;
    }

    await this.recordLog(operator, xForwardedFor, "user.role_grant", userId, `授予角色 ${code}`);
    return { success: true, data: { roles: await this.identity.listRoleCodes(userId) } };
  }

  /**
   * 撤销角色。
   *
   * <p>⚠️ 撤销**最后一个超级管理员**的角色会被拒（409）：这么做完之后没人能进管理端了。
   * 规则在 `@lib/core/identity/roles.ts`，纯函数、有独立测试——
   * 将来做批量授撤或脚本时走同一个判定，不会各写一份。
   */
  @Delete(":userId/roles/:code")
  async revoke(
    @CurrentUser() operator: AuthenticatedUser,
    @Param("userId") rawUserId: string,
    @Param("code") code: string,
    @Headers("x-forwarded-for") xForwardedFor?: string,
  ) {
    const userId = parseUserId(rawUserId);

    try {
      await this.identity.revokeRole(userId, code);
    } catch (error) {
      if (error instanceof LastSuperAdminError) {
        // 409 而不是 400：不是「你传错了」，是「这个状态下这么做不行」。
        // 提示语必须说人话，否则运维只会换个参数再试一次。
        throw new AdminException(409, error.message);
      }
      if (error instanceof UnknownRoleError) throw new AdminException(400, error.message);
      throw error;
    }

    await this.recordLog(operator, xForwardedFor, "user.role_revoke", userId, `撤销角色 ${code}`);
    return { success: true, data: { roles: await this.identity.listRoleCodes(userId) } };
  }

  /**
   * 记一条操作日志。
   *
   * <p>⚠️ **写失败不阻断授撤**（旁路），但记 error——授权是审计里最该留下痕迹的一类动作，
   * 一个坏掉的日志表不该表现为「一切正常」。
   */
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
      // best-effort：日志写不进去不该让一次合法的授权失败
    }
  }
}
