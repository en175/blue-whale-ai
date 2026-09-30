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
  // 精确查人（积分记录那条链路）与批量取身份都走 findMany —— 用例各自覆写返回行
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

describe("admin-user-query 的精确查人（积分记录用）", () => {
  beforeEach(() => vi.clearAllMocks());

  /** 精确查人走 findMany（一次试三种解释），取第 n 次调用传的 where。 */
  const resolveWhere = (h: ReturnType<typeof fakePrisma>, n = 0) =>
    h.findMany.mock.calls[n]?.[0]?.where as { OR: unknown[] };

  it("★ 一次查询同时试三种解释 —— 用户 ID / 手机号 / 用户名共用一个输入框", async () => {
    // 少试哪一种，那一种输入就永远查不到人，而运营没有任何办法知道该怪谁。
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
    // 一次查询，不是三次
    expect(h.findMany).toHaveBeenCalledTimes(1);
  });

  it("★ 数字**用户名**优先于同号的用户 ID —— 少了优先级就会拿到别人的账", async () => {
    // 用户名的形状不受限（注册只要求非空），「一个叫 123456 的用户」是存在的。
    // 没有优先级时输 `123456` 只会命中 id=123456 那个人 —— **错的人，还不报错**。
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
    // 查 `admin` 时库会把 `Admin` 这行也带回来（utf8mb4_unicode_ci）
    h.findMany.mockResolvedValue([
      { id: BigInt(42), username: "别人", phone: null },
      { id: BigInt(8), username: "Admin", phone: null },
    ]);

    await expect(createAdminUserQuery(h.prisma).findUserIdByKeyword("admin")).resolves.toBe(8);
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
    // 用户管理页过滤它；这里是账本，被软删的人那笔账仍然要能按手机号查到。
    // 与下面 loadUserIdentities 那条是同一个决定的两个入口，别只改一处。
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
      // 存量用户没手机号：这一列在库里就是 NULL，落到身份里要是 null 就会与
      // 「查不到这个用户」撞成同一种形态
      { id: BigInt(8), username: "乙", phone: null },
    ]);

    const identities = await createAdminUserQuery(h.prisma).loadUserIdentities([7, 8, 7]);

    // 去重后再查：同一页里一个用户可能有多行流水
    expect(h.findMany.mock.calls[0]?.[0]?.where).toEqual({ id: { in: [BigInt(7), BigInt(8)] } });
    expect(identities.get(7)).toEqual({ nickname: "甲", phone: "13800008888" });
    expect(identities.get(8)).toEqual({ nickname: "乙", phone: "" });
  });

  it("批量取展示身份**不过滤 is_delete** —— 账本里软删用户的历史流水仍是账", async () => {
    // 用户管理页过滤它（列表与仪表盘数字要对得上）；这里是账本，过滤掉会让同一页里
    // 那些行的昵称显示成「—」，反而自相矛盾。
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
