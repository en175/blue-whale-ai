import { createNewApiClient, NewApiError } from "@blue-whale/core";
import {
  consumeCredits,
  parseRecordPaging,
  summarizeConsumption,
} from "@/lib/account/records";
import { loadGoConsumeLogsCredentials } from "@/lib/account/go-consume-logs";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";

/**
 * GET /api/account/consumptions — 当前用户消费记录（账户中心，IK39UR）
 *
 * 数据流：Go /api/log/self?type=2（model.Log 消费流水，按 id desc 即时间倒序）→
 * 映射为展示契约（消耗积分 + 模型名→业务摘要），{code,msg,data} 信封返回。
 * 摘要为简单版映射（seedream→生成图片 / seedance→生成视频），不改 Go。
 *
 * 鉴权（过渡期，与 topups 不同）：/api/log/self 尚未迁账户层（ADR-0062 #18
 * 只迁了充值三接口），仍只认 access_token + New-Api-User，不认 sk- 令牌
 * （部署环境实测 invalid access token）。故用 root 凭证代理查询，
 * 见 lib/account/go-consume-logs.ts；前端 sk- 令牌仍过 withAuthenticatedUser
 * 真校验，防伪造。Go 迁 log/self 后改为透传用户令牌。
 */
export async function GET(request: Request) {
  const credentials = loadGoConsumeLogsCredentials();
  if (!credentials) {
    return Response.json(
      {
        code: 503,
        msg: "Go 消费记录凭证未配置（NEW_API_BASE_URL / NEW_API_ROOT_ACCESS_TOKEN / NEW_API_ROOT_USER_ID）",
        data: null,
      },
      { status: 503 },
    );
  }

  return withAuthenticatedUser(request, async () => {
    const { page, pageSize } = parseRecordPaging(
      new URL(request.url).searchParams,
    );

    try {
      const client = createNewApiClient({ baseUrl: credentials.baseUrl });
      const result = await client.listUserConsumeLogs(
        credentials.rootToken,
        { page, pageSize },
        credentials.rootUserId,
      );
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
