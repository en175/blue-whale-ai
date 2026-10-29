import { describe, expect, it } from "vitest";

import {
  AgentCanvasRequestError,
  parseAgentCanvasCursor,
  parseAgentCanvasLimit,
  readAgentCanvasNodeDetails,
  searchAgentCanvasNodes,
} from "./agent-canvas-nodes.js";

const NODES = [
  { id: "n1", type: "textNode", position: { x: 1, y: 2 }, data: { title: "蓝鲸文案", tags: ["脚本", "重要"], parentNodeId: "g1" } },
  { id: "n2", type: "mediaNode", position: { x: 3, y: 4 }, data: { title: "参考图", tags: ["素材"], mediaType: "image" } },
  { id: "n3", type: "textNode", position: { x: 5, y: 6 }, data: { title: "脚本二", tags: ["脚本"] } },
];
const EDGES = [
  { id: "e1", source: "n1", target: "n2", data: { refRole: "reference" } },
  { id: "e2", source: "n3", target: "n2" },
];

function fakePrisma(options: { marker?: number; nodes?: unknown[]; edges?: unknown[] } = {}) {
  const nodes = options.nodes ?? NODES;
  const edges = options.edges ?? EDGES;
  return {
    project_canvas: {
      findFirst: async () => ({
        id: 1n,
        project_id: 55n,
        version: 1,
        viewport_json: null,
        nodes_json: nodes,
        edges_json: edges,
        rows_authoritative: options.marker ?? 0,
      }),
    },
    project_nodes: {
      findMany: async () => (nodes as Array<Record<string, unknown>>)
        .filter((node) => node.is_delete !== 1)
        .map((node) => ({
          node_id: node.id,
          type: node.type,
          pos_x: (node.position as { x: number }).x,
          pos_y: (node.position as { y: number }).y,
          data_json: node.data,
        })),
    },
    project_edges: {
      findMany: async () => (edges as Array<Record<string, unknown>>).map((edge) => ({
        edge_id: edge.id,
        source_node_id: edge.source,
        target_node_id: edge.target,
        ref_role: null,
        data_json: edge.data ?? {},
      })),
    },
  } as never;
}

