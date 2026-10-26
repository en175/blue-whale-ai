import { NewApiError } from "@lib/core";
import type { Logger } from "@lib/core/logging";
import type { RechargeOrderRepo, RechargeOrderView } from "@lib/shared/persistence/index.js";
import { RECHARGE_ORDER_STATUS } from "@lib/shared/persistence/index.js";
import type { OrderSpec, RechargeOrderCreated } from "./recharge.service.js";

export const CASHIER_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface ActiveOrderReuseDeps {
  repo: Pick<RechargeOrderRepo, "findActiveOrder" | "findUnsettledPaidOrder">;
  reconcile: (order: RechargeOrderView) => Promise<RechargeOrderView>;
  logger: Logger;
}

export function createActiveOrderReuse(
  deps: ActiveOrderReuseDeps,
): (userId: number, spec: OrderSpec) => Promise<RechargeOrderCreated | null> {
  return async function reuseActiveOrder(userId, spec) {
    const unsettled = await deps.repo.findUnsettledPaidOrder(userId);
    if (unsettled) {
      deps.logger.warn(
        `用户重复下单命中一笔已支付的未终态单 tradeNo=${unsettled.tradeNo} `
          + `userId=${unsettled.userId} 状态=${unsettled.status}：不建新单、不复用二维码`,
      );
      throw new NewApiError(
        `您有一笔订单正在处理中（${unsettled.tradeNo}），请勿重复购买。`
          + `请稍后重试本页；若长时间未到账请联系客服`,
        409,
        "recharge_order_paid",
      );
    }

    const active = await deps.repo.findActiveOrder({
      userId,
      productType: spec.productType,
      tierId: spec.tierId,
      credits: spec.credits,
      amountFen: spec.amountFen,
    });
    if (!active) return null;

    if (!active.payOrderId) return null;

    const age = Date.now() - Date.parse(active.createdAt);
    if (active.cashierUrl && age <= CASHIER_TOKEN_TTL_MS) {
      deps.logger.info(
        `复用未支付的同商品订单 tradeNo=${active.tradeNo} userId=${active.userId}`,
      );
      return {
        tradeNo: active.tradeNo,
        cashierUrl: active.cashierUrl,
        expiresAt: new Date(
          Date.parse(active.createdAt) + CASHIER_TOKEN_TTL_MS,
        ).toISOString(),
        amount: active.amountFen / 100,
        credits: active.credits,
      };
    }

    if (active.cashierUrl === null && age <= CASHIER_TOKEN_TTL_MS) {
      throw new NewApiError(
        `您有一笔尚未支付的订单（${active.tradeNo}），请稍后重试本页；若持续失败请联系客服`,
        409,
        "recharge_order_pending",
      );
    }

    const settled = await deps.reconcile(active);
    if (settled.status !== RECHARGE_ORDER_STATUS.pending) {
      deps.logger.warn(
        `重新下单时发现旧单已了结 tradeNo=${active.tradeNo} 旧状态=${active.status} 新状态=${settled.status}`,
      );
    }
    return null;
  };
}
