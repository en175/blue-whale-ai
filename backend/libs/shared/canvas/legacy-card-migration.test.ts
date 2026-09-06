import { describe, expect, it } from "vitest";
import type { LegacyCardHistoryRow } from "@blue-whale/persistence";
import { isLegacyGenerationCard, planLegacyCardMigration, type CanvasNodeLike } from "./legacy-card-migration.js";

function legacyNode(id: string, card: unknown, position = { x: 1, y: 2 }): CanvasNodeLike {
  return { id, type: "assetNode", position, data: { kind: "generation", generationCard: card } };
}

function textNode(id: string, promptSource?: unknown): CanvasNodeLike {
  return { id, type: "textNode", position: { x: 0, y: 0 }, data: { title: "t", text: "x", ...(promptSource ? { promptSource } : {}) } };
}

function historyRow(nodeId: string, over: Partial<LegacyCardHistoryRow> = {}): LegacyCardHistoryRow {
  return {
    id: 1n,
    project_id: 55n,
    node_id: nodeId,
    title: "历史标题",
    prompt_text: "历史提示词",
    visual_text: "历史画面",
    source_json: null,
    card_json: { shotTitle: "历史标题" },
    gmt_create: new Date("2026-09-07T00:00:00Z"),
    ...over,
  };
}

describe("isLegacyGenerationCard", () => {
  it("识别 assetNode + kind=generation；其他节点不匹配", () => {
    expect(isLegacyGenerationCard(legacyNode("a", {}))).toBe(true);
    expect(isLegacyGenerationCard(textNode("b"))).toBe(false);
    expect(isLegacyGenerationCard({ id: "c", type: "assetNode", data: { kind: "asset" } })).toBe(false);
  });
});

