import { beforeEach, describe, expect, it, vi } from "vitest";

// 只替换网络函数，两个错误类用真实现——「billing 没配 / billing 挂了各回什么状态码」
// 是这条端点对外契约的一部分，换成假的等于把这条断言删掉（与 account.controller.test 同款）。
const { listAdminTransactions } = vi.hoisted(() => ({ listAdminTransactions: vi.fn() }));

vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/billing/billing-admin-client.js")>();
  return { ...actual, listAdminTransactions };
});

import { BillingAdminConfigError, BillingAdminError } from "@lib/shared/billing/billing-admin-client.js";
import { AdminConsumptionRecordsController } from "./consumption-records.controller.js";

// 消费记录读的是 billing 的账本（游标分页、无总数）。本测试钉住的是管理面**独有的那条自由度**：
// userId 可以不传 = 全站流水——用户面的 ListTransactions 里它是必填的。

const controller = new AdminConsumptionRecordsController();

function page(items: unknown[] = [], nextPageToken = "") {
  return { items, nextPageToken };
}

const ITEM = {
  id: "res:7",
  userId: 42,
  type: "consume",
  direction: "out",
  title: "视频生成 · seedance-2.5",
  amount: 30,
  // 「冻 12、实扣 1」那种情形：amount 是结算后的实际值，预扣额另有一列
  reservedCredits: 100,
  status: "done",
  createdAt: "2026-09-25T10:00:00+08:00",
  settledAt: "2026-09-25T10:01:00+08:00",
};

describe("AdminConsumptionRecordsController.list", () => {
  beforeEach(() => {
    listAdminTransactions.mockReset();
  });

  it("缺省：userId **不传** = 全站流水，pageToken 为空 = 首页", async () => {
    listAdminTransactions.mockResolvedValue(page());

    await controller.list({});

    // 没有 userId 这个键（不是 userId: undefined）：exactOptionalPropertyTypes 下
    // 传 undefined 与「不传」是两回事，而这里的差别就是「全站」与「某个用户」。
    expect(listAdminTransactions).toHaveBeenCalledWith({
      pageSize: 20,
      pageToken: "",
    });
  });

  it("userId 传入时转成数字，type 透传", async () => {
    listAdminTransactions.mockResolvedValue(page());

    await controller.list({ userId: "42", type: "consume", pageToken: "tok-1" });

    expect(listAdminTransactions).toHaveBeenCalledWith({
      userId: 42,
      type: "consume",
      pageSize: 20,
      pageToken: "tok-1",
    });
  });

  it("响应把 billing 的字段名映射成下划线口径，且带出 user_id（管理面独有的列）", async () => {
    listAdminTransactions.mockResolvedValue(page([ITEM], "next-tok"));

    await expect(controller.list({})).resolves.toEqual({
      success: true,
      data: {
        items: [
          {
            id: "res:7",
            user_id: 42,
            type: "consume",
            direction: "out",
            title: "视频生成 · seedance-2.5",
            credits: 30,
            reserved_credits: 100,
            status: "done",
            created_at: "2026-09-25T10:00:00+08:00",
            settled_at: "2026-09-25T10:01:00+08:00",
          },
        ],
        next_page_token: "next-tok",
      },
    });
  });

  it("billing 没回预扣额（发放 / 账本行）→ reserved_credits 为 null，不是 undefined", async () => {
    // 契约里只能有一种「没有」：多一种空值，界面就要判两次，而少判的那次会渲染成
    // 「预扣 undefined」或干脆不渲染——两种都不会报错。
    // 这里的发放行刻意**没有 reservedCredits 这个键**，模拟老版 billing 的回包。
    const grantRow = {
      id: "lot:12",
      userId: 42,
      type: "recharge",
      direction: "in",
      title: "充值到账",
      amount: 1000,
      status: "done",
      createdAt: "2026-09-25T10:00:00+08:00",
      settledAt: "2026-09-25T10:00:00+08:00",
    };
    listAdminTransactions.mockResolvedValue(page([grantRow]));

    await expect(controller.list({})).resolves.toMatchObject({
      data: { items: [{ reserved_credits: null }] },
    });
  });

  it("pageSize 上限 100、非法回落 20", async () => {
    listAdminTransactions.mockResolvedValue(page());

    await controller.list({ pageSize: "9999" });
    expect(listAdminTransactions).toHaveBeenLastCalledWith({ pageSize: 100, pageToken: "" });

    await controller.list({ pageSize: "abc" });
    expect(listAdminTransactions).toHaveBeenLastCalledWith({ pageSize: 20, pageToken: "" });
  });

  it("userId 非正整数 → 400，且不调 billing", async () => {
    for (const bad of ["abc", "-1", "0"]) {
      await expect(controller.list({ userId: bad })).rejects.toMatchObject({ status: 400 });
    }
    expect(listAdminTransactions).not.toHaveBeenCalled();
  });

  it("billing 管理端地址没配 → 503（重试不会好，要人去改配置）", async () => {
    listAdminTransactions.mockRejectedValue(new BillingAdminConfigError("缺 BILLING_ADMIN_URL"));

    await expect(controller.list({})).rejects.toMatchObject({ status: 503 });
  });

  it("billing 调用失败 → 502 且带上原因；**绝不回 200 空列表**", async () => {
    listAdminTransactions.mockRejectedValue(
      new BillingAdminError("billing 管理端 /admin/transactions 返回 HTTP 400：未知的流水类型：recharg"),
    );

    // 空列表会让人得出「这段时间没人消费」——一句不报错的假话，而这一页正是用来对账的
    await expect(controller.list({})).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("未知的流水类型"),
    });
  });
});
