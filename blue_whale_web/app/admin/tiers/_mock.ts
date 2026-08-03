/**
 * admin tiers — 真实 API 数据层（替换原 mock）
 *
 * 对接 /api/admin/topup-tiers 系列接口。
 */

export type AdminTier = {
  id: string;
  name: string;
  amount: number;
  originalPrice: number;
  discount: number;
  price: number;
  isRecommended: boolean;
  status: "active" | "inactive";
  startTime: string | null;
  endTime: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type TierFormData = {
  amount: number;
  originalPrice: number;
  discount: number;
  isRecommended: boolean;
  status: "active" | "inactive";
  startTime: string;
  endTime: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "请求失败");
  return json.data as T;
}

export async function getTiers(): Promise<AdminTier[]> {
  return api<AdminTier[]>("/api/admin/topup-tiers");
}

export async function createTier(data: TierFormData): Promise<AdminTier> {
  return api<AdminTier>("/api/admin/topup-tiers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateTier(
  id: string,
  data: TierFormData,
): Promise<AdminTier> {
  return api<AdminTier>(`/api/admin/topup-tiers/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteTier(id: string): Promise<void> {
  await api<unknown>(`/api/admin/topup-tiers/${id}`, { method: "DELETE" });
}

export async function moveTier(
  tiers: AdminTier[],
  id: string,
  direction: "up" | "down",
): Promise<AdminTier[]> {
  const idx = tiers.findIndex((t) => t.id === id);
  if (idx === -1) return tiers;
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= tiers.length) return tiers;

  const reordered = [...tiers];
  [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
  const items = reordered.map((t, i) => ({ id: t.id, sortOrder: i + 1 }));

  return api<AdminTier[]>("/api/admin/topup-tiers/sort", {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export async function getPreviewTiers(): Promise<AdminTier[]> {
  return api<AdminTier[]>("/api/admin/topup-tiers/preview");
}
