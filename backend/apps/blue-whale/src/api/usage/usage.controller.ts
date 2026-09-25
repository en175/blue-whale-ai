import { Controller, Get } from "@nestjs/common";
import { ok } from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { sharedBillingClient, toBillingError } from "@lib/shared/billing/billing-client.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/**
 * 余额查询。
 *
 * <p>数据源是 **billing 的账本**（`QueryBalance`）。原先这里转发 new-api 的
 * `/api/usage/token`，而 new-api 已降级成「带一把统一 key 的上游供应商」——
 * 那把 key 是全项目共用的，问它「余额多少」只会得到统一 key 属主一个人的余额。
 *
 * <p>返回的 `credits` 是**整数积分**（账本单位），不是 new-api 的 quota：
 * 用户看到的数就是 billing 记的数，中间不再有一次 50,000 的换算。
 */
@Controller("usage")
export class UsageController {
  @Get("token")
  async token(@CurrentUser() user: AuthenticatedUser) {
    try {
      const balance = await sharedBillingClient().queryBalance(Number(user.userId));
      return ok({ credits: balance.availableCredits });
    } catch (error) {
      throw toBillingError(error, "余额查询暂不可用");
    }
  }
}
