import { describe, expect, it, vi } from "vitest";

import { createLegacyCardHistoryRepo } from "./legacy-card-history-repo.js";

describe("legacy card history repo", () => {
  it("rememberMany 按 (project_id, node_id) 唯一幂等写入，缺省来源/画面描述传 null 语义", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { project_card_migration_history: { createMany } };
    const repo = createLegacyCardHistoryRepo(prisma as never);

    await repo.rememberMany("55", [
      { nodeId: "card-1", title: "镜头 1", promptText: "提示词", visualText: "画面", source: { sessionId: "s", revisionId: "r", shotNo: 1 }, cardJson: { prompt: "提示词" } },
      { nodeId: "card-2", title: "", promptText: "无来源卡", visualText: null, source: null, cardJson: { prompt: "无来源卡" } },
    ]);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          project_id: 55n,
          node_id: "card-1",
          title: "镜头 1",
          prompt_text: "提示词",
          visual_text: "画面",
          source_json: { sessionId: "s", revisionId: "r", shotNo: 1 },
          card_json: { prompt: "提示词" },
        },
        {
          project_id: 55n,
          node_id: "card-2",
          title: "",
          prompt_text: "无来源卡",
          visual_text: null,
          card_json: { prompt: "无来源卡" },
        },
      ],
      skipDuplicates: true,
    });
  });

  it("rememberMany 空数组不触发写入", async () => {
    const createMany = vi.fn();
    const repo = createLegacyCardHistoryRepo({ project_card_migration_history: { createMany } } as never);
    await repo.rememberMany("55", []);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("listByProject 按 id 升序返回本项目全部历史", async () => {
    const rows = [{ id: 1n, node_id: "card-1" }];
    const findMany = vi.fn().mockResolvedValue(rows);
    const repo = createLegacyCardHistoryRepo({ project_card_migration_history: { findMany } } as never);

    await expect(repo.listByProject("55")).resolves.toBe(rows);
    expect(findMany).toHaveBeenCalledWith({
      where: { project_id: 55n },
      orderBy: { id: "asc" },
    });
  });
});


it("migration version conflict rolls back history together with canvas", async () => {
  let persistedHistory: unknown[] = [];
  const prisma = {
    $transaction: async (run: (tx: any) => Promise<unknown>) => {
      let staged: unknown[] = [];
      const result = await run({
        project_card_migration_history: { createMany: async ({ data }: any) => { staged = data; } },
        project_canvas: { updateMany: async () => ({ count: 0 }) },
      });
      persistedHistory = staged;
      return result;
    },
  };
  const repo = createLegacyCardHistoryRepo(prisma as never);
  const result = await repo.migrate("55", 3, "[]", [
    { nodeId: "a", title: "A", promptText: "before", visualText: null, source: null, cardJson: {} },
  ]);
  expect(result).toBe(false);
  expect(persistedHistory).toEqual([]);
});
