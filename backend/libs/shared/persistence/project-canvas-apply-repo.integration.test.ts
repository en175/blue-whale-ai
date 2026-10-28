import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  CanvasApplyConflictError,
  applyCanvasChanges,
} from "./project-canvas-apply-repo.js";

const OWNER_ID = 987654n;

describe.skipIf(!process.env.IKQY35_DATABASE_URL)("画布按节点 apply（真库）", () => {
  let prisma: PrismaService;
  let projectId: bigint;
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKQY35_DATABASE_URL;
    prisma = new PrismaService();
    const row = await prisma.client.project.create({
      data: { owner_id: OWNER_ID, name: `ikqy35-${Date.now()}`, purpose: "canvas" },
      select: { id: true },
    });
    projectId = row.id;
  });

  beforeEach(async () => {
    await prisma.client.project_node_revisions.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_edges.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_nodes.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_canvas.deleteMany({ where: { project_id: projectId } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.client.project_node_revisions.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_edges.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_nodes.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_canvas.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project.delete({ where: { id: projectId } });
      await prisma.client.$disconnect();
    }
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  });

  const apply = (input: {
    nodes?: Array<{ id: string; type: string; position?: { x: number; y: number }; data?: Record<string, unknown> }>;
    deleteNodeIds?: string[];
    edges?: Array<{ id: string; source: string; target: string; [key: string]: unknown }>;
    deleteEdgeIds?: string[];
    viewport?: unknown;
  }) =>
    applyCanvasChanges(prisma.client, {
      projectId: projectId.toString(),
      nodes: input.nodes ?? [],
      deleteNodeIds: input.deleteNodeIds ?? [],
      edges: input.edges ?? [],
      deleteEdgeIds: input.deleteEdgeIds ?? [],
      viewport: input.viewport,
      actorId: OWNER_ID.toString(),
    });

  it("新增节点与边：落行、记 revision、版本递增", async () => {
    const result = await apply({
      nodes: [
        { id: "n1", type: "textNode", position: { x: 1, y: 2 }, data: { text: "甲" } },
        { id: "n2", type: "mediaNode", position: { x: 3, y: 4 }, data: { type: "image" } },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    });
    expect(result.upserted_node_ids).toEqual(["n1", "n2"]);
    expect(result.upserted_edge_ids).toEqual(["e1"]);
    expect(await prisma.client.project_nodes.count({ where: { project_id: projectId } })).toBe(2);
    expect(await prisma.client.project_edges.count({ where: { project_id: projectId } })).toBe(1);
    expect(await prisma.client.project_node_revisions.count({ where: { project_id: projectId } })).toBe(2);
  });

  it("无差异重放：跳过、不涨版本、不写 revision", async () => {
    await apply({ nodes: [{ id: "n1", type: "textNode", position: { x: 1, y: 2 }, data: { text: "甲" } }] });
    const before = await prisma.client.project_canvas.findFirstOrThrow({ where: { project_id: projectId } });
    const revisions = await prisma.client.project_node_revisions.count({ where: { project_id: projectId } });
    const result = await apply({ nodes: [{ id: "n1", type: "textNode", position: { x: 1, y: 2 }, data: { text: "甲" } }] });
    expect(result.skipped_node_ids).toEqual(["n1"]);
    expect(result.upserted_node_ids).toEqual([]);
    const after = await prisma.client.project_canvas.findFirstOrThrow({ where: { project_id: projectId } });
    expect(after.version).toBe(before.version);
    expect(await prisma.client.project_node_revisions.count({ where: { project_id: projectId } })).toBe(revisions);
  });

  it("只改一个节点：另一节点版本与内容不变", async () => {
    await apply({
      nodes: [
        { id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: { text: "甲" } },
        { id: "n2", type: "textNode", position: { x: 0, y: 0 }, data: { text: "乙" } },
      ],
    });
    const n2Before = await prisma.client.project_nodes.findFirstOrThrow({ where: { project_id: projectId, node_id: "n2" } });
    await apply({ nodes: [{ id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: { text: "甲改" } }] });
    const n2After = await prisma.client.project_nodes.findFirstOrThrow({ where: { project_id: projectId, node_id: "n2" } });
    expect(n2After.version).toBe(n2Before.version);
    expect(n2After.data_json).toEqual(n2Before.data_json);
    const revision = await prisma.client.project_node_revisions.findFirstOrThrow({
      where: { project_id: projectId, node_id: "n1", op: "update" },
    });
    expect(revision.changes).toMatchObject({ data: { from: { text: "甲" }, to: { text: "甲改" } } });
  });

  it("删除节点：软删并级联软删其连线", async () => {
    await apply({
      nodes: [
        { id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: {} },
        { id: "n2", type: "textNode", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    });
    const result = await apply({ deleteNodeIds: ["n1"] });
    expect(result.deleted_node_ids).toEqual(["n1"]);
    expect(result.cascaded_edge_ids).toEqual(["e1"]);
    expect((await prisma.client.project_nodes.findFirstOrThrow({ where: { project_id: projectId, node_id: "n1" } })).is_delete).toBe(1);
    expect((await prisma.client.project_edges.findFirstOrThrow({ where: { project_id: projectId, edge_id: "e1" } })).is_delete).toBe(1);
  });

  it("复活软删节点：同 id 再写入恢复为有效行", async () => {
    await apply({ nodes: [{ id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: {} }] });
    await apply({ deleteNodeIds: ["n1"] });
    await apply({ nodes: [{ id: "n1", type: "textNode", position: { x: 9, y: 9 }, data: { text: "回来" } }] });
    const row = await prisma.client.project_nodes.findFirstOrThrow({ where: { project_id: projectId, node_id: "n1" } });
    expect(row.is_delete).toBe(0);
    expect(row.pos_x).toBe(9);
  });

  it("同一对节点用不同 edge_id 再写：拒绝为 duplicate_edge_pair", async () => {
    await apply({
      nodes: [
        { id: "n1", type: "textNode", position: { x: 0, y: 0 }, data: {} },
        { id: "n2", type: "textNode", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    });
    await expect(
      apply({ edges: [{ id: "e2", source: "n1", target: "n2" }] }),
    ).rejects.toBeInstanceOf(CanvasApplyConflictError);
  });
});
