// new-api 客户端组合入口。实现按职责拆分到同目录子模块（IK74V8，≤800 行硬线）；
// 本文件只做组合与再导出，对外导出面保持不变。
import {
  createNewApiRequest,
  createNewApiRequestWithMeta,
} from "./new-api-transport.js";
import { createNewApiAccountOps } from "./new-api-account-ops.js";
import { createNewApiGenerationOps } from "./new-api-generation-ops.js";
import { createNewApiBillingOps } from "./new-api-billing-ops.js";
import { createNewApiAdminOps } from "./new-api-admin-ops.js";
import type { NewApiClientOptions } from "./new-api-types.js";

export * from "./new-api-types.js";
export { NewApiError } from "./new-api-transport.js";

/**
 * 原生充值接口（/api/user/amount、/api/user/bluewhalepay/pay、
 * /api/user/topup/self）挂在账户层 AccountTokenOrUserAuth 下，只凭 Bearer
 * sk-xxx 证明账户身份；订单 User ID 由 Go 从 Token 属主解析，客户端不得
 * 发送 New-Api-User 头。（RootAuth 的 /api/option/ 管理接口仍需该头。）
 */
export function createNewApiClient(options: NewApiClientOptions) {
  const request = createNewApiRequest(options);
  const requestWithMeta = createNewApiRequestWithMeta(options);
  return {
    ...createNewApiAccountOps(request),
    ...createNewApiGenerationOps(request, requestWithMeta),
    ...createNewApiBillingOps(request),
    ...createNewApiAdminOps(request),
  };
}
