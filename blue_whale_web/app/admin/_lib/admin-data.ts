/**
 * 管理后台真实数据层（IK6JXJ，替代 users/orders/仪表板的 _mock.ts）。
 *
 * 字段与 docs/specs/2026-08-05-admin-api-contract.md 第 3/4 节一一对应；
 * 全部走 adminRequest（apiFetch：token 注入 + 401 自动刷新 + 统一信封）。
 */

import { adminRequest } from "./admin-api";

// ---- 契约 3.1 AdminUser ----
export type AdminUserInfo = {
  userId: number;
  nickname: string;
  phone: string;
  balance: number;
  totalRecharge: number;
  totalSpend: number;
  role: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

// ---- 契约 3.2 AdminOrder ----
export type OrderStatus = "pending" | "success" | "expired" | "failed";

export type AdminOrder = {
  tradeNo: string;
  userId: number;
  nickname: string;
  phone: string;
  tierName: string;
  amount: number;
  price: number;
  points: number;
  bonus: number;
  status: OrderStatus;
  paymentMethod: string;
  platformRefNo: string | null;
  ip: string;
  createdAt: string;
  paidAt: string | null;
  arrivedAt: string | null;
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待支付",
  success: "已到账",
  expired: "已过期",
  failed: "支付失败",
};

export const ORDER_STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "pending", label: "待支付" },
  { value: "success", label: "已到账" },
  { value: "expired", label: "已过期" },
  { value: "failed", label: "支付失败" },
];

// ---- 契约 3.3 / 3.4 仪表板 ----
export type ConsumeRecord = {
  userId: number;
  model: string;
  points: number;
  createdAt: string;
};

export type DashboardStats = {
  totalUsers: number;
  todayRecharge: number;
  todayRechargeCount: number;
  todaySpend: number;
  pendingOrders: number;
  recentRecharges: AdminOrder[];
  recentConsumes: ConsumeRecord[];
};

// ---- 契约 4.2 / 4.3 用户 ----

export async function fetchAdminUsers(
  params: {
    keyword?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{ list: AdminUserInfo[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.keyword) qs.set("keyword", params.keyword);
  if (params.status) qs.set("status", params.status);
  qs.set("page", String(params.page ?? 1));
  qs.set("pageSize", String(params.pageSize ?? 100));
  const { data } = await adminRequest<{ list: AdminUserInfo[]; total: number }>(
    `/api/admin/users?${qs.toString()}`,
  );
  return data;
}

export async function manageUser(
  userId: number,
  action: "freeze" | "unfreeze" | "adjustBalance",
  reason: string,
  value?: number,
): Promise<void> {
  await adminRequest(`/api/admin/users/${userId}/manage`, {
    method: "POST",
    body: JSON.stringify({
      action,
      reason,
      ...(value !== undefined ? { value } : {}),
    }),
  });
}

// ---- 契约 4.4 / 4.5 订单 ----

export async function fetchAdminOrders(
  params: {
    keyword?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<{ list: AdminOrder[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.keyword) qs.set("keyword", params.keyword);
  if (params.status) qs.set("status", params.status);
  qs.set("page", String(params.page ?? 1));
  qs.set("pageSize", String(params.pageSize ?? 100));
  const { data } = await adminRequest<{ list: AdminOrder[]; total: number }>(
    `/api/admin/orders?${qs.toString()}`,
  );
  return data;
}

export async function completeOrder(
  tradeNo: string,
  reason: string,
): Promise<void> {
  await adminRequest(
    `/api/admin/orders/${encodeURIComponent(tradeNo)}/complete`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

// ---- 契约 4.6 仪表板 ----

export async function fetchDashboard(): Promise<DashboardStats> {
  const { data } = await adminRequest<DashboardStats>("/api/admin/dashboard");
  return data;
}
