import { Controller, Get } from "@nestjs/common";
import { ok } from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { sharedBillingClient, toBillingError } from "@lib/shared/billing/billing-client.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("usage")
export class UsageController {
  @Get("token")
  async token(@CurrentUser() user: AuthenticatedUser) {
    try {
      const balance = await sharedBillingClient().queryBalance(Number(user.userId));
      return ok({
        credits: balance.availableCredits,
        by_source: balance.bySource.map((item) => ({
          source: item.source,
          credits: item.credits,
        })),
        // 上游早就返回了（gRPC QueryBalance.expiring + 客户端映射都在），此前只是这一层
        // 没投影出来。契约里 `expires_at` 是 RFC3339，`source` 是**批次口径**
        // （purchased | bonus | …），不是流水口径的 recharge
        expiring: balance.expiring.map((lot) => ({
          credits: lot.credits,
          expires_at: lot.expiresAt,
          source: lot.source,
        })),
      });
    } catch (error) {
      throw toBillingError(error, "余额查询暂不可用");
    }
  }
}
