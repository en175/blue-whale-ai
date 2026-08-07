vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (_request: unknown, handler: (user: unknown) => Promise<Response> | Response) =>
    handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listActive: vi.fn(),
  syncAllTierDiscountsToGo: vi.fn(),
}));

vi.mock("@/lib/topup-tier/deps", () => ({
  createTopupTierDeps: () => ({
    db: { listActive: mocks.listActive },
  }),
}));

vi.mock("@/lib/topup-tier/go-amount-discount", () => ({
  syncAllTierDiscountsToGo: mocks.syncAllTierDiscountsToGo,
}));

import { PUT } from "./route";

describe("PUT /api/admin/topup-tiers/sync（IK75PR 全量补同步）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("active 档位折扣全量同步到 Go，返回同步数", async () => {
    mocks.listActive.mockResolvedValue([
      { originalPrice: 4, discount: 0.02 },
      { originalPrice: 11, discount: 0.01 },
    ]);
    mocks.syncAllTierDiscountsToGo.mockImplementation(async (tiers) => tiers.length);

    const res = await PUT(new Request("http://localhost/api/admin/topup-tiers/sync", { method: "PUT" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, data: { synced: 2, total: 2 } });
    expect(mocks.syncAllTierDiscountsToGo).toHaveBeenCalledWith([
      { originalPrice: 4, discount: 0.02 },
      { originalPrice: 11, discount: 0.01 },
    ]);
  });

  it("无 active 档位 → 返回 0，不调 Go", async () => {
    mocks.listActive.mockResolvedValue([]);
    mocks.syncAllTierDiscountsToGo.mockImplementation(async (tiers) => tiers.length);

    const res = await PUT(new Request("http://localhost/api/admin/topup-tiers/sync", { method: "PUT" }));
    const json = await res.json();
    expect(json).toMatchObject({ success: true, data: { synced: 0, total: 0 } });
    expect(mocks.syncAllTierDiscountsToGo).toHaveBeenCalledWith([]);
  });

  it("Go 同步失败 → 异常向上抛（Next.js 兜底 500）", async () => {
    mocks.listActive.mockResolvedValue([{ originalPrice: 4, discount: 0.02 }]);
    mocks.syncAllTierDiscountsToGo.mockRejectedValue(new Error("go down"));

    await expect(
      PUT(new Request("http://localhost/api/admin/topup-tiers/sync", { method: "PUT" })),
    ).rejects.toThrow("go down");
  });
});
