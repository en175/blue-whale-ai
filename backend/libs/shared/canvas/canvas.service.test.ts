import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CANVAS_EDGE_LIMITS, DATA_NOT_EXIST_CODE, DomainError, RECOVERY_REASONS } from "@lib/contracts";

import { CanvasService } from "./canvas.service.js";


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
    generation_canvas_submissions: { findFirst: vi.fn().mockResolvedValue(null) },
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

function buildProtectedService(current: CanvasRow | null = null) {
  const built = buildService(current);
  built.client.generation_canvas_submissions.findFirst.mockResolvedValue({ id: 1n });
  return built;
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

  it.each([
    ["媒体成品卡（mediaNode）", { id: "e1", source: "media-1", target: "media-1" }],
    ["文本节点（textNode）", { id: "e1", source: "text-1", target: "text-1" }],
  ])("自环（%s source === target）→ 合法保存（素材原卡重新编辑引用自身）", async (_label, edge) => {
    const { service, tx } = buildService();
    const edges = [edge];

    const result = await service.save("u1", "1", saveBody(edges));

    expect(result.code).toBe(200);
    expect(tx.canvas.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ project_id: 1n, edges_json: edges }),
    });
    expect(result.data?.edges).toBe(JSON.stringify(edges));
  });

  it("重复自环（同一 (source, target) 两条）→ 400，零读零写", async () => {
    const { service, client } = buildService();

    await expect(
      service.save("u1", "1", saveBody([
        { id: "e1", source: "media-1", target: "media-1" },
        { id: "e2", source: "media-1", target: "media-1" },
      ])),
    ).rejects.toThrow(new BadRequestException("同一对节点之间只允许一条连线，原内容未改动"));
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
    const nodeIds = Array.from({ length: 24 }, (_, i) => `n${i}`);
    const nodes = JSON.stringify(nodeIds.map((id) => ({ id, type: "textNode", data: {} })));
    const edges: Array<{ id: string; source: string; target: string }> = [];
    for (const source of nodeIds) {
      for (const target of nodeIds) {
        if (edges.length < CANVAS_EDGE_LIMITS.maxEdges + 1) {
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

describe("CanvasService.save 版本冲突返回当前 version", () => {
  function row(version: number) {
    return {
      id: 1n,
      project_id: 1n,
      version,
      viewport_json: null,
      nodes_json: JSON.parse(NODES),
      edges_json: null,
    };
  }

  it("预览节点 If-Match 与当前版本不符 → 412 且 data.version 为服务端当前版本", async () => {
    const { service, client } = buildService(row(7));
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

    const result = await service.save("u1", "1", { nodes, expectedVersion: 6 });

    expect(result.code).toBe(412);
    expect(result.data).toEqual({ version: 7 });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("条件写失败（读后被并发改动）→ 412 且 data.version 是重读的最新值，不是本次请求的陈旧快照", async () => {
    const { service, client, tx } = buildService(row(3));
    tx.canvas.updateMany.mockResolvedValue({ count: 0 });
    client.canvas.findFirst
      .mockResolvedValueOnce(row(3))
      .mockResolvedValueOnce(row(5));

    const result = await service.save("u1", "1", { nodes: NODES, expectedVersion: 3 });

    expect(result.code).toBe(412);
    expect(result.data).toEqual({ version: 5 });
    expect(client.canvas.findFirst).toHaveBeenCalledTimes(2);
  });

  it("保存成功仍返回 200 与 data.version，冲突分支不影响成功路径", async () => {
    const { service, tx } = buildService(row(3));
    tx.canvas.findFirst.mockResolvedValue(row(4));

    const result = await service.save("u1", "1", { nodes: NODES, expectedVersion: 3 });

    expect(result.code).toBe(200);
    expect(result.data?.version).toBe(4);
  });
});

describe("CanvasService.save 项目不属于调用方", () => {
  it("抛 DomainError：code 100100、HTTP 404（此前回 200）", async () => {
    const { client } = buildService(null);
    const notOwned = new CanvasService(
      { client } as never,
      { findOwnedById: vi.fn().mockResolvedValue(null) } as never,
    );

    const error = await notOwned
      .save("u1", "1", { nodes: NODES, expectedVersion: 3 })
      .then(() => null, (e: unknown) => e as DomainError);

    expect(error).toBeInstanceOf(DomainError);
    expect({ code: error?.code, status: error?.status }).toEqual({
      code: DATA_NOT_EXIST_CODE,
      status: 404,
    });
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

describe("CanvasService.save 空覆盖防护（IKIIWN）", () => {
  const nonEmpty = {
    id: 1n,
    project_id: 1n,
    version: 3,
    viewport_json: {},
    nodes_json: JSON.parse(NODES),
    edges_json: [],
  };

  it("非空画布被空 nodes 覆盖且未确认 → 422 信封，零写入", async () => {
    const { service, tx } = buildService(nonEmpty);

    const result = await service.save("u1", "1", { nodes: "[]" });

    expect(result).toEqual({
      code: 422,
      msg: "画布非空，本次保存会清空全部节点；确认清空请携带 confirmEmpty",
      data: null,
    });
    expect(tx.canvas.updateMany).not.toHaveBeenCalled();
    expect(tx.canvas.create).not.toHaveBeenCalled();
  });

  it("confirmEmpty 非 true（如字符串 \"true\"）→ 同样拒绝", async () => {
    const { service, tx } = buildService(nonEmpty);

    const result = await service.save("u1", "1", { nodes: "[]", confirmEmpty: "true" });

    expect(result.code).toBe(422);
    expect(tx.canvas.updateMany).not.toHaveBeenCalled();
  });

  it("确认清空缺 If-Match → 428 信封，零写入、不消耗版本", async () => {
    const { service, client, tx } = buildService(nonEmpty);

    const result = await service.save("u1", "1", { nodes: "[]", confirmEmpty: true });

    expect(result).toEqual({
      code: 428,
      msg: "确认清空必须携带 If-Match 数值版本",
      data: null,
    });
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(tx.canvas.updateMany).not.toHaveBeenCalled();
    expect(tx.canvas.create).not.toHaveBeenCalled();
  });

  it(`确认清空携带 "missing" 哨兵 → 已有非空画布上 create 撞唯一键 → 412 带当前版本，零写入`, async () => {
    const { service, tx } = buildService(nonEmpty);
    tx.canvas.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await service.save("u1", "1", { nodes: "[]", confirmEmpty: true, expectedVersion: null });

    expect(result.code).toBe(412);
    expect(result.data).toEqual({ version: 3 });
    expect(tx.canvas.create).toHaveBeenCalled();
    expect(tx.canvas.updateMany).not.toHaveBeenCalled();
  });

  it("确认清空携带过期数值版本 → 条件写不命中 → 412 带当前版本，零写入", async () => {
    const { service, tx } = buildService(nonEmpty);
    tx.canvas.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.save("u1", "1", { nodes: "[]", confirmEmpty: true, expectedVersion: 2 });

    expect(result.code).toBe(412);
    expect(result.data).toEqual({ version: 3 });
    expect(tx.canvas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { project_id: 1n, version: 2 } }),
    );
    expect(tx.canvas.create).not.toHaveBeenCalled();
  });

  it("携带当前数值版本的确认清空 → 放行（用户显式删光场景），空文档条件写入", async () => {
    const { service, tx } = buildService(nonEmpty);

    const result = await service.save("u1", "1", { nodes: "[]", confirmEmpty: true, expectedVersion: 3 });

    expect(result.code).toBe(200);
    expect(tx.canvas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project_id: 1n, version: 3 },
        data: expect.objectContaining({ nodes_json: [] }),
      }),
    );
  });

  it("既有画布本就为空 → 空保存不触发防护", async () => {
    const { service, tx } = buildService({ ...nonEmpty, nodes_json: [] });

    const result = await service.save("u1", "1", { nodes: "[]" });

    expect(result.code).toBe(200);
    expect(tx.canvas.updateMany).toHaveBeenCalled();
  });

  it("画布行不存在 → 空保存直接新建（首次创建空画布）", async () => {
    const { service, tx } = buildService(null);

    const result = await service.save("u1", "1", { nodes: "[]" });

    expect(result.code).toBe(200);
    expect(tx.canvas.create).toHaveBeenCalled();
  });
});

describe("CanvasService.save 受保护项目版本要求（IKJJQU B.7）", () => {
  const nonEmptyRow = {
    id: 1n,
    project_id: 1n,
    version: 3,
    viewport_json: {},
    nodes_json: JSON.parse(NODES),
    edges_json: [],
  };
  it("项目存在新协议关联且缺 If-Match → 428 canvas_version_required，零写入", async () => {
    const { service, tx } = buildProtectedService(null);

    const result = await service.save("u1", "1", saveBody([]));

    expect(result).toMatchObject({
      code: 428,
      data: { reason: "canvas_version_required" },
    });
    expect(tx.canvas.create).not.toHaveBeenCalled();
    expect(tx.canvas.updateMany).not.toHaveBeenCalled();
  });

  it("带版本旧请求普通编辑仍可用（无受保护标记节点时不拦）", async () => {
    const { service, tx } = buildProtectedService({ ...nonEmptyRow });

    const result = await service.save("u1", "1", saveBody([{ id: "text-1", source: "text-1", target: "media-1" }], 3));

    expect(result.code).toBe(200);
    expect(tx.canvas.updateMany).toHaveBeenCalled();
  });
});

describe("CanvasService.save 旧协议受保护标记严格比较", () => {
  const marker = { protocolVersion: 1, submissionId: "0a1b2c3d-0000-4000-8000-000000000000", outputKey: "$target" };
  const previous = [{ id: "media-1", type: "mediaNode", position: { x: 1, y: 2 }, data: { assetId: "7", generationRecovery: marker } }];
  const current: CanvasRow = {
    id: 1n,
    project_id: 1n,
    version: 3,
    viewport_json: {},
    nodes_json: previous,
    edges_json: [],
  };

  it.each([
    { label: "布尔值", protocolVersion: true },
    { label: "数组", protocolVersion: [1] },
  ])("协议版本从 1 改为$label → 428，零写入", async ({ protocolVersion }) => {
    const { service, client, tx } = buildProtectedService(current);
    const incoming = [{ ...previous[0]!, data: { assetId: "7", generationRecovery: { ...marker, protocolVersion } } }];

    const result = await service.save("u1", "1", { expectedVersion: 3, nodes: JSON.stringify(incoming), edges: "[]" });

    expect(result).toMatchObject({ code: 428, data: { reason: RECOVERY_REASONS.protocolRequired } });
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(tx.canvas.updateMany).not.toHaveBeenCalled();
    expect(tx.canvas.create).not.toHaveBeenCalled();
  });

  it("合法标记不变时，受保护卡普通编辑仍可保存", async () => {
    const { service, tx } = buildProtectedService(current);
    const incoming = [{ ...previous[0]!, position: { x: 99, y: 2 }, data: { ...previous[0]!.data, fileName: "改名" } }];

    const result = await service.save("u1", "1", { expectedVersion: 3, nodes: JSON.stringify(incoming), edges: "[]" });

    expect(result.code).toBe(200);
    expect(tx.canvas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nodes_json: incoming }) }),
    );
  });
});
