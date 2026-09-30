import { beforeEach, describe, expect, it, vi } from "vitest";

// 只替换 client 的来源，`toBillingError` 用真实现——错误映射是这条端点对外的一部分，
// 换成假的就等于把「billing 挂了会回什么」这条断言删掉了。
const { listTransactions, listCreditLots, sharedBillingClient } = vi.hoisted(() => {
  const listTransactions = vi.fn();
  const listCreditLots = vi.fn();
  return {
    listTransactions,
    listCreditLots,
    sharedBillingClient: () => ({ listTransactions, listCreditLots }),
  };
});

vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/billing/billing-client.js")>();
  return { ...actual, sharedBillingClient };
});

import { BillingConfigError } from "@lib/shared/billing/billing-client.js";
import type { JobsService } from "@lib/shared/jobs/jobs.service.js";
import type { RechargeService } from "@lib/shared/recharge/recharge.service.js";
import { AccountController } from "./account.controller.js";

const USER = { userId: "42", username: "alice" } as never;

// JobsService 用桩：这条端点该负责的是「把两个来源合并成什么形状」，不是「怎么查任务」——
// 查询本身归它自己的单测。这里只在边界上钉住合并行为（与积分记录页同款）。
const { loadTaskSummaries } = vi.hoisted(() => ({ loadTaskSummaries: vi.fn() }));
const { listOrdersForAdmin } = vi.hoisted(() => ({ listOrdersForAdmin: vi.fn() }));
const controller = new AccountController(
  { loadTaskSummaries } as unknown as JobsService,
  { listOrdersForAdmin } as unknown as RechargeService,
);

function page(items: unknown[] = [], total = 0) {
  return { items, total };
}

describe("AccountController.consumptions（billing 账本）", () => {
  beforeEach(() => {
    listTransactions.mockReset();
    listCreditLots.mockReset();
    loadTaskSummaries.mockReset();
    // 缺省：这一页一条任务都查不到（summary 全 undefined）→ 四字段全 null。
    // 需要「查得到」的用例自己 mockResolvedValue 一份 Map。
    loadTaskSummaries.mockResolvedValue(new Map());
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
            generationJobId: "7",
          },
        ],
        4,
      ),
    );
    // 任务查得到 → 三个语义字段有值；提示词为 null（免费工具族）也能分辨
    loadTaskSummaries.mockResolvedValue(
      new Map([
        [
          "7",
          {
            type: "text2video",
            modelId: "seedance-2.5",
            modelLabel: "Seedance 2.5",
            prompt: null,
          },
        ],
      ]),
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
      job_id: "7",
      task_type: "text2video",
      model_id: "seedance-2.5",
      model_label: "Seedance 2.5",
      prompt: null,
    });
  });

  it("一页只批量查一次任务；没有任务的行不参与查询", async () => {
    listTransactions.mockResolvedValue(
      page([
        {
          id: "res:7",
          type: "consume",
          direction: "out",
          title: "t",
          credits: 0,
          status: "done",
          createdAt: "2026-09-25T10:00:00+08:00",
          settledAt: "2026-09-25T10:01:00+08:00",
          generationJobId: "7",
        },
        {
          // 发放行 / 过期行没有任务：job id 为 null，不该被塞进批量查询（7 行就是 7 次库往返）
          id: "lot:3",
          type: "recharge",
          direction: "in",
          title: "充值到账",
          credits: 600,
          status: "done",
          createdAt: "2026-09-25T09:00:00+08:00",
          settledAt: "2026-09-25T09:00:00+08:00",
          generationJobId: null,
        },
      ]),
    );

    await controller.consumptions(USER, {});

    expect(loadTaskSummaries).toHaveBeenCalledTimes(1);
    expect(loadTaskSummaries).toHaveBeenCalledWith(["7"]);
  });

  it("任务查不到（跨库历史 / 已清理）→ 四字段全 null，但**不是错误**", async () => {
    listTransactions.mockResolvedValue(
      page([
        {
          id: "res:9",
          type: "consume",
          direction: "out",
          title: "视频生成 · seedance-2.5",
          credits: 30,
          status: "done",
          createdAt: "2026-09-25T10:00:00+08:00",
          settledAt: "2026-09-25T10:01:00+08:00",
          generationJobId: "9",
        },
      ]),
    );
    // loadTaskSummaries 缺省返回空 Map = 查不到

    const item = (await controller.consumptions(USER, {})).data.items[0];

    // job_id 仍然给（那笔钱确实关联过一个任务），只是语义字段查不到 → 前端回落显示 title
    expect(item.job_id).toBe("9");
    expect(item.task_type).toBeNull();
    expect(item.model_id).toBeNull();
    expect(item.model_label).toBeNull();
    expect(item.prompt).toBeNull();
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

describe("AccountController.creditLots（批次台账）", () => {
  beforeEach(() => {
    listTransactions.mockReset();
    listCreditLots.mockReset();
  });

  it("★ 用户 id 只来自会话，query 里的 user_id 一个字都不认", async () => {
    listCreditLots.mockResolvedValue({ items: [], total: 0 });

    // 传了 user_id / userId 也不该改变行为 —— 这条路由压根没有「查别人的台账」这个入参。
    // 上游 billing 对 user_id <= 0 直接拒，所以这里**绝不能**把它透传下去
    await controller.creditLots(USER, { user_id: "999", userId: "999" });

    expect(listCreditLots).toHaveBeenCalledWith({
      userId: 42,
      pageSize: 20,
      page: 1,
    });
  });

  it("投影成前端字段：空串到期时间 = 永久有效，不是 null", async () => {
    listCreditLots.mockResolvedValue({
      items: [
        {
          lotId: "18401",
          source: "purchased",
          amount: 3000,
          remaining: 1200,
          createdAt: "2024-12-01T09:12:00+08:00",
          expiresAt: "",
          bizType: "recharge",
          bizId: "BW20241201091200555",
        },
      ],
      total: 3,
    });

    const response = await controller.creditLots(USER, {});

    expect(response.data.total).toBe(3);
    expect(response.data.items[0]).toEqual({
      lot_id: "18401",
      source: "purchased",
      amount: 3000,
      remaining: 1200,
      created_at: "2024-12-01T09:12:00+08:00",
      // 空串而不是 null：对外只留一种「没有」，与 settled_at 同一条收敛
      expires_at: "",
      biz_type: "recharge",
      biz_id: "BW20241201091200555",
    });
  });

  it("page_size / page 同样按缺省与上限钳制", async () => {
    listCreditLots.mockResolvedValue({ items: [], total: 0 });

    await controller.creditLots(USER, { page_size: "9999", page: "0" });
    expect(listCreditLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageSize: 100, page: 1 }),
    );
  });
});

