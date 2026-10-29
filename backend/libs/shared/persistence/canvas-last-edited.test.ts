import { describe, expect, it, vi } from "vitest";

import { createCanvasRepo } from "./canvas-repo.js";

function build() {
  const tx = {
    project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    canvas: {
      upsert: vi.fn().mockResolvedValue({
        id: 1n,
        project_id: 55n,
        version: 1,
        viewport_json: null,
        nodes_json: [],
        edges_json: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({
        id: 1n,
        project_id: 55n,
        version: 2,
        viewport_json: null,
        nodes_json: [],
        edges_json: null,
      }),
    },
    generation_output_slots: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
    generation_job_extras: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const repo = createCanvasRepo({
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as never);
  return { repo, tx };
}

describe("画布保存更新项目最近编辑时间（IKRE7U）", () => {
  it("普通保存在同一事务写入 last_edited_at", async () => {
    const { repo, tx } = build();

    await repo.save("55", null, "[]");

    expect(tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: 55n },
      data: { last_edited_at: expect.any(Date) },
    });
  });

  it("带版本保护的更新也在同一事务写入 last_edited_at", async () => {
    const { repo, tx } = build();

    await repo.saveIfVersion("55", 1, null, "[]", null, undefined);

    expect(tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: 55n },
      data: { last_edited_at: expect.any(Date) },
    });
  });

  it("首次建画布（expectedVersion 为 null）同样写入", async () => {
    const { repo, tx } = build();
    tx.canvas.create = vi.fn().mockResolvedValue({
      id: 1n,
      project_id: 55n,
      version: 1,
      viewport_json: null,
      nodes_json: [],
      edges_json: null,
    });

    await repo.saveIfVersion("55", null, null, "[]", null, undefined);

    expect(tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: 55n },
      data: { last_edited_at: expect.any(Date) },
    });
  });
});
