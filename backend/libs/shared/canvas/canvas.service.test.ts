import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CANVAS_EDGE_LIMITS } from "@blue-whale/contracts";

import { CanvasService } from "./canvas.service.js";

// IKDLQF：Canvas save() 的 edges 校验分支（契约「连线持久化」：不满足即明确失败、零写入）。
// 校验失败在读库与事务之前发生，断言 prisma 完全未被触碰（零读零写）。

type CanvasRow = {
  id: bigint;
  project_id: bigint;
  version: number;
  viewport_json: unknown;
  nodes_json: unknown;
  edges_json: unknown;
};

function buildService(current: CanvasRow | null = null) {
  const tx = {
    canvas: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 1n,
        project_id: data.project_id,
        version: 0,
        viewport_json: data.viewport_json ?? null,
        nodes_json: data.nodes_json ?? null,
        edges_json: data.edges_json ?? null,
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(current),
      upsert: vi.fn(),
    },
    generation_output_slots: { updateMany: vi.fn() },
  };
  const client = {
    canvas: { findFirst: vi.fn().mockResolvedValue(current) },
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
    ),
  };
  const service = new CanvasService(
    { client } as never,
    { findOwnedById: vi.fn().mockResolvedValue({ id: "1" }) } as never,
  );
  return { service, client, tx };
}

const NODES = JSON.stringify([
  { id: "text-1", type: "textNode", data: { title: "t", text: "正文" } },
  { id: "media-1", type: "mediaNode", data: { mediaType: "image" } },
]);

function saveBody(edges: unknown, expectedVersion?: number) {
  return {
    nodes: NODES,
    edges: typeof edges === "string" ? edges : JSON.stringify(edges),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  };
}

