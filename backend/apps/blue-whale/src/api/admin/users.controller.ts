import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { createLogger } from "@lib/core/logging";
import { isSuperAdmin } from "@lib/core/identity/roles.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-paging.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import {
  BillingAdminConfigError,
  BillingAdminError,
  grantCredits,
} from "@lib/shared/billing/billing-admin-client.js";
import {
  AccountDirectoryService,
  IdentityService,
  PasswordPolicyError,
  USER_STATUS_DISABLED,
  USER_STATUS_NORMAL,
} from "@lib/shared/identity/index.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const USER_MANAGE_ACTIONS = new Set([
  "freeze",
  "unfreeze",
  "adjustBalance",
  "reset_password",
]);

const ACTION_LOG_MAP: Record<string, string> = {
  freeze: "user.freeze",
  unfreeze: "user.unfreeze",
  adjustBalance: "user.adjust_balance",
  reset_password: "user.reset_password",
};

@Controller("admin/users")
@UseGuards(AdminGuard)
export class AdminUsersController {
  private readonly logger = createLogger("admin-users");

  constructor(
    private readonly identity: IdentityService,
    private readonly directory: AccountDirectoryService,
    private readonly operationLog: OperationLogService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const keyword = query.keyword?.trim() || undefined;
    const statusParam = query.status;
    const status =
      statusParam === "active" ? 1 : statusParam === "disabled" ? 0 : undefined;

    const options: {
      keyword?: string;
      status?: number;
      page?: number;
      pageSize?: number;
    } = {
      page: parsePageParam(query.page),
      pageSize: parsePageSizeParam(query.pageSize),
    };
    if (keyword) options.keyword = keyword;
    if (status !== undefined) options.status = status;

    try {
      const result = await this.directory.listAdminUsers(options);
      return { success: true, data: { list: result.items, total: result.total } };
    } catch (error) {
      throw toUserListError(error);
    }
  }

  @Post(":userId/manage")
  async manage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId") rawUserId: string,
    @Body() body: Record<string, unknown>,
    @Headers("x-forwarded-for") xForwardedFor?: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AdminException(400, "userId 须为正整数");
    }
    const action = body.action;
    if (typeof action !== "string" || !USER_MANAGE_ACTIONS.has(action)) {
      throw new AdminException(
        400,
        "action 须为 freeze/unfreeze/adjustBalance/reset_password",
      );
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) throw new AdminException(400, "reason 必填");

    let revokedSessions = 0;
    let revokeError: string | null = null;
    let granted: { credits: number | null; duplicated: boolean } | null = null;

    try {
      if (action === "freeze") {
        const found = await this.directory.setUserStatus(
          userId,
          USER_STATUS_DISABLED,
        );
        if (!found) throw new AdminException(404, "用户不存在");
        try {
          revokedSessions = await this.sessions.revokeAllForUser(userId);
        } catch (error) {
          revokeError = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `freeze user=${userId} session revoke failed: ${revokeError}`,
          );
        }
      } else if (action === "unfreeze") {
        const found = await this.directory.setUserStatus(
          userId,
          USER_STATUS_NORMAL,
        );
        if (!found) throw new AdminException(404, "用户不存在");
      } else if (action === "reset_password") {
        if (userId === Number(user.userId)) {
          throw new AdminException(400, "不能重置自己的密码，请走「修改密码」");
        }
        if (!(await this.directory.userExists(userId))) {
          throw new AdminException(404, "用户不存在");
        }
        if (isSuperAdmin(await this.directory.listRoleCodes(userId))) {
          throw new AdminException(403, "不能重置超级管理员的密码");
        }
        const newPassword = typeof body.password === "string" ? body.password : "";
        if (!newPassword) throw new AdminException(400, "password 必填");
        try {
          await this.identity.resetPassword(userId, newPassword);
        } catch (error) {
          if (error instanceof PasswordPolicyError) {
            throw new AdminException(400, error.message);
          }
          throw error;
        }
        try {
          revokedSessions = await this.sessions.revokeAllForUser(userId);
        } catch (error) {
          revokeError = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `reset_password user=${userId} session revoke failed: ${revokeError}`,
          );
        }
      } else {
        const value = body.value;
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
          throw new AdminException(400, "value 须为正整数积分（本接口只加不减）");
        }
        const bizId = idempotencyKey?.trim();
        if (!bizId) throw new AdminException(400, "缺少 Idempotency-Key 请求头");
        if (!(await this.directory.userExists(userId))) {
          throw new AdminException(404, "用户不存在");
        }

        try {
          const { duplicated } = await grantCredits({
            userId,
            credits: value,
            source: "gift",
            bizId,
            bizType: "grant",
          });
          granted = duplicated
            ? { credits: null, duplicated: true }
            : { credits: value, duplicated: false };
        } catch (error) {
          if (error instanceof BillingAdminConfigError) {
            throw new AdminException(503, `发放积分失败：计费服务未配置（${error.message}）`);
          }
          if (error instanceof BillingAdminError) {
            throw new AdminException(502, `发放积分失败：${error.message}`);
          }
          throw new AdminException(
            502,
            `发放积分失败：计费服务不可达（${error instanceof Error ? error.message : "未知错误"}）`,
          );
        }
      }
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }

    const adjustAudit = granted
      ? granted.duplicated
        ? { duplicated: true }
        : { value: granted.credits }
      : {};

    try {
      await this.operationLog.create({
        category: "user",
        action: ACTION_LOG_MAP[action] ?? action,
        target: `user:${userId}`,
        targetUserId: String(userId),
        detail: JSON.stringify({
          reason,
          ...(action === "freeze" || action === "reset_password"
            ? { revokedSessions, ...(revokeError ? { revokeError } : {}) }
            : {}),
          ...adjustAudit,
        }),
        operator: user.username,
        operatorId: user.userId,
        ipAddress: xForwardedFor?.split(",")[0]?.trim() ?? null,
      });
    } catch (error) {
      this.logger.error(
        `审计写入失败 ${action} user=${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (action === "freeze" || action === "reset_password") {
      return { success: true, data: { revokedSessions } };
    }
    if (granted) return { success: true, data: granted };
    return { success: true, data: null };
  }
}

function toUserListError(error: unknown): AdminException {
  if (error instanceof BillingAdminConfigError) {
    return new AdminException(503, `用户列表不可用：${error.message}`);
  }
  if (error instanceof BillingAdminError) {
    return new AdminException(502, `用户列表查询失败：${error.message}`);
  }
  throw error;
}
