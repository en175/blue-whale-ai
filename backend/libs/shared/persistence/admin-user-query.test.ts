import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminUserQuery } from "./admin-user-query.js";

const billing = vi.hoisted(() => ({ fetchAdminUserStats: vi.fn() }));

vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lib/shared/billing/billing-admin-client.js")>()),
  ...billing,
}));

function fakePrisma(rows: Array<{ id: bigint; username: string }>) {
  const count = vi.fn().mockResolvedValue(rows.length);
  const findMany = vi.fn().mockResolvedValue(
    rows.map((row) => ({
      ...row,
      phone: null,
      status: "NORMAL",
      gmt_create: new Date("2026-09-01T00:00:00.000Z"),
      gmt_modified: new Date("2026-09-01T00:00:00.000Z"),
    })),
  );
  return {
    count,
    findMany,
    prisma: {
      bw_users: { count, findMany },
      bw_user_roles: { findMany: vi.fn().mockResolvedValue([]) },
      bw_roles: { findMany: vi.fn().mockResolvedValue([]) },
    } as never,
  };
}

const whereOf = (spy: ReturnType<typeof vi.fn>, n = 0) =>
  spy.mock.calls[n]?.[0]?.where as Record<string, unknown>;

const ROWS = [
  { id: BigInt(7), username: "甲" },
  { id: BigInt(8), username: "乙" },
];

describe("admin-user-query 的余额三列（IKJ5M7）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("三列按 user_id 各归各的行", async () => {
    billing.fetchAdminUserStats.mockResolvedValue(
      new Map([
        [7, { availableCredits: 100, totalRecharged: 200, totalConsumed: 3 }],
        [8, { availableCredits: 500, totalRecharged: 600, totalConsumed: 7 }],
      ]),
    );

    const { items } = await createAdminUserQuery(fakePrisma(ROWS).prisma).listAdminUsers({});

    expect(items[0]).toMatchObject({ userId: 7, balance: 100, totalRecharge: 200, totalSpend: 3 });
    expect(items[1]).toMatchObject({ userId: 8, balance: 500, totalRecharge: 600, totalSpend: 7 });
    expect(billing.fetchAdminUserStats).toHaveBeenCalledTimes(1);
    expect(billing.fetchAdminUserStats).toHaveBeenCalledWith([7, 8]);
  });

  it("billing 不可达时报错，不静默给 0", async () => {
    billing.fetchAdminUserStats.mockRejectedValue(new Error("billing 不在"));

    await expect(createAdminUserQuery(fakePrisma(ROWS).prisma).listAdminUsers({})).rejects.toThrow(
      "billing 不在",
    );
  });

  it("只数总数时不碰计费", async () => {
    await expect(createAdminUserQuery(fakePrisma(ROWS).prisma).countAdminUsers()).resolves.toBe(2);
    expect(billing.fetchAdminUserStats).not.toHaveBeenCalled();
  });
});

describe("admin-user-query 的关键词（IKJ5M7 下沉到服务端）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    billing.fetchAdminUserStats.mockResolvedValue(new Map());
  });

  it("整串数字：额外按用户 ID 精确匹配（搜索框承诺了用户 ID）", async () => {
    const h = fakePrisma(ROWS);
    await createAdminUserQuery(h.prisma).listAdminUsers({ keyword: "42" });

    expect(whereOf(h.findMany).OR).toContainEqual({ id: BigInt(42) });
  });

  it("非数字：不带 ID 分支", async () => {
    const h = fakePrisma(ROWS);
    await createAdminUserQuery(h.prisma).listAdminUsers({ keyword: "ali" });

    expect(whereOf(h.findMany).OR).toEqual([
      { username: { contains: "ali" } },
      { phone: { contains: "ali" } },
    ]);
  });

  it("超长数字串不当 ID 查：BigInt 咽得下，BIGINT 列装不下", async () => {
    const h = fakePrisma(ROWS);
    await createAdminUserQuery(h.prisma).listAdminUsers({ keyword: "9".repeat(30) });

    expect(whereOf(h.findMany).OR).toHaveLength(2);
  });

  it("计数与列表用**同一个** where：分叉了页数就与实际行数对不上", async () => {
    const h = fakePrisma(ROWS);
    await createAdminUserQuery(h.prisma).listAdminUsers({ keyword: "42", status: 1 });

    expect(whereOf(h.count)).toEqual(whereOf(h.findMany));
  });

  it("空关键词不带任何筛选条件（空串 = 全部）", async () => {
    const h = fakePrisma(ROWS);
    await createAdminUserQuery(h.prisma).listAdminUsers({ keyword: "" });

    expect(whereOf(h.findMany)).toEqual({ is_delete: false });
  });
});

