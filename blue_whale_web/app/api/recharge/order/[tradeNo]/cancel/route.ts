import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

/**
 * POST /api/recharge/order/:tradeNo/cancel — 取消未支付订单
 *
 * 改接说明：Go 原生 new-api 充值**没有**取消端点（旧自定义 recharge 才有 /order/:tradeNo/cancel）。
 * 原生 pending 订单由 BlueWhalePay / Go 超时机制自动失效，无需主动取消。
 * 故此处保留鉴权契约、做幂等 no-op：前端关闭弹窗/切换支付方式时 fire-and-forget 调用即可。
 *
 * 鉴权与下单同门禁：sk- 令牌过 withAuthenticatedUser 真校验（Go identity，60s 缓存），
 * 只查前缀会让任意伪造令牌触发端点（即便是 no-op，也不留匿名面）。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tradeNo: string }> },
) {
  return withAuthenticatedUser(request, async (_user) => {
    const { tradeNo } = await params;
    if (!tradeNo) {
      return Response.json(
        { code: 400, msg: "缺少订单号", data: null },
        { status: 400 },
      );
    }

    // 原生充值无取消语义，pending 单自动过期。幂等返回成功。
    return Response.json({ code: 200, msg: null, data: null });
  });
}
