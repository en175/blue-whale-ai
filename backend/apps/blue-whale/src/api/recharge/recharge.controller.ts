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

  constructor(
    private readonly recharge: RechargeService,
    private readonly custom: RechargeCustomService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * 档位目录 + 当前换算率（1 元 = 多少积分）。价格表是公开信息，不需要登录。
   *
   * <p>⚠️ 游客与登录用户拿到的是**同一张价格表**，区别只在权限信号：
   * `can_purchase` 为 `null`（游客，未判定）/ `true` / `false`（PRD §6.3 置灰并展示提示）。
   * 所以这里像 `customOffer` 一样自己看一眼会话 cookie（best-effort，读不出来当游客），
   * 而不是用 `@CurrentUser()`：`@Public()` 路由上 AuthGuard 直接放行、不填 `request.user`，
   * 那样登录用户也会被当成「未判定」，白名单用户照样看到灰卡片。
   */
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
          // null = 游客（未判定）。前端据此把卡片置灰并展示提示 ——
          // 与自定义充值那条（`can_purchase`）同一个形状，两条购买路径体验对称
          can_purchase: t.canPurchase,
          denied_hint: t.deniedHint,
          // 这一档到账积分的有效期（月）。**逐档回**，与自定义充值那条（`credits_valid_months`）
          // 同一个形状：卡片上要标这一档自己的那个数，页面级写死任何一个数都会是假话
          credits_valid_months: t.creditsValidMonths,
        })),
        credits_per_yuan: catalog.creditsPerYuan,
      });
    } catch (error) {
      throw toRechargeError(error, "档位服务暂不可用");
    }
  }

  /**
   * 自定义充值报价（模块 B，PRD §7.2）。
   *
   * <p>⚠️ **游客也要能拿到**（PRD §7.4「游客可见不可买」），所以是 `@Public()`；
   * 但登录用户必须拿到自己的权限判定，因此这里**自己看一眼会话 cookie**（best-effort）：
   * `@Public()` 会让 `AuthGuard` 直接放行、不填 `request.user`，所以拿不到注入的当前用户。
   *
   * <p>会话读不出来一律当游客（`canPurchase: null`），**不报错** —— 这条接口游客本来就该能看，
   * 把「cookie 过期」变成 401 只会让没登录的人在充值页上看到一块红色错误。
   */
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
        // null = 游客（未判定）。前端据此把按钮导向登录，而不是把整块藏起来
        can_purchase: offer.canPurchase,
        denied_hint: offer.deniedHint,
      });
    } catch (error) {
      throw toRechargeError(error, "自定义充值配置暂不可用");
    }
  }

  /**
   * 下单：返回银行统一收银台链接，前端自己渲染二维码。
   *
   * <p>两种商品类型走同一个接口：传 `tier_id` = 固定档位，传 `credits` = 自定义充值（模块 B）。
   * **不接受前端传来的价格**（PRD §7.5「以服务端最新配置为准」）—— 钱只能服务端算。
   */
  @Post("order")
  async order(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tierId = typeof body?.tier_id === "string" ? body.tier_id.trim() : "";
    const hasCredits = body?.credits !== undefined && body?.credits !== null;

    // 两个都给（或都不给）说明调用方搞错了商品类型。**不当场挑一个执行**：
    // 「以为买的是 600 积分、实际下的是 ¥499 档位」这种歧义一旦按某一边解释，
    // 用户看到的金额与他会付的钱就不是一回事了。
    if (tierId && hasCredits) {
      throw new NewApiError("tier_id 与 credits 只能传一个", 400);
    }
    if (!tierId && !hasCredits) {
      throw new NewApiError("缺少 tier_id 或 credits", 400);
    }

    // 自定义充值：在边界先把积分数解析出来，非法值当场 400（服务里还会再校验一次 ——
    // 那里是真正的闸，这里只是让错误消息贴着「传参不对」这个事实）
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

  /**
   * 尽力而为地解析当前用户：拿不到就是游客（返回 null），**不抛错**。
   *
   * <p>为什么不用 `@CurrentUser()`：本方法服务于 `@Public()` 接口，而 `AuthGuard`
   * 对公开接口直接放行、压根不解析会话，注入进来永远是 undefined ——
   * 那样登录用户拿到的权限判定会与游客一样是「未知」。
   */
  private async optionalUserId(req: Request): Promise<number | null> {
    // IKJAZM：令牌可能来自请求头（新）或 cookie（迁移期）。只看 cookie 会让
    // 只带请求头的已登录用户被判成游客——看到游客价、「登录后购买」。
    const token = extractLoginToken(req);
    if (!token) return null;
    try {
      const session = await this.sessions.resolveSession(token);
      return session ? Number(session.userId) : null;
    } catch {
      // 会话服务不可用/会话已过期，对这条接口都只是「当游客看」这一个答案：
      // 展示项本来就是公开的，把它变成 500 只会让充值页多一块无谓的错误态
      return null;
    }
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