describe("Agent 画布节点只读查询", () => {
  it("按名称子串（忽略大小写）、类型、标签、父节点与节点 id 过滤", async () => {
    const prisma = fakePrisma();
    const byName = await searchAgentCanvasNodes(prisma, "55", { name: "蓝鲸" }, null, 50);
    expect(byName.items.map((item) => item.id)).toEqual(["n1"]);
    expect(byName.items[0]).toMatchObject({ name: "蓝鲸文案", tags: ["脚本", "重要"], parent_node_id: "g1", position: { x: 1, y: 2 } });

    const byType = await searchAgentCanvasNodes(prisma, "55", { type: "mediaNode" }, null, 50);
    expect(byType.items.map((item) => item.id)).toEqual(["n2"]);

    const byTag = await searchAgentCanvasNodes(prisma, "55", { tags: ["脚本"] }, null, 50);
    expect(byTag.items.map((item) => item.id)).toEqual(["n1", "n3"]);

    const byTwoTags = await searchAgentCanvasNodes(prisma, "55", { tags: ["脚本", "重要"] }, null, 50);
    expect(byTwoTags.items.map((item) => item.id)).toEqual(["n1"]);

    const byParent = await searchAgentCanvasNodes(prisma, "55", { parentNodeId: "g1" }, null, 50);
    expect(byParent.items.map((item) => item.id)).toEqual(["n1"]);

    const byId = await searchAgentCanvasNodes(prisma, "55", { nodeId: "n3" }, null, 50);
    expect(byId.items.map((item) => item.id)).toEqual(["n3"]);
  });

  it("没有筛选条件时返回 filter_required", async () => {
    await expect(searchAgentCanvasNodes(fakePrisma(), "55", {}, null, 50)).rejects.toMatchObject({
      reason: "filter_required",
    });
  });

  it("分页与 total", async () => {
    const first = await searchAgentCanvasNodes(fakePrisma(), "55", { tags: ["脚本"] }, null, 1);
    expect(first.items.map((item) => item.id)).toEqual(["n1"]);
    expect(first.next_cursor).toBe("n1");
    expect(first.total).toBe(2);
    const second = await searchAgentCanvasNodes(fakePrisma(), "55", { tags: ["脚本"] }, first.next_cursor, 1);
    expect(second.items.map((item) => item.id)).toEqual(["n3"]);
    expect(second.next_cursor).toBeNull();
  });

  it("游标与 limit 校验", () => {
    expect(parseAgentCanvasCursor(undefined)).toBeNull();
    expect(parseAgentCanvasCursor("n1")).toBe("n1");
    expect(() => parseAgentCanvasCursor("")).toThrow(AgentCanvasRequestError);
    expect(() => parseAgentCanvasCursor("x".repeat(129))).toThrow(AgentCanvasRequestError);
    expect(() => parseAgentCanvasCursor(-1 as never)).toThrow(AgentCanvasRequestError);
    expect(parseAgentCanvasLimit(undefined)).toBe(50);
    expect(parseAgentCanvasLimit(200)).toBe(200);
    expect(() => parseAgentCanvasLimit(0)).toThrow(AgentCanvasRequestError);
    expect(() => parseAgentCanvasLimit(201)).toThrow(AgentCanvasRequestError);
    expect(() => parseAgentCanvasLimit(1.5)).toThrow(AgentCanvasRequestError);
  });

  it("详情返回节点、相连的边与 missing", async () => {
    const result = await readAgentCanvasNodeDetails(fakePrisma(), "55", ["n1", "n404", "n2"]);
    expect(result.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    expect(result.missing).toEqual(["n404"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["e1", "e2"]);
  });

  it("行表权威项目读取行表并排除已删除节点", async () => {
    const prisma = fakePrisma({
      marker: 1,
      nodes: [
        { id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: { title: "存活" } },
        { id: "n2", type: "textNode", position: { x: 0, y: 0 }, data: { title: "删除" }, is_delete: 1 },
      ],
      edges: [],
    });
    const result = await searchAgentCanvasNodes(prisma, "55", { name: "存活" }, null, 50);
    expect(result.items.map((item) => item.id)).toEqual(["n1"]);
    const details = await readAgentCanvasNodeDetails(prisma, "55", ["n1", "n2"]);
    expect(details.nodes.map((node) => node.id)).toEqual(["n1"]);
    expect(details.missing).toEqual(["n2"]);
  });

  it("缺省字段返回稳定形态", async () => {
    const result = await searchAgentCanvasNodes(
      fakePrisma({ nodes: [{ id: "n9", type: "textNode" }], edges: [] }),
      "55",
      { nodeId: "n9" },
      null,
      50,
    );
    expect(result.items[0]).toEqual({
      id: "n9",
      type: "textNode",
      name: null,
      tags: [],
      parent_node_id: null,
      position: { x: 0, y: 0 },
      data: {},
    });
  });

  it("旧 JSON 结构异常按空画布处理，不抛 500", async () => {
    const prisma = {
      project_canvas: {
        findFirst: async () => ({
          id: 1n,
          project_id: 55n,
          version: 1,
          viewport_json: null,
          nodes_json: "oops",
          edges_json: { bad: true },
          rows_authoritative: 0,
        }),
      },
    } as never;
    const result = await searchAgentCanvasNodes(prisma, "55", { name: "任意" }, null, 50);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("详情不返回指向已不存在节点的悬空边", async () => {
    const result = await readAgentCanvasNodeDetails(
      fakePrisma({ nodes: [{ id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: {} }], edges: [{ id: "e1", source: "n1", target: "n404" }] }),
      "55",
      ["n1"],
    );
    expect(result.nodes.map((node) => node.id)).toEqual(["n1"]);
    expect(result.edges).toEqual([]);
  });
});
