import { describe, expect, it, vi } from "vitest";

import { createWorkerRepo } from "./generation-worker-repo.js";

describe("generation video worker repo", () => {
  it("claims only the video job named by the BullMQ message", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 300n,
      project_id: 55n,
      user_id: 9n,
      type: "video",
      status: "queued",
      input: { provider_credential: "sealed-token" },
      provider_task_id: null,
      cancel_requested_at: null,
      fencing_token: 0n,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await expect(repo.claimVideoJobById("300", "worker-1")).resolves.toMatchObject({
      id: "300",
      workerId: "worker-1",
      fencingToken: 1,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 300n, type: "video" }),
      }),
    );
  });

  it("lists due video jobs for low-frequency Redis recovery", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 300n }, { id: 301n }]);
    const repo = createWorkerRepo({ generation_jobs: { findMany } } as never);

    await expect(repo.listDueVideoJobIds(100)).resolves.toEqual(["300", "301"]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        where: expect.objectContaining({
          type: "video",
          next_action_at: expect.any(Object),
        }),
      }),
    );
  });

  it("reclaims an expired processing video job with a new fencing token", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 300n,
      project_id: 55n,
      user_id: 9n,
      type: "video",
      status: "processing",
      input: { provider_credential: "sealed-token" },
      provider_task_id: "upstream-1",
      cancel_requested_at: null,
      expected_output_count: 1,
      fencing_token: 4n,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      generation_jobs: { findFirst, updateMany },
    };
    const repo = createWorkerRepo(prisma as never) as ReturnType<
      typeof createWorkerRepo
    > & {
      claimNextVideoJob?: (workerId: string) => Promise<unknown>;
    };

    expect(repo.claimNextVideoJob).toBeTypeOf("function");
    if (!repo.claimNextVideoJob) return;

    await expect(repo.claimNextVideoJob("worker-2")).resolves.toEqual({
      id: "300",
      projectId: "55",
      userId: "9",
      input: { provider_credential: "sealed-token" },
      providerTaskId: "upstream-1",
      cancelRequested: false,
      workerId: "worker-2",
      fencingToken: 5,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "video",
          OR: expect.arrayContaining([
            expect.objectContaining({ status: "queued" }),
            expect.objectContaining({ status: "processing" }),
          ]),
        }),
      }),
    );
    const claimWhere = findFirst.mock.calls[0]?.[0]?.where as {
      OR?: Array<Record<string, unknown>>;
    };
    expect(claimWhere.OR).toContainEqual(
      expect.objectContaining({
        status: "processing",
        OR: expect.arrayContaining([
          { lease_expires_at: null },
          expect.objectContaining({ lease_expires_at: expect.any(Object) }),
        ]),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 300n, fencing_token: 4n }),
        data: expect.objectContaining({
          lease_owner: "worker-2",
          fencing_token: { increment: 1 },
        }),
      }),
    );
  });

  it("persists the upstream task id and releases the short lease", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { generation_jobs: { updateMany } };
    const repo = createWorkerRepo(prisma as never) as ReturnType<
      typeof createWorkerRepo
    > & {
      markVideoSubmitted?: (input: Record<string, unknown>) => Promise<boolean>;
    };

    expect(repo.markVideoSubmitted).toBeTypeOf("function");
    if (!repo.markVideoSubmitted) return;

    await expect(
      repo.markVideoSubmitted({
        jobId: "300",
        workerId: "worker-1",
        fencingToken: 5,
        providerTaskId: "upstream-1",
      }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 300n,
        status: "processing",
        lease_owner: "worker-1",
        fencing_token: 5n,
      },
      data: expect.objectContaining({
        provider_task_id: "upstream-1",
        lease_owner: null,
        lease_expires_at: null,
      }),
    });
  });

  it("rejects a stale worker before it can create an Asset", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const createAsset = vi.fn();
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        generation_jobs: { updateMany },
        assets: { create: createAsset },
        cost_reservations: { updateMany: vi.fn() },
        generation_job_logs: { create: vi.fn() },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never) as
      ReturnType<typeof createWorkerRepo> & {
        publishVideoResult?: (input: Record<string, unknown>) => Promise<boolean>;
      };

    expect(repo.publishVideoResult).toBeTypeOf("function");
    if (!repo.publishVideoResult) return;

    await expect(
      repo.publishVideoResult({
        jobId: "300",
        projectId: "55",
        userId: "9",
        workerId: "stale-worker",
        fencingToken: 4,
        url: "https://bucket.test/result.mp4",
        storageKey: "generated/9/video/result.mp4",
        mime: "video/mp4",
        size: 11,
        width: 1280,
        height: 720,
      }),
    ).resolves.toBe(false);
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("cancels a video before provider dispatch under the active fence", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({ generation_jobs: { updateMany } } as never) as
      ReturnType<typeof createWorkerRepo> & {
        cancelVideoBeforeDispatch?: (
          input: Record<string, unknown>,
        ) => Promise<boolean>;
      };

    expect(repo.cancelVideoBeforeDispatch).toBeTypeOf("function");
    if (!repo.cancelVideoBeforeDispatch) return;

    await expect(
      repo.cancelVideoBeforeDispatch({
        jobId: "300",
        workerId: "worker-1",
        fencingToken: 5,
      }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 300n,
        status: "processing",
        provider_task_id: null,
        lease_owner: "worker-1",
        fencing_token: 5n,
      },
      data: expect.objectContaining({
        status: "cancelled",
        lease_owner: null,
        lease_expires_at: null,
      }),
    });
  });
});
