import { describe, expect, it, vi } from "vitest";

import { createWorkerRepo } from "./generation-worker-repo.js";

describe("generation video worker repo", () => {
  it("claims only the video job named by the RocketMQ message", async () => {
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

    await expect(
      repo.claimVideoJobById("300", "worker-1"),
    ).resolves.toMatchObject({
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
    const repo = createWorkerRepo({
      $transaction: transaction,
    } as never) as ReturnType<typeof createWorkerRepo> & {
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

  it("persists generated video duration for future reference validation", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createAsset = vi.fn().mockResolvedValue({ id: 901n });
    const update = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        // findUnique 来自 IK50GB-B（视频成功后查 job 追加 project event）；
        // 本测试只验 duration 持久化，project_id: null 跳过 event 分支。
        generation_jobs: {
          updateMany,
          update,
          findUnique: vi.fn().mockResolvedValue({ id: 300n, project_id: null }),
        },
        assets: { create: createAsset },
        cost_reservations: { updateMany: vi.fn() },
        generation_job_logs: { create: vi.fn() },
        // IK67HE/T14：publishVideoResult 现查输出槽做放置；无槽时返回空。
        generation_output_slots: { findFirst: vi.fn().mockResolvedValue(null) },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await expect(
      repo.publishVideoResult({
        jobId: "300",
        projectId: "55",
        userId: "9",
        workerId: "worker-1",
        fencingToken: 5,
        url: "https://bucket.test/result.mp4",
        storageKey: "generated/9/video/result.mp4",
        mime: "video/mp4",
        size: 11,
        width: 1280,
        height: 720,
        duration: 8,
      }),
    ).resolves.toBe(true);
    expect(createAsset).toHaveBeenCalledWith({
      data: expect.objectContaining({ duration: 8 }),
    });
  });

  it("keeps video generation successful when Canvas placement is unavailable", async () => {
    const tx = {
      generation_jobs: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          id: 300n,
          project_id: 55n,
          type: "video",
          source: "scene_card",
          status: "succeeded",
          progress: 100,
          version: 2,
        }),
      },
      assets: {
        create: vi.fn().mockResolvedValue({
          id: 901n,
          type: "video",
          url: "https://bucket.test/result.mp4",
          version: 1,
        }),
      },
      cost_reservations: { updateMany: vi.fn().mockResolvedValue({}) },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
      generation_output_slots: {
        findFirst: vi.fn().mockResolvedValue({
          id: 77n,
          slot_index: 0,
          scene_card_generation_record_id: 88n,
        }),
        findMany: vi
          .fn()
          .mockResolvedValue([{ slot_index: 0, status: "succeeded" }]),
        update: vi.fn().mockResolvedValue({}),
      },
      scene_card_generation_records: {
        findUnique: vi.fn().mockResolvedValue({ scene_card_id: 66n }),
        update: vi.fn().mockResolvedValue({}),
      },
      canvas: {
        findFirst: vi.fn().mockRejectedValue(new Error("canvas unavailable")),
      },
      project_events: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => data,
        ),
      },
    };
    const repo = createWorkerRepo({
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    } as never);

    await expect(
      repo.publishVideoResult({
        jobId: "300",
        projectId: "55",
        userId: "9",
        workerId: "worker-1",
        fencingToken: 5,
        url: "https://bucket.test/result.mp4",
        storageKey: "generated/9/video/result.mp4",
        mime: "video/mp4",
        size: 11,
        width: 1280,
        height: 720,
        duration: 8,
      }),
    ).resolves.toBe(true);
  });

  it("cancels a video before provider dispatch under the active fence", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const releaseReservations = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        generation_jobs: { updateMany },
        cost_reservations: { updateMany: releaseReservations },
      }),
    );
    const repo = createWorkerRepo({
      $transaction: transaction,
    } as never) as ReturnType<typeof createWorkerRepo> & {
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
    // IK7G9X：派发前取消释放预留（reserved → released，实扣 0）。
    expect(releaseReservations).toHaveBeenCalledWith({
      where: { generation_job_id: 300n, status: "reserved" },
      data: { status: "released", actual_amount_fen: 0n },
    });
  });

  it("marks the record successful when a failed logical slot succeeds on retry", async () => {
    const record = { summary_status: "generating" };
    const createEvent = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => data,
    );
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 2n,
          slot_index: 0,
          status: "pending",
          retry_of_slot_id: 1n,
          scene_card_generation_record_id: 88n,
        },
      ])
      .mockResolvedValueOnce([
        { slot_index: 0, status: "failed" },
        { slot_index: 0, status: "succeeded" },
      ]);
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        generation_output_slots: {
          findMany,
          update: vi.fn().mockResolvedValue({}),
        },
        generation_jobs: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 301n,
            project_id: 55n,
            type: "image",
            source: "api",
            status: "succeeded",
            progress: 100,
            version: 2,
          }),
        },
        canvas: {
          findFirst: vi.fn().mockResolvedValue({
            id: 1n,
            nodes_json: [{ id: "image:301:0" }],
          }),
        },
        project_events: {
          create: createEvent,
        },
        scene_card_generation_records: {
          update: vi.fn(
            async ({ data }: { data: { summary_status: string } }) => {
              record.summary_status = data.summary_status;
              return { id: 88n, project_id: 55n, version: 2, ...record };
            },
          ),
        },
        storyboard_previews: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await repo.completeJob({jobId: "301", assetIds: ["901"], workerId: "w", fencingToken: 1});

    expect(record.summary_status).toBe("success");
    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "generation_job.output_attached",
        payload: expect.objectContaining({
          slot_id: "2",
          slot_index: 0,
          status: "succeeded",
          asset_id: "901",
          retry_of_slot_id: "1",
          initial_placement_status: "pending",
        }),
      }),
    });
    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "scene_card_generation_record.summary_changed",
        payload: {
          record_id: "88",
          summary_status: "success",
        },
      }),
    });
  });

  it("keeps image generation successful when Canvas placement is unavailable", async () => {
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        generation_output_slots: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 2n,
              slot_index: 0,
              status: "pending",
              scene_card_generation_record_id: null,
            },
          ]),
          update: vi.fn().mockResolvedValue({}),
        },
        generation_jobs: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({
            id: 301n,
            project_id: 55n,
            type: "image",
            source: "api",
            status: "succeeded",
            progress: 100,
            version: 2,
          }),
        },
        canvas: {
          findFirst: vi.fn().mockRejectedValue(new Error("canvas unavailable")),
        },
        project_events: {
          create: vi.fn(
            async ({ data }: { data: Record<string, unknown> }) => data,
          ),
        },
        storyboard_previews: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await expect(
      repo.completeJob({jobId: "301", assetIds: ["901"], workerId: "w", fencingToken: 1}),
    ).resolves.toBe(true);
  });

  it("emits output_updated for every failed slot after partial image success", async () => {
    const createEvent = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => data,
    );
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        generation_output_slots: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1n, slot_index: 0, retry_of_slot_id: null },
            { id: 2n, slot_index: 1, retry_of_slot_id: null },
          ]),
          update: vi.fn().mockResolvedValue({}),
        },
        generation_jobs: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue({}),
          findUnique: vi.fn().mockResolvedValue({
            id: 301n,
            project_id: 55n,
            type: "image",
            source: "api",
            status: "partially_succeeded",
            progress: 100,
            version: 2,
          }),
        },
        project_events: { create: createEvent },
        storyboard_previews: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await repo.completeJob({jobId: "301", assetIds: ["901"], workerId: "w", fencingToken: 1});

    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "generation_job.output_updated",
        payload: expect.objectContaining({
          slot_id: "2",
          slot_index: 1,
          status: "failed",
          asset_id: null,
        }),
      }),
    });
  });
});