describe("admin-user-query 的精确查人（积分记录用）", () => {
  beforeEach(() => vi.clearAllMocks());

  const resolveWhere = (h: ReturnType<typeof fakePrisma>, n = 0) =>
    h.findMany.mock.calls[n]?.[0]?.where as { OR: unknown[] };

  it("★ 一次查询同时试三种解释 —— 用户 ID / 手机号 / 用户名共用一个输入框", async () => {
    const h = fakePrisma(ROWS);
    h.findMany.mockResolvedValue([{ id: BigInt(7), username: "某人", phone: "13800008888" }]);

    await expect(
      createAdminUserQuery(h.prisma).findUserIdByKeyword("13800008888"),
    ).resolves.toBe(7);

    expect(resolveWhere(h).OR).toEqual([
      { id: BigInt("13800008888") },
      { phone: "13800008888" },
      { username: "13800008888" },
    ]);
    expect(h.findMany).toHaveBeenCalledTimes(1);
  });

  it("★ 数字**用户名**优先于同号的用户 ID —— 少了优先级就会拿到别人的账", async () => {
    const h = fakePrisma(ROWS);
    h.findMany.mockResolvedValue([
      { id: BigInt(123456), username: "别人", phone: null },
      { id: BigInt(7), username: "123456", phone: null },
    ]);

    await expect(
      createAdminUserQuery(h.prisma).findUserIdByKeyword("123456"),
    ).resolves.toBe(7);
  });

  it("手机号命中优先于同号的用户 ID", async () => {
    const h = fakePrisma(ROWS);
    h.findMany.mockResolvedValue([
      { id: BigInt(42), username: "别人", phone: null },
      { id: BigInt(9), username: "某人", phone: "42" },
    ]);

    await expect(createAdminUserQuery(h.prisma).findUserIdByKeyword("42")).resolves.toBe(9);
  });

  it("用户名按**不区分大小写**比对：库的排序规则是 *_ci，逐字比会落空退回 id 那一行", async () => {
    const h = fakePrisma(ROWS);
    h.findMany.mockResolvedValue([
      { id: BigInt(42), username: "别人", phone: null },
      { id: BigInt(8), username: "Admin", phone: null },
    ]);

    await expect(createAdminUserQuery(h.prisma).findUserIdByKeyword("admin")).resolves.toBe(8);
  });

  it("★ 用户名与手机号撞在同一个关键词上 → **当作查不到**，不替运营挑一个", async () => {
    const h = fakePrisma(ROWS);
    h.findMany.mockResolvedValue([
      { id: BigInt(7), username: "13800008888", phone: null },
      { id: BigInt(9), username: "某人", phone: "13800008888" },
    ]);

    await expect(
      createAdminUserQuery(h.prisma).findUserIdByKeyword("13800008888"),
    ).resolves.toBeUndefined();
  });

  it("同一行既是用户名命中又是手机号命中（只有一个人）→ 照常返回那个人", async () => {
    const h = fakePrisma(ROWS);
    h.findMany.mockResolvedValue([
      { id: BigInt(7), username: "13800008888", phone: "13800008888" },
    ]);

    await expect(
      createAdminUserQuery(h.prisma).findUserIdByKeyword("13800008888"),
    ).resolves.toBe(7);
  });

  it("只有用户 ID 命中时就用它（这是数字输入的常态）", async () => {
    const h = fakePrisma(ROWS);
    h.findMany.mockResolvedValue([{ id: BigInt(42), username: "某人", phone: null }]);

    await expect(createAdminUserQuery(h.prisma).findUserIdByKeyword("42")).resolves.toBe(42);
  });

  it("非纯数字时不带 ID 分支，只按手机号 / 用户名查", async () => {
    const h = fakePrisma(ROWS);

    await createAdminUserQuery(h.prisma).findUserIdByKeyword("张小明");

    expect(resolveWhere(h).OR).toEqual([{ phone: "张小明" }, { username: "张小明" }]);
  });

  it("超长数字串不带 ID 分支 —— BigInt 咽得下，BIGINT 列装不下", async () => {
    const h = fakePrisma(ROWS);

    await createAdminUserQuery(h.prisma).findUserIdByKeyword("9".repeat(30));

    expect(resolveWhere(h).OR).toEqual([
      { phone: "9".repeat(30) },
      { username: "9".repeat(30) },
    ]);
  });

  it("★ 查人**不过滤 is_delete**：过滤了，软删用户的历史流水就再也搜不出来", async () => {
    const h = fakePrisma(ROWS);

    await createAdminUserQuery(h.prisma).findUserIdByKeyword("13800008888");

    expect(resolveWhere(h)).not.toHaveProperty("is_delete");
  });

  it("查不到 → undefined（空页由调用方决定，不是这里抛错）", async () => {
    const h = fakePrisma(ROWS);

    await expect(createAdminUserQuery(h.prisma).findUserIdByKeyword("查无此人")).resolves.toBeUndefined();
  });

  it("空白关键词不查库 —— 那会白跑一次，还会把「没填」当成「查不到」", async () => {
    const h = fakePrisma(ROWS);

    await expect(createAdminUserQuery(h.prisma).findUserIdByKeyword("   ")).resolves.toBeUndefined();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("★ 批量取展示身份：一次 IN 查，phone 缺值收敛成空串（不是 null）", async () => {
    const h = fakePrisma(ROWS);
    h.findMany.mockResolvedValue([
      { id: BigInt(7), username: "甲", phone: "13800008888" },
      { id: BigInt(8), username: "乙", phone: null },
    ]);

    const identities = await createAdminUserQuery(h.prisma).loadUserIdentities([7, 8, 7]);

    expect(h.findMany.mock.calls[0]?.[0]?.where).toEqual({ id: { in: [BigInt(7), BigInt(8)] } });
    expect(identities.get(7)).toEqual({ nickname: "甲", phone: "13800008888" });
    expect(identities.get(8)).toEqual({ nickname: "乙", phone: "" });
  });

  it("批量取展示身份**不过滤 is_delete** —— 账本里软删用户的历史流水仍是账", async () => {
    const h = fakePrisma(ROWS);

    await createAdminUserQuery(h.prisma).loadUserIdentities([7]);

    expect(h.findMany.mock.calls[0]?.[0]?.where).not.toHaveProperty("is_delete");
  });

  it("没有行时不查库（空数组的 IN 是白跑一趟）", async () => {
    const h = fakePrisma(ROWS);

    await expect(createAdminUserQuery(h.prisma).loadUserIdentities([])).resolves.toEqual(new Map());
    expect(h.findMany).not.toHaveBeenCalled();
  });
});
