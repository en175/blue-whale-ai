import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryBalance, sharedBillingClient } = vi.hoisted(() => {
  const queryBalance = vi.fn();
  return { queryBalance, sharedBillingClient: () => ({ queryBalance }) };
});

vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/billing/billing-client.js")>();
  return { ...actual, sharedBillingClient };
});

import { BillingConfigError } from "@lib/shared/billing/billing-client.js";
import { UsageController } from "./usage.controller.js";

const USER = { userId: "42", username: "alice" } as never;
const controller = new UsageController();

describe("UsageController.token（billing 余额）", () => {
  beforeEach(() => {
    queryBalance.mockReset();
  });

  it("返回可用余额的**积分**（不是 new-api 的 quota）", async () => {
    queryBalance.mockResolvedValue({
      availableCredits: 120,
      frozenCredits: 30,
      expiring: [
        { credits: 50, expiresAt: "2026-12-01T00:00:00+08:00", source: "purchased" },
      ],
      bySource: [
        { source: "purchased", credits: 100 },
        { source: "bonus", credits: 20 },
      ],
    });

    const response = await controller.token(USER);

    // 展示的余额 = 冻结之外真正可用的那部分：待结算的预扣不该被当成能花的钱。
    // `by_source` 是**同一笔钱的分项**（Σ 必须等于 credits）—— 前端按它相加得到总数；
    // `credits` 保留，是为了既有消费端（画布顶栏、额度闸）不必跟着改。
    expect(response.data).toEqual({
      credits: 120,
      by_source: [
        { source: "purchased", credits: 100 },
        { source: "bonus", credits: 20 },
      ],
      // 临期批次：账户积分页的「最近到期批次」用它。⚠️ 它是**子集**（不是全部批次），
      // 也**不是第二个金额** —— 这些批次的钱已经算在 credits 里了
      expiring: [
        { credits: 50, expires_at: "2026-12-01T00:00:00+08:00", source: "purchased" },
      ],
    });
    expect(queryBalance).toHaveBeenCalledWith(42);
  });

  it("没有临期批次时 expiring 是空数组，不是缺键", async () => {
    queryBalance.mockResolvedValue({
      availableCredits: 0,
      frozenCredits: 0,
      expiring: [],
      bySource: [],
    });

    // 空数组与「字段不存在」在前端是两种分支：前者能安全 `.length`，
    // 后者要判 undefined。对外只留一种
    expect((await controller.token(USER)).data.expiring).toEqual([]);
  });

  it("billing 未配置 → 503，billing 报错 → 502（不回落成 0 或 null）", async () => {
    queryBalance.mockRejectedValue(new BillingConfigError("计费服务地址未配置"));
    await expect(controller.token(USER)).rejects.toMatchObject({
      status: 503,
      code: "billing_unconfigured",
    });

    queryBalance.mockRejectedValue(new Error("boom"));
    await expect(controller.token(USER)).rejects.toMatchObject({
      status: 502,
      code: "billing_error",
    });
  });
});
