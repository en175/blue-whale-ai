/**
 * 管理后台对外数据模型（IK6JXI 契约 3.x，camelCase）。
 * 字段与 docs/specs/2026-08-05-admin-api-contract.md 一一对应。
 */

export type AdminUserStatus = "active" | "disabled";

export interface AdminUser {
  userId: number;
  nickname: string;
  phone: string;
  balance: number;
  totalRecharge: number;
  totalSpend: number;
  role: number;
  status: AdminUserStatus;
  createdAt: string;
  updatedAt: string;
}

/** new-api TopUp 状态透传（pending | success | expired | failed，无 refunded）。 */
export type AdminOrderStatus = "pending" | "success" | "expired" | "failed";

export interface AdminOrder {
  tradeNo: string;
  userId: number;
  nickname: string;
  phone: string;
  tierName: string;
  amount: number;
  price: number;
  points: number;
  bonus: number;
  status: AdminOrderStatus;
  paymentMethod: string;
  platformRefNo: string | null;
  ip: string;
  createdAt: string;
  paidAt: string | null;
  arrivedAt: string | null;
}

export interface ConsumeRecord {
  userId: number;
  model: string;
  points: number;
  createdAt: string;
}

export interface AdminPage<T> {
  list: T[];
  total: number;
}

export interface DashboardStats {
  totalUsers: number;
  todayRecharge: number;
  todayRechargeCount: number;
  todaySpend: number;
  pendingOrders: number;
  recentRecharges: AdminOrder[];
  recentConsumes: ConsumeRecord[];
}
