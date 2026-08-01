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

let logSeed = 9000;
const logs: AuditLogEntry[] = [];

export function getAuditLogs(filter?: {
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  searchText?: string;
}): AuditLogEntry[] {
  let result = [...logs];
  if (filter?.category && filter.category !== "all") {
    result = result.filter((l) => l.category === filter.category);
  }
  if (filter?.dateFrom) {
    const from = new Date(filter.dateFrom).getTime();
    result = result.filter((l) => new Date(l.createdAt).getTime() >= from);
  }
  if (filter?.dateTo) {
    const to = new Date(filter.dateTo).getTime() + 86400000;
    result = result.filter((l) => new Date(l.createdAt).getTime() <= to);
  }
  if (filter?.searchText?.trim()) {
    const q = filter.searchText.trim().toLowerCase();
    result = result.filter(
      (l) =>
        l.target.toLowerCase().includes(q) ||
        l.detail.toLowerCase().includes(q) ||
        l.operator.toLowerCase().includes(q),
    );
  }
  return result.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function writeAuditLog(
  entry: Omit<AuditLogEntry, "id" | "createdAt">,
): void {
  logs.unshift({
    ...entry,
    id: `audit_${String(++logSeed)}`,
    createdAt: new Date().toISOString(),
  });
}
