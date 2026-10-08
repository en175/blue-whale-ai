import { StreamableFile } from "@nestjs/common";
import ExcelJS from "exceljs";
import type { Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 导出的 xlsx 必须**真读回来**断言：写坏了服务端不报错，只有用户下载才发现。 */
async function readBackWorkbook(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

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
    // loadTaskSummaries 缺省返回空 Map = 查不到

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

/**
 * 导出这一层**必须**有测试。
 *
 * <p>⚠️ 上一版这里一条都没有，于是漏掉了一整类事故：`collectExportRows` 把 repo 的
 * camelCase 原始对象（`createdAt` / `amountFen`）直接塞给读 snake_case 的列定义，
 * 键全对不上 —— 服务端一声不响，用户下载下来才发现大半格子是空的。
 * 所以下面第一条用例**真的把 xlsx 读回来**，而不是断言中间产物。
 */
describe("AccountController.export（导出 xlsx）", () => {
  /** `@Res({ passthrough: true })` 的最小替身：只记头。 */
  function fakeRes() {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response;
  }

  /** 把 StreamableFile 的流读成 Buffer —— 这样才能交给 exceljs 回读。 */
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
          // 这是 `RechargeOrderView` 的真实形状 —— 键与导出的列定义**不同名**
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

    // 直接塞原始对象的话，这三格会是 undefined / NaN，而服务端不会报错
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
    // 空串 = 永久有效。投影漏了的话这里是空白，而 §3.3 明写**不要**渲染成空白
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
    // 中文文件名必须走 filename*，否则 Chrome 之外的浏览器会渲染成乱码
    expect(res.headers["Content-Disposition"]).toContain("filename*=UTF-8''");
    expect(res.headers["Content-Disposition"]).toContain(encodeURIComponent("订单记录"));
  });
});
