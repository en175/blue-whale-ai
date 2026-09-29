import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminUserQuery } from "./admin-user-query.js";

const billing = vi.hoisted(() => ({ fetchAdminUserStats: vi.fn() }));

// 三列来自 billing，本模块**直接调用**它（不是注入）——所以要在这里换掉模块导出的绑定
vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lib/shared/billing/billing-admin-client.js")>()),
  ...billing,
}));

/**
 * 最小的 prisma 替身：只实现本模块真正用到的四处读。
 *
 * <p>不引 PrismaClient 的 mock 工具：本模块与库的接触面就是这么几处，多造的桩只会让
 * 「测试通过」与「代码正确」之间的联系变松。
 *
 * <p>`count` / `findMany` 单独露出来，是因为「列表与计数用的是不是同一个 where」
 * 只有看这两个 spy 才能断言 —— 而它一旦分叉，翻页的页数就与实际行数对不上。
 */
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

/** 取第 n 次调用传进去的 `where`（spy 的参数是 any，这里只做形状上的收窄）。 */
const whereOf = (spy: ReturnType<typeof vi.fn>, n = 0) =>
  spy.mock.calls[n]?.[0]?.where as Record<string, unknown>;

const ROWS = [
  { id: BigInt(7), username: "甲" },
  { id: BigInt(8), username: "乙" },
];

describe("admin-user-query 的余额三列（IKJ5M7）", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * ★ 三列按 **user_id** 落到对应的行上。
   *
   * <p>这条钉的是「拿 id 去查」而不是「按数组下标取」——后者在两个用户身上会**整好
   * 对调**，而两个数都合法、都不报错，页面上看不出任何异常。所以断言必须让两个人的
   * 数字互不相同，只验「非 0」是抓不住这个错的。
   */
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
    // 一次批量问过这一页的 id，不是逐用户调（那是 N+1）
    expect(billing.fetchAdminUserStats).toHaveBeenCalledTimes(1);
    expect(billing.fetchAdminUserStats).toHaveBeenCalledWith([7, 8]);
  });

  /**
   * ★ billing 不可达时**整条列表失败**，不静默回落成 0。
   *
   * <p>这条钉的是一个**刻意的设计决定**，不是顺手写的行为：三列都是钱，回落成 0 会让
   * 「计费挂了」与「这个用户真的没积分」在界面上长得一模一样 —— 而「三列全是 0」
   * 恰恰是 IKJ5M7 要消灭的那个症状。将来有人觉得「列表不该因为计费挂了就白屏」而
   * 加一句 `.catch(() => new Map())`，这条会红，让他看见那段理由再决定。
   */
  it("billing 不可达时报错，不静默给 0", async () => {
    billing.fetchAdminUserStats.mockRejectedValue(new Error("billing 不在"));

    await expect(createAdminUserQuery(fakePrisma(ROWS).prisma).listAdminUsers({})).rejects.toThrow(
      "billing 不在",
    );
  });

  /**
   * ★ 只数总数时**一次计费都不发**。
   *
   * <p>仪表盘只要这一个数，而它的 `stats` 特意让计费那趟的失败**不影响**另外几个数。
   * 若这里也走列表路径（原先就是 `listAdminUsers({pageSize:1})`），计费不可达会把
   * 「总用户数」一起带走，那句话当场作废。用「没调过」而不是「返回 2」来钉这件事 ——
   * 后者在「既数了又调了计费」的实现下同样会绿。
   */
  it("只数总数时不碰计费", async () => {
    await expect(createAdminUserQuery(fakePrisma(ROWS).prisma).countAdminUsers()).resolves.toBe(2);
    expect(billing.fetchAdminUserStats).not.toHaveBeenCalled();
  });
});

/**
 * 关键词下沉到服务端之后（IKJ5M7），「搜 42 就是用户 42」这件事只由**一条 where** 保证 ——
 * 前端那一半匹配逻辑已经删掉了。这一组钉的就是那条 where：它错了不会有任何报错，
 * 只会安静地搜不到人（或者多搜出一串 ID 里带 42 的人）。
 */
describe("admin-user-query 的关键词（IKJ5M7 下沉到服务端）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ⚠️ `clearAllMocks` 清调用记录但**保留实现**，所以上面那条 mockRejectedValue
    //    会一路漏到这里。这一组只关心 where，给个空表把计费那一环摘掉。
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
