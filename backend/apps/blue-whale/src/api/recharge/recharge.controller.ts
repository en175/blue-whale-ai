import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { NewApiError } from "@lib/core";
import { createLogger, type Logger } from "@lib/core/logging";
import { ok } from "@lib/contracts";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { parseCustomCredits } from "@lib/shared/recharge-custom/constants.js";
import { RechargeCustomService } from "@lib/shared/recharge-custom/recharge-custom.service.js";
import { RechargeService } from "@lib/shared/recharge/recharge.service.js";
import { toRechargeError } from "@lib/shared/recharge/recharge-error.js";
import { extractLoginToken } from "@lib/shared/session/login-token.js";
import { SessionService } from "@lib/shared/session/session.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const NOTIFY_ACK = "SUCCESS";
const NOTIFY_NAK = "FAIL";

@Controller("recharge")
export class RechargeController {
  private readonly logger: Logger = createLogger("recharge");

  constructor(
    private readonly recharge: RechargeService,
    private readonly custom: RechargeCustomService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Get("tiers")
  async tiers(@Req() req: Request) {
    try {
      const catalog = await this.recharge.listTiers(await this.optionalUserId(req));
      return ok({
        tiers: catalog.tiers.map((t) => ({
          id: t.id,
          name: t.name,
          amount: t.amount,
          price: t.price,
          original_price: t.originalPrice,
          discount: t.discount,
          is_recommended: t.isRecommended,
          sort_order: t.sortOrder,
          can_purchase: t.canPurchase,
          denied_hint: t.deniedHint,
          credits_valid_months: t.creditsValidMonths,
        })),
        credits_per_yuan: catalog.creditsPerYuan,
      });
    } catch (error) {
      throw toRechargeError(error, "档位服务暂不可用");
    }
  }

  @Public()
  @Get("custom")
  async customOffer(@Req() req: Request) {
    try {
      const offer = await this.custom.buildOffer(await this.optionalUserId(req));
      return ok({
        enabled: offer.enabled,
        min_credits: offer.minCredits,
        max_credits: offer.maxCredits,
        default_credits: offer.defaultCredits,
        step_credits: offer.stepCredits,
        credits_per_yuan: offer.creditsPerYuan,
        credits_valid_months: offer.creditsValidMonths,
        can_purchase: offer.canPurchase,
        denied_hint: offer.deniedHint,
      });
    } catch (error) {
      throw toRechargeError(error, "自定义充值配置暂不可用");
    }
  }

  @Post("order")
  async order(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tierId = typeof body?.tier_id === "string" ? body.tier_id.trim() : "";
    const hasCredits = body?.credits !== undefined && body?.credits !== null;

    if (tierId && hasCredits) {
      throw new NewApiError("tier_id 与 credits 只能传一个", 400);
    }
    if (!tierId && !hasCredits) {
      throw new NewApiError("缺少 tier_id 或 credits", 400);
    }

    const credits = hasCredits ? parseCustomCredits(body.credits) : null;
    if (hasCredits && credits === null) {
      throw new NewApiError("credits 须为 1 以上的整数", 400);
    }

    try {
      const created = await this.recharge.createOrder(
        tierId
          ? { userId: Number(user.userId), tierId }
          : { userId: Number(user.userId), credits: credits as number },
      );
      return ok({
        trade_no: created.tradeNo,
        qr_code_url: created.cashierUrl,
        expire_time: created.expiresAt,
        amount: created.amount,
        points: created.credits,
      });
    } catch (error) {
      throw toRechargeError(error, "下单服务暂不可用");
    }
  }

  @Get("order/:tradeNo/status")
  async status(
    @Param("tradeNo") tradeNo: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!tradeNo) throw new NewApiError("缺少订单号", 400);
    try {
      const state = await this.recharge.getOrderStatus({
        userId: Number(user.userId),
        tradeNo,
      });
      return ok({
        trade_no: state.tradeNo,
        status: state.status,
        credits_after: state.creditsAfter,
      });
    } catch (error) {
      throw toRechargeError(error, "订单查询暂不可用");
    }
  }

  @Public()
  @BypassTransform()
  @Post("notify/pay")
  @HttpCode(200)
  async payNotify(
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const params = toStringRecord(body);
    let accepted = false;
    try {
      accepted = await this.recharge.handleNotify(params);
    } catch (error) {
      this.logger.error(
        `回调处理异常 tradeNo=${params.mchOrderNo ?? ""}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    res.type("text/plain").send(accepted ? NOTIFY_ACK : NOTIFY_NAK);
  }

  private async optionalUserId(req: Request): Promise<number | null> {
    const token = extractLoginToken(req);
    if (!token) return null;
    try {
      const session = await this.sessions.resolveSession(token);
      return session ? Number(session.userId) : null;
    } catch {
      return null;
    }
  }
}

function toStringRecord(body: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (typeof value === "string") result[key] = value;
    else if (typeof value === "number") result[key] = String(value);
  }
  return result;
}
