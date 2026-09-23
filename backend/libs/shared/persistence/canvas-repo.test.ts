import { describe, expect, it, vi } from "vitest";

import { createCanvasRepo } from "./canvas-repo.js";

describe("canvas optimistic save", () => {
  it("首次保存规范混合结果卡记为 present，移除记 removed，撤销重加回 present", async () => {
    let version = 3;
    let cardState = "pending";
    const tx = {
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
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: { canvas_card_state: string } }) => {
          if (where.project_id !== 55n || where.user_id !== 9n || where.type !== "audio_mix") return { count: 0 };
          if (data.canvas_card_state === "present" && Array.isArray((where.id as { in?: bigint[] } | undefined)?.in)
              && (where.id as { in: bigint[] }).in.includes(73n)) cardState = "present";
          const excluded = (where.id as { notIn?: bigint[] } | undefined)?.notIn ?? [];
          if (data.canvas_card_state === "removed" && cardState === "present" && !excluded.includes(73n)) cardState = "removed";
          return { count: 1 };
        }),
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

  it("Canvas 版本冲突及非规范结果卡不改变混合卡状态", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const jobUpdate = vi.fn();
    const tx = { canvas: { updateMany }, generation_jobs: { updateMany: jobUpdate } };
    const repo = createCanvasRepo({ $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as never);
    const forged = JSON.stringify([{ id: "other-73", type: "mediaNode", data: { jobId: "73" } }]);
    await expect(repo.saveIfVersion("55", 3, null, forged, null, { ownerId: "9", items: [] })).resolves.toBeNull();
    expect(jobUpdate).not.toHaveBeenCalled();
  });

  it("returns a conflict without overwriting newer canvas data", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const upsert = vi.fn();
    const tx = {
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

// IKDLQF：edges_json 与 nodes_json 同一次条件写入，读取路径序列化为字符串（缺省 null）。
describe("canvas edges persistence (IKDLQF)", () => {
  it("persists parsed edges in the same conditional write and returns them serialized", async () => {
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
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
