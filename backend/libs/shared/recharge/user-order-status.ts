import {
  PAID_REACHED_STATUSES,
  RECHARGE_ORDER_STATUS,
  type RechargeOrderStatus,
} from "@lib/shared/persistence/index.js";

export const USER_ORDER_STATUSES = ["pending", "paid", "expired"] as const;

export type UserOrderStatus = (typeof USER_ORDER_STATUSES)[number];

export const USER_ORDER_STATUS_LABEL: Record<UserOrderStatus, string> = {
  pending: "待支付",
  paid: "已到账",
  expired: "已取消",
};

export function isUserOrderStatus(value: string): value is UserOrderStatus {
  return (USER_ORDER_STATUSES as readonly string[]).includes(value);
}

export function toUserOrderStatus(status: RechargeOrderStatus): UserOrderStatus {
  if (status === RECHARGE_ORDER_STATUS.pending) return "pending";
  if (PAID_REACHED_STATUSES.includes(status)) return "paid";
  return "expired";
}

export function toStoredOrderStatuses(status: UserOrderStatus): RechargeOrderStatus[] {
  if (status === "pending") return [RECHARGE_ORDER_STATUS.pending];
  if (status === "paid") return [...PAID_REACHED_STATUSES];
  return [RECHARGE_ORDER_STATUS.failed, RECHARGE_ORDER_STATUS.expired];
}