describe("AccountController.orders（用户侧充值订单）", () => {
  beforeEach(() => {
    listOrdersForAdmin.mockReset();
    listOrdersForAdmin.mockResolvedValue({ items: [], total: 0 });
  });

  it("★ 归属被钉死成会话用户：query 里的 user_id / keyword 一个字都不参与", async () => {
    await controller.orders(USER, {
      user_id: "999",
      userId: "999",
      keyword: "别人的手机号",
    });

    // 关键：userId 是 42（会话里的），不是 999。管理端那条可以不传 userId = 全站订单，
    // 这条路由永远不许走到那个分支
    expect(listOrdersForAdmin).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      userId: 42,
    });
  });

  it("status 白名单来自 RECHARGE_ORDER_STATUSES，合法值透传", async () => {
    await controller.orders(USER, { status: "paid_pending" });
    expect(listOrdersForAdmin).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "paid_pending" }),
    );
  });

  it("status 非法 → 当场 400，不是静默回空列表", async () => {
    // 空列表与「真的没有」长得一模一样，运营/用户都分不出来
    await expect(controller.orders(USER, { status: "refunded" })).rejects.toMatchObject({
      status: 400,
    });
    expect(listOrdersForAdmin).not.toHaveBeenCalled();
  });

  it("投影成前端字段：金额是分、到账积分拆成基础 + 赠送", async () => {
    listOrdersForAdmin.mockResolvedValue({
      items: [
        {
          tradeNo: "BW20260929143200801",
          productName: "自定义充值 · 600 积分",
          productType: "custom",
          amountFen: 4000,
          credits: 600,
          bonusCredits: 0,
          status: "paid",
          createdAt: "2026-09-29T14:32:00+08:00",
          paidAt: "2026-09-29T14:32:41+08:00",
          creditsValidMonths: 24,
        },
      ],
      total: 7,
    });

    const response = await controller.orders(USER, {});

    expect(response.data.total).toBe(7);
    expect(response.data.items[0]).toEqual({
      trade_no: "BW20260929143200801",
      product_name: "自定义充值 · 600 积分",
      product_type: "custom",
      amount_fen: 4000,
      credits: 600,
      bonus_credits: 0,
      status: "paid",
      created_at: "2026-09-29T14:32:00+08:00",
      paid_at: "2026-09-29T14:32:41+08:00",
      credits_valid_months: 24,
    });
  });
});
