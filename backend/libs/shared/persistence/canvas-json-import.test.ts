import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";

import {
  CanvasRowsImportError,
  compareCanvasJson,
  importCanvasJsonToRows,
} from "./canvas-json-import.js";

interface Seed {
  nodes_json: Prisma.JsonValue | null;
  edges_json: Prisma.JsonValue | null;
  rows_authoritative?: number;
  existingNodes?: number;
  existingEdges?: number;
  history?: Array<Record<string, unknown>>;
}

function fakeTx(seed: Seed) {
  const created = {
    nodes: [] as Array<Record<string, unknown>>,
    edges: [] as Array<Record<string, unknown>>,
    history: [] as Array<Record<string, unknown>>,
    canvas: null as null | Record<string, unknown>,
  };
  const tx = {
    project_nodes: {
      count: async () => seed.existingNodes ?? 0,
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        created.nodes.push(...data);
      },
    },
    project_edges: {
      count: async () => seed.existingEdges ?? 0,
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        created.edges.push(...data);
      },
    },
    project_card_migration_history: {
      findMany: async () => seed.history ?? [],
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        created.history.push(...data);
      },
    },
    project_canvas: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        created.canvas = data;
      },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, created };
}

const canvasOf = (seed: Seed) => ({
  id: 1n,
  nodes_json: seed.nodes_json,
  edges_json: seed.edges_json,
  rows_authoritative: seed.rows_authoritative ?? 0,
});

describe("存量画布 JSON 导入行表", () => {
  it("保留旧节点类型与数据，坐标取整，名称取 data.title", async () => {
    const seed: Seed = {
      nodes_json: [
        { id: "t1", type: "text", position: { x: 10.4, y: 20.6 }, data: { html: "<p>甲</p>" } },
        { id: "r1", type: "reference", position: { x: 1, y: 2 }, data: { content: "参考" } },
        { id: "m1", type: "mediaNode", position: { x: 3, y: 4 }, data: { mediaType: "video", title: "镜头 1" } },
        { id: "g1", type: "groupFrame", data: { title: "分组", width: 400 } },
      ],
      edges_json: [{ id: "e1", source: "t1", target: "m1", data: { refRole: "reference" } }],
    };
    const { tx, created } = fakeTx(seed);
    const report = await importCanvasJsonToRows(tx, 9n, canvasOf(seed));

    expect(report.imported_nodes).toBe(4);
    expect(report.imported_edges).toBe(1);
    expect(created.nodes.map((row) => row.type)).toEqual(["text", "reference", "mediaNode", "groupFrame"]);
    expect(created.nodes[0]).toMatchObject({ node_id: "t1", pos_x: 10, pos_y: 21, name: null, source: "user" });
    expect(created.nodes[0]!.data_json).toEqual({ html: "<p>甲</p>" });
    expect(created.nodes[2]).toMatchObject({ name: "镜头 1", pos_x: 3, pos_y: 4 });
    expect(created.nodes[3]).toMatchObject({ pos_x: null, pos_y: null });
    expect(created.edges[0]).toMatchObject({
      edge_id: "e1",
      source_node_id: "t1",
      target_node_id: "m1",
      ref_role: "reference",
    });
    expect(created.edges[0]!.data_json).toEqual({ refRole: "reference" });
    expect(created.canvas).toEqual({ rows_authoritative: 1, version: { increment: 1 } });
  });

  it("重复节点 id 保留第一条；重复连线 id 与端点对分别只留第一条", async () => {
    const seed: Seed = {
      nodes_json: [
        { id: "n1", type: "textNode", data: { text: "第一" } },
        { id: "n2", type: "mediaNode", data: { src: "a" } },
        { id: "n1", type: "textNode", data: { text: "第二" } },
      ],
      edges_json: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n1", target: "n2" },
        { id: "e1", source: "n2", target: "n1" },
      ],
    };
    const { tx, created } = fakeTx(seed);
    const report = await importCanvasJsonToRows(tx, 9n, canvasOf(seed));

    expect(report.duplicate_node_ids).toEqual(["n1"]);
    expect(report.duplicate_edge_pairs).toEqual(["e2"]);
    expect(report.duplicate_edge_ids).toEqual(["e1"]);
    expect(created.nodes.filter((row) => row.node_id === "n1")).toHaveLength(1);
    expect(created.nodes.find((row) => row.node_id === "n1")!.data_json).toEqual({ text: "第一" });
    expect(created.edges).toHaveLength(1);
    expect(created.edges[0]).toMatchObject({ edge_id: "e1", source_node_id: "n1", target_node_id: "n2" });
  });

  it("旧卡按迁移历史转换并落历史行", async () => {
    const card = {
      id: "c1",
      type: "assetNode",
      data: {
        kind: "generation",
        generationCard: { shotTitle: "镜头 A", prompt: "一只蓝鲸", source: { sessionId: "s1", revisionId: "r1", shotNo: 1 } },
      },
    };
    const seed: Seed = { nodes_json: [card], edges_json: [], history: [] };
    const { tx, created } = fakeTx(seed);
    const report = await importCanvasJsonToRows(tx, 9n, canvasOf(seed));

    expect(report.migrated_cards).toEqual(["c1"]);
    expect(created.nodes[0]!.data_json).toMatchObject({ title: "镜头 A" });
    expect(created.history).toHaveLength(1);
    expect(created.history[0]).toMatchObject({ node_id: "c1", title: "镜头 A", prompt_text: "一只蓝鲸" });
  });

  it("结构化解析失败时不写入、不开启标记", async () => {
    const seed: Seed = { nodes_json: { not: "array" }, edges_json: [] };
    const { tx, created } = fakeTx(seed);
    await expect(importCanvasJsonToRows(tx, 9n, canvasOf(seed))).rejects.toMatchObject({
      reason: "parse_failure",
    });
    expect(created.nodes).toHaveLength(0);
    expect(created.canvas).toBeNull();

    const brokenNode = fakeTx({ nodes_json: [{ type: "textNode" }], edges_json: [] });
    await expect(importCanvasJsonToRows(brokenNode.tx, 9n, canvasOf({ nodes_json: [{ type: "textNode" }], edges_json: [] })))
      .rejects.toBeInstanceOf(CanvasRowsImportError);
  });

  it("已有节点行但未开启标记时拒绝导入", async () => {
    const seed: Seed = { nodes_json: [], edges_json: [], existingNodes: 2 };
    const { tx } = fakeTx(seed);
    await expect(importCanvasJsonToRows(tx, 9n, canvasOf(seed))).rejects.toMatchObject({
      reason: "rows_without_marker",
    });
  });

  it("含无法落行的顶层字段或超长字段时整项目失败", async () => {
    const topLevel = fakeTx({
      nodes_json: [{ id: "r1", type: "reference", cardType: "style", references: [{ asset_id: 1 }] }],
      edges_json: [],
    });
    await expect(importCanvasJsonToRows(topLevel.tx, 9n, canvasOf({
      nodes_json: [{ id: "r1", type: "reference", cardType: "style", references: [{ asset_id: 1 }] }],
      edges_json: [],
    }))).rejects.toMatchObject({ reason: "parse_failure" });

    const tooLong = fakeTx({ nodes_json: [{ id: "n".repeat(129), type: "textNode" }], edges_json: [] });
    await expect(importCanvasJsonToRows(tooLong.tx, 9n, canvasOf({
      nodes_json: [{ id: "n".repeat(129), type: "textNode" }],
      edges_json: [],
    }))).rejects.toMatchObject({ reason: "parse_failure" });
  });

  it("已开启标记时幂等跳过", async () => {
    const seed: Seed = { nodes_json: [{ id: "n1", type: "textNode" }], edges_json: [], rows_authoritative: 1 };
    const { tx, created } = fakeTx(seed);
    const report = await importCanvasJsonToRows(tx, 9n, canvasOf(seed));
    expect(report.already_authoritative).toBe(true);
    expect(created.nodes).toHaveLength(0);
    expect(created.canvas).toBeNull();
  });
});

