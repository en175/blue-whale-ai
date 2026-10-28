import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { createCanvasRepo } from "./canvas-repo.js";

const OWNER_ID = 987652n;
const SIZES = Number(process.env.IKQY3G_NODES ?? 0) > 0
  ? [Number(process.env.IKQY3G_NODES)]
  : [200, 1000];
const ITERATIONS = Number(process.env.IKQY3G_ITERATIONS ?? 30);

function nodesOf(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    type: index % 2 === 0 ? "textNode" : "mediaNode",
    position: { x: index * 20, y: index * 10 },
    data: index % 2 === 0
      ? { title: `节点 ${index}`, text: `正文 ${index}`, prompt: "一只蓝鲸", fontSize: 14 }
      : { mediaType: "image", assetId: String(800000 + index), fileName: `参考 ${index}.png`, src: `https://example.test/${index}.png` },
  }));
}

function edgesOf(count: number) {
  return Array.from({ length: count - 1 }, (_, index) => ({
    id: `e${index}`,
    source: `n${index}`,
    target: `n${index + 1}`,
    data: { refRole: index % 2 === 0 ? "reference" : "source" },
  }));
}

function byId(list: Array<Record<string, unknown>>) {
  return [...list].sort((left, right) => String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0);
}

async function medianRead(repo: ReturnType<typeof createCanvasRepo>, projectId: string) {
  const samples: number[] = [];
  let payloadBytes = 0;
  for (let index = 0; index < ITERATIONS; index += 1) {
    const started = process.hrtime.bigint();
    const view = await repo.getByProject(projectId);
    samples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    payloadBytes = Buffer.byteLength(view.nodes ?? "", "utf8") + Buffer.byteLength(view.edges ?? "", "utf8");
  }
  samples.sort((left, right) => left - right);
  return {
    median: Number(samples[Math.floor(samples.length / 2)]!.toFixed(3)),
    min: Number(samples[0]!.toFixed(3)),
    max: Number(samples[samples.length - 1]!.toFixed(3)),
    payloadBytes,
  };
}

describe.skipIf(!process.env.IKQY3G_DATABASE_URL)("画布读取效率对比（JSON 与行表）", () => {
  let prisma: PrismaService;
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKQY3G_DATABASE_URL;
    prisma = new PrismaService();
  });

  afterAll(async () => {
    if (prisma) await prisma.client.$disconnect();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  });

  async function measureSize(nodeCount: number) {
    const nodes = nodesOf(nodeCount);
    const edges = edgesOf(nodeCount);
    const [jsonProject, rowsProject] = await Promise.all([
      prisma.client.project.create({ data: { owner_id: OWNER_ID, name: `ikqy3g-json-${nodeCount}-${Date.now()}`, purpose: "canvas" }, select: { id: true } }),
      prisma.client.project.create({ data: { owner_id: OWNER_ID, name: `ikqy3g-rows-${nodeCount}-${Date.now()}`, purpose: "canvas" }, select: { id: true } }),
    ]);
    const projectIds = [jsonProject.id, rowsProject.id];
    try {
      await prisma.client.project_canvas.create({
        data: { project_id: jsonProject.id, nodes_json: nodes as never, edges_json: edges as never, rows_authoritative: 0 },
      });
      await prisma.client.project_canvas.create({
        data: { project_id: rowsProject.id, viewport_json: {}, rows_authoritative: 1 },
      });
      await prisma.client.project_nodes.createMany({
        data: nodes.map((node) => ({
          project_id: rowsProject.id,
          node_id: node.id,
          type: node.type,
          name: typeof (node.data as Record<string, unknown>).title === "string" ? (node.data as Record<string, unknown>).title as string : null,
          source: "user",
          pos_x: node.position.x,
          pos_y: node.position.y,
          data_json: node.data,
        })),
      });
      await prisma.client.project_edges.createMany({
        data: edges.map((edge) => ({
          project_id: rowsProject.id,
          edge_id: edge.id,
          source_node_id: edge.source,
          target_node_id: edge.target,
          ref_role: edge.data.refRole,
          data_json: edge.data,
        })),
      });

      const repo = createCanvasRepo(prisma.client);
      const jsonRead = await medianRead(repo, jsonProject.id.toString());
      const rowsRead = await medianRead(repo, rowsProject.id.toString());
      console.info(
        [
          "",
          `节点 ${nodeCount} / 连线 ${edges.length}，各读 ${ITERATIONS} 次（本地 MySQL）`,
          `JSON 读取：中位 ${jsonRead.median} ms（min ${jsonRead.min} / max ${jsonRead.max}），返回 ${jsonRead.payloadBytes} B`,
          `行表读取：中位 ${rowsRead.median} ms（min ${rowsRead.min} / max ${rowsRead.max}），返回 ${rowsRead.payloadBytes} B`,
          "",
        ].join("\n"),
      );

      const [jsonView, rowsView] = await Promise.all([
        repo.getByProject(jsonProject.id.toString()),
        repo.getByProject(rowsProject.id.toString()),
      ]);
      expect(byId(JSON.parse(rowsView.nodes ?? "[]"))).toEqual(byId(JSON.parse(jsonView.nodes ?? "[]")));
      expect(byId(JSON.parse(rowsView.edges ?? "[]"))).toEqual(byId(JSON.parse(jsonView.edges ?? "[]")));

      const rawRows = await prisma.client.project_nodes.findMany({
        where: { project_id: rowsProject.id, is_delete: 0 },
        orderBy: { id: "asc" },
        select: { node_id: true, type: true, data_json: true },
      });
      expect(rawRows).toHaveLength(nodeCount);
      expect(rawRows[0]).toMatchObject({ node_id: nodes[0]!.id, type: nodes[0]!.type, data_json: nodes[0]!.data });
    } finally {
      for (const projectId of projectIds) {
        await prisma.client.project_nodes.deleteMany({ where: { project_id: projectId } });
        await prisma.client.project_edges.deleteMany({ where: { project_id: projectId } });
        await prisma.client.project_canvas.deleteMany({ where: { project_id: projectId } });
        await prisma.client.project.delete({ where: { id: projectId } });
      }
    }
  }

  it.each(SIZES)("同一节点规模（%i）下比较读取耗时与返回数据量", async (nodeCount) => {
    await measureSize(nodeCount);
  });
});
