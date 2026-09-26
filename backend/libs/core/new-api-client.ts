// new-api 客户端组合入口。实现按职责拆分到同目录子模块（IK74V8，≤800 行硬线）；
// 本文件只做组合与再导出。
//
// ⚠️ 这里的**只剩上游本职**：生成（worker 的任务）与下面三块。用户的身份、余额、
//    消费流水、充值、管理端订单都不再经过 new-api——它是带一把统一 key 的上游供应商，
//    问它「这个人的余额 / 账单」只会拿到统一 key 属主一个人的答案。
import {
  createNewApiRequest,
  createNewApiRequestWithMeta,
} from "./new-api-transport.js";
import { createNewApiGenerationOps } from "./new-api-generation-ops.js";
import { createNewApiUpstreamOps } from "./new-api-upstream-ops.js";
import type { NewApiClientOptions } from "./new-api-types.js";

export * from "./new-api-types.js";
export {
  createNewApiRawRequest,
  type NewApiRawRequest,
  type NewApiRawResult,
  NewApiError,
  NewApiTimeoutError,
  NewApiNetworkError,
  CLIENT_SYSTEM_BLUEWHALE,
} from "./new-api-transport.js";

export function createNewApiClient(options: NewApiClientOptions) {
  const request = createNewApiRequest(options);
  const requestWithMeta = createNewApiRequestWithMeta(options);
  return {
    ...createNewApiGenerationOps(request, requestWithMeta),
    ...createNewApiUpstreamOps(request),
  };
}
