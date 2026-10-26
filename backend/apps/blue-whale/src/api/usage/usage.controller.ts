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
