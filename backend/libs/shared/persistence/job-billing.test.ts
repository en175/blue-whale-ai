import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  jobExistenceProbe,
  releaseUnlessJobCommitted,
  withBillingCompensation,
} from "./job-billing.js";

function billingOf() {
  const charge = vi.fn(async () => {});
  const release = vi.fn(async (_jobId: number, _reason: string) => {});
  return { charge, release, billing: { charge, release } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withBillingCompensation", () => {
  it("事务已落库但随后报错 → 不退款", async () => {
    const { charge, release, billing } = billingOf();
    const probe = vi.fn(async () => true);

    await expect(
      withBillingCompensation(
        billing,
        async (jobBilling) => {
          await jobBilling!.charge(501);
          throw new Error("commit ack lost");
        },
        probe,
      ),
    ).rejects.toThrow("commit ack lost");

    expect(charge).toHaveBeenCalledWith(501);
    expect(probe).toHaveBeenCalledWith(501);
    expect(release).not.toHaveBeenCalled();
  });

  it("任务未落库 → 退款一次并上抛", async () => {
    const { release, billing } = billingOf();
    const probe = vi.fn(async () => false);

    await expect(
      withBillingCompensation(
        billing,
        async (jobBilling) => {
          await jobBilling!.charge(502);
          throw new Error("rollback");
        },
        probe,
      ),
    ).rejects.toThrow("rollback");

    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(502, "rollback");
  });

  it("扣费本身失败 → 没有持有任务，不退款", async () => {
    const charge = vi.fn(async () => {
      throw new Error("INSUFFICIENT_CREDITS");
    });
    const release = vi.fn(async () => {});
    const probe = vi.fn(async () => false);

    await expect(
      withBillingCompensation(
        { charge, release },
        async (jobBilling) => {
          await jobBilling!.charge(503);
        },
        probe,
      ),
    ).rejects.toThrow("INSUFFICIENT_CREDITS");

    expect(release).not.toHaveBeenCalled();
  });

  it("探测连续失败 → 不冒然退款", async () => {
    const { release, billing } = billingOf();
    const probe = vi.fn(async () => {
      throw new Error("db down");
    });

    await expect(
      withBillingCompensation(
        billing,
        async (jobBilling) => {
          await jobBilling!.charge(504);
          throw new Error("commit unknown");
        },
        probe,
      ),
    ).rejects.toThrow("commit unknown");

    expect(probe).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
  });
});

describe("releaseUnlessJobCommitted", () => {
  it("任务存在 → 跳过释放", async () => {
    const release = vi.fn(async () => {});
    await releaseUnlessJobCommitted({
      release,
      jobId: 601,
      probe: async () => true,
      reason: "x",
    });
    expect(release).not.toHaveBeenCalled();
  });

  it("未提供探测 → 保持旧行为直接释放", async () => {
    const release = vi.fn(async () => {});
    await releaseUnlessJobCommitted({
      release,
      jobId: 602,
      reason: "legacy",
    });
    expect(release).toHaveBeenCalledWith(602, "legacy");
  });
});

describe("jobExistenceProbe", () => {
  it("把非空查询结果视为已落库", async () => {
    const found = jobExistenceProbe({
      generation_jobs: { findUnique: vi.fn(async () => ({ id: 1n })) },
    });
    const missing = jobExistenceProbe({
      generation_jobs: { findUnique: vi.fn(async () => null) },
    });
    const empty = jobExistenceProbe({
      generation_jobs: { findUnique: vi.fn(async () => undefined) },
    });

    expect(await found(1)).toBe(true);
    expect(await missing(1)).toBe(false);
    expect(await empty(1)).toBe(false);
  });
});
