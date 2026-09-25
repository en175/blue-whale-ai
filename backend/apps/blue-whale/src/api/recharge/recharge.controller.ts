import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { NewApiError } from "@lib/core";
import { createLogger, type Logger } from "@lib/core/logging";
import { ok } from "@lib/contracts";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { RechargeService, toRechargeError } from "@lib/shared/recharge/recharge.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** 网关认的应答文案（大小写不敏感比对），其它任何回复都会被当成「没收到」并重投。 */
const NOTIFY_ACK = "SUCCESS";
const NOTIFY_NAK = "FAIL";

/**
 * 充值（接 blue-whale-pay 的杭州银行聚合主扫渠道）。
 *
 * <p>用户扫的是**银行统一收银台**链接，在银行页面上自选微信/支付宝/云闪付——
 * 所以这里没有「选支付方式」这一步：渠道选择对商户透明，不是我们偷懒只接了一个。
 *
 * <p>⚠️ 到账靠**异步通知 + 查单补偿**两条路（见 `RechargeService`）：
 *    通知会重投、也可能丢，用户看到的「到账了」永远以我们自己的账本为准。
 */
@Controller("recharge")
export class RechargeController {
  private readonly logger: Logger = createLogger("recharge");

  constructor(private readonly recharge: RechargeService) {}

  /** 档位目录 + 当前换算率（1 元 = 多少积分）。价格表是公开信息，不需要登录。 */
  @Public()
  @Get("tiers")
  async tiers() {
    try {
      const catalog = await this.recharge.listTiers();
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
        })),
        credits_per_yuan: catalog.creditsPerYuan,
      });
    } catch (error) {
      throw toRechargeError(error, "档位服务暂不可用");
    }
  }

  /** 下单：返回银行统一收银台链接，前端自己渲染二维码。 */
  @Post("order")
  async order(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tierId = typeof body?.tier_id === "string" ? body.tier_id.trim() : "";
    if (!tierId) throw new NewApiError("缺少 tier_id", 400);

    try {
      const created = await this.recharge.createOrder({
        userId: Number(user.userId),
        tierId,
      });
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

  /**
   * 查单：轮询支付状态。
   *
   * <p>用户在等的时候会每 3 秒打一次，所以这里**顺手做一次补偿**（限流在服务里，30 秒一次）：
   * 网关的通知丢了也能在这一步把订单推到终态。
   */
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

  /**
   * 异步通知：支付网关在订单终态时 POST 到这里（表单编码，带 `sign`）。
   *
   * <p>⚠️ **应答体必须是裸的 `SUCCESS`**，不能是统一信封：网关逐字比对这个字符串，
   *    包成 `{"code":200,...}` 会被判成「没收到」并重投 6 次。所以这里 `@BypassTransform`
   *    并直接写响应体。
   *
   * <p>⚠️ 幂等由 `RechargeService.handleNotify` 负责（验签 + 金额比对 + billing 幂等键），
   *    重复投递只会走到「已经发过了」那条分支，不会重复到账。
   */
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
      // 配置缺失（凭证/密钥没配）会走到这里：网关拿不到钱，但我们必须留下痕迹，
      // 否则表现为「回调一直失败」而看不到原因
      this.logger.error(
        `回调处理异常 tradeNo=${params.mchOrderNo ?? ""}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    res.type("text/plain").send(accepted ? NOTIFY_ACK : NOTIFY_NAK);
  }
}

/** 表单/查询参数一律按字符串收：签名的计算口径就是「它将出现在报文里的那个字符串」。 */
function toStringRecord(body: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (typeof value === "string") result[key] = value;
    else if (typeof value === "number") result[key] = String(value);
  }
  return result;
}
