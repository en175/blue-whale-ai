/**
 * admin tiers — 真实 API 数据层（原文件名为 _mock.ts，实为真实客户端，IK6JXJ 更名去误导）。
 *
 * 对接 /api/admin/topup-tiers 系列接口（withAdminUser 保护）。
 * 审计（operation_logs）与折扣同步（amount_discount）都在服务端路由内完成，
 * 这里只负责请求/响应与把服务端带回的 warning（如同步失败提示）透出给用户。
 */

import { adminRequest } from "../_lib/admin-api";

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

export async function getTiers(): Promise<AdminTier[]> {
  return (await adminRequest<AdminTier[]>("/api/admin/topup-tiers")).data;
}

export async function createTier(data: TierFormData): Promise<AdminTier> {
  const { data: tier, warning } = await adminRequest<AdminTier>(
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
  const { data: tier, warning } = await adminRequest<AdminTier>(
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
  const { warning } = await adminRequest<unknown>(
    `/api/admin/topup-tiers/${id}`,
    {
      method: "DELETE",
    },
  );
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
    await adminRequest<AdminTier[]>("/api/admin/topup-tiers/sort", {
      method: "PUT",
      body: JSON.stringify({ items }),
    })
  ).data;
}

export async function getPreviewTiers(): Promise<AdminTier[]> {
  return (await adminRequest<AdminTier[]>("/api/admin/topup-tiers/preview"))
    .data;
}

/** 全量补同步：把全部 active 档位折扣写进 Go amount_discount（IK75PR）。 */
export async function syncAllTierDiscounts(): Promise<{
  synced: number;
  total: number;
}> {
  return (
    await adminRequest<{ synced: number; total: number }>(
      "/api/admin/topup-tiers/sync",
      { method: "PUT" },
    )
  ).data;
}
