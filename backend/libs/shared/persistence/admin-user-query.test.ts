import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminUserQuery } from "./admin-user-query.js";

const billing = vi.hoisted(() => ({ fetchAdminUserStats: vi.fn() }));

// 三列来自 billing，本模块**直接调用**它（不是注入）——所以要在这里换掉模块导出的绑定
vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lib/shared/billing/billing-admin-client.js")>()),
  ...billing,
}));

/**
 * 最小的 prisma 替身：只实现本模块真正用到的四个读。
 *
 * <p>不引 PrismaClient 的 mock 工具：本模块与库的接触面就是这四处，多造的桩只会让
 * 「测试通过」与「代码正确」之间的联系变松。
 */
function fakePrisma(rows: Array<{ id: bigint; username: string }>) {
  return {
    bw_users: {
      count: vi.fn().mockResolvedValue(rows.length),
      findMany: vi.fn().mockResolvedValue(
        rows.map((row) => ({
          ...row,
          phone: null,
          status: "NORMAL",
          gmt_create: new Date("2026-09-01T00:00:00.000Z"),
          gmt_modified: new Date("2026-09-01T00:00:00.000Z"),
        })),
      ),
    },
    bw_user_roles: { findMany: vi.fn().mockResolvedValue([]) },
    bw_roles: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;
}

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

    const { items } = await createAdminUserQuery(fakePrisma(ROWS)).listAdminUsers({});

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

    await expect(createAdminUserQuery(fakePrisma(ROWS)).listAdminUsers({})).rejects.toThrow(
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
    await expect(createAdminUserQuery(fakePrisma(ROWS)).countAdminUsers()).resolves.toBe(2);
    expect(billing.fetchAdminUserStats).not.toHaveBeenCalled();
  });
});