describe("行表与旧 JSON 比对", () => {
  const viewNodes = [
    { id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: { text: "甲" } },
    { id: "n2", type: "mediaNode", position: { x: 5, y: 6 }, data: {} },
  ];
  const viewEdges = [{ id: "e1", source: "n1", target: "n2", data: { refRole: "reference" } }];

  it("忽略数组顺序与坐标取整差异", () => {
    const comparison = compareCanvasJson(
      [
        { id: "n2", type: "mediaNode", position: { x: 5.2, y: 5.8 }, data: {} },
        { id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: { text: "甲" } },
      ],
      [{ id: "e1", source: "n1", target: "n2", data: { refRole: "reference" } }],
      viewNodes,
      viewEdges,
    );
    expect(comparison).toEqual({ consistent: true, differences: [] });
  });

  it("报告缺失、多出与数据差异", () => {
    const comparison = compareCanvasJson(
      [
        { id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: { text: "乙" } },
        { id: "n9", type: "textNode", data: {} },
      ],
      [],
      viewNodes,
      viewEdges,
    );
    expect(comparison.consistent).toBe(false);
    expect(comparison.differences).toEqual(
      expect.arrayContaining([
        "node:n1:data",
        "node:n9:missing",
        "node:n2:extra",
        "edge:e1:extra",
      ]),
    );
  });

  it("迁移过的卡片跳过类型与 data 比对，仍比对位置", () => {
    const comparison = compareCanvasJson(
      [{ id: "n1", type: "assetNode", position: { x: 0, y: 0 }, data: { legacy: true } }],
      [],
      [viewNodes[0]],
      [],
      new Set(["n1"]),
    );
    expect(comparison.consistent).toBe(true);

    const positionDiff = compareCanvasJson(
      [{ id: "n1", type: "assetNode", position: { x: 5, y: 0 }, data: { legacy: true } }],
      [],
      [viewNodes[0]],
      [],
      new Set(["n1"]),
    );
    expect(positionDiff.differences).toEqual(["node:n1:position"]);
  });
});
