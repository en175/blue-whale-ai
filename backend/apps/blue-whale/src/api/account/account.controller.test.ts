import { describe, expect, it } from "vitest";

import type { AccountService } from "@lib/shared/account/account.service.js";
import { AccountController } from "./account.controller.js";

// IKGCWU：这个 controller 此前没有测试，而本单最要紧的那条不变量——非法 type 必须 400，
// 绝不能落进上游「不加过滤」哨兵（那会把充值/登录/管理行混进用户账单）——只靠 records.ts
// 的单测证不了：还得证明校验发生在 try 之外，没被 toUpstreamError 重包装成 502，
// 而且根本没往下游发请求。

interface ConsumeCall {
  token: string;
  options: { page?: number; pageSize?: number; type?: number | readonly number[] };
}

function makeController(result?: {
  items: Array<Record<string, unknown>>;
  total: number;
}) {
  const calls: ConsumeCall[] = [];
  const service = {
    listUserConsumeLogs: (token: string, options: ConsumeCall["options"]) => {
      calls.push({ token, options });
      return Promise.resolve(result ?? { items: [], total: 0 });
    },
  } as unknown as AccountService;
  return { controller: new AccountController(service), calls };
}

const AUTH = "Bearer sk-user-token";

describe("AccountController.consumptions（IKGCWU）", () => {
  it("缺省查消耗 + 退款两类", async () => {
    const { controller, calls } = makeController();

    await controller.consumptions(AUTH, {});

    expect(calls[0]?.options.type).toEqual([2, 6]);
    expect(calls[0]?.token).toBe("sk-user-token");
  });

  it("显式 type=6 收窄到退款", async () => {
    const { controller, calls } = makeController();

    await controller.consumptions(AUTH, { type: "6" });

    expect(calls[0]?.options.type).toEqual([6]);
  });

  it("非法 type 抛 400，且不往下游发请求", async () => {
    const { controller, calls } = makeController();

    await expect(controller.consumptions(AUTH, { type: "0" })).rejects.toMatchObject({
      status: 400,
      code: "invalid_log_type",
    });
    // 校验在 try 之外：既没打上游，也没被 toUpstreamError 改写成 502。
    expect(calls).toHaveLength(0);
  });

  it("unset 掉 type 之外的错误仍走上游映射（这里用 502 兜底）", async () => {
    const service = {
      listUserConsumeLogs: () => Promise.reject(new Error("boom")),
    } as unknown as AccountService;
    const controller = new AccountController(service);

    await expect(controller.consumptions(AUTH, {})).rejects.toMatchObject({ status: 502 });
  });

  it("无令牌 401，且不往下游发请求", async () => {
    const { controller, calls } = makeController();

    await expect(controller.consumptions(undefined, {})).rejects.toMatchObject({
      status: 401,
    });
    expect(calls).toHaveLength(0);
  });

  it("把上游日志映射成带 kind 的账单项", async () => {
    const { controller } = makeController({
      items: [
        {
          id: 7,
          type: 2,
          quota: 300_000,
          model_name: "doubao-seedance-2-0-260128",
          created_at: 1_700_000_100,
        },
        {
          id: 8,
          type: 6,
          quota: 300_000,
          model_name: "doubao-seedance-2-0-260128",
          created_at: 1_700_000_200,
        },
      ],
      total: 2,
    });

    const response = await controller.consumptions(AUTH, {});

    expect(response.data.total).toBe(2);
    expect(response.data.items.map((item) => item.kind)).toEqual(["consume", "refund"]);
    // 退款也是正的变动幅度，方向只由 kind 表达。
    expect(response.data.items[1]?.credits).toBeGreaterThan(0);
    expect(response.data.items[1]?.summary).toBe("退款（生成视频）");
  });
});
