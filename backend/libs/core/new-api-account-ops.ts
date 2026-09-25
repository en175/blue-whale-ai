// IK74V8：从 new-api-client.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// Token 面的只读查询：用量与用量日志。
//
// ⚠️ 这里**不再有**能力探测、注册/登录、Token 身份复核、改密——那几件事的前提
//    都是「new-api 认识我们的用户」，而 new-api 已经降级成带一把统一 key 的上游
//    供应商。身份类读写现在全部走我们自己的库（`IdentityService`）。
import {NewApiError} from "./new-api-transport.js";
import type {NewApiEnvelope, NewApiRequest} from "./new-api-transport.js";
import type {NewApiLog, NewApiUsage} from "./new-api-types.js";

export function createNewApiAccountOps(request: NewApiRequest) {
  return {
    async getTokenUsage(token: string): Promise<NewApiUsage> {
      const response = await request<NewApiEnvelope>(
        "/api/usage/token/",
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as Record<string, unknown>;
      const quota = data.user_quota ?? data.quota ?? data.total_available;
      if (typeof quota !== "number" || !Number.isFinite(quota)) {
        throw new NewApiError(
          "new-api usage 响应缺少 quota",
          502,
          "invalid_usage_response",
          response,
        );
      }
      return { userQuota: quota, raw: response.data };
    },

    async getTokenLogs(token: string): Promise<NewApiLog[]> {
      const response = await request<NewApiEnvelope>(
        "/api/log/token",
        { method: "GET" },
        token,
      );
      return Array.isArray(response.data) ? (response.data as NewApiLog[]) : [];
    },
  };
}
