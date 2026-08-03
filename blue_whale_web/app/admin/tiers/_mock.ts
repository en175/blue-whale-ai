/**
 * admin tiers — 真实 API 数据层（替换原 mock）
 *
 * 对接 /api/admin/topup-tiers 系列接口。
 * 审计（operation_logs）与折扣同步（amount_discount）都在服务端路由内完成，
 * 这里只负责请求/响应与把服务端带回的 warning（如同步失败提示）透出给用户。
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

/** 服务端响应壳：{ success, data, error?, warning? }。warning 用于非阻断提示（如折扣同步失败）。 */
async function api<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; warning?: string }> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "请求失败");
  return {
    data: json.data as T,
    ...(typeof json.warning === "string" && json.warning
      ? { warning: json.warning }
      : {}),
  };
}

export async function getTiers(): Promise<AdminTier[]> {
  return (await api<AdminTier[]>("/api/admin/topup-tiers")).data;
}

export async function createTier(data: TierFormData): Promise<AdminTier> {
  const { data: tier, warning } = await api<AdminTier>(
    "/api/admin/topup-tiers",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
  // 档位已保存但折扣同步失败等：不阻断，但必须让管理员知道去 Go 后台核对。
  if (warning) alert(warning);
  return tier;
}

export async function updateTier(
  id: string,
  data: TierFormData,
): Promise<AdminTier> {
  const { data: tier, warning } = await api<AdminTier>(
    `/api/admin/topup-tiers/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
  if (warning) alert(warning);
  return tier;
}

export async function deleteTier(id: string): Promise<void> {
  const { warning } = await api<unknown>(`/api/admin/topup-tiers/${id}`, {
    method: "DELETE",
  });
  if (warning) alert(warning);
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

  return (
    await api<AdminTier[]>("/api/admin/topup-tiers/sort", {
      method: "PUT",
      body: JSON.stringify({ items }),
    })
  ).data;
}

export async function getPreviewTiers(): Promise<AdminTier[]> {
  return (await api<AdminTier[]>("/api/admin/topup-tiers/preview")).data;
}
