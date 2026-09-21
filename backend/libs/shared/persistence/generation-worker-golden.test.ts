import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkerRepo } from "./generation-worker-repo.js";

// IKENSZ：generation-worker 持久化层金标（golden / characterization）测试。
// 目的：把当前 TS 行为钉死，供 Java 移植侧以同一 case table 对账。
// 约定：每条 it 注释引用 docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md 的章节（§3.x）。
// 行为与契约文档不符时，测试仍钉当前行为，附 `// 契约冲突:` 注释并在报告列出。

const FROZEN_NOW = new Date("2026-09-10T12:00:00.000Z");
// IMAGE_JOB_LEASE_SECONDS 默认 120s（internals.ts:118-121）。
const LEASE_SECONDS = 120;

/** 候选行工厂（图片 queued）。字段与 findFirst 返回对齐。 */
function imageQueuedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 300n,
    project_id: 55n,
    user_id: 9n,
    type: "image",
    status: "queued",
    input: { prompt: "一只猫", model_id: "m", provider_credential: "sealed" },
    expected_output_count: 1,
    retry_count: 0,
    cancel_requested_at: null,
    fencing_token: 0n,
    ...overrides,
  };
}

/** 候选行工厂（视频 queued）。 */
function videoQueuedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 300n,
    project_id: 55n,
    user_id: 9n,
    type: "video",
    status: "queued",
    input: { provider_credential: "sealed-token" },
    provider_task_id: null,
    cancel_requested_at: null,
    retry_of_job_id: null,
    expected_output_count: 1,
    poll_count: 0,
    progress: 0,
    fencing_token: 0n,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// §3.1：claim 候选 findFirst 完整谓词。
describe("§3.1 claim 候选 findFirst 谓词", () => {
  it("图片 claimNextJob：source IN 白名单 / is_delete=false / next_action_at<=now", async () => {
    const findFirst = vi.fn().mockResolvedValue(imageQueuedRow());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await repo.claimNextJob("worker-1");

    const where = findFirst.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({
      status: "queued",
      is_delete: false,
      source: { in: ["bottom_dock", "plan_apply", "storyboard_preview"] },
      next_action_at: { lte: expect.any(Date) },
    });
  });

  it("视频 claimNextVideoJob：source IN 白名单 / is_delete=false / next_action_at<=now，并含孤儿 OR", async () => {
    const findFirst = vi.fn().mockResolvedValue(videoQueuedRow());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    // cost_reservations.findFirst 被 loadReservationFen 调用；mock 兜底 null。
    const prisma = {
      generation_jobs: { findFirst, updateMany },
      cost_reservations: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never;
    const repo = createWorkerRepo(prisma);

    await repo.claimNextVideoJob("worker-1");

    const where = findFirst.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({
      type: "video",
      source: { in: ["bottom_dock", "plan_apply", "plan", "scene_card"] },
      is_delete: false,
      next_action_at: { lte: expect.any(Date) },
    });
    // OR 包含 queued 与 processing+孤儿两分支。
    expect(where).toHaveProperty("OR");
    const or = where.OR as Array<Record<string, unknown>>;
    expect(or).toContainEqual(expect.objectContaining({ status: "queued" }));
    expect(or).toContainEqual(
      expect.objectContaining({
        status: "processing",
        OR: expect.arrayContaining([
          { lease_expires_at: null },
          expect.objectContaining({ lease_expires_at: expect.any(Object) }),
        ]),
      }),
    );
  });
});

// §3.1：CAS SET 完整断言。
describe("§3.1 claim CAS SET 完整字段", () => {
  it("claimNextJob CAS SET：lease_expires_at≈now+120s / last_polled_at=now / fencing+1 / version+1", async () => {
    const findFirst = vi.fn().mockResolvedValue(imageQueuedRow());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await repo.claimNextJob("worker-1");

    const expectedLease = new Date(FROZEN_NOW.getTime() + LEASE_SECONDS * 1000);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 300n,
          status: "queued",
          fencing_token: 0n,
        }),
        data: {
          status: "processing",
          lease_owner: "worker-1",
          lease_expires_at: expectedLease,
          last_polled_at: FROZEN_NOW,
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      }),
    );
  });
});

// §3.1：claimJobById CAS where 含 user_id。
describe("§3.1 claimJobById 精确路径 user_id 守卫", () => {
  it("findFirst 与 CAS updateMany 的 where 都含 user_id", async () => {
    const findFirst = vi.fn().mockResolvedValue(imageQueuedRow());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await repo.claimJobById("300", "9", "worker-1");

    const findWhere = findFirst.mock.calls[0]![0].where as Record<string, unknown>;
    expect(findWhere).toMatchObject({ id: 300n, user_id: 9n, status: "queued" });
    const casWhere = updateMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(casWhere).toMatchObject({
      id: 300n,
      status: "queued",
      fencing_token: 0n,
      user_id: 9n,
    });
  });
});

