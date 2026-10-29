import { describe, expect, it, vi } from "vitest";

import { createCanvasRepo } from "./canvas-repo.js";

describe("canvas optimistic save", () => {
  it("首次保存规范混合结果卡记为 present，移除记 removed，撤销重加回 present", async () => {
    let version = 3;
    let cardState = "pending";
    const upsertExtra = vi.fn(async ({ where, create }: {
      where: { generation_job_id_extra_key: { generation_job_id: bigint } };
      create: { extra_key: string; value_text: string };
    }) => {
      if (where.generation_job_id_extra_key.generation_job_id === 73n && create.extra_key === "canvas_card_state") {
        cardState = create.value_text;
      }
      return {};
    });
    const tx = {
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      canvas: {
        updateMany: vi.fn(async ({ where }: { where: { version: number } }) => {
          if (where.version !== version) return { count: 0 };
          version += 1;
          return { count: 1 };
        }),
        findFirst: vi.fn(async () => ({ id: 1n, project_id: 55n, version,
          viewport_json: null, nodes_json: [], edges_json: null })),
      },
      generation_output_slots: { updateMany: vi.fn() },
      generation_jobs: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.project_id !== 55n || where.user_id !== 9n || where.type !== "audio_mix" || where.is_delete !== false) return [];
          const excluded = (where.id as { notIn?: bigint[] } | undefined)?.notIn ?? [];
          return excluded.includes(73n) ? [] : [{ id: 73n }];
        }),
      },
      generation_job_extras: {
        upsert: upsertExtra,
        findMany: vi.fn(async ({ where }: { where: { generation_job_id: bigint | { in: bigint[] } } }) => {
          const ids = typeof where.generation_job_id === "object" && "in" in where.generation_job_id
            ? where.generation_job_id.in
            : [where.generation_job_id];
          return ids.includes(73n)
            ? [{ generation_job_id: 73n, extra_key: "canvas_card_state", value_type: "string", value_text: cardState }]
            : [];
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const repo = createCanvasRepo({ $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as never);
    const card = JSON.stringify([{ id: "audio-mix-73", type: "mediaNode", data: { jobId: "73" } }]);
    await repo.saveIfVersion("55", 3, null, card, null, { ownerId: "9", items: [] });
    expect(cardState).toBe("present");
    await repo.saveIfVersion("55", 4, null, "[]", null, { ownerId: "9", items: [] });
    expect(cardState).toBe("removed");
    await repo.saveIfVersion("55", 5, null, card, null, { ownerId: "9", items: [] });
    expect(cardState).toBe("present");
  });

  it("IKJCOE：卡号不在本人本项目作用域内 → 一个扩展位都不写（跨用户写防护）", async () => {
    const upsertExtra = vi.fn().mockResolvedValue({});
    const tx = {
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      canvas: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findFirst: vi.fn(async () => ({
          id: 1n, project_id: 55n, version: 3,
          viewport_json: null, nodes_json: [], edges_json: null,
        })),
      },
      generation_output_slots: { updateMany: vi.fn() },
      generation_jobs: {
        findMany: vi.fn(async ({ where }: { where: { id?: { in?: bigint[] } } }) =>
          (where.id?.in ?? []).includes(73n) ? [{ id: 73n }] : [],
        ),
      },
      generation_job_extras: {
        upsert: upsertExtra,
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const repo = createCanvasRepo({
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    } as never);
    const foreignCard = JSON.stringify([
      { id: "audio-mix-999", type: "mediaNode", data: { jobId: "999" } },
    ]);
    await repo.saveIfVersion("55", 3, null, foreignCard, null, { ownerId: "9", items: [] });

    expect(tx.generation_jobs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project_id: 55n,
          user_id: 9n,
          type: "audio_mix",
          is_delete: false,
          id: { in: [999n] },
        }),
      }),
    );
    expect(upsertExtra).not.toHaveBeenCalled();
  });

  it("无混音结果卡且无待移除状态时不执行混音任务更新", async () => {
    const jobScan = vi.fn().mockResolvedValue([]);
    const jobUpsert = vi.fn();
    const tx = {
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      canvas: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({ id: 1n, project_id: 55n, version: 4, viewport_json: null, nodes_json: [], edges_json: null }),
      },
      generation_jobs: { findMany: jobScan },
      generation_job_extras: {
        upsert: jobUpsert,
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      generation_output_slots: { updateMany: vi.fn() },
    };
    const repo = createCanvasRepo({ $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as never);
    await repo.saveIfVersion("55", 3, null, "[]", null, { ownerId: "9", items: [] });
    expect(jobScan).toHaveBeenCalledOnce();
    expect(jobUpsert).not.toHaveBeenCalled();
  });

  it("Canvas 版本冲突及非规范结果卡不改变混合卡状态", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const jobUpsert = vi.fn();
    const tx = {
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      canvas: { updateMany },
      generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
      generation_job_extras: {
        upsert: jobUpsert,
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const repo = createCanvasRepo({ $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as never);
    const forged = JSON.stringify([{ id: "other-73", type: "mediaNode", data: { jobId: "73" } }]);
    await expect(repo.saveIfVersion("55", 3, null, forged, null, { ownerId: "9", items: [] })).resolves.toBeNull();
    expect(jobUpsert).not.toHaveBeenCalled();
  });

  it("IKIZQH：删画布卡（保存无卡节点集）不删任务或资产——任务只改 canvas_card_state 标记，assets 无写调用", async () => {
    const jobScan = vi.fn().mockResolvedValue([{ id: 73n }]);
    const jobUpsert = vi.fn().mockResolvedValue({});
    const assetsWrite = vi.fn();
    const tx = {
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      canvas: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({ id: 1n, project_id: 55n, version: 4, viewport_json: null, nodes_json: [], edges_json: null }),
      },
      generation_jobs: { findMany: jobScan },
      generation_job_extras: {
        upsert: jobUpsert,
        findMany: vi.fn().mockResolvedValue([
          { generation_job_id: 73n, extra_key: "canvas_card_state", value_type: "string", value_text: "present" },
        ]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      generation_output_slots: { updateMany: vi.fn() },
      assets: { updateMany: assetsWrite, update: assetsWrite, deleteMany: assetsWrite },
      project_asset: { upsert: vi.fn() },
    };
    const repo = createCanvasRepo({ $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as never);

    await repo.saveIfVersion("55", 3, null, "[]", null, { ownerId: "9", items: [] });

    expect(jobUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = jobUpsert.mock.calls[0]![0];
    expect(upsertArg.create).toEqual({
      generation_job_id: 73n,
      extra_key: "canvas_card_state",
      value_type: "string",
      value_text: "removed",
    });
    expect(upsertArg.create).not.toHaveProperty("is_delete");
    expect(assetsWrite).not.toHaveBeenCalled();
  });

  it("returns a conflict without overwriting newer canvas data", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn();
    const tx = {
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      canvas: { updateMany, upsert, findFirst: vi.fn() },
      generation_output_slots: { updateMany: vi.fn() },
    };
    const repo = createCanvasRepo({
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    } as never) as ReturnType<typeof createCanvasRepo> & {
      saveIfVersion?: (
        projectId: string,
        expectedVersion: number,
        viewport: string | null,
        nodes: string | null,
        edges: string | null,
      ) => Promise<unknown>;
    };

    expect(repo.saveIfVersion).toBeTypeOf("function");
    if (!repo.saveIfVersion) return;

    await expect(
      repo.saveIfVersion("55", 3, null, JSON.stringify([{ id: "stale" }]), null),
    ).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith({
      where: { project_id: 55n, version: 3 },
      data: {
        viewport_json: null,
        nodes_json: [{ id: "stale" }],
        edges_json: null,
        version: { increment: 1 },
      },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("marks deterministic output slots placed in the same Canvas transaction", async () => {
    const markPlaced = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      canvas: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({
          id: 1n,
          project_id: 55n,
          version: 4,
          viewport_json: null,
          nodes_json: [{ id: "generation-output:501" }],
          edges_json: null,
        }),
      },
      generation_output_slots: { updateMany: markPlaced },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const repo = createCanvasRepo(prisma as never);

    await repo.saveIfVersion(
      "55",
      3,
      null,
      JSON.stringify([{ id: "generation-output:501" }]),
      null,
    );

    expect(markPlaced).toHaveBeenCalledWith({
      where: {
        id: { in: [501n] },
        project_id: 55n,
        status: "succeeded",
        initial_placement_status: "pending",
      },
      data: { initial_placement_status: "placed" },
    });
  });
});

describe("canvas edges persistence (IKDLQF)", () => {
  it("persists parsed edges in the same conditional write and returns them serialized", async () => {
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      canvas: {
        updateMany,
        findFirst: vi.fn().mockResolvedValue({
          id: 1n,
          project_id: 55n,
          version: 4,
          viewport_json: null,
          nodes_json: [{ id: "text-1" }, { id: "media-1" }],
          edges_json: edges,
        }),
      },
      generation_output_slots: { updateMany: vi.fn() },
    };
    const repo = createCanvasRepo({
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    } as never);

    const view = await repo.saveIfVersion(
      "55",
      3,
      null,
      JSON.stringify([{ id: "text-1" }, { id: "media-1" }]),
      JSON.stringify(edges),
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { project_id: 55n, version: 3 },
      data: {
        viewport_json: null,
        nodes_json: [{ id: "text-1" }, { id: "media-1" }],
        edges_json: edges,
        version: { increment: 1 },
      },
    });
    expect(view?.edges).toBe(JSON.stringify(edges));
  });

  it("maps edges_json on reads: string when present, null when absent or no row", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 1n,
        project_id: 55n,
        version: 2,
        viewport_json: null,
        nodes_json: [],
        edges_json: [{ id: "e1", source: "a", target: "b" }],
      })
      .mockResolvedValueOnce({
        id: 1n,
        project_id: 55n,
        version: 2,
        viewport_json: null,
        nodes_json: [],
        edges_json: null,
      })
      .mockResolvedValueOnce(null);
    const repo = createCanvasRepo({
      canvas: { findFirst },
    } as never);

    const withEdges = await repo.getByProject("55");
    expect(withEdges.edges).toBe(
      JSON.stringify([{ id: "e1", source: "a", target: "b" }]),
    );
    const withoutEdges = await repo.getByProject("55");
    expect(withoutEdges.edges).toBeNull();
    const missing = await repo.getByProject("55");
    expect(missing.edges).toBeNull();
  });
});
