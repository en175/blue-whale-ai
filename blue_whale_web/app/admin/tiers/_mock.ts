import type { RechargeTier } from "@/components/recharge/types";

export type AdminTier = RechargeTier & {
  status: "active" | "inactive";
  startTime: string | null;
  endTime: string | null;
  chargeCount: number;
  totalRevenue: number;
  createdAt: string;
  updatedAt: string;
};

let seed = 100;
function nextId(): string { return `tier_${String(++seed)}`; }

const NOW = new Date();
const HOUR_LATER = new Date(NOW.getTime() + 3600000).toISOString();
const WEEK_LATER = new Date(NOW.getTime() + 7 * 86400000).toISOString();
const WEEK_AGO = new Date(NOW.getTime() - 7 * 86400000).toISOString();

export const MOCK_TIERS: AdminTier[] = [
  { id: "tier_1", amount: 1000, price: 10, bonus: 0, isRecommended: false, sortOrder: 1, status: "active", startTime: null, endTime: null, chargeCount: 823, totalRevenue: 8230, createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-20T10:00:00Z" },
  { id: "tier_2", amount: 3000, price: 30, bonus: 100, isRecommended: false, sortOrder: 2, status: "active", startTime: null, endTime: null, chargeCount: 541, totalRevenue: 16230, createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-20T10:00:00Z" },
  { id: "tier_3", amount: 6000, price: 60, bonus: 300, isRecommended: true, sortOrder: 3, status: "active", startTime: null, endTime: null, chargeCount: 1203, totalRevenue: 72180, createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-22T14:00:00Z" },
  { id: "tier_4", amount: 12000, price: 120, bonus: 800, isRecommended: false, sortOrder: 4, status: "active", startTime: null, endTime: null, chargeCount: 412, totalRevenue: 49440, createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-22T14:00:00Z" },
  { id: "tier_5", amount: 30000, price: 300, bonus: 3000, isRecommended: true, sortOrder: 5, status: "active", startTime: null, endTime: null, chargeCount: 198, totalRevenue: 59400, createdAt: "2026-06-15T10:00:00Z", updatedAt: "2026-07-25T09:00:00Z" },
  { id: "tier_6", amount: 60000, price: 600, bonus: 8000, isRecommended: false, sortOrder: 6, status: "active", startTime: null, endTime: null, chargeCount: 67, totalRevenue: 40200, createdAt: "2026-06-15T10:00:00Z", updatedAt: "2026-07-25T09:00:00Z" },
  { id: "tier_7", amount: 5000, price: 50, bonus: 200, isRecommended: false, sortOrder: 7, status: "inactive", startTime: null, endTime: null, chargeCount: 0, totalRevenue: 0, createdAt: "2026-07-01T12:00:00Z", updatedAt: "2026-07-26T16:00:00Z" },
  { id: "tier_8", amount: 8888, price: 88, bonus: 888, isRecommended: true, sortOrder: 8, status: "active", startTime: HOUR_LATER, endTime: WEEK_LATER, chargeCount: 156, totalRevenue: 13728, createdAt: "2026-07-15T08:00:00Z", updatedAt: "2026-07-27T08:00:00Z" },
];

let tiers = [...MOCK_TIERS];

export type TierFormData = Pick<AdminTier, "amount" | "price" | "bonus" | "isRecommended" | "status"> & {
  startTime: string;
  endTime: string;
};

export function getTiers(): AdminTier[] { return [...tiers]; }

export function createTier(data: TierFormData): AdminTier {
  const tier: AdminTier = {
    ...data,
    id: nextId(),
    sortOrder: tiers.length + 1,
    startTime: data.startTime || null,
    endTime: data.endTime || null,
    chargeCount: 0,
    totalRevenue: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tiers.push(tier);
  return tier;
}

export function updateTier(id: string, data: TierFormData): AdminTier | null {
  const idx = tiers.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  tiers[idx] = { ...tiers[idx], ...data, startTime: data.startTime || null, endTime: data.endTime || null, updatedAt: new Date().toISOString() };
  return tiers[idx];
}

export function deleteTier(id: string): boolean {
  const idx = tiers.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  tiers.splice(idx, 1);
  return true;
}

export function moveTier(id: string, direction: "up" | "down"): boolean {
  const idx = tiers.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= tiers.length) return false;
  [tiers[idx], tiers[target]] = [tiers[target], tiers[idx]];
  // Re-number all sortOrder values sequentially to keep them in sync with array order
  tiers.forEach((t, i) => { t.sortOrder = i + 1; });
  return true;
}

export function getPreviewTiers(): AdminTier[] {
  const now = new Date().toISOString();
  return tiers
    .filter((t) => {
      if (t.status !== "active") return false;
      if (t.startTime && now < t.startTime) return false;
      if (t.endTime && now > t.endTime) return false;
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
