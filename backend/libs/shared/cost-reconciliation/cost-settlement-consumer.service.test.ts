import { describe, expect, it, vi } from "vitest";

import { CostSettlementConsumer } from "./cost-settlement-consumer.service.js";

function createConsumer() {
  const repo = { createBatch: vi.fn() };
  const alignReservation = vi.fn().mockResolvedValue(undefined);
  const consumer = new CostSettlementConsumer({
    repo,
    alignReservation,
  } as never);
  return { consumer, repo, alignReservation };
}

describe("CostSettlementConsumer（IK9VZ0 多退少补接收/记账）", () => {
  it("同一 batch 重复接收只落一次（整批幂等 → duplicate）", async () => {
    const { consumer, repo } = createConsumer();
    repo.createBatch
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce(null);
    const batch = {
      batchNo: "B1",
      items: [{ userId: 2, action: "refund", amountFen: 100n, reason: "对账" }],
    };

    expect((await consumer.consume(batch)).status).toBe("applied");
    expect((await consumer.consume(batch)).status).toBe("duplicate");
    expect(repo.createBatch).toHaveBeenCalledTimes(2);
  });

  it("有 jobId 的项 → 落库后仅对齐该 job 的预留；无 jobId 的项不触达预留", async () => {
    const { consumer, repo, alignReservation } = createConsumer();
    repo.createBatch.mockResolvedValue({ count: 2 });
    const batch = {
      batchNo: "B2",
      items: [
        { jobId: "9", userId: 2, action: "refund", amountFen: 100n, reason: "多扣退回" },
        { userId: 3, action: "supplement", amountFen: 50n, reason: "补收" },
      ],
    };

    await consumer.consume(batch);

    expect(alignReservation).toHaveBeenCalledTimes(1);
    expect(alignReservation).toHaveBeenCalledWith(
      "9",
      expect.objectContaining({ action: "refund", amountFen: 100n }),
    );
    // createBatch 收到按分/action 归一化的载荷
    expect(repo.createBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        batchNo: "B2",
        items: [
          expect.objectContaining({ generationJobId: "9", actionType: "refund", userId: "2" }),
          expect.objectContaining({ actionType: "supplement", userId: "3" }),
        ],
      }),
    );
  });

  it("消费端不依赖任何改余额能力（无 manageUserQuota / token 注入点）", () => {
    const { consumer } = createConsumer();
    const depsJson = JSON.stringify(consumer);
    expect(depsJson).not.toContain("manageUserQuota");
    expect(depsJson).not.toContain("/api/user/manage");
    expect(depsJson).not.toContain("root_token");
  });
});
