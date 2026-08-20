import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CostSettlementInternalController } from "./cost-settlement.controller.js";

// IK9VZ0：internal/cost-settlements 接收接口校验单测。
// 关键回归：JSON 无 bigint，amountFen 以整数 number（分）传输——此前误用 typeof bigint
// 导致所有合法请求 400（internal 接口不可用），已修复为 number 校验 + BigInt 转换。

function createController() {
  const consume = vi.fn().mockResolvedValue({ status: "applied" });
  const controller = new CostSettlementInternalController({
    consume,
  } as never);
  return { controller, consume };
}

const LEGAL_BATCH = {
  batchNo: "ADJ-TEST-001",
  items: [
    {
      jobId: "10086",
      userId: 42,
      action: "refund",
      amountFen: 1285,
      reason: "对账偏差",
    },
  ],
};

describe("CostSettlementInternalController（IK9VZ0）", () => {
  beforeEach(() => {
    process.env.COST_SETTLEMENT_SERVICE_TOKEN = "test-shared-secret";
  });
  afterEach(() => {
    delete process.env.COST_SETTLEMENT_SERVICE_TOKEN;
  });

  it("无 token → 401", async () => {
    const { controller, consume } = createController();
    await expect(
      controller.receive(undefined, LEGAL_BATCH),
    ).rejects.toMatchObject({ status: 401 });
    expect(consume).not.toHaveBeenCalled();
  });

  it("token 错误 → 401", async () => {
    const { controller, consume } = createController();
    await expect(
      controller.receive("Bearer wrong", LEGAL_BATCH),
    ).rejects.toMatchObject({ status: 401 });
    expect(consume).not.toHaveBeenCalled();
  });

  it("合法批次（amountFen 为 JSON number）→ 通过校验并转 bigint 消费", async () => {
    const { controller, consume } = createController();
    const result = await controller.receive(
      "Bearer test-shared-secret",
      LEGAL_BATCH,
    );
    expect(result).toEqual({ batch_no: "ADJ-TEST-001", status: "applied" });
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        batchNo: "ADJ-TEST-001",
        items: [
          expect.objectContaining({
            jobId: "10086",
            userId: 42,
            action: "refund",
            amountFen: 1285n,
            reason: "对账偏差",
          }),
        ],
      }),
    );
  });

  it("amountFen 非法（字符串/0/负数/小数）→ 400 invalid_item", async () => {
    const { controller, consume } = createController();
    for (const bad of ["1285", 0, -5, 1.5, null]) {
      await expect(
        controller.receive("Bearer test-shared-secret", {
          batchNo: "ADJ-BAD",
          items: [{ userId: 1, action: "refund", amountFen: bad }],
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(consume).not.toHaveBeenCalled();
  });

  it("batchNo 缺失 / items 非数组 → 400 invalid_batch", async () => {
    const { controller, consume } = createController();
    await expect(
      controller.receive("Bearer test-shared-secret", { items: [] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.receive("Bearer test-shared-secret", {
        batchNo: "X",
        items: "nope",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(consume).not.toHaveBeenCalled();
  });
});
