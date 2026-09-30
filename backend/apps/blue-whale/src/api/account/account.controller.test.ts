import { beforeEach, describe, expect, it, vi } from "vitest";

// 只替换 client 的来源，`toBillingError` 用真实现——错误映射是这条端点对外的一部分，
// 换成假的就等于把「billing 挂了会回什么」这条断言删掉了。
const { listTransactions, sharedBillingClient } = vi.hoisted(() => {
  const listTransactions = vi.fn();
  return { listTransactions, sharedBillingClient: () => ({ listTransactions }) };
});

vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/billing/billing-client.js")>();
  return { ...actual, sharedBillingClient };
});

import { BillingConfigError } from "@lib/shared/billing/billing-client.js";
import { AccountController } from "./account.controller.js";

const USER = { userId: "42", username: "alice" } as never;
const controller = new AccountController();

function page(items: unknown[] = [], total = 0) {
  return { items, total };
}

describe("AccountController.consumptions（billing 账本）", () => {
  beforeEach(() => {
    listTransactions.mockReset();
  });

  it("缺省不带类型过滤、页码落 1 —— 契约里空 = 全部流水", async () => {
    listTransactions.mockResolvedValue(page());

    await controller.consumptions(USER, {});

    // 没有 typeFilters 这个键（不是 typeFilters: undefined）：exactOptionalPropertyTypes 下
    // 传 undefined 与「不传」在契约上是两回事。
    expect(listTransactions).toHaveBeenCalledWith({
      userId: 42,
      pageSize: 20,
      page: 1,
    });
  });

  it("type 收窄到单个类型，page 原样传下去", async () => {
    listTransactions.mockResolvedValue(page());

    await controller.consumptions(USER, {
      type: "refund",
      page_size: "5",
      page: "3",
    });

    expect(listTransactions).toHaveBeenCalledWith({
      userId: 42,
      typeFilters: ["refund"],
      pageSize: 5,
      page: 3,
    });
  });

  it("type 逗号分隔 = 多值：用户的「已消耗」页签要一次取 consume + expire", async () => {
    listTransactions.mockResolvedValue(page());

    // 多余的空格与空段都要滤掉，否则会把 "" 当成一个类型送去校验、被 billing 拒成 400
    await controller.consumptions(USER, { type: " consume , expire ,, " });

    expect(listTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ typeFilters: ["consume", "expire"] }),
    );
  });

  it("page 非法 / 小于 1 一律当第一页", async () => {
    listTransactions.mockResolvedValue(page());

    for (const raw of ["0", "-3", "abc"]) {
      await controller.consumptions(USER, { page: raw });
      // 不夹的话 (page-1)*page_size 会算出负 OFFSET，MySQL 直接语法错、整请求 500 ——
      // 而调用方只是传了个 0（客户端从 0 起算是常见写法）
      expect(listTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    }
  });

  it("page_size 非法或超上限时回落到缺省 / 上限", async () => {
    listTransactions.mockResolvedValue(page());

    await controller.consumptions(USER, { page_size: "abc" });
    expect(listTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageSize: 20 }),
    );

    await controller.consumptions(USER, { page_size: "9999" });
    expect(listTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageSize: 100 }),
    );
  });

  it("把账本行投影成前端字段（金额是整数积分，id 是带前缀的字符串）", async () => {
    listTransactions.mockResolvedValue(
      page(
        [
          {
            id: "res:7",
            type: "consume",
            direction: "out",
            title: "视频生成 · seedance-2.5 1080p 5s",
            credits: 30,
            status: "done",
            createdAt: "2026-09-25T10:00:00+08:00",
            settledAt: "2026-09-25T10:01:00+08:00",
          },
        ],
        4,
      ),
    );

    const response = await controller.consumptions(USER, {});

    expect(response.data.total).toBe(4);
    expect(response.data.items[0]).toEqual({
      id: "res:7",
      type: "consume",
      direction: "out",
      title: "视频生成 · seedance-2.5 1080p 5s",
      credits: 30,
      status: "done",
      created_at: "2026-09-25T10:00:00+08:00",
      settled_at: "2026-09-25T10:01:00+08:00",
    });
  });

  it("billing 未配置 → 503，billing 报错 → 502（都不是静默空列表）", async () => {
    listTransactions.mockRejectedValue(new BillingConfigError("计费服务地址未配置"));
    await expect(controller.consumptions(USER, {})).rejects.toMatchObject({
      status: 503,
      code: "billing_unconfigured",
    });

    listTransactions.mockRejectedValue(new Error("boom"));
    await expect(controller.consumptions(USER, {})).rejects.toMatchObject({
      status: 502,
      code: "billing_error",
    });
  });
});
