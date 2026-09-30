import { describe, expect, it, vi } from "vitest";

import { NewApiError } from "@lib/core";
import { AdminRechargeRecordsController } from "./recharge-records.controller.js";

// 充值记录读的是我们自己的 recharge_orders（本地表，offset 分页 + 总数）。
// 本测试钉住的是**入参解析**：非法筛选条件必须当场 400，而不是静默当成「没有」——
// 后者在运营拿单号对账时表现为「这单不存在」，是一句查不出来的假话。

/** 用户维度走 bw_users，用桩：本文件管的是入参解析，不管「怎么查用户」。 */
function identityStub() {
  return {
    findAdminUserIdByKeyword: vi.fn().mockResolvedValue(undefined),
    loadAdminUserIdentities: vi.fn().mockResolvedValue(new Map()),
  };
}

function createController(list = vi.fn().mockResolvedValue({ items: [], total: 0 })) {
  const recharge = { listOrdersForAdmin: list };
  const operationLog = { create: vi.fn().mockResolvedValue(undefined) };
  const identity = identityStub();
  return {
    controller: new AdminRechargeRecordsController(
      recharge as never,
      operationLog as never,
      identity as never,
    ),
    list,
    operationLog,
    identity,
  };
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

  it("关键词命中一个用户 → 用它换来的 userId 过滤，status 透传", async () => {
    const { controller, list, identity } = createController();
    identity.findAdminUserIdByKeyword.mockResolvedValue(42);

    await controller.list({ keyword: " 13800008888 ", status: "paid" });

    expect(identity.findAdminUserIdByKeyword).toHaveBeenCalledWith("13800008888");
    // 送给仓储的是**解析出来的数字**，不是关键词——它那层不认识手机号
    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 20, userId: 42, status: "paid" });
  });

  it("★ 还认着旧的 `userId` 参数 —— 不认它就是静默回一页全站订单", async () => {
    // 前端与后端不是原子发版（本仓 2026-09-26 实测过：3100 上跑着 4 小时前的构建）。
    // 一个还没刷新的管理页仍会发 `?userId=42`：不认它的后果不是报错，而是运营以为
    // 筛了那个人、实际看到所有人的单，而这一页是拿来对账的。
    const { controller, list, identity } = createController();
    identity.findAdminUserIdByKeyword.mockResolvedValue(42);

    await controller.list({ userId: "42" });

    expect(identity.findAdminUserIdByKeyword).toHaveBeenCalledWith("42");
    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 20, userId: 42 });
  });

  it("关键词查不到人 → 空页，**不查订单表**", async () => {
    const { controller, list } = createController();

    await expect(controller.list({ keyword: "查无此人" })).resolves.toEqual({
      success: true,
      data: { list: [], total: 0 },
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("用户名 / 手机号按本页的 userId 集合一次批量回填；用户没手机号收敛成 null", async () => {
    const { controller, identity } = createController(
      vi.fn().mockResolvedValue({
        items: [{ tradeNo: "RC1", userId: "42" }],
        total: 1,
      }),
    );
    identity.loadAdminUserIdentities.mockResolvedValue(
      new Map([[42, { nickname: "张小明", phone: "" }]]),
    );

    await expect(controller.list({})).resolves.toMatchObject({
      data: { list: [{ tradeNo: "RC1", nickname: "张小明", phone: null }], total: 1 },
    });
    expect(identity.loadAdminUserIdentities).toHaveBeenCalledTimes(1);
    expect(identity.loadAdminUserIdentities).toHaveBeenCalledWith([42]);
  });

  it("用户查不到（已被清理）→ 用户名手机号都是 null，行照常返回", async () => {
    const { controller } = createController(
      vi.fn().mockResolvedValue({ items: [{ tradeNo: "RC1", userId: "42" }], total: 1 }),
    );

    await expect(controller.list({})).resolves.toMatchObject({
      data: { list: [{ tradeNo: "RC1", nickname: null, phone: null }] },
    });
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

  it("status 不在白名单 → 400，且不查库（静默空列表与「真的没有」长得一样）", async () => {
    const { controller, list } = createController();

    await expect(controller.list({ status: "success" })).rejects.toMatchObject({ status: 400 });
    expect(list).not.toHaveBeenCalled();
  });

  it("★ 同时给了查不到人的关键词和非法 status → 仍然是 400，不是 200 空页", async () => {
    // 校验必须排在查人之前。否则「另一个条件没命中」会把非法条件一起兜成 200 空列表——
    // 而运营看到的是一句「暂无订单」，不是「你的条件写错了」。
    const { controller, list } = createController();

    await expect(
      controller.list({ keyword: "查无此人", status: "success" }),
    ).rejects.toMatchObject({ status: 400 });
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

describe("AdminRechargeRecordsController.retryGrant — 人工补发（E-1 的出口）", () => {
  function createRetry(recharge: Record<string, unknown>) {
    const operationLog = { create: vi.fn().mockResolvedValue(undefined) };
    return {
      controller: new AdminRechargeRecordsController(
        recharge as never,
        operationLog as never,
        identityStub() as never,
      ),
      operationLog,
    };
  }

  it("★ 单号原样交给服务层（去除首尾空白），并把补发后的状态回给调用方", async () => {
    const retryGrantForAdmin = vi
      .fn()
      .mockResolvedValue({ tradeNo: "RC20260927001", status: "paid" });
    const { controller } = createRetry({ retryGrantForAdmin });

    const res = await controller.retryGrant(" RC20260927001 ");

    expect(retryGrantForAdmin).toHaveBeenCalledWith("RC20260927001");
    expect(res).toEqual({
      success: true,
      data: { tradeNo: "RC20260927001", status: "paid" },
    });
  });

  it("★ 补发是写操作，必须留下审计（事后能回答「这笔是谁推的、推成功没有」）", async () => {
    const { controller, operationLog } = createRetry({
      retryGrantForAdmin: vi.fn().mockResolvedValue({ tradeNo: "RC1", status: "paid" }),
    });

    await controller.retryGrant("RC1");

    const entry = operationLog.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry).toMatchObject({ category: "recharge", action: "重试发放", target: "RC1" });
    // 成功与「补发后仍卡住」两句话必须不同：只看审计的人分得出这次到底成没成
    expect(String(entry.detail)).toContain("已到账");
  });

  it("★ 补发后仍是 paid_pending：审计如实写「仍失败」，不写成成功", async () => {
    const { controller, operationLog } = createRetry({
      retryGrantForAdmin: vi
        .fn()
        .mockResolvedValue({ tradeNo: "RC2", status: "paid_pending" }),
    });

    await controller.retryGrant("RC2");

    const detail = String(
      (operationLog.create.mock.calls[0]![0] as Record<string, unknown>).detail,
    );
    expect(detail).toContain("paid_pending");
    expect(detail).not.toContain("已到账");
  });

  it("审计写失败不阻断返回（补发已经发生，回滚是更大的错）", async () => {
    const operationLog = { create: vi.fn().mockRejectedValue(new Error("audit down")) };
    const c = new AdminRechargeRecordsController(
      { retryGrantForAdmin: vi.fn().mockResolvedValue({ tradeNo: "RC3", status: "paid" }) } as never,
      operationLog as never,
      identityStub() as never,
    );

    await expect(c.retryGrant("RC3")).resolves.toEqual({
      success: true,
      data: { tradeNo: "RC3", status: "paid" },
    });
    expect(operationLog.create).toHaveBeenCalled();
  });

  it("缺单号 → 400，且不去调服务层", async () => {
    const retryGrantForAdmin = vi.fn();
    const { controller } = createRetry({ retryGrantForAdmin });

    await expect(controller.retryGrant("  ")).rejects.toMatchObject({ status: 400 });
    expect(retryGrantForAdmin).not.toHaveBeenCalled();
  });

  it("服务层的业务错误（如「尚未收到款项」）状态与消息透传，不是笼统 500", async () => {
    const { controller } = createRetry({
      retryGrantForAdmin: vi
        .fn()
        .mockRejectedValue(new NewApiError("该订单尚未收到款项", 400)),
    });

    await expect(controller.retryGrant("RC4")).rejects.toMatchObject({
      status: 400,
      message: "该订单尚未收到款项",
    });
  });
});
