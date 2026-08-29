import { Body, Controller, Get, Headers, OnModuleInit, Param, Post } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { ok } from "@blue-whale/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { quotaToCredits } from "@lib/shared/credits/credits.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import { toUpstreamError } from "@lib/shared/errors/upstream-error.js";
import { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";
import { readCollectToken, warnIfCollectTokenMissing } from "./collect-token.js";

const WAY_CODE_BY_METHOD: Record<string, string> = {
  wechat: "WX_NATIVE",
  alipay: "ALI_QR",
};

const QR_TTL_MS = 15 * 60 * 1000;

/** Go common.TopUpStatus* → 前端 OrderStatus。 */
const STATUS_MAP: Record<string, "pending" | "paid" | "expired" | "failed"> = {
  pending: "pending",
  success: "paid",
  expired: "expired",
  failed: "failed",
};

@Controller("recharge")
export class RechargeController implements OnModuleInit {
  constructor(
    private readonly account: AccountService,
    private readonly topupTier: TopupTierService,
  ) {}

  onModuleInit() {
    warnIfCollectTokenMissing();
  }

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

    const collectToken = readCollectToken();
    if (!collectToken) {
      throw new NewApiError("下单服务不可用", 503, "topup_collect_unconfigured");
    }

    try {
      const identity = await this.account.resolveTokenIdentity(token);
      const order = await this.account.createCollectTopUp({
        collectToken,
        userId: identity.userId,
        money: tier.price,
        amount,
        wayCode,
      });
      return ok({
        trade_no: order.tradeNo,
        qr_code_url: order.payData,
        expire_time: new Date(Date.now() + QR_TTL_MS).toISOString(),
        amount: tier.price,
        points: Math.round(quotaToCredits(tier.amount)),
      });
    } catch (error) {
      throw toUpstreamError(error, "下单服务不可用");
    }
  }

  /** POST /api/recharge/order/:tradeNo/cancel — 取消未支付订单。
   *  Go 原生 new-api 充值没有取消端点，pending 单自动过期，无需主动取消。
   *  保留鉴权契约、做幂等 no-op（前端关弹窗/切换支付方式时 fire-and-forget 调用）。 */
  @Post("order/:tradeNo/cancel")
  async cancel(@Param("tradeNo") tradeNo: string) {
    if (!tradeNo) throw new NewApiError("缺少订单号", 400);
    return ok();
  }

  /** GET /api/recharge/order/:tradeNo/status — 轮询充值订单状态（原生 new-api topup）。
   *  查 GET /api/user/topup/self?keyword=<tradeNo> 精确匹配；Go success → paid，
   *  paid 时取 /api/usage/token 当前余额作 credits_after。 */
  @Get("order/:tradeNo/status")
  async status(
    @Param("tradeNo") tradeNo: string,
    @Headers("authorization") authorization?: string,
  ) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("未提供有效令牌", 401, "unauthorized");
    if (!tradeNo) throw new NewApiError("缺少订单号", 400);

    try {
      const record = await this.account.getTopUpByTradeNo(token, tradeNo);
      if (!record) throw new NewApiError("订单不存在", 404);
      const status = STATUS_MAP[record.status] ?? "pending";
      let creditsAfter: number | null = null;
      if (status === "paid") {
        const usage = await this.account.getTokenUsage(token);
        // 展示口径：credits_after 语义为积分，须按 quota / 50000 换算（产品确认 2026-08-19）
        creditsAfter = quotaToCredits(usage.userQuota);
      }
      return ok({ trade_no: tradeNo, status, credits_after: creditsAfter });
    } catch (error) {
      throw toUpstreamError(error, "订单查询不可用");
    }
  }
}
