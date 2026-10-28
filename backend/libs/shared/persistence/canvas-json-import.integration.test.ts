import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { createCanvasRepo } from "./canvas-repo.js";
import { CanvasRowsImportError, ensureCanvasRowsImported } from "./canvas-json-import.js";
import { applyCanvasChanges } from "./project-canvas-apply-repo.js";

const OWNER_ID = 987653n;

describe.skipIf(!process.env.IKQY3D_DATABASE_URL)("存量画布懒迁移（真库）", () => {
  let prisma: PrismaService;
  let projectId: bigint;
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKQY3D_DATABASE_URL;
    prisma = new PrismaService();
    const row = await prisma.client.project.create({
      data: { owner_id: OWNER_ID, name: `ikqy3d-${Date.now()}`, purpose: "canvas" },
      select: { id: true },
    });
    projectId = row.id;
  });

  beforeEach(async () => {
    await prisma.client.project_node_revisions.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_edges.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_nodes.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_card_migration_history.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_canvas.deleteMany({ where: { project_id: projectId } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.client.project_node_revisions.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_edges.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_nodes.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_card_migration_history.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_canvas.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project.delete({ where: { id: projectId } });
      await prisma.client.$disconnect();
    }
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  });

  const seedCanvas = (nodes: unknown[], edges: unknown[]) =>
    prisma.client.project_canvas.create({
      data: {
        project_id: projectId,
        nodes_json: nodes as unknown as Prisma.InputJsonValue,
        edges_json: edges as unknown as Prisma.InputJsonValue,
      },
    });

  const readView = async () => {
    const view = await createCanvasRepo(prisma.client).getByProject(projectId.toString());
    return {
      nodes: JSON.parse(view.nodes ?? "[]") as Array<Record<string, unknown>>,
      edges: JSON.parse(view.edges ?? "[]") as Array<Record<string, unknown>>,
    };
  };

  it("apply 首次写入先导入旧 JSON，再应用本次改动", async () => {
    await seedCanvas(
      [
        { id: "t1", type: "text", position: { x: 1.4, y: 2.6 }, data: { html: "<p>旧</p>" } },
        { id: "r1", type: "reference", position: { x: 3, y: 4 }, data: { content: "参考" } },
      ],
      [{ id: "e0", source: "t1", target: "r1" }],
    );

    const result = await applyCanvasChanges(prisma.client, {
      projectId: projectId.toString(),
      nodes: [{ id: "m1", type: "mediaNode", position: { x: 0, y: 0 }, data: { src: "https://example.com/a.png" } }],
      deleteNodeIds: [],
      edges: [{ id: "e1", source: "t1", target: "m1" }],
      deleteEdgeIds: [],
      actorId: OWNER_ID.toString(),
    });

    expect(result.upserted_node_ids).toEqual(["m1"]);
    expect(result.upserted_edge_ids).toEqual(["e1"]);
    const canvas = await prisma.client.project_canvas.findUniqueOrThrow({ where: { project_id: projectId } });
    expect(canvas.rows_authoritative).toBe(1);
    const rows = await prisma.client.project_nodes.findMany({
      where: { project_id: projectId, is_delete: 0 },
      orderBy: { id: "asc" },
      select: { node_id: true, type: true, pos_x: true, pos_y: true, data_json: true },
    });
    expect(rows.map((row) => [row.node_id, row.type])).toEqual([["t1", "text"], ["r1", "reference"], ["m1", "mediaNode"]]);
    expect(rows[0]).toMatchObject({ pos_x: 1, pos_y: 3 });
    const view = await readView();
    expect(view.nodes.map((node) => node.id)).toEqual(["t1", "r1", "m1"]);
    expect(view.edges.map((edge) => edge.id)).toEqual(["e0", "e1"]);
  });

  it("重复节点 id 保留第一条并报告，关联边仍指向保留节点", async () => {
    await seedCanvas(
      [
        { id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: { text: "第一" } },
        { id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: { text: "第二" } },
      ],
      [{ id: "e1", source: "n1", target: "n1" }],
    );

    const outcome = await ensureCanvasRowsImported(prisma.client, projectId);
    expect(outcome?.report.duplicate_node_ids).toEqual(["n1"]);
    expect(outcome?.report.imported_nodes).toBe(1);
    const row = await prisma.client.project_nodes.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: projectId, node_id: "n1" } },
    });
    expect(row.data_json).toEqual({ text: "第一" });
  });

  it("解析失败不写行、不开启标记，仍可按旧 JSON 读取", async () => {
    await seedCanvas([{ type: "textNode" }], []);

    await expect(ensureCanvasRowsImported(prisma.client, projectId)).rejects.toBeInstanceOf(CanvasRowsImportError);
    const canvas = await prisma.client.project_canvas.findUniqueOrThrow({ where: { project_id: projectId } });
    expect(canvas.rows_authoritative).toBe(0);
    expect(await prisma.client.project_nodes.count({ where: { project_id: projectId } })).toBe(0);
    const view = await readView();
    expect(view.nodes).toEqual([{ type: "textNode" }]);
  });

  it("可重复执行：第二次直接跳过，行数不翻倍", async () => {
    await seedCanvas([{ id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: { text: "甲" } }], []);

    const first = await ensureCanvasRowsImported(prisma.client, projectId);
    expect(first?.report.imported_nodes).toBe(1);
    const second = await ensureCanvasRowsImported(prisma.client, projectId);
    expect(second?.report.already_authoritative).toBe(true);
    expect(await prisma.client.project_nodes.count({ where: { project_id: projectId } })).toBe(1);
  });
});
