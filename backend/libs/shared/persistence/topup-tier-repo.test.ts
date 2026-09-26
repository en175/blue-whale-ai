import { describe, expect, it, vi } from "vitest";

import { createTopupTierRepo } from "./topup-tier-repo.js";

// 档位保存要 bump `version`：下单时把它快照进 `recharge_orders.config_version`，
// 用来回答「这单是改价前还是改价后下的」。版本不动 = 快照分不出配置变过没有，
// 那一列就成了一个永远相等的摆设。

const ROW = {
  id: 7n,
  name: "1000积分",
  amount: 1500n,
  original_price: 100,
  discount: 1,
  price: 100,
  is_recommended: false,
  status: "active",
  start_time: null,
  end_time: null,
  sort_order: 1,
  // 保存后的行：版本已经从 3 涨到 4（Prisma 的 increment 会把新值带在返回行里）
  version: 4,
  gmt_create: new Date("2026-09-01T00:00:00Z"),
  gmt_modified: new Date("2026-09-26T00:00:00Z"),
};

describe("createTopupTierRepo.update — 保存即 +1 版", () => {
  it("保存一次 version 自增 1（只改名字也算——名字是用户看得到的东西）", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...ROW, version: 3 });
    const update = vi.fn().mockResolvedValue(ROW);
    const repo = createTopupTierRepo({ topup_tiers: { findFirst, update } } as never);

    const view = await repo.update("7", { name: "春季特惠" });

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: expect.objectContaining({ name: "春季特惠", version: { increment: 1 } }),
    });
    expect(view?.version).toBe(4);
  });
});

describe("createTopupTierRepo.updateSortOrder — 排序不是配置变更", () => {
  it("只写 sort_order，不碰 version（拖一下顺序不代表商品口径变了）", async () => {
    const update = vi.fn().mockResolvedValue(ROW);
    const repo = createTopupTierRepo({
      topup_tiers: { update },
      $transaction: async (ops: unknown[]) => ops,
    } as never);

    await repo.updateSortOrder([{ id: "7", sortOrder: 2 }]);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { sort_order: 2, gmt_modified: expect.any(Date) },
    });
  });
});
