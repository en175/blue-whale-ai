vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (_request: unknown, handler: (user: unknown) => Promise<Response> | Response) =>
    handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listAll: vi.fn(),
  syncTierDiscountToGo: vi.fn(),
  removeTierDiscountFromGo: vi.fn(),
  logTierUpdate: vi.fn(),
  logTierDelete: vi.fn(),
}));

vi.mock("@/lib/topup-tier/deps", () => ({
  createTopupTierDeps: () => ({
    db: {
      getById: mocks.getById,
      update: mocks.update,
      remove: mocks.remove,
      listAll: mocks.listAll,
    },
  }),
}));

vi.mock("@/lib/topup-tier/go-amount-discount", () => ({
  syncTierDiscountToGo: mocks.syncTierDiscountToGo,
  removeTierDiscountFromGo: mocks.removeTierDiscountFromGo,
}));

vi.mock("@/lib/topup-tier/operation-log", () => ({
  logTierUpdate: mocks.logTierUpdate,
  logTierDelete: mocks.logTierDelete,
}));

import { DELETE, PUT } from "./route";

function call(method: string, body: unknown, id = "1") {
  return new Request(`http://localhost/api/admin/topup-tiers/${id}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
}
const params = (id = "1") => ({ params: Promise.resolve({ id }) });

const BEFORE = { id: "1", originalPrice: 100, discount: 0.85 };
const UPDATED = { id: "1", originalPrice: 200, discount: 0.8 };

describe("admin topup-tiers [id] 折扣同步接线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAll.mockResolvedValue([]);
    mocks.syncTierDiscountToGo.mockResolvedValue(true);
    mocks.removeTierDiscountFromGo.mockResolvedValue(true);
    mocks.logTierUpdate.mockResolvedValue(undefined);
    mocks.logTierDelete.mockResolvedValue(undefined);
  });

  it("PUT 原价变更 → 先删旧 N 的 key 再 set 新折扣，积分重派生", async () => {
    mocks.getById.mockResolvedValue(BEFORE);
    mocks.update.mockResolvedValue(UPDATED);
    const res = await PUT(
      call("PUT", { originalPrice: 200, discount: 0.8 }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(mocks.removeTierDiscountFromGo).toHaveBeenCalledWith(100);
    expect(mocks.syncTierDiscountToGo).toHaveBeenCalledWith(200, 0.8);
    // 改价时积分服务端重派生：200 × 500000
    expect(mocks.update).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ originalPrice: 200, amount: 100_000_000 }),
    );
  });

  it("PUT 原价不变 → 只 set 新折扣，不删旧 key", async () => {
    mocks.getById.mockResolvedValue({ ...BEFORE, originalPrice: 200 });
    mocks.update.mockResolvedValue(UPDATED);
    await PUT(call("PUT", { discount: 0.8 }), params());
    expect(mocks.removeTierDiscountFromGo).not.toHaveBeenCalled();
    expect(mocks.syncTierDiscountToGo).toHaveBeenCalledWith(200, 0.8);
  });

  it("PUT 档位不存在 → 404，不更新不同步", async () => {
    mocks.getById.mockResolvedValue(null);
    const res = await PUT(call("PUT", { discount: 0.8 }), params());
    expect(res.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.syncTierDiscountToGo).not.toHaveBeenCalled();
  });

  it("同步失败不阻断更新（仍 200，档位已落库），但响应带 warning", async () => {
    mocks.getById.mockResolvedValue(BEFORE);
    mocks.update.mockResolvedValue(UPDATED);
    mocks.syncTierDiscountToGo.mockRejectedValue(new Error("go down"));
    const res = await PUT(
      call("PUT", { originalPrice: 200, discount: 0.8 }),
      params(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warning).toContain("折扣同步到 Go 失败");
  });

  it("DELETE → 删除后移除该 N 的折扣 key，服务端落审计", async () => {
    mocks.getById.mockResolvedValue(BEFORE);
    mocks.remove.mockResolvedValue(true);
    const res = await DELETE(call("DELETE", null), params());
    expect(res.status).toBe(200);
    expect(mocks.removeTierDiscountFromGo).toHaveBeenCalledWith(100);
    expect(mocks.logTierDelete).toHaveBeenCalledWith(BEFORE);
  });

  it("DELETE 档位不存在 → 404，不移除折扣不落审计", async () => {
    mocks.getById.mockResolvedValue(null);
    mocks.remove.mockResolvedValue(false);
    const res = await DELETE(call("DELETE", null), params());
    expect(res.status).toBe(404);
    expect(mocks.removeTierDiscountFromGo).not.toHaveBeenCalled();
    expect(mocks.logTierDelete).not.toHaveBeenCalled();
  });
});

// amount_discount 按整数原价做 key，改价不得撞上其他档位。
describe("PUT /api/admin/topup-tiers/:id 原价唯一", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAll.mockResolvedValue([]);
    mocks.syncTierDiscountToGo.mockResolvedValue(true);
    mocks.removeTierDiscountFromGo.mockResolvedValue(true);
    mocks.logTierUpdate.mockResolvedValue(undefined);
    mocks.getById.mockResolvedValue(BEFORE);
  });

  it("原价改到另一档位已占用的原价 → 409，不更新不同步", async () => {
    mocks.listAll.mockResolvedValue([
      BEFORE,
      { id: "2", originalPrice: 200, discount: 0.7 },
    ]);
    const res = await PUT(call("PUT", { originalPrice: 200 }), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.syncTierDiscountToGo).not.toHaveBeenCalled();
    expect(mocks.removeTierDiscountFromGo).not.toHaveBeenCalled();
  });

  it("原价保持为自己的原价 → 不视为碰撞，正常更新", async () => {
    mocks.listAll.mockResolvedValue([BEFORE]);
    mocks.update.mockResolvedValue({ ...BEFORE, discount: 0.8 });
    const res = await PUT(
      call("PUT", { originalPrice: 100, discount: 0.8 }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
  });

  it("未提交原价（只改折扣）→ 不校验唯一性，不阻断", async () => {
    // 存量数据即使已有同原价碰撞，纯折扣修改不受影响
    mocks.listAll.mockResolvedValue([
      BEFORE,
      { id: "5", originalPrice: 100, discount: 0.3 },
    ]);
    mocks.update.mockResolvedValue({ ...BEFORE, discount: 0.9 });
    const res = await PUT(call("PUT", { discount: 0.9 }), params());
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
  });
});

describe("PUT /api/admin/topup-tiers/:id 入参校验与派生", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAll.mockResolvedValue([]);
    mocks.getById.mockResolvedValue(BEFORE);
    mocks.syncTierDiscountToGo.mockResolvedValue(true);
    mocks.logTierUpdate.mockResolvedValue(undefined);
  });

  it("原价非整数 / 负数 / 非数字 → 400，不更新", async () => {
    expect(
      (await PUT(call("PUT", { originalPrice: 10.5 }), params())).status,
    ).toBe(400);
    expect(
      (await PUT(call("PUT", { originalPrice: -100 }), params())).status,
    ).toBe(400);
    expect(
      (await PUT(call("PUT", { originalPrice: "abc" }), params())).status,
    ).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('折扣 NaN 穿透（"abc"）→ 400', async () => {
    const res = await PUT(call("PUT", { discount: "abc" }), params());
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("只提交 amount（不改原价）→ 派生量不接受直改，更新不含 amount", async () => {
    mocks.update.mockResolvedValue(BEFORE);
    const res = await PUT(call("PUT", { amount: 999 }), params());
    expect(res.status).toBe(200);
    const [, payload] = mocks.update.mock.calls[0];
    expect(payload).not.toHaveProperty("amount");
    expect(payload).not.toHaveProperty("originalPrice");
  });

  it("审计失败不阻断更新（仍 200）", async () => {
    mocks.update.mockResolvedValue({ ...BEFORE, discount: 0.8 });
    mocks.logTierUpdate.mockRejectedValue(new Error("db down"));
    const res = await PUT(call("PUT", { discount: 0.8 }), params());
    expect(res.status).toBe(200);
  });

  it("更新成功 → 服务端落审计（before/after）", async () => {
    mocks.update.mockResolvedValue({ ...BEFORE, discount: 0.8 });
    await PUT(call("PUT", { discount: 0.8 }), params());
    expect(mocks.logTierUpdate).toHaveBeenCalledWith(BEFORE, {
      ...BEFORE,
      discount: 0.8,
    });
  });
});
