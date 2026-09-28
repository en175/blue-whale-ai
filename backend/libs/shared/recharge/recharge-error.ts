/* ============================================
 * 充值域错误 → HTTP 信封错误。
 *
 * 抽成独立文件（它只需要几个错误类型，不需要 Prisma/网关）有两个好处：控制器只 import 它
 * 就能把异常翻成响应，而 `recharge.service.ts` 不必为了几个 `instanceof` 拖着这些依赖
 * —— 那个文件有 800 行硬线。
 * ============================================ */
import { NewApiError } from "@lib/core";
import {
  BillingAdminConfigError,
  BillingAdminError,
} from "@lib/shared/billing/billing-admin-client.js";
import { toBillingError } from "@lib/shared/billing/billing-client.js";
import {
  PayGatewayError,
  PayServerConfigError,
} from "@lib/shared/pay-server/index.js";
import { SystemSettingsConfigError } from "@lib/shared/system-settings/index.js";

/**
 * 三类分开：**配置错了**（503，要人改配置）、**网关业务失败**（502，可重试或换金额）、
 * **billing 不可用**（503）。统一成 500 会让「少配一个环境变量」看起来像「服务挂了」，
 * 处置完全不同。
 */
export function toRechargeError(error: unknown, fallbackMessage: string): NewApiError {
  if (error instanceof NewApiError) return error;
  if (
    error instanceof PayServerConfigError ||
    error instanceof BillingAdminConfigError ||
    error instanceof SystemSettingsConfigError
  ) {
    return new NewApiError(error.message, 503, "recharge_unconfigured");
  }
  if (error instanceof PayGatewayError) {
    return new NewApiError(error.message, 502, "pay_gateway_error");
  }
  if (error instanceof BillingAdminError) {
    return new NewApiError(fallbackMessage, 503, "billing_unavailable");
  }
  return toBillingError(error, fallbackMessage);
}
