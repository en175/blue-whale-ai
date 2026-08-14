import { NewApiError } from "@blue-whale/core";
import { userCredentialRequiredResponse } from "@/lib/account/bff";
import { createWebNewApiClient } from "@/lib/logging";
import {
  mapPaymentMethodLabel,
  mapTopUpStatus,
  parseRecordPaging,
  topUpCreditsGained,
} from "@/lib/account/records";
import { parseNewApiBearerToken } from "@/lib/auth/bearer-token";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { loadGoTopUpConfig } from "@/lib/recharge/go-topup";

/**
 * GET /api/account/topups — 当前用户充值记录（账户中心，IK39UR）
 *
 * 数据流：Go /api/user/topup/self（model.TopUp，按 id desc 即时间倒序）→
 * 映射为展示契约（积分/实付/支付方式文案/三态状态），{code,msg,data} 信封返回。
 *
 * 鉴权（ADR-0062 #18）：topup/self 挂账户层 AccountTokenOrUserAuth，凭当前用户
 * sk- 令牌即可，Go 按 Token 属主过滤订单，不发 New-Api-User、不用 root 凭证。
 * 前端令牌先过 withAuthenticatedUser 真校验（Go identity，60s 缓存），防伪造。
 */
export async function GET(request: Request) {
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

  return withAuthenticatedUser(request, async () => {
    const userToken = parseNewApiBearerToken(
      request.headers.get("authorization"),
    );
    if (!userToken) {
      return userCredentialRequiredResponse("未提供有效令牌");
    }

    const { page, pageSize } = parseRecordPaging(
      new URL(request.url).searchParams,
    );

    try {
      const client = createWebNewApiClient({ baseUrl: config.baseUrl });
      const result = await client.listUserTopUps(userToken, {
        page,
        pageSize,
      });
      return Response.json({
        code: 200,
        msg: null,
        data: {
          items: result.items.map((record) => ({
            trade_no: record.trade_no,
            credits: topUpCreditsGained(record.amount),
            amount_cny: record.money,
            payment_method: mapPaymentMethodLabel(record.payment_method),
            status: mapTopUpStatus(record.status),
            created_at: record.create_time,
          })),
          total: result.total,
        },
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
          msg: error instanceof Error ? error.message : "充值记录查询不可用",
          data: null,
        },
        { status },
      );
    }
  });
}
