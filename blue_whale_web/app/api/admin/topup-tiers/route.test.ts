vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (_request: unknown, handler: (user: unknown) => Promise<Response> | Response) =>
    handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  listAll: vi.fn(),
  syncTierDiscountToGo: vi.fn(),
  logTierCreate: vi.fn(),
}));

vi.mock("@/lib/topup-tier/deps", () => ({
  createTopupTierDeps: () => ({
    db: { create: mocks.create, listAll: mocks.listAll },
  }),
}));

vi.mock("@/lib/topup-tier/go-amount-discount", () => ({
  syncTierDiscountToGo: mocks.syncTierDiscountToGo,
}));

vi.mock("@/lib/topup-tier/operation-log", () => ({
  logTierCreate: mocks.logTierCreate,
}));

import { POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/admin/topup-tiers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/topup-tiers 折扣同步接线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAll.mockResolvedValue([]);
    mocks.syncTierDiscountToGo.mockResolvedValue(true);
    mocks.logTierCreate.mockResolvedValue(undefined);
  });

  it("建档成功 → 同步折扣到 Go（原价, 折扣）", async () => {
    mocks.create.mockResolvedValue({ id: "1" });
    const res = await POST(
      post({
        amount: 50_000_000,
        originalPrice: 100,
        discount: 0.85,
        status: "active",
      }),
    );
    expect(res.status).toBe(201);
    expect(mocks.syncTierDiscountToGo).toHaveBeenCalledWith(100, 0.85);
  });

  it("折扣校验失败 → 400，不建档不同步", async () => {
    const res = await POST(
      post({ amount: 100, originalPrice: 100, discount: 5 }),
    );
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.syncTierDiscountToGo).not.toHaveBeenCalled();
  });
});

// amount_discount 按整数原价做 key，同原价档位的折扣必互相覆盖 → 源头拒绝。
describe("POST /api/admin/topup-tiers 原价唯一", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAll.mockResolvedValue([]);
    mocks.create.mockResolvedValue({ id: "9" });
    mocks.syncTierDiscountToGo.mockResolvedValue(true);
    mocks.logTierCreate.mockResolvedValue(undefined);
  });

  it("原价与已有档位相同 → 409，不建档不同步", async () => {
    mocks.listAll.mockResolvedValue([
      { id: "3", originalPrice: 100, discount: 0.9 },
    ]);
    const res = await POST(
      post({ amount: 50_000_000, originalPrice: 100, discount: 0.85 }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.syncTierDiscountToGo).not.toHaveBeenCalled();
  });

  it("停用档位也算碰撞（折扣 key 与上下架状态无关）", async () => {
    mocks.listAll.mockResolvedValue([
      { id: "6", originalPrice: 50, discount: 0.5, status: "inactive" },
    ]);
    const res = await POST(
      post({ amount: 25_000_000, originalPrice: 50, discount: 0.7 }),
    );
    expect(res.status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("原价不碰撞 → 正常建档", async () => {
    mocks.listAll.mockResolvedValue([
      { id: "3", originalPrice: 100, discount: 0.9 },
    ]);
    const res = await POST(
      post({ amount: 10_000_000, originalPrice: 20, discount: 1 }),
    );
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalled();
  });
});

describe("POST /api/admin/topup-tiers 入参校验与派生", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAll.mockResolvedValue([]);
    mocks.create.mockResolvedValue({ id: "9" });
    mocks.syncTierDiscountToGo.mockResolvedValue(true);
    mocks.logTierCreate.mockResolvedValue(undefined);
  });

  it("原价非整数 → 400（N 为整数美元额度，防 UI/折扣 key/计费口径错位）", async () => {
    const res = await POST(post({ originalPrice: 10.5, discount: 0.85 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "原价须为正整数（元）" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("原价非数字 / 负数 → 400", async () => {
    expect(
      (await POST(post({ originalPrice: "abc", discount: 1 }))).status,
    ).toBe(400);
    expect(
      (await POST(post({ originalPrice: -100, discount: 1 }))).status,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('折扣为 NaN 穿透（"abc"）→ 400，不落库变 500', async () => {
    const res = await POST(post({ originalPrice: 100, discount: "abc" }));
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("积分由服务端派生（原价×QuotaPerUnit），客户端 amount 不接受", async () => {
    const res = await POST(post({ amount: 1, originalPrice: 20, discount: 1 }));
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10_000_000, originalPrice: 20 }),
    );
  });
});

describe("POST /api/admin/topup-tiers 审计与同步可观测", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAll.mockResolvedValue([]);
    mocks.create.mockResolvedValue({ id: "9", name: "20积分" });
    mocks.syncTierDiscountToGo.mockResolvedValue(true);
    mocks.logTierCreate.mockResolvedValue(undefined);
  });

  it("建档成功 → 服务端落审计", async () => {
    await POST(post({ originalPrice: 20, discount: 1 }));
    expect(mocks.logTierCreate).toHaveBeenCalledWith({
      id: "9",
      name: "20积分",
    });
  });

  it("审计失败不阻断建档（仍 201）", async () => {
    mocks.logTierCreate.mockRejectedValue(new Error("db down"));
    const res = await POST(post({ originalPrice: 20, discount: 1 }));
    expect(res.status).toBe(201);
  });

  it("同步失败 → 仍 201，但响应带 warning（漂移可观测）", async () => {
    mocks.syncTierDiscountToGo.mockRejectedValue(new Error("go down"));
    const res = await POST(post({ originalPrice: 20, discount: 1 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.warning).toContain("折扣同步到 Go 失败");
    expect(mocks.logTierCreate).toHaveBeenCalled();
  });
});