describe("planLegacyCardMigration", () => {
  it("无旧生成卡返回 null（不写画布）", () => {
    expect(planLegacyCardMigration([textNode("t1")], [])).toBeNull();
  });

  it("转换为普通文本节点：保留 id/position/标题/实际提示词，落历史含画面描述与原卡片", () => {
    const card = { shotTitle: "镜头 1", visual: "暮色街道", prompt: "用户改过的提示词", timeRange: "0-4s", cardId: "rev1#1" };
    const plan = planLegacyCardMigration([legacyNode("card-1", card)], []);
    expect(plan).not.toBeNull();
    expect(plan!.migrated).toEqual(["card-1"]);
    expect(plan!.failed).toEqual([]);
    expect(plan!.nodes[0]).toEqual({
      id: "card-1",
      type: "textNode",
      position: { x: 1, y: 2 },
      data: { title: "镜头 1", text: "用户改过的提示词" },
    });
    expect(plan!.historyDrafts).toEqual([
      { nodeId: "card-1", title: "镜头 1", promptText: "用户改过的提示词", visualText: "暮色街道", source: null, cardJson: card },
    ]);
  });

  it("shotTitle 缺失时标题落空串；visual 缺失时历史 visualText 为 null", () => {
    const plan = planLegacyCardMigration([legacyNode("card-1", { prompt: "只有提示词" })], []);
    expect(plan!.nodes[0]!.data).toEqual({ title: "", text: "只有提示词" });
    expect(plan!.historyDrafts[0]).toMatchObject({ title: "", visualText: null });
  });

  it("合法且唯一的 source 迁移为 promptSource；无来源不伪造", () => {
    const source = { sessionId: "s1", revisionId: "r1", shotNo: 2 };
    const plan = planLegacyCardMigration([
      legacyNode("card-1", { shotTitle: "A", prompt: "pa", source }),
      legacyNode("card-2", { shotTitle: "B", prompt: "pb" }),
    ], []);
    expect(plan!.nodes[0]!.data).toMatchObject({ promptSource: source });
    expect(plan!.nodes[1]!.data).not.toHaveProperty("promptSource");
    expect(plan!.historyDrafts[0]).toMatchObject({ source });
    expect(plan!.historyDrafts[1]).toMatchObject({ source: null });
  });

  it("重复 source 去重：先扫描到者携带 promptSource，后者只进历史", () => {
    const source = { sessionId: "s1", revisionId: "r1", shotNo: 2 };
    const plan = planLegacyCardMigration([
      legacyNode("card-1", { shotTitle: "A", prompt: "pa", source }),
      legacyNode("card-2", { shotTitle: "B", prompt: "pb", source }),
    ], []);
    expect(plan!.nodes[0]!.data).toHaveProperty("promptSource");
    expect(plan!.nodes[1]!.data).not.toHaveProperty("promptSource");
    expect(plan!.historyDrafts[1]).toMatchObject({ source });
  });

  it("与既有文本节点的 promptSource 冲突时不携带", () => {
    const source = { sessionId: "s1", revisionId: "r1", shotNo: 2 };
    const plan = planLegacyCardMigration([
      textNode("text-9", source),
      legacyNode("card-1", { shotTitle: "A", prompt: "pa", source }),
    ], []);
    expect(plan!.nodes[1]!.data).not.toHaveProperty("promptSource");
    expect(plan!.historyDrafts[0]).toMatchObject({ source });
  });

  it("损坏 source 不伪造不失败：正常迁移但不携带 promptSource", () => {
    const plan = planLegacyCardMigration([
      legacyNode("card-1", { shotTitle: "A", prompt: "pa", source: { sessionId: "s1" } }),
    ], []);
    expect(plan!.failed).toEqual([]);
    expect(plan!.nodes[0]!.data).not.toHaveProperty("promptSource");
    expect(plan!.historyDrafts[0]).toMatchObject({ source: null });
  });

  it("prompt 缺失/非字符串：保留原卡、报告原因、不落历史、不用 visual 兜底", () => {
    const card = { shotTitle: "镜头 2", visual: "只有画面" };
    const plan = planLegacyCardMigration([legacyNode("card-2", card)], []);
    expect(plan!.migrated).toEqual([]);
    expect(plan!.failed).toEqual([{ nodeId: "card-2", title: "镜头 2", reason: "提示词缺失或已损坏" }]);
    expect(plan!.nodes[0]).toEqual(legacyNode("card-2", card));
    expect(plan!.historyDrafts).toEqual([]);
  });

  it("generationCard 缺失或不是对象：失败保留原卡", () => {
    const plan = planLegacyCardMigration([
      { id: "card-3", type: "assetNode", position: { x: 0, y: 0 }, data: { kind: "generation" } },
      legacyNode("card-4", "not-an-object"),
    ], []);
    expect(plan!.failed).toEqual([
      { nodeId: "card-3", title: "", reason: "提示词缺失或已损坏" },
      { nodeId: "card-4", title: "", reason: "提示词缺失或已损坏" },
    ]);
    expect(plan!.migrated).toEqual([]);
  });

  it("prompt 超存储限长：失败保留原卡", () => {
    const plan = planLegacyCardMigration([legacyNode("card-5", { shotTitle: "A", prompt: "文".repeat(100_001) })], []);
    expect(plan!.failed).toEqual([{ nodeId: "card-5", title: "A", reason: "提示词超过存储限长" }]);
  });

  it("shotTitle 超存储限长：失败保留原卡", () => {
    const plan = planLegacyCardMigration([legacyNode("card-6", { shotTitle: "长".repeat(201), prompt: "p" })], []);
    expect(plan!.failed).toEqual([{ nodeId: "card-6", title: "长".repeat(201), reason: "标题超过存储限长" }]);
  });

  it("历史与旧卡冲突：保留现值并报告冲突，不用旧历史覆盖", () => {
    const card = { shotTitle: "现值标题", prompt: "现值提示词", visual: "现值画面" };
    const plan = planLegacyCardMigration([legacyNode("card-7", card)], [historyRow("card-7")]);
    expect(plan!.migrated).toEqual([]);
    expect(plan!.nodes[0]).toEqual(legacyNode("card-7", card));
    expect(plan!.failed[0]?.reason).toContain("冲突");
    expect(plan!.historyDrafts).toEqual([]);
  });

  it("历史来源在恢复转换时同样判重", () => {
    const source = { sessionId: "s1", revisionId: "r1", shotNo: 1 };
    const plan = planLegacyCardMigration([
      textNode("text-9", source),
      legacyNode("card-8", { shotTitle: "历史标题", prompt: "历史提示词", visual: "历史画面", source }),
    ], [historyRow("card-8", { source_json: source })]);
    expect(plan!.migrated).toEqual(["card-8"]);
    expect(plan!.nodes[1]!.data).not.toHaveProperty("promptSource");
  });

  it("混合场景：一张迁移一张失败，失败卡原样保留且其余节点不动", () => {
    const ok = legacyNode("card-1", { shotTitle: "A", prompt: "pa" });
    const bad = legacyNode("card-2", { shotTitle: "B" });
    const plain = textNode("text-1");
    const plan = planLegacyCardMigration([ok, bad, plain], []);
    expect(plan!.migrated).toEqual(["card-1"]);
    expect(plan!.failed).toHaveLength(1);
    expect(plan!.nodes.map(n => n.id)).toEqual(["card-1", "card-2", "text-1"]);
    expect(plan!.nodes[0]!.type).toBe("textNode");
    expect(plan!.nodes[1]).toEqual(bad);
    expect(plan!.nodes[2]).toEqual(plain);
  });
});