describe("CanvasService.save edges 校验（IKDLQF）", () => {
  it("合法 edges 随 nodes 同一次条件写入落库，读取视图携带 edges", async () => {
    const { service, tx } = buildService();
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];

    const result = await service.save("u1", "1", saveBody(edges));

    expect(result.code).toBe(200);
    expect(tx.canvas.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        project_id: 1n,
        edges_json: edges,
      }),
    });
    expect(result.data?.edges).toBe(JSON.stringify(edges));
  });

  it("edges 未携带（旧客户端）→ 保留既有连线，不得清空", async () => {
    const existingEdges = [{ id: "e1", source: "text-1", target: "media-1" }];
    const { service, tx } = buildService({
      id: 1n,
      project_id: 1n,
      version: 3,
      viewport_json: {},
      nodes_json: JSON.parse(NODES),
      edges_json: existingEdges,
    });

    const result = await service.save("u1", "1", { nodes: NODES });

    expect(result.code).toBe(200);
    expect(tx.canvas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ edges_json: existingEdges }),
      }),
    );
    expect(tx.canvas.create).not.toHaveBeenCalled();
  });

  it("edges 未携带且画布不存在 → 新建落 null", async () => {
    const { service, tx } = buildService();

    const result = await service.save("u1", "1", { nodes: NODES });

    expect(result.code).toBe(200);
    expect(tx.canvas.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ edges_json: null }),
    });
  });

  it("edges 解析后不是数组 → 400，零读零写", async () => {
    const { service, client } = buildService();

    await expect(
      service.save("u1", "1", saveBody('{"id":"e1"}')),
    ).rejects.toThrow(new BadRequestException("画布连线格式无效，原内容未改动"));
    expect(client.canvas.findFirst).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["source 为空串", { id: "e1", source: "", target: "media-1" }],
    ["id 超过 128 字符", { id: "e".repeat(129), source: "text-1", target: "media-1" }],
    ["携带额外键", { id: "e1", source: "text-1", target: "media-1", animated: true }],
  ])("边不过 canvasEdgeSchema（%s）→ 400，零读零写", async (_label, edge) => {
    const { service, client } = buildService();

    await expect(service.save("u1", "1", saveBody([edge]))).rejects.toThrow(
      new BadRequestException("画布连线格式无效，原内容未改动"),
    );
    expect(client.canvas.findFirst).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("自环（source === target）→ 400，零读零写", async () => {
    const { service, client } = buildService();

    await expect(
      service.save("u1", "1", saveBody([{ id: "e1", source: "text-1", target: "text-1" }])),
    ).rejects.toThrow(new BadRequestException("连线不能指向同一节点，原内容未改动"));
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("悬空端点（引用同次 nodes 之外的 id）→ 400，零读零写", async () => {
    const { service, client } = buildService();

    await expect(
      service.save("u1", "1", saveBody([{ id: "e1", source: "text-1", target: "media-404" }])),
    ).rejects.toThrow(
      new BadRequestException("连线端点必须引用本次保存的画布节点，原内容未改动"),
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("同一 (source, target) 重复连线 → 400，零读零写", async () => {
    const { service, client } = buildService();
    const edges = [
      { id: "e1", source: "text-1", target: "media-1" },
      { id: "e2", source: "text-1", target: "media-1" },
    ];

    await expect(service.save("u1", "1", saveBody(edges))).rejects.toThrow(
      new BadRequestException("同一对节点之间只允许一条连线，原内容未改动"),
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it(`超过 ${CANVAS_EDGE_LIMITS.maxEdges} 条 → 400，零读零写`, async () => {
    const { service, client } = buildService();
    // 24 个节点的有向无环点对共 552 个，取 501 条保证除总数外全部合法。
    const nodeIds = Array.from({ length: 24 }, (_, i) => `n${i}`);
    const nodes = JSON.stringify(nodeIds.map((id) => ({ id, type: "textNode", data: {} })));
    const edges: Array<{ id: string; source: string; target: string }> = [];
    for (const source of nodeIds) {
      for (const target of nodeIds) {
        if (source !== target && edges.length < CANVAS_EDGE_LIMITS.maxEdges + 1) {
          edges.push({ id: `e${edges.length}`, source, target });
        }
      }
    }
    expect(edges).toHaveLength(CANVAS_EDGE_LIMITS.maxEdges + 1);

    await expect(
      service.save("u1", "1", { nodes, edges: JSON.stringify(edges) }),
    ).rejects.toThrow(
      new BadRequestException(
        `连线数量超过 ${CANVAS_EDGE_LIMITS.maxEdges} 条上限，原内容未改动`,
      ),
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("edges 序列化超过 256 KiB → 400，零读零写", async () => {
    const { service, client } = buildService();
    const edge = { id: "e".repeat(128), source: "s".repeat(128), target: "t".repeat(128) };
    const edges = Array.from({ length: 700 }, () => edge);
    expect(Buffer.byteLength(JSON.stringify(edges), "utf8")).toBeGreaterThan(
      CANVAS_EDGE_LIMITS.edgesBytes,
    );

    await expect(service.save("u1", "1", saveBody(edges))).rejects.toThrow(
      new BadRequestException("连线内容超过 256 KiB，原内容未改动"),
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("promptSource 校验不受 edges 影响：预览节点缺 If-Match 仍 400", async () => {
    const { service, client } = buildService({
      id: 1n,
      project_id: 1n,
      version: 3,
      viewport_json: null,
      nodes_json: [],
      edges_json: null,
    });
    const nodes = JSON.stringify([
      {
        id: "text-1",
        type: "textNode",
        data: {
          title: "t",
          text: "正文",
          promptSource: { sessionId: "s", revisionId: "r", shotNo: 1 },
        },
      },
      { id: "media-1", type: "mediaNode", data: { mediaType: "image" } },
    ]);

    await expect(
      service.save("u1", "1", {
        nodes,
        edges: JSON.stringify([{ id: "e1", source: "text-1", target: "media-1" }]),
      }),
    ).rejects.toThrow(new BadRequestException("保存预览节点必须携带 If-Match"));
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