// §3.1：孤儿接管——by-id 变体接受 processing + lease_expires_at null 或 < now。
describe("§3.1 孤儿接管候选", () => {
  it("claimVideoJobById：processing + lease_expires_at=null 的候选可被领取", async () => {
    const orphanRow = videoQueuedRow({
      status: "processing",
      lease_expires_at: null,
      fencing_token: 4n,
    });
    const findFirst = vi.fn().mockResolvedValue(orphanRow);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      generation_jobs: { findFirst, updateMany },
      cost_reservations: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never;
    const repo = createWorkerRepo(prisma);

    const claimed = await repo.claimVideoJobById("300", "worker-2");
    expect(claimed).toMatchObject({ id: "300", fencingToken: 5 });
    // CAS 用候选当前 status（processing），不强制 queued。
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 300n,
          status: "processing",
          fencing_token: 4n,
        }),
      }),
    );
  });

  it("claimImageJobById：processing + 过期租约的候选可被接管", async () => {
    const staleLease = new Date(FROZEN_NOW.getTime() - 1000);
    const orphanRow = imageQueuedRow({
      status: "processing",
      lease_expires_at: staleLease,
      fencing_token: 2n,
    });
    const findFirst = vi.fn().mockResolvedValue(orphanRow);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    const claimed = await repo.claimImageJobById("300", "worker-2");
    expect(claimed).toMatchObject({ id: "300", fencingToken: 3 });
    // findFirst where 的 OR 包含 processing 分支（孤儿接管）。
    const findWhere = findFirst.mock.calls[0]![0].where as Record<string, unknown>;
    const or = findWhere.OR as Array<Record<string, unknown>>;
    expect(or).toContainEqual(
      expect.objectContaining({
        status: "processing",
        OR: expect.arrayContaining([
          { lease_expires_at: null },
          expect.objectContaining({ lease_expires_at: expect.any(Object) }),
        ]),
      }),
    );
  });
});

// §3.1：updateMany 异常兜底 → .catch → claim 返回 null。
describe("§3.1 updateMany reject 兜底", () => {
  it("claimNextJob 中 updateMany reject 时返回 null（不抛）", async () => {
    const findFirst = vi.fn().mockResolvedValue(imageQueuedRow());
    const updateMany = vi.fn().mockRejectedValue(new Error("db down"));
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    // 源码 claim-ops.ts:88 `.catch(() => ({count:0}))`——reject 被吞，返回 null。
    await expect(repo.claimNextJob("worker-1")).resolves.toBeNull();
  });
});

// §3.1 / §3.2：markProviderSubmitted guard-fail。
describe("§3.2 markProviderSubmitted", () => {
  it("stale fencing_token → count=0 → 返回 false（guard fail 静默）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);

    await expect(
      repo.markProviderSubmitted({
        jobId: "300",
        workerId: "stale",
        fencingToken: 4,
        providerTaskId: "upstream-1",
      }),
    ).resolves.toBe(false);
  });
});

// §3.2：rescheduleProviderPoll 全套。
describe("§3.2 rescheduleProviderPoll", () => {
  it("happy：progress 钳制 0–99 / poll_count+1 / 释放租约 / next_action_at≈now+5s", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);

    const result = await repo.rescheduleProviderPoll({
      jobId: "300",
      workerId: "worker-1",
      fencingToken: 5,
      progress: 42,
    });
    expect(result).toBe(true);

    const expectedNext = new Date(FROZEN_NOW.getTime() + 5_000);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 300n,
        status: "processing",
        lease_owner: "worker-1",
        fencing_token: 5n,
      },
      data: {
        progress: 42,
        poll_count: { increment: 1 },
        next_poll_at: expectedNext,
        next_action_at: expectedNext,
        last_polled_at: FROZEN_NOW,
        lease_owner: null,
        lease_expires_at: null,
        version: { increment: 1 },
      },
    });
  });

  it("progress 钳制：>99 截为 99，<0 截为 0", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);

    await repo.rescheduleProviderPoll({
      jobId: "300",
      workerId: "worker-1",
      fencingToken: 5,
      progress: 150,
    });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ progress: 99 }),
      }),
    );

    await repo.rescheduleProviderPoll({
      jobId: "300",
      workerId: "worker-1",
      fencingToken: 5,
      progress: -5,
    });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ progress: 0 }),
      }),
    );
  });

  it("guard-fail（stale token）→ count=0 → 返回 false", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);

    await expect(
      repo.rescheduleProviderPoll({
        jobId: "300",
        workerId: "stale",
        fencingToken: 4,
        progress: 50,
      }),
    ).resolves.toBe(false);
  });
});

// §3.3：cancelVideoBeforeDispatch。
describe("§3.3 cancelVideoBeforeDispatch", () => {
  it("stale fencing_token → count=0 → 返回 false", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const releaseReservations = vi.fn();
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        generation_jobs: { updateMany },
        cost_reservations: { updateMany: releaseReservations },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await expect(
      repo.cancelVideoBeforeDispatch({
        jobId: "300",
        workerId: "stale",
        fencingToken: 4,
      }),
    ).resolves.toBe(false);
    // guard fail：预留释放不执行。
    expect(releaseReservations).not.toHaveBeenCalled();
  });

  it("provider_task_id 非空 → CAS where provider_task_id:null 不命中 → 返回 false", async () => {
    // 源码 video-ops.ts:309-327：where 硬编码 provider_task_id:null。
    // 已提交上游的 job 在 DB 上 provider_task_id 非空，CAS 不命中，count=0。
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const releaseReservations = vi.fn();
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        generation_jobs: { updateMany },
        cost_reservations: { updateMany: releaseReservations },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await expect(
      repo.cancelVideoBeforeDispatch({
        jobId: "300",
        workerId: "worker-1",
        fencingToken: 5,
      }),
    ).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provider_task_id: null }),
      }),
    );
    expect(releaseReservations).not.toHaveBeenCalled();
  });
});

