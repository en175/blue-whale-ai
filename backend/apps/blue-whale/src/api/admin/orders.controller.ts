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
import { NewApiError } from "@blue-whale/core";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import {
  mapAdminOrder,
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-mapper.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("admin/orders")
@UseGuards(AdminGuard)
export class AdminOrdersController {
  constructor(
    private readonly account: AccountService,
    private readonly operationLog: OperationLogService,
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
    const status = query.status;
    const options: {
      keyword?: string;
      page?: number;
      pageSize?: number;
    } = { page: parsePageParam(query.page), pageSize: parsePageSizeParam(query.pageSize) };
    if (keyword) options.keyword = keyword;

    try {
      const result = await this.account.listAdminTopUps(
        token,
        Number(user.userId),
        options,
      );
      let list = result.items.map(mapAdminOrder);
      if (status) {
        list = list.filter((order) => order.status === status);
      }
      return { success: true, data: { list, total: result.total } };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Post(":tradeNo/complete")
  async complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("tradeNo") tradeNo: string,
    @Body() body: { reason?: unknown },
    @Headers("authorization") authorization?: string,
    @Headers("x-forwarded-for") xForwardedFor?: string,
  ) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    if (!tradeNo.trim()) throw new AdminException(400, "tradeNo 必填");
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) throw new AdminException(400, "reason 必填");

    try {
      await this.account.completeAdminTopUp(token, Number(user.userId), tradeNo);
    } catch (error) {
      throw toAdminError(error);
    }

    try {
      await this.operationLog.create({
        category: "order",
        action: "order.complete",
        target: tradeNo,
        detail: JSON.stringify({ reason }),
        operator: user.username,
        operatorId: user.userId,
        ipAddress: xForwardedFor?.split(",")[0]?.trim() ?? null,
      });
    } catch {
      // best-effort 审计，失败不阻断
    }

    return { success: true, data: null };
  }
}
