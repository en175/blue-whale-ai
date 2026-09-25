import type {
  NewApiAdminTopUpRow,
  NewApiAdminUserRow,
  NewApiLogRow,
} from "@lib/core";
import { quotaToCredits } from "@lib/shared/credits/credits.js";

export type AdminOrderStatus = "success" | "failed" | "pending";

export type AdminUser = {
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
  status: AdminOrderStatus;
  paymentMethod: string;
  platformRefNo: string | null;
  ip: string;
  createdAt: string;
  paidAt: string | null;
  arrivedAt: string | null;
};

export type ConsumeRecord = {
  userId: number;
  model: string;
  points: number;
  createdAt: string;
};

function epochToIso(seconds: number): string {
  return new Date((seconds || 0) * 1000).toISOString();
}

function epochToIsoOrNull(seconds: number): string | null {
  return seconds > 0 ? epochToIso(seconds) : null;
}

export function mapAdminUser(row: NewApiAdminUserRow): AdminUser {
  const createdAt = epochToIso(row.created_at);
  // IK9VZ0：管理端展示统一为积分（quota / 50,000，与用户侧口径一致）；
  // quota 仍是内部唯一余额真相，与 Go 交互不在此层。
  return {
    userId: row.id,
    nickname: row.display_name || row.username,
    phone: row.email ?? "",
    balance: quotaToCredits(row.quota ?? 0),
    totalRecharge: quotaToCredits((row.quota ?? 0) + (row.used_quota ?? 0)),
    totalSpend: quotaToCredits(row.used_quota ?? 0),
    role: row.role,
    status: row.status === 1 ? "active" : "disabled",
    createdAt,
    updatedAt: createdAt,
  };
}

export function mapAdminOrder(row: NewApiAdminTopUpRow): AdminOrder {
  // IK9VZ0：TopUp.Amount 为 quota 量纲（raw tokens），管理端展示统一换算为积分。
  return {
    tradeNo: row.trade_no,
    userId: row.user_id,
    nickname: "",
    phone: "",
    tierName: `${quotaToCredits(row.amount ?? 0)} 积分`,
    amount: quotaToCredits(row.amount ?? 0),
    price: row.money ?? 0,
    points: quotaToCredits(row.amount ?? 0),
    bonus: 0,
    status: (row.status || "pending") as AdminOrderStatus,
    paymentMethod: row.payment_method ?? "",
    platformRefNo: row.payment_provider ?? null,
    ip: "",
    createdAt: epochToIso(row.create_time),
    paidAt: epochToIsoOrNull(row.complete_time),
    arrivedAt: epochToIsoOrNull(row.complete_time),
  };
}

export function mapConsumeRecord(row: NewApiLogRow): ConsumeRecord {
  return {
    userId: row.user_id,
    model: row.model_name ?? "",
    points: quotaToCredits(row.quota ?? 0),
    createdAt: epochToIso(row.created_at),
  };
}

export function parsePageParam(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function parsePageSizeParam(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20;
}