// §3.1 / §3.2：requeueImageJobForRetry。
describe("§3.1 requeueImageJobForRetry", () => {
  it("count=0（非 processing 态）→ 返回 false", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);

    await expect(
      repo.requeueImageJobForRetry("300", new Date()),
    ).resolves.toBe(false);
  });

  it("happy：data 完整断言——next_action_at 入参透传 / lease 全清 / retry+1 / fencing+1 / version+1", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);
    const nextAt = new Date(FROZEN_NOW.getTime() + 30_000);

    await expect(
      repo.requeueImageJobForRetry("300", nextAt),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 300n, status: "processing" },
        data: {
          status: "queued",
          lease_owner: null,
          lease_expires_at: null,
          next_action_at: nextAt,
          retry_count: { increment: 1 },
          fencing_token: { increment: 1 },
          version: { increment: 1 },
        },
      }),
    );
  });

  it("updateMany reject 兜底 → 返回 false", async () => {
    const updateMany = vi.fn().mockRejectedValue(new Error("db down"));
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);

    // 源码 claim-ops.ts:577 `.catch(() => ({count:0}))`。
    await expect(
      repo.requeueImageJobForRetry("300", new Date()),
    ).resolves.toBe(false);
  });
});

// §3.3：completeJob CAS data 完整断言。
describe("§3.3 completeJob CAS data 完整字段", () => {
  it("happy：progress=100 / next_action_at=null / lease_owner=null / lease_expires_at=null / version+1", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      id: 300n,
      project_id: 55n,
      type: "image",
      source: "api",
      status: "succeeded",
      progress: 100,
      version: 2,
    });
    const eventRow = {
      event_id: "evt_g",
      cursor: 1n,
      project_id: 55n,
      aggregate_type: "asset",
      aggregate_id: "901",
      aggregate_version: 1,
      correlation_id: "job_300",
      causation_id: null,
      occurred_at: FROZEN_NOW,
      payload: null,
    };
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        generation_jobs: { updateMany, findUnique },
        generation_output_slots: { findMany: vi.fn().mockResolvedValue([]) },
        project_events: { create: vi.fn().mockResolvedValue(eventRow) },
        storyboard_previews: { findFirst: vi.fn().mockResolvedValue(null) },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await expect(
      repo.completeJob({
        jobId: "300",
        assetIds: ["901"],
        workerId: "worker-1",
        fencingToken: 5,
      }),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 300n,
          status: "processing",
          lease_owner: "worker-1",
          fencing_token: 5n,
        },
        data: {
          status: "succeeded",
          progress: 100,
          output_asset_ids: [901],
          next_action_at: null,
          lease_owner: null,
          lease_expires_at: null,
          version: { increment: 1 },
        },
      }),
    );
  });
});

// §3.2：updateMediaExtractProgress 钳制与续租。
describe("§3.2 updateMediaExtractProgress", () => {
  it("progress 钳制：150→99，-5→0", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);

    await repo.updateMediaExtractProgress({
      jobId: "400",
      workerId: "worker-1",
      fencingToken: 2,
      progress: 150,
    });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ progress: 99 }),
      }),
    );

    await repo.updateMediaExtractProgress({
      jobId: "400",
      workerId: "worker-1",
      fencingToken: 2,
      progress: -5,
    });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ progress: 0 }),
      }),
    );
  });

  it("续租：lease_expires_at≈now+120s 写入 data", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);

    await repo.updateMediaExtractProgress({
      jobId: "400",
      workerId: "worker-1",
      fencingToken: 2,
      progress: 50,
    });

    const expectedLease = new Date(FROZEN_NOW.getTime() + LEASE_SECONDS * 1000);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 400n,
        status: "processing",
        lease_owner: "worker-1",
        fencing_token: 2n,
      },
      data: {
        progress: 50,
        last_polled_at: FROZEN_NOW,
        lease_expires_at: expectedLease,
        version: { increment: 1 },
      },
    });
  });
});

// §1：消费者毒丸 / ack 语义。
// 现有消费者类（rocketmq-image.consumer.ts）强依赖 Nest DI（@Injectable + 构造注入 ImageWorkerService
// + SimpleConsumer 实例），剥离 DI 做纯函数级测试的成本高（需重写 loop/handleMessage 入参），
// 且本仓已有 rocketmq-image.consumer.test.ts 覆盖 loadImageConcurrency。
// gap-15 跳过：Java 侧 §1 对账以 consumer 源码（rocketmq-*.consumer.ts）为权威，不在本测试文件覆盖。
