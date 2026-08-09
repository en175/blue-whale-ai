import { describe, expect, it, vi } from "vitest";

import { createWorkerRepo } from "./generation-worker-repo.js";

// IK7GRP：图片 GenerationJob 写入路径 lease/fence 守卫验证。
// 覆盖：completeJob / failJob / createAsset / settleReservation 守卫通过（当前合法 worker）、
// stale worker（旧 fencing_token / 失效 lease）的 4 个写方法全被拒且无副作用、
// succeeded 任务不被迟到的 failJob 翻为 failed、stale worker 建素材被拒。
// 对齐视频 publishVideoResult / failVideoJob 的守卫-后写模式。

const LEASE = {workerId: "worker-1", fencingToken: 5};

/** appendProjectEvent 的 toView 需要完整 row；守卫通过路径的 event create mock 返回此对象。 */
const EVENT_ROW = {
  event_id: "evt_x",
  cursor: 1n,
  project_id: 55n,
  aggregate_type: "asset",
  aggregate_id: "901",
  aggregate_version: 1,
  correlation_id: "job_300",
  causation_id: null,
  occurred_at: new Date(),
  payload: null,
};

describe("image write path fence（IK7GRP）", () => {
  describe("completeJob 守卫", () => {
    it("当前合法 worker 守卫通过 → 返回 true", async () => {
      const updateMany = vi.fn().mockResolvedValue({count: 1});
      const findUnique = vi.fn().mockResolvedValue({
        id: 300n,
        project_id: 55n,
        type: "image",
        source: "api",
        status: "succeeded",
        progress: 100,
        version: 2,
      });
      const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {updateMany, findUnique},
          generation_output_slots: {
            findMany: vi.fn().mockResolvedValue([]),
          },
          project_events: {create: vi.fn().mockResolvedValue(EVENT_ROW)},
          storyboard_previews: {findFirst: vi.fn().mockResolvedValue(null)},
        }),
      );
      const repo = createWorkerRepo({$transaction: transaction} as never);

      await expect(
        repo.completeJob({jobId: "300", assetIds: ["901"], ...LEASE}),
      ).resolves.toBe(true);
      // 守卫 CAS 条件含 lease_owner + fencing_token。
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 300n,
            status: "processing",
            lease_owner: "worker-1",
            fencing_token: 5n,
          },
        }),
      );
    });

    it("stale worker（旧 fencing_token）守卫拒绝 → 返回 false，无后续副作用", async () => {
      const updateMany = vi.fn().mockResolvedValue({count: 0});
      const slotsFindMany = vi.fn();
      const findUnique = vi.fn();
      const eventCreate = vi.fn();
      const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {updateMany, findUnique},
          generation_output_slots: {findMany: slotsFindMany, update: vi.fn()},
          project_events: {create: eventCreate},
          storyboard_previews: {findFirst: vi.fn().mockResolvedValue(null)},
        }),
      );
      const repo = createWorkerRepo({$transaction: transaction} as never);

      await expect(
        repo.completeJob({jobId: "300", assetIds: ["901"], workerId: "stale", fencingToken: 4}),
      ).resolves.toBe(false);
      // 守卫失败：槽位、事件、汇总回写均不执行。
      expect(slotsFindMany).not.toHaveBeenCalled();
      expect(findUnique).not.toHaveBeenCalled();
      expect(eventCreate).not.toHaveBeenCalled();
    });
  });

  describe("failJob 守卫", () => {
    it("当前合法 worker 守卫通过 → 返回 true", async () => {
      const updateMany = vi.fn().mockResolvedValue({count: 1});
      const findUnique = vi.fn().mockResolvedValue({
        id: 300n,
        project_id: 55n,
        type: "image",
        source: "api",
        status: "failed",
        progress: 0,
        version: 2,
      });
      const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {updateMany, findUnique},
          generation_output_slots: {
            findMany: vi.fn().mockResolvedValue([]),
          },
          generation_job_logs: {create: vi.fn()},
          project_events: {create: vi.fn().mockResolvedValue(EVENT_ROW)},
          storyboard_previews: {findFirst: vi.fn().mockResolvedValue(null)},
        }),
      );
      const repo = createWorkerRepo({$transaction: transaction} as never);

      await expect(
        repo.failJob({jobId: "300", errorCode: "provider_failed", errorMessage: "x", ...LEASE}),
      ).resolves.toBe(true);
    });

    it("succeeded 任务不被迟到的 failJob 翻为 failed（守卫拒绝 processing→failed 的 CAS）", async () => {
      // job 已是 succeeded（被新 worker 完成完成），旧 worker 迟到 failJob：
      // 守卫 where status="processing" 不命中 → count=0 → 返回 false，job 保持 succeeded。
      const updateMany = vi.fn().mockResolvedValue({count: 0});
      const slotsFindMany = vi.fn();
      const logCreate = vi.fn();
      const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {updateMany, findUnique: vi.fn()},
          generation_output_slots: {findMany: slotsFindMany, update: vi.fn()},
          generation_job_logs: {create: logCreate},
          project_events: {create: vi.fn()},
          storyboard_previews: {findFirst: vi.fn().mockResolvedValue(null)},
        }),
      );
      const repo = createWorkerRepo({$transaction: transaction} as never);

      await expect(
        repo.failJob({jobId: "300", errorCode: "provider_failed", errorMessage: "迟到", workerId: "stale", fencingToken: 4}),
      ).resolves.toBe(false);
      expect(slotsFindMany).not.toHaveBeenCalled();
      expect(logCreate).not.toHaveBeenCalled();
    });
  });

  describe("createAsset 守卫", () => {
    it("当前合法 worker 守卫通过 → 建素材并返回 assetId", async () => {
      const jobsUpdateMany = vi.fn().mockResolvedValue({count: 1});
      const assetsCreate = vi.fn().mockResolvedValue({
        id: 901n,
        version: 1,
        type: "image",
        url: "https://x.png",
      });
      const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {updateMany: jobsUpdateMany},
          assets: {create: assetsCreate},
          project_events: {create: vi.fn().mockResolvedValue(EVENT_ROW)},
        }),
      );
      const repo = createWorkerRepo({$transaction: transaction} as never);

      await expect(
        repo.createAsset({
          user_id: "9",
          project_id: "55",
          generation_job_id: "300",
          url: "https://x.png",
          type: "image",
          width: 1,
          height: 1,
          storage_key: null,
          mime: "image/png",
          size: 11,
          ...LEASE,
        }),
      ).resolves.toBe("901");
      // 守卫 CAS：version 自增占位，不改 status。
      expect(jobsUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 300n,
            status: "processing",
            lease_owner: "worker-1",
            fencing_token: 5n,
          },
          data: {version: {increment: 1}},
        }),
      );
    });

    it("stale worker 建素材被拒 → 返回 null，无 assets.create 调用（无孤儿素材）", async () => {
      const jobsUpdateMany = vi.fn().mockResolvedValue({count: 0});
      const assetsCreate = vi.fn();
      const eventCreate = vi.fn();
      const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {updateMany: jobsUpdateMany},
          assets: {create: assetsCreate},
          project_events: {create: eventCreate},
        }),
      );
      const repo = createWorkerRepo({$transaction: transaction} as never);

      await expect(
        repo.createAsset({
          user_id: "9",
          project_id: "55",
          generation_job_id: "300",
          url: "https://x.png",
          type: "image",
          width: 1,
          height: 1,
          storage_key: null,
          mime: "image/png",
          size: 11,
          workerId: "stale",
          fencingToken: 4,
        }),
      ).resolves.toBeNull();
      expect(assetsCreate).not.toHaveBeenCalled();
      expect(eventCreate).not.toHaveBeenCalled();
    });
  });

  describe("settleReservation 守卫", () => {
    it("当前合法 worker 守卫通过 → 结算并返回 true", async () => {
      const jobsUpdateMany = vi.fn().mockResolvedValue({count: 1});
      const costUpdateMany = vi.fn().mockResolvedValue({count: 1});
      const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {updateMany: jobsUpdateMany},
          cost_reservations: {updateMany: costUpdateMany},
        }),
      );
      const repo = createWorkerRepo({$transaction: transaction} as never);

      await expect(
        repo.settleReservation({jobId: "300", ...LEASE}),
      ).resolves.toBe(true);
      // 守卫 CAS：校验终态 + fencing_token 一致（completeJob 已清 lease、定终态）。
      expect(jobsUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 300n,
            status: {in: ["succeeded", "partially_succeeded", "failed"]},
            fencing_token: 5n,
          },
          data: {version: {increment: 1}},
        }),
      );
      expect(costUpdateMany).toHaveBeenCalledWith({
        where: {generation_job_id: 300n, status: "reserved"},
        data: {status: "settled", actual_amount_fen: 0},
      });
    });

    it("stale worker 不能结算新一次尝试的预留 → 返回 false，无 cost_reservations 写入", async () => {
      const jobsUpdateMany = vi.fn().mockResolvedValue({count: 0});
      const costUpdateMany = vi.fn();
      const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {updateMany: jobsUpdateMany},
          cost_reservations: {updateMany: costUpdateMany},
        }),
      );
      const repo = createWorkerRepo({$transaction: transaction} as never);

      await expect(
        repo.settleReservation({jobId: "300", workerId: "stale", fencingToken: 4}),
      ).resolves.toBe(false);
      expect(costUpdateMany).not.toHaveBeenCalled();
    });
  });

  // 验收标准#2：完整端到端顺序场景。
  // 领取（worker-1, token=1）→ 租约过期重放（reset, token→2）→ 新 worker 重领（worker-2, token=3）
  // → worker-2 完成（守卫通过）→ worker-1 迟到的 4 个写方法全部被拒，新结果不被覆盖。
  it("完整顺序：领取→过期重放→新Worker重领完成→旧Worker的4个写方法全被拒", async () => {
    const staleLease = {workerId: "worker-1", fencingToken: 1};
    const freshLease = {workerId: "worker-2", fencingToken: 3};

    // 共享副作用 spy：stale 全拒时都不应被调用。
    const assetsCreate = vi.fn();
    const costUpdateMany = vi.fn();
    const logCreate = vi.fn();

    // stale 仓库：所有守卫 CAS（updateMany）统一 count=0（token=1 已被重放/重领失效）。
    const staleRepo = createWorkerRepo({
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {updateMany: vi.fn().mockResolvedValue({count: 0}), findUnique: vi.fn()},
          generation_output_slots: {findMany: vi.fn(), update: vi.fn()},
          assets: {create: assetsCreate},
          cost_reservations: {updateMany: costUpdateMany},
          generation_job_logs: {create: logCreate},
          project_events: {create: vi.fn().mockResolvedValue(EVENT_ROW)},
          storyboard_previews: {findFirst: vi.fn().mockResolvedValue(null)},
        }),
      ),
    } as never);

    // ① 旧 worker-1 的 completeJob 被拒。
    await expect(
      staleRepo.completeJob({jobId: "300", assetIds: ["401"], ...staleLease}),
    ).resolves.toBe(false);
    // ② 旧 worker-1 的 failJob 被拒（succeeded 不被翻 failed）。
    await expect(
      staleRepo.failJob({jobId: "300", errorCode: "provider_failed", errorMessage: "迟到", ...staleLease}),
    ).resolves.toBe(false);
    // ③ 旧 worker-1 的 createAsset 被拒（无孤儿素材）。
    await expect(
      staleRepo.createAsset({
        user_id: "9", project_id: "55", generation_job_id: "300",
        url: "https://old.png", type: "image", width: 1, height: 1,
        storage_key: null, mime: "image/png", size: 11, ...staleLease,
      }),
    ).resolves.toBeNull();
    // ④ 旧 worker-1 的 settleReservation 被拒（不结算新尝试的预留）。
    await expect(
      staleRepo.settleReservation({jobId: "300", ...staleLease}),
    ).resolves.toBe(false);

    // stale 4 方法守卫全拒：无任何副作用写入。
    expect(assetsCreate).not.toHaveBeenCalled();
    expect(costUpdateMany).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();

    // ⑤ 新 worker-2（token=3，当前合法）的 completeJob 守卫通过，新结果落盘。
    const freshUpdateMany = vi.fn().mockResolvedValue({count: 1});
    const freshRepo = createWorkerRepo({
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({
          generation_jobs: {
            updateMany: freshUpdateMany,
            findUnique: vi.fn().mockResolvedValue({
              id: 300n, project_id: 55n, type: "image", source: "api",
              status: "succeeded", progress: 100, version: 3,
            }),
          },
          generation_output_slots: {findMany: vi.fn().mockResolvedValue([]), update: vi.fn()},
          project_events: {create: vi.fn().mockResolvedValue(EVENT_ROW)},
          storyboard_previews: {findFirst: vi.fn().mockResolvedValue(null)},
        }),
      ),
    } as never);
    await expect(
      freshRepo.completeJob({jobId: "300", assetIds: ["501", "502"], ...freshLease}),
    ).resolves.toBe(true);
    // 守卫 CAS 条件用新 token，新 output_asset_ids 落库（Number 化后）。
    expect(freshUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {id: 300n, status: "processing", lease_owner: "worker-2", fencing_token: 3n},
        data: expect.objectContaining({output_asset_ids: [501, 502]}),
      }),
    );
  });
});
