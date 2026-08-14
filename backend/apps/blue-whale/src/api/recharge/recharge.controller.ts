import { Body, Controller, Get, Headers, Logger, Post } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { ok } from "@blue-whale/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { quotaToCredits } from "@lib/shared/credits/credits.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import { toUpstreamError } from "@lib/shared/errors/upstream-error.js";
import { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";

const WAY_CODE_BY_METHOD: Record<string, string> = {
  wechat: "WX_NATIVE",
  alipay: "ALI_QR",
};

const QR_TTL_MS = 15 * 60 * 1000;

@Controller("recharge")
export class RechargeController {
  private readonly logger = new Logger(RechargeController.name);

  constructor(
    private readonly account: AccountService,
    private readonly topupTier: TopupTierService,
  ) {}

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

  @Public()
  @Get("agreement")
  async agreement() {
    try {
      const result = await this.account.getRechargeAgreement();
      return ok(result);
    } catch (error) {
      throw toUpstreamError(error, "协议服务不可用");
    }
  }

  @Post("order")
  async order(
    @Body() body: { tier_id?: unknown; payment_method?: unknown },
    @Headers("authorization") authorization?: string,
  ) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("未提供有效令牌", 401, "unauthorized");

    const tierId = typeof body?.tier_id === "string" ? body.tier_id : "";
    const paymentMethod =
      typeof body?.payment_method === "string" ? body.payment_method : "";
    if (!tierId || !paymentMethod) {
      throw new NewApiError("缺少 tier_id 或 payment_method", 400);
    }

    const wayCode = WAY_CODE_BY_METHOD[paymentMethod];
    if (!wayCode) {
      throw new NewApiError("支付方式仅支持 wechat / alipay", 400);
    }

    let tier;
    try {
      tier = await this.topupTier.getById(tierId);
    } catch (error) {
      throw new NewApiError(
        error instanceof Error ? error.message : "档位服务不可用",
        500,
      );
    }
    if (!tier) throw new NewApiError("档位不存在", 404);
    if (tier.status !== "active") throw new NewApiError("该档位已下架", 400);
    const now = Date.now();
    if (tier.startTime && new Date(tier.startTime).getTime() > now) {
      throw new NewApiError("该档位尚未生效", 400);
    }
    if (tier.endTime && new Date(tier.endTime).getTime() < now) {
      throw new NewApiError("该档位已过期", 400);
    }

    const amount = Math.round(tier.originalPrice);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new NewApiError("档位原价须为正整数", 400);
    }

    try {
      const payMoney = await this.account.requestTopUpAmount(token, amount);
      if (Math.abs(payMoney - tier.price) > 0.01) {
        this.logger.warn(
          `报价漂移：Go 报价 ¥${payMoney} ≠ 档位实付 ¥${tier.price}（tier id=${tier.id}, N=${amount}）`,
        );
      }
      const order = await this.account.createBlueWhalePayTopUp(
        token,
        amount,
        wayCode,
      );
      return ok({
        trade_no: order.tradeNo,
        qr_code_url: order.payData,
        expire_time: new Date(Date.now() + QR_TTL_MS).toISOString(),
        amount: payMoney,
        points: Math.round(quotaToCredits(tier.amount)),
      });
    } catch (error) {
      throw toUpstreamError(error, "下单服务不可用");
    }
  }
}
