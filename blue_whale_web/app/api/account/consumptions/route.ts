import { createNewApiClient, NewApiError } from "@blue-whale/core";
import {
  consumeCredits,
  parseRecordPaging,
  summarizeConsumption,
} from "@/lib/account/records";
import { parseNewApiBearerToken } from "@/lib/auth/bearer-token";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { loadGoTopUpConfig } from "@/lib/recharge/go-topup";

/**
 * GET /api/account/consumptions — 当前用户消费记录（账户中心，IK39UR）
 *
 * 数据流：Go /api/log/self?type=2（model.Log 消费流水，按 id desc 即时间倒序）→
 * 映射为展示契约（消耗积分 + 模型名→业务摘要），{code,msg,data} 信封返回。
 * 摘要为简单版映射（seedream→生成图片 / seedance→生成视频），不改 Go。
 *
 * 鉴权（IK6M2F）：/api/log/self 已迁账户层 AccountTokenOrUserAuth，凭当前用户
 * sk- 令牌即可，Go 按 Token 属主过滤流水，不发 New-Api-User、不用 root 凭证
 * （与 topups 一致）。前端令牌先过 withAuthenticatedUser 真校验（Go identity，
 * 60s 缓存），防伪造。
 */
export async function GET(request: Request) {
  const config = loadGoTopUpConfig();
  if (!config) {
    return Response.json(
      {
        code: 503,
        msg: "Go 消费记录服务未配置（NEW_API_BASE_URL）",
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
      return Response.json(
        { code: 401, msg: "未提供有效令牌", data: null },
        { status: 401 },
      );
    }

    const { page, pageSize } = parseRecordPaging(
      new URL(request.url).searchParams,
    );

    try {
      const client = createNewApiClient({ baseUrl: config.baseUrl });
      const result = await client.listUserConsumeLogs(userToken, {
        page,
        pageSize,
      });
      return Response.json({
        code: 200,
        msg: null,
        data: {
          items: result.items.map((log) => ({
            id: log.id,
            credits: consumeCredits(log.quota),
            summary: summarizeConsumption(log.model_name),
            created_at: log.created_at,
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
          msg: error instanceof Error ? error.message : "消费记录查询不可用",
          data: null,
        },
        { status },
      );
    }
  });
}
