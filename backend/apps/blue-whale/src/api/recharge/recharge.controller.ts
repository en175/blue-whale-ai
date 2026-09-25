import { Controller, Get } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { ok } from "@lib/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { quotaToCredits } from "@lib/shared/credits/credits.js";
import { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";

/**
 * 充值档位目录（我们自己的库）。
 *
 * <p>⚠️ **这里没有下单、查单与协议**。原先 `agreement` / `order` / `order/:tradeNo/status`
 * 三条都转发 new-api，而 new-api 已是上游供应商、不再代我们收款；本仓又没有支付通道
 * （blue_whale_pay 是独立仓库，jeepay 迁移尚未接过来）。**用户当前无法充值**——
 * 所以那三条连同一个 no-op 的 cancel 一起整条删掉，不留空壳、也不返回假成功：
 * 前端打过来应当拿到 404。
 */
@Controller("recharge")
export class RechargeController {
  constructor(private readonly topupTier: TopupTierService) {}

  @Public()
  @Get("tiers")
  async tiers() {
    try {
      const rows = await this.topupTier.listActive();
      const tiers = rows.map((t) => ({
        id: t.id,
        name: t.name,
        amount: Math.round(quotaToCredits(t.amount)),
        price: t.price,
        original_price: t.originalPrice,
        discount: t.discount,
        is_recommended: t.isRecommended,
        sort_order: t.sortOrder,
      }));
      return ok({ tiers });
    } catch (error) {
      throw new NewApiError(
        error instanceof Error ? error.message : "档位服务不可用",
        500,
      );
    }
  }
}
