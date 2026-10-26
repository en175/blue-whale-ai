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
