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
import type { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { AdminConsumptionRecordsController } from "./consumption-records.controller.js";

// 积分记录读的是 billing 的账本（游标分页、无总数）。本测试钉住的是管理面**独有的那条自由度**：
// userId 可以不传 = 全站流水——用户面的 ListTransactions 里它是必填的。
//
// JobsService 用桩：这条端点该负责的是「把任务语义合并成什么形状」，不是「怎么查任务」——
// 查询本身归 jobs.service / job-repo 的单测。这里只在边界上钉住合并行为。
const { loadTaskSummaries } = vi.hoisted(() => ({ loadTaskSummaries: vi.fn() }));

const controller = new AdminConsumptionRecordsController({
  loadTaskSummaries,
} as unknown as JobsService);

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
  // billing 侧那条预留上挂的任务 id（字符串，别过 Number——它是 join key）
  generationJobId: "7",
  status: "done",
  createdAt: "2026-09-25T10:00:00+08:00",
  settledAt: "2026-09-25T10:01:00+08:00",
};

/** 一笔发放：没有任务，刻意**不带 `generationJobId` 这个键**（模拟老版 billing 的回包）。 */
const GRANT_ROW = {
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

describe("AdminConsumptionRecordsController.list", () => {
  beforeEach(() => {
    listAdminTransactions.mockReset();
    loadTaskSummaries.mockReset();
    // 缺省：没有任务可补（发放行、当页无消费行）——多数用例不关心这条链路
    loadTaskSummaries.mockResolvedValue(new Map());
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

  it("响应把 billing 的字段名映射成下划线口径，且带出 user_id 与任务的三个语义字段", async () => {
    listAdminTransactions.mockResolvedValue(page([ITEM], "next-tok"));
    loadTaskSummaries.mockResolvedValue(
      new Map([
        [
          "7",
          {
            type: "text2video",
            modelId: "seedance-2.5",
            modelLabel: "Seedance 2.5",
            prompt: "一只猫在草地上跑",
          },
        ],
      ]),
    );

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
            task_type: "text2video",
            model_id: "seedance-2.5",
            model_label: "Seedance 2.5",
            prompt: "一只猫在草地上跑",
            status: "done",
            created_at: "2026-09-25T10:00:00+08:00",
            settled_at: "2026-09-25T10:01:00+08:00",
          },
        ],
        next_page_token: "next-tok",
      },
    });
  });

  it("只把消费行的 jobId 拿去批量查（发放行没有任务，不混进 IN 查询）", async () => {
    listAdminTransactions.mockResolvedValue(page([ITEM, GRANT_ROW]));

    await controller.list({});

    // 一次批量查，不是逐行查；且只带真的有关联任务的那些行
    expect(loadTaskSummaries).toHaveBeenCalledTimes(1);
    expect(loadTaskSummaries).toHaveBeenCalledWith(["7"]);
  });

  it("任务查不到（跨库历史 / 已清理）→ 四字段 null，行照常返回", async () => {
    listAdminTransactions.mockResolvedValue(page([ITEM]));
    // 批量查回的 Map 里没有 "7" —— 键缺席就是「没这个任务」，不是「有这个任务但字段为空」
    loadTaskSummaries.mockResolvedValue(new Map());

    await expect(controller.list({})).resolves.toMatchObject({
      data: {
        items: [
          {
            id: "res:7",
            task_type: null,
            model_id: null,
            model_label: null,
            prompt: null,
          },
        ],
      },
    });
  });

  it("任务在、免费工具族没有模型 → model 两字段 null，但 prompt 仍在", async () => {
    // 「没有模型」与「没有提示词」是两回事：前者免费工具族天生没有，
    // 后者这个任务就没写。混成一个 null，前端就没法决定该不该显示那一格。
    listAdminTransactions.mockResolvedValue(page([ITEM]));
    loadTaskSummaries.mockResolvedValue(
      new Map([
        [
          "7",
          {
            type: "image_cutout",
            modelId: null,
            modelLabel: null,
            prompt: "把背景抠掉",
          },
        ],
      ]),
    );

    await expect(controller.list({})).resolves.toMatchObject({
      data: {
        items: [
          {
            task_type: "image_cutout",
            model_id: null,
            model_label: null,
            prompt: "把背景抠掉",
          },
        ],
      },
    });
  });

  it("当页没有任何消费行 → 仍然只调一次批量查（空数组），不做无谓查询", async () => {
    listAdminTransactions.mockResolvedValue(page([GRANT_ROW]));

    await controller.list({});

    expect(loadTaskSummaries).toHaveBeenCalledWith([]);
  });

  it("billing 未投影 jobId（新后端 + 老 billing）→ 不崩，四字段为 null", async () => {
    // 半上线形态：proto 没这字段时客户端收敛成 null，这里模拟「键整个不存在」的最坏形态
    listAdminTransactions.mockResolvedValue(page([GRANT_ROW]));

    await expect(controller.list({})).resolves.toMatchObject({
      data: { items: [{ task_type: null, prompt: null }] },
    });
  });

  it("billing 没回预扣额（发放 / 账本行）→ reserved_credits 为 null，不是 undefined", async () => {
    // 契约里只能有一种「没有」：多一种空值，界面就要判两次，而少判的那次会渲染成
    // 「预扣 undefined」或干脆不渲染——两种都不会报错。
    // 这里的发放行刻意**没有 reservedCredits 这个键**，模拟老版 billing 的回包。
    listAdminTransactions.mockResolvedValue(page([GRANT_ROW]));

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
