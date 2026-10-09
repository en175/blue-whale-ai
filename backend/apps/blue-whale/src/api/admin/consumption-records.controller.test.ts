import { beforeEach, describe, expect, it, vi } from "vitest";

const { listAdminTransactions } = vi.hoisted(() => ({ listAdminTransactions: vi.fn() }));

vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/billing/billing-admin-client.js")>();
  return { ...actual, listAdminTransactions };
});

import { BillingAdminConfigError, BillingAdminError } from "@lib/shared/billing/billing-admin-client.js";
import type { IdentityService } from "@lib/shared/identity/identity.service.js";
import type { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { AdminConsumptionRecordsController } from "./consumption-records.controller.js";

const { loadTaskSummaries } = vi.hoisted(() => ({ loadTaskSummaries: vi.fn() }));
const { findAdminUserIdByKeyword, loadAdminUserIdentities } = vi.hoisted(() => ({
  findAdminUserIdByKeyword: vi.fn(),
  loadAdminUserIdentities: vi.fn(),
}));

const controller = new AdminConsumptionRecordsController(
  { loadTaskSummaries } as unknown as JobsService,
  { findAdminUserIdByKeyword, loadAdminUserIdentities } as unknown as IdentityService,
);

function page(items: unknown[] = [], total = 0) {
  return { items, total };
}

const ITEM = {
  id: "res:7",
  userId: 42,
  type: "consume",
  direction: "out",
  title: "视频生成 · seedance-2.5",
  amount: 30,
  reservedCredits: 100,
  generationJobId: "7",
  status: "done",
  createdAt: "2026-09-25T10:00:00+08:00",
  settledAt: "2026-09-25T10:01:00+08:00",
};

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
    findAdminUserIdByKeyword.mockReset();
    loadAdminUserIdentities.mockReset();
    loadTaskSummaries.mockResolvedValue(new Map());
    loadAdminUserIdentities.mockResolvedValue(new Map());
  });

  it("缺省：关键词**不传** = 全站流水，页码落 1 = 首页", async () => {
    listAdminTransactions.mockResolvedValue(page());

    await controller.list({});

    expect(listAdminTransactions).toHaveBeenCalledWith({
      pageSize: 20,
      page: 1,
    });
    expect(findAdminUserIdByKeyword).not.toHaveBeenCalled();
  });

  it("关键词命中一个用户 → 用它换来的 userId 去过滤 billing，type 与 page 透传", async () => {
    listAdminTransactions.mockResolvedValue(page());
    findAdminUserIdByKeyword.mockResolvedValue(42);

    await controller.list({ keyword: "13800008888", type: "consume", page: "3" });

    expect(findAdminUserIdByKeyword).toHaveBeenCalledWith("13800008888");
    expect(listAdminTransactions).toHaveBeenCalledWith({
      userId: 42,
      type: "consume",
      pageSize: 20,
      page: 3,
    });
  });

  it("关键词查不到人 → 空页，**不问 billing**（账本按 user_id 过滤，认不出人就一条也对不上）", async () => {
    findAdminUserIdByKeyword.mockResolvedValue(undefined);

    await expect(controller.list({ keyword: "查无此人" })).resolves.toEqual({
      success: true,
      data: { items: [], total: 0 },
    });
    expect(listAdminTransactions).not.toHaveBeenCalled();
  });

  it("响应把 billing 的字段名映射成下划线口径，且带出 user_id、任务的三个语义字段与展示身份", async () => {
    listAdminTransactions.mockResolvedValue(page([ITEM], 4));
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
    loadAdminUserIdentities.mockResolvedValue(
      new Map([[42, { nickname: "张小明", phone: "13800008888" }]]),
    );

    await expect(controller.list({})).resolves.toEqual({
      success: true,
      data: {
        items: [
          {
            id: "res:7",
            user_id: 42,
            nickname: "张小明",
            phone: "13800008888",
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
        total: 4,
      },
    });

    expect(loadAdminUserIdentities).toHaveBeenCalledTimes(1);
    expect(loadAdminUserIdentities).toHaveBeenCalledWith([42]);
  });

  it("用户没手机号（存量用户是常态）→ phone 收敛成 null，**不是空串**", async () => {
    listAdminTransactions.mockResolvedValue(page([ITEM]));
    loadAdminUserIdentities.mockResolvedValue(
      new Map([[42, { nickname: "老用户", phone: "" }]]),
    );

    await expect(controller.list({})).resolves.toMatchObject({
      data: { items: [{ nickname: "老用户", phone: null }] },
    });
  });

  it("用户查不到（跨库历史 / 被清理）→ 昵称手机号都是 null，行照常返回", async () => {
    listAdminTransactions.mockResolvedValue(page([ITEM]));

    await expect(controller.list({})).resolves.toMatchObject({
      data: { items: [{ user_id: 42, nickname: null, phone: null }] },
    });
  });

  it("当页没有任何行 → 仍然只调一次批量查（空数组），不做无谓查询", async () => {
    listAdminTransactions.mockResolvedValue(page([]));

    await controller.list({});

    expect(loadAdminUserIdentities).toHaveBeenCalledWith([]);
  });

  it("只把消费行的 jobId 拿去批量查（发放行没有任务，不混进 IN 查询）", async () => {
    listAdminTransactions.mockResolvedValue(page([ITEM, GRANT_ROW]));

    await controller.list({});

    expect(loadTaskSummaries).toHaveBeenCalledTimes(1);
    expect(loadTaskSummaries).toHaveBeenCalledWith(["7"]);
  });

  it("任务查不到（跨库历史 / 已清理）→ 四字段 null，行照常返回", async () => {
    listAdminTransactions.mockResolvedValue(page([ITEM]));
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
    listAdminTransactions.mockResolvedValue(page([GRANT_ROW]));

    await expect(controller.list({})).resolves.toMatchObject({
      data: { items: [{ task_type: null, prompt: null }] },
    });
  });

  it("billing 没回预扣额（发放 / 账本行）→ reserved_credits 为 null，不是 undefined", async () => {
    listAdminTransactions.mockResolvedValue(page([GRANT_ROW]));

    await expect(controller.list({})).resolves.toMatchObject({
      data: { items: [{ reserved_credits: null }] },
    });
  });

  it("pageSize 上限 100、非法回落 20", async () => {
    listAdminTransactions.mockResolvedValue(page());

    await controller.list({ pageSize: "9999" });
    expect(listAdminTransactions).toHaveBeenLastCalledWith({ pageSize: 100, page: 1 });

    await controller.list({ pageSize: "abc" });
    expect(listAdminTransactions).toHaveBeenLastCalledWith({ pageSize: 20, page: 1 });
  });

  it("关键词是空白 → 等同于不传（全站），不白跑一次查人", async () => {
    listAdminTransactions.mockResolvedValue(page());

    await controller.list({ keyword: "   " });

    expect(findAdminUserIdByKeyword).not.toHaveBeenCalled();
    expect(listAdminTransactions).toHaveBeenCalledWith({ pageSize: 20, page: 1 });
  });

  it("★ 还认着旧的 `userId` 参数 —— 不认它就是静默回一页全站流水", async () => {
    listAdminTransactions.mockResolvedValue(page());
    findAdminUserIdByKeyword.mockResolvedValue(42);

    await controller.list({ userId: "42" });

    expect(findAdminUserIdByKeyword).toHaveBeenCalledWith("42");
    expect(listAdminTransactions).toHaveBeenCalledWith({ userId: 42, pageSize: 20, page: 1 });
  });

  it("新参数优先：同时收到 keyword 与 userId 时用 keyword", async () => {
    listAdminTransactions.mockResolvedValue(page());
    findAdminUserIdByKeyword.mockResolvedValue(7);

    await controller.list({ keyword: "13800008888", userId: "42" });

    expect(findAdminUserIdByKeyword).toHaveBeenCalledWith("13800008888");
  });

  it("billing 管理端地址没配 → 503（重试不会好，要人去改配置）", async () => {
    listAdminTransactions.mockRejectedValue(new BillingAdminConfigError("缺 BILLING_ADMIN_URL"));

    await expect(controller.list({})).rejects.toMatchObject({ status: 503 });
  });

  it("billing 调用失败 → 502 且带上原因；**绝不回 200 空列表**", async () => {
    listAdminTransactions.mockRejectedValue(
      new BillingAdminError("billing 管理端 /admin/transactions 返回 HTTP 400：未知的流水类型：recharg"),
    );

    await expect(controller.list({})).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("未知的流水类型"),
    });
  });
});
