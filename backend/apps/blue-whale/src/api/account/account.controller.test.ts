import { StreamableFile } from "@nestjs/common";
import ExcelJS from "exceljs";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function readBackWorkbook(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

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
    loadTaskSummaries.mockResolvedValue(new Map());
  });

  it("缺省不带类型过滤、页码落 1 —— 契约里空 = 全部流水", async () => {
    listTransactions.mockResolvedValue(page());

    await controller.consumptions(USER, {});

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

    await controller.consumptions(USER, { type: " consume , expire ,, " });

    expect(listTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ typeFilters: ["consume", "expire"] }),
    );
  });

  it("page 非法 / 小于 1 一律当第一页", async () => {
    listTransactions.mockResolvedValue(page());

    for (const raw of ["0", "-3", "abc"]) {
      await controller.consumptions(USER, { page: raw });
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
    loadTaskSummaries.mockResolvedValue(
      new Map([
        [
          "7",
          {
            type: "video",
            modelId: "seedance-2.5",
            modelLabel: "Seedance 2.5",
            prompt: null,
            specs: { resolution: "1080p", duration: "5" },
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
      task_type: "video",
      model_id: "seedance-2.5",
      model_label: "Seedance 2.5",
      prompt: null,
      specs: { resolution: "1080p", duration: "5" },
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

  it("任务查不到（跨库历史 / 已清理）→ 五个语义字段全 null，但**不是错误**", async () => {
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

    const item = (await controller.consumptions(USER, {})).data.items[0];

    expect(item.job_id).toBe("9");
    expect(item.task_type).toBeNull();
    expect(item.model_id).toBeNull();
    expect(item.model_label).toBeNull();
    expect(item.prompt).toBeNull();
    expect(item.specs).toBeNull();
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

describe("AccountController.export（导出 xlsx）", () => {
  function fakeRes() {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response;
  }

  async function toBuffer(file: StreamableFile): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  }

  beforeEach(() => {
    listOrdersForAdmin.mockReset();
    listCreditLots.mockReset();
    listTransactions.mockReset();
    loadTaskSummaries.mockReset();
    loadTaskSummaries.mockResolvedValue(new Map());
  });

  it("★ orders：repo 的 camelCase 被投影成列定义的 snake_case（不是半张空表）", async () => {
    listOrdersForAdmin.mockResolvedValue({
      items: [
        {
          tradeNo: "BW-1",
          productName: "自定义充值 · 600 积分",
          amountFen: 4000,
          credits: 600,
          bonusCredits: 0,
          status: "paid",
          createdAt: "2026-09-29T14:32:00+08:00",
          paidAt: null,
        },
      ],
      total: 1,
    });

    const file = await controller.export(USER, { scope: "orders" }, fakeRes());
    const sheet = await readBackWorkbook(await toBuffer(file));

    expect(sheet.getRow(2).getCell(1).value).toBe("2026-09-29T14:32:00+08:00");
    expect(sheet.getRow(2).getCell(3).value).toBe("BW-1");
    expect(sheet.getRow(2).getCell(4).value).toBe(40);
  });

  it("★ gain：批次行同样要投影，到期时间不能变成空白", async () => {
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
      total: 1,
    });

    const file = await controller.export(USER, { scope: "gain" }, fakeRes());
    const sheet = await readBackWorkbook(await toBuffer(file));

    expect(sheet.getRow(2).getCell(1).value).toBe("2024-12-01T09:12:00+08:00");
    expect(sheet.getRow(2).getCell(4).value).toBe("永久有效");
    expect(sheet.getRow(2).getCell(6).value).toBe(1200);
  });

  it("★ 用户 id 只来自会话：query 里的 user_id 不改变归属（三个 scope 都验）", async () => {
    listOrdersForAdmin.mockResolvedValue({ items: [], total: 0 });
    listCreditLots.mockResolvedValue({ items: [], total: 0 });
    listTransactions.mockResolvedValue({ items: [], total: 0 });

    await controller.export(USER, { scope: "orders", user_id: "999" }, fakeRes());
    expect(listOrdersForAdmin).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 42 }),
    );

    await controller.export(USER, { scope: "gain", user_id: "999" }, fakeRes());
    expect(listCreditLots).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 42 }),
    );

    await controller.export(USER, { scope: "consume", user_id: "999" }, fakeRes());
    expect(listTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 42 }),
    );
  });

  it("scope 非法 → 400，不问任何数据源", async () => {
    await expect(controller.export(USER, { scope: "orders2" }, fakeRes())).rejects.toMatchObject({
      status: 400,
    });
    await expect(controller.export(USER, {}, fakeRes())).rejects.toMatchObject({ status: 400 });
    expect(listOrdersForAdmin).not.toHaveBeenCalled();
  });

  it("fields 里有未知字段 → 400（静默忽略会导出一份少几列的文件）", async () => {
    await expect(
      controller.export(USER, { scope: "orders", fields: "trade_no,nope" }, fakeRes()),
    ).rejects.toMatchObject({ status: 400 });
    expect(listOrdersForAdmin).not.toHaveBeenCalled();
  });

  it("响应头是 xlsx 二进制流，文件名走 RFC 5987 的 filename*", async () => {
    listOrdersForAdmin.mockResolvedValue({ items: [], total: 0 });
    const res = fakeRes();

    await controller.export(USER, { scope: "orders" }, res);

    expect(res.headers["Content-Type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers["Content-Disposition"]).toContain("filename*=UTF-8''");
    expect(res.headers["Content-Disposition"]).toContain(encodeURIComponent("订单记录"));
  });
});
