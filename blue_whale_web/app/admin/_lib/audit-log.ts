/**
 * admin 操作日志数据层 —— 真实 API 客户端（替换原内存 mock）
 *
 * 对接 /api/admin/operation-logs。导出类型与常量保持不变，
 * 调用方（logs 页 + 各模块 mock 的 writeAuditLog）无需改动签名。
 * 只记录写操作；查询不记。
 */

import { adminRequest } from "./admin-api";

export type AuditCategory = "pricing" | "tier" | "order" | "user";

export type AuditLogEntry = {
  id: string;
  category: AuditCategory;
  action: string;
  target: string;
  detail: string;
  operator: string;
  createdAt: string;
};

export const AUDIT_CATEGORY_OPTIONS = [
  { value: "all", label: "全部类别" },
  { value: "pricing", label: "定价规则" },
  { value: "tier", label: "充值档位" },
  { value: "order", label: "订单管理" },
  { value: "user", label: "用户管理" },
];

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  pricing: "定价规则",
  tier: "充值档位",
  order: "订单管理",
  user: "用户管理",
};

/** 后端返回行（camelCase），取 AuditLogEntry 需要的字段。 */
type ApiRow = {
  id: string;
  category: string;
  action: string;
  target: string;
  detail: string;
  operator: string;
  createdAt: string;
};

export async function getAuditLogs(filter?: {
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  searchText?: string;
}): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (filter?.category) params.set("category", filter.category);
  if (filter?.dateFrom) params.set("dateFrom", filter.dateFrom);
  if (filter?.dateTo) params.set("dateTo", filter.dateTo);
  if (filter?.searchText?.trim())
    params.set("searchText", filter.searchText.trim());

  try {
    const { data } = await adminRequest<ApiRow[]>(
      `/api/admin/operation-logs?${params.toString()}`,
    );
    return data.map((r) => ({
      id: r.id,
      category: r.category as AuditCategory,
      action: r.action,
      target: r.target,
      detail: r.detail,
      operator: r.operator,
      createdAt: r.createdAt,
    }));
  } catch {
    return [];
  }
}

/** 写一条操作审计。fire-and-forget：内部吞错，调用方无需 await，失败不阻断主流程。 */
export function writeAuditLog(
  entry: Omit<AuditLogEntry, "id" | "createdAt">,
): void {
  void adminRequest("/api/admin/operation-logs", {
    method: "POST",
    body: JSON.stringify(entry),
  }).catch(() => {});
}
