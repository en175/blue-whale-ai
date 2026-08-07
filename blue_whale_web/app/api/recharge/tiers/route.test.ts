import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listActive: vi.fn(),
}));

vi.mock("@/lib/topup-tier/deps", () => ({
  createTopupTierDeps: () => ({ db: { listActive: mocks.listActive } }),
}));

import { GET } from "./route";

// 测试系数固定为 0.00001（lib/credits.ts 默认值）：500000 quota → 5 积分
describe("GET /api/recharge/tiers 积分口径统一（IK756O）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("amount 从裸 quota 换算为积分（×0.00001 取整）", async () => {
    mocks.listActive.mockResolvedValue([
      { id: "12", name: "500000积分", amount: 500_000, price: 0.01, originalPrice: 1, discount: 0.01, isRecommended: false, sortOrder: 1 },
      { id: "9", name: "5000000积分", amount: 5_000_000, price: 10, originalPrice: 10, discount: 1, isRecommended: false, sortOrder: 2 },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe(200);
    expect(json.data.tiers).toEqual([
      expect.objectContaining({ id: "12", amount: 5 }),
      expect.objectContaining({ id: "9", amount: 50 }),
    ]);
  });

  it("档位加载失败 → 500", async () => {
    mocks.listActive.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
