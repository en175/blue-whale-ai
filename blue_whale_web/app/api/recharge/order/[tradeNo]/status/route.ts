import { NewApiError } from "@blue-whale/core";
import { createWebNewApiClient } from "@/lib/logging";
import { parseNewApiBearerToken } from "@/lib/auth/bearer-token";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { loadGoTopUpConfig } from "@/lib/recharge/go-topup";

/**
 * GET /api/recharge/order/:tradeNo/status — 轮询充值订单状态（原生 new-api topup）
 *
 * 改接说明：原生充值订单（BWP...）存于 Go model.TopUp，旧的自定义 recharge status 端点
 * 查的是另一张表、找不到 BWP 单。这里改调 GET /api/user/topup/self?keyword=<tradeNo> 精确匹配。
 * Go 状态 success → 前端 paid；paid 时取 /api/usage/token 当前余额作 credits_after。
 *
 * 鉴权：查单接口挂在账户层 AccountTokenOrUserAuth 下，凭当前用户 sk- 令牌即可；
 * Go 按 Token 属主过滤订单，天然查不到他人订单。前端令牌过 withAuthenticatedUser
 * 真校验（Go identity，60s 缓存，轮询不额外打 Go）；余额接口 /api/usage/token 走
 * TokenAuthReadOnly，认前端 sk- 令牌，直接沿用。
 */

/** Go common.TopUpStatus* → 前端 OrderStatus。 */
const STATUS_MAP: Record<string, "pending" | "paid" | "expired" | "failed"> = {
  pending: "pending",
  success: "paid",
  expired: "expired",
  failed: "failed",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tradeNo: string }> },
) {
  const config = loadGoTopUpConfig();
  if (!config) {
    return Response.json(
      {
        code: 503,
        msg: "Go 充值配置未就绪（NEW_API_BASE_URL）",
        data: null,
      },
      { status: 503 },
    );
  }

  return withAuthenticatedUser(request, async (_user) => {
    // 认证回调内提取当前请求的 Bearer Token（刚经 withAuthenticatedUser 真校验）。
    const userToken = parseNewApiBearerToken(
      request.headers.get("authorization"),
    );
    if (!userToken) {
      return Response.json(
        { code: 401, msg: "未提供有效令牌", data: null },
        { status: 401 },
      );
    }

    const { tradeNo } = await params;
    if (!tradeNo) {
      return Response.json(
        { code: 400, msg: "缺少订单号", data: null },
        { status: 400 },
      );
    }

    try {
      const client = createWebNewApiClient({ baseUrl: config.baseUrl });
      // 查单走账户层 AccountTokenOrUserAuth，用当前用户 Token；Go 按属主过滤订单。
      const record = await client.getTopUpByTradeNo(userToken, tradeNo);
      if (!record) {
        return Response.json(
          { code: 404, msg: "订单不存在", data: null },
          { status: 404 },
        );
      }
      const status = STATUS_MAP[record.status] ?? "pending";
      let creditsAfter: number | null = null;
      if (status === "paid") {
        // 余额走 /api/usage/token（TokenAuthReadOnly，认 sk- 令牌），沿用前端令牌。
        const usage = await client.getTokenUsage(userToken);
        creditsAfter = usage.userQuota;
      }
      return Response.json({
        code: 200,
        msg: null,
        data: { trade_no: tradeNo, status, credits_after: creditsAfter },
      });
    } catch (error) {
      const status =
        error instanceof NewApiError &&
        error.status >= 400 &&
        error.status < 500
          ? error.status
          : 502;
      return Response.json(
        {
          code: status,
          msg: error instanceof Error ? error.message : "订单查询不可用",
          data: null,
        },
        { status },
      );
    }
  });
}
