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
import { NewApiError } from "@lib/core";
import { createLogger } from "@lib/core/logging";
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
  IdentityService,
  USER_STATUS_DISABLED,
  USER_STATUS_NORMAL,
} from "@lib/shared/identity/index.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const USER_MANAGE_ACTIONS = new Set(["freeze", "unfreeze", "adjustBalance"]);

const ACTION_LOG_MAP: Record<string, string> = {
  freeze: "user.freeze",
  unfreeze: "user.unfreeze",
};

@Controller("admin/users")
@UseGuards(AdminGuard)
export class AdminUsersController {
  private readonly logger = createLogger("admin-users");

  constructor(
    private readonly identity: IdentityService,
    private readonly operationLog: OperationLogService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("authorization") authorization?: string,
    @Query() query: Record<string, string> = {},
  ) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("缺少登录凭证", 401, "unauthorized");

    const keyword = query.keyword?.trim() || undefined;
    const statusParam = query.status;
    const roleParam = query.role;
    const status =
      statusParam === "active" ? 1 : statusParam === "disabled" ? 0 : undefined;
    const role =
      roleParam && roleParam.trim() !== "" ? Number(roleParam) : undefined;

    const options: {
      keyword?: string;
      status?: number;
      role?: number;
      page?: number;
      pageSize?: number;
    } = {
      page: parsePageParam(query.page),
      pageSize: parsePageSizeParam(query.pageSize),
    };
    if (keyword) options.keyword = keyword;
    if (status !== undefined) options.status = status;
    if (role !== undefined) options.role = role;

    // ★ 查我们自己的库，不再转发 new-api。
    //   原来那条链路有两个问题：new-api 独立后会断；且它要求调用者在 new-api 那边
    //   也是管理员 —— 于是「我们给了 super_admin 却看不到列表」。
    const result = await this.identity.listAdminUsers(options);
    return { success: true, data: { list: result.items, total: result.total } };
  }

  @Post(":userId/manage")
  async manage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId") rawUserId: string,
    @Body() body: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
    @Headers("x-forwarded-for") xForwardedFor?: string,
  ) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("缺少登录凭证", 401, "unauthorized");

    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AdminException(400, "userId 须为正整数");
    }
    const action = body.action;
    if (typeof action !== "string" || !USER_MANAGE_ACTIONS.has(action)) {
      throw new AdminException(400, "action 须为 freeze/unfreeze/adjustBalance");
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) throw new AdminException(400, "reason 必填");

    // 冻结时吊销会话的统计（best-effort）：冻结成功后踢该用户全部登录会话，立即生效。
    let revokedSessions = 0;
    let revokeError: string | null = null;

    try {
      if (action === "freeze") {
        // ★ 冻结 = 写我们自己的库（identity_users.status）。
        //   原先转发 new-api 的 manage 接口，而 new-api 独立后那边不再有我们的用户；
        //   而且那条链路要求「调用者在 new-api 那边也是管理员」——查得到列表却冻不了人。
        const found = await this.identity.setUserStatus(
          userId,
          USER_STATUS_DISABLED,
        );
        if (!found) throw new AdminException(404, "用户不存在");
        // 状态落库成功后再踢会话（禁用先行，最小化并发登录窗口）。
        try {
          revokedSessions = await this.sessions.revokeAllForUser(userId);
        } catch (error) {
          revokeError = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `freeze user=${userId} session revoke failed: ${revokeError}`,
          );
          // best-effort：状态禁用已保证禁登录/禁继续用（≤5min 复核兜底），
          // 会话清除失败不阻断冻结，落在审计里可见。
        }
      } else if (action === "unfreeze") {
        const found = await this.identity.setUserStatus(
          userId,
          USER_STATUS_NORMAL,
        );
        if (!found) throw new AdminException(404, "用户不存在");
      } else {
        // ⚠️ adjustBalance（加扣余额）**尚未实现**：它属于计费域，等 billing 接过
        //    用户维度的余额账本后由那边提供。这里显式报错而不是：
        //    - 转发 new-api（它已经不认识我们的用户，转发只会 404/乱扣）；
        //    - 静默返回成功（管理员会以为钱已经加上去了——这是最坏的一种）。
        throw new AdminException(
          501,
          "调整积分尚未开放：计费域接入后提供",
        );
      }
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }

    try {
      await this.operationLog.create({
        category: "user",
        action: ACTION_LOG_MAP[action] ?? action,
        target: `user:${userId}`,
        targetUserId: String(userId),
        detail: JSON.stringify({
          reason,
          ...(action === "freeze"
            ? { revokedSessions, ...(revokeError ? { revokeError } : {}) }
            : {}),
        }),
        operator: user.username,
        operatorId: user.userId,
        ipAddress: xForwardedFor?.split(",")[0]?.trim() ?? null,
      });
    } catch {
      // best-effort 审计，失败不阻断
    }

    // freeze 额外返回吊销会话数，供前端展示（unfreeze 维持 data: null）。
    return {
      success: true,
      data: action === "freeze" ? { revokedSessions } : null,
    };
  }
}
