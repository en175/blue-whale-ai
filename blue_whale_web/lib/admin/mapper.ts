/**
 * new-api 原始行 → 管理后台对外模型（IK6JXI 契约 3.x）。
 * 纯函数映射，字段口径以 docs/specs/2026-08-05-admin-api-contract.md 为准。
 */

import type {
  NewApiAdminTopUpRow,
  NewApiAdminUserRow,
  NewApiLogRow,
} from "@blue-whale/core";

import type {
  AdminOrder,
  AdminOrderStatus,
  AdminUser,
  ConsumeRecord,
} from "./types";

/** 秒级时间戳 → ISO；缺失时回退到 0 时刻（上游脏数据兜底）。 */
function epochToIso(seconds: number): string {
  return new Date((seconds || 0) * 1000).toISOString();
}

/** 秒级时间戳 → ISO；0 / 缺失 → null（未完成动作无时间）。 */
function epochToIsoOrNull(seconds: number): string | null {
  return seconds > 0 ? epochToIso(seconds) : null;
}

/** new-api User → AdminUser（契约 3.1）。 */
export function mapAdminUser(row: NewApiAdminUserRow): AdminUser {
  const createdAt = epochToIso(row.created_at);
  return {
    userId: row.id,
    nickname: row.display_name || row.username,
    phone: row.email ?? "",
    balance: row.quota ?? 0,
    // 累计到账口径：剩余 + 已消费（契约锁定的近似值，new-api 无独立累计充值字段）。
    totalRecharge: (row.quota ?? 0) + (row.used_quota ?? 0),
    totalSpend: row.used_quota ?? 0,
    role: row.role,
    status: row.status === 1 ? "active" : "disabled",
    createdAt,
    updatedAt: createdAt,
  };
}

/** new-api TopUp → AdminOrder（契约 3.2）。
 *  nickname/phone：new-api 无批量用户查询，列表场景留空，前端展示 userId 兜底。 */
export function mapAdminOrder(row: NewApiAdminTopUpRow): AdminOrder {
  return {
    tradeNo: row.trade_no,
    userId: row.user_id,
    nickname: "",
    phone: "",
    // new-api TopUp 无档位名，按契约锁定生成规则。
    tierName: `${row.amount ?? 0} 积分`,
    amount: row.amount ?? 0,
    price: row.money ?? 0,
    points: row.amount ?? 0,
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

/** new-api Log → ConsumeRecord（契约 3.4）。
 *  points 口径：取 quota（与用户余额同单位的积分消耗；折算公式锁定为 quota 直读）。 */
export function mapConsumeRecord(row: NewApiLogRow): ConsumeRecord {
  return {
    userId: row.user_id,
    model: row.model_name ?? "",
    points: row.quota ?? 0,
    createdAt: epochToIso(row.created_at),
  };
}
