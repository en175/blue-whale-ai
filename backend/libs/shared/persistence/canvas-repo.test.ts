import { describe, expect, it, vi } from "vitest";

import { createCanvasRepo } from "./canvas-repo.js";

describe("canvas optimistic save", () => {
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
