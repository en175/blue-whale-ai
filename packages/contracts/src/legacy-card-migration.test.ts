import { describe, expect, it } from "vitest";
import {
  legacyCardHistoryItemSchema,
  legacyMigrationReportSchema,
} from "./legacy-card-migration.js";

describe("legacyCardHistoryItemSchema", () => {
  const item = {
    historyId: "42",
    nodeId: "card-1",
    title: "镜头 1",
    promptText: "实际保存的提示词",
    visualText: "画面描述",
    source: { sessionId: "s1", revisionId: "r1", shotNo: 1 },
    cardJson: { shotTitle: "镜头 1", prompt: "实际保存的提示词" },
    migratedAt: "2026-09-07T01:00:00.000Z",
  };

  it("接受完整条目（含来源与原卡片）", () => {
    expect(legacyCardHistoryItemSchema.parse(item)).toEqual(item);
  });

  it("接受无画面描述与无来源条目", () => {
    const bare = { ...item, visualText: null, source: null, cardJson: { prompt: "x" } };
    expect(legacyCardHistoryItemSchema.parse(bare)).toEqual(bare);
  });

  it("拒绝来源形状损坏的条目", () => {
    expect(legacyCardHistoryItemSchema.safeParse({ ...item, source: { sessionId: "s1" } }).success).toBe(false);
  });
});

describe("legacyMigrationReportSchema", () => {
  it("接受空报告与含失败报告", () => {
    expect(legacyMigrationReportSchema.parse({ migrated: [], failed: [] })).toEqual({ migrated: [], failed: [] });
    const report = { migrated: ["a"], failed: [{ nodeId: "b", title: "镜头 2", reason: "提示词缺失或已损坏" }] };
    expect(legacyMigrationReportSchema.parse(report)).toEqual(report);
  });

  it("拒绝缺字段或空原因的报告", () => {
    expect(legacyMigrationReportSchema.safeParse({ migrated: [] }).success).toBe(false);
    expect(legacyMigrationReportSchema.safeParse({ migrated: [], failed: [{ nodeId: "b", title: "", reason: "" }] }).success).toBe(false);
  });
});
