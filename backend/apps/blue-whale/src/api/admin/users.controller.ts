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
  BillingAdminConfigError,
  BillingAdminError,
  grantCredits,
} from "@lib/shared/billing/billing-admin-client.js";
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
  // ⚠️ 这个键漏了不会报错，只会让审计落成裸的 `"adjustBalance"` —— 而前端「调整记录」
  //    tab 过滤的是 `'user.adjust_balance'`（UserManage 的 adjusts），于是那一步的
  //    发放在界面上**永远看不见**。键名与前端常量是一对，改一处必须改另一处。
  adjustBalance: "user.adjust_balance",
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
    @Headers("idempotency-key") idempotencyKey?: string,
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
    /** adjustBalance 的发放结果；freeze/unfreeze 保持 null。 */
    let granted: { credits: number; duplicated: boolean } | null = null;

    try {
      if (action === "freeze") {
        // ★ 冻结 = 写我们自己的库（bw_users.status）。
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
        // ★ 加积分 = 调 billing 的发放接口，**不写我们自己的库**。
        //   账本的权威在 billing（ADR-0114）：余额是各批次剩余之和，压根没有物化余额表，
        //   本地任何一张表都只是它的投影 —— 写本地库等于另造一个账本。
        //   接线之前这里是一个显式 501；现在把它换成真调用，而不是删掉检查。
        //
        // ⚠️ 只做**增加**。扣减在 billing 侧没有路径：`CreditService.grant` 硬校验
        //   `amount > 0`。要做得先定义「从哪一批扣、赠送的那批能不能扣、扣到欠费怎么算」，
        //   那是另一件事，本单明确排除。
        const value = body.value;
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
          throw new AdminException(400, "value 须为正整数积分（本接口只加不减）");
        }
        // 幂等键**必填**。缺了它，「网络超时 → 管理员再点一次」就是发两笔，
        // 而两笔在账本上都合法，事后分不出哪笔是重试。前端在**弹窗打开那一刻**
        // 铸造一把并在该次意图的重试路径上复用（`web/src/api/idempotencyKey.ts`）。
        const bizId = idempotencyKey?.trim();
        if (!bizId) throw new AdminException(400, "缺少 Idempotency-Key 请求头");

        try {
          const { duplicated } = await grantCredits({
            userId,
            credits: value,
            // 运营赠送。有效期由 billing 的 GrantPolicy 按来源决定（30 天）——
            // 不在这里传 expiresAt：有效期是**来源的属性**，各入口各传一份必然会漂。
            source: "gift",
            bizId,
            // 人工发放不是充值。biz_type 落不到 `recharge`：那一列是 `idx_ledger__biz`
            // 的查询键，写错不会报错，只会让按业务对账时这笔混进充值那堆。
            bizType: "grant",
          });
          granted = { credits: value, duplicated };
        } catch (error) {
          // 与积分记录页同一条口径（consumption-records.controller.ts 的 toConsumptionError）：
          // 配置错要人去改配置并重启（503），调用失败可能等 billing 恢复就好（502）。
          // 混成一个 500，值班的人只能靠读文案猜该找谁。
          if (error instanceof BillingAdminConfigError) {
            throw new AdminException(503, `发放积分失败：计费服务未配置（${error.message}）`);
          }
          if (error instanceof BillingAdminError) {
            throw new AdminException(502, `发放积分失败：${error.message}`);
          }
          throw error;
        }
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
          // 前端「调整记录」tab 读 `value` 渲染金额与正负徽标（UserManage 的 parseDetail）。
          // 不写进去，那一步发放在审计里只剩一行没有金额的记录。
          ...(granted ? { value: granted.credits } : {}),
        }),
        operator: user.username,
        operatorId: user.userId,
        ipAddress: xForwardedFor?.split(",")[0]?.trim() ?? null,
      });
    } catch {
      // best-effort 审计，失败不阻断
    }

    // freeze 返回吊销会话数；adjustBalance 返回本次发放结果（`duplicated` = 幂等命中，
    // 这笔之前就发过，本次没有重复发放）；unfreeze 维持 data: null。
    if (action === "freeze") return { success: true, data: { revokedSessions } };
    if (granted) return { success: true, data: granted };
    return { success: true, data: null };
  }
}
