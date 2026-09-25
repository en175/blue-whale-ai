import { describe, expect, it, vi } from "vitest";

import { AdminRechargeRecordsController } from "./recharge-records.controller.js";

// 充值记录读的是我们自己的 recharge_orders（本地表，offset 分页 + 总数）。
// 本测试钉住的是**入参解析**：非法筛选条件必须当场 400，而不是静默当成「没有」——
// 后者在运营拿单号对账时表现为「这单不存在」，是一句查不出来的假话。

function createController(list = vi.fn().mockResolvedValue({ items: [], total: 0 })) {
  const recharge = { listOrdersForAdmin: list };
  return { controller: new AdminRechargeRecordsController(recharge as never), list };
}

describe("AdminRechargeRecordsController.list", () => {
  it("缺省：第 1 页 20 条，不带任何筛选项", async () => {
    const { controller, list } = createController();

    await expect(controller.list({})).resolves.toEqual({
      success: true,
      data: { list: [], total: 0 },
    });
    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it("pageSize 上限 100、page 非法回落第 1 页", async () => {
    const { controller, list } = createController();

    await controller.list({ page: "0", pageSize: "9999" });

    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
  });

  it("userId 与 status 传入时按原值过滤", async () => {
    const { controller, list } = createController();

    await controller.list({ userId: " 42 ", status: "paid" });

    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 20, userId: 42, status: "paid" });
  });

  it("交易单号是精确匹配 —— 运营拿单号对账，模糊匹配会带出无关行", async () => {
    const { controller, list } = createController();

    await controller.list({ tradeNo: " RC20260925001 " });

    expect(list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      tradeNo: "RC20260925001",
    });
  });

  it("userId 非正整数 → 400，且不查库", async () => {
    const { controller, list } = createController();

    for (const bad of ["abc", "-1", "0", "1.5"]) {
      await expect(controller.list({ userId: bad })).rejects.toMatchObject({ status: 400 });
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("status 不在白名单 → 400，且不查库（静默空列表与「真的没有」长得一样）", async () => {
    const { controller, list } = createController();

    await expect(controller.list({ status: "success" })).rejects.toMatchObject({ status: 400 });
    expect(list).not.toHaveBeenCalled();
  });

  it("仓储抛错 → 转成 AdminException，消息透传", async () => {
    const { controller } = createController(vi.fn().mockRejectedValue(new Error("db down")));

    await expect(controller.list({})).rejects.toMatchObject({
      status: 500,
      message: "db down",
    });
  });
});
