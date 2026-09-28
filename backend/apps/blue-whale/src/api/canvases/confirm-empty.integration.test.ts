import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";

/* IKIMQJ 确认清空版本前置（父规格 IKIMPQ 契约 §9）：
   已有非空画布的破坏性清空只认明确的数值 If-Match——
   缺头 428、"missing" 哨兵与过期数值版本 412（带回当前版本），零写入不消耗版本；
   当前数值版本放行。全程经真实 HTTP + 隔离 MySQL（IKIMQJ_DATABASE_URL 门控），
   每步回读持久行核对节点与版本，不以事务 mock 代替持久状态。 */
describe.skipIf(!process.env.IKIMQJ_DATABASE_URL)("Confirm-empty version guard (IKIMQJ)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKIMQJ_DATABASE_URL;
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController], providers: [
      { provide: CanvasService, useValue: canvasService },
      { provide: PrismaService, useValue: prisma },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.use(json({ limit: "16mb" }));
    app.setGlobalPrefix("api");
    app.use((req: { user: unknown }, _res: unknown, next: () => void) => {
      req.user = { userId: "987654" };
      next();
    });
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    await prisma.client.$disconnect();
  });

  async function createProject() {
    return prisma.client.project.create({
      data: { owner_id: 987654n, name: `ikimqj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    });
  }
  async function putCanvas(projectId: bigint, body: Record<string, unknown>, ifMatch?: string) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (ifMatch !== undefined) headers["if-match"] = ifMatch;
    return fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
  }
  async function readCanvasRow(projectId: bigint) {
    return prisma.client.canvas.findUnique({ where: { project_id: projectId } });
  }
  function parseNodes(row: { nodes_json: unknown }): Array<{ id: string; type: string }> {
    const raw = typeof row.nodes_json === "string" ? JSON.parse(row.nodes_json) : row.nodes_json;
    return (raw ?? []) as Array<{ id: string; type: string }>;
  }
  async function expectPersisted(projectId: bigint, expectedNodes: Array<{ id: string }>, expectedVersion: number) {
    const row = await readCanvasRow(projectId);
    expect(parseNodes(row!)).toEqual(expectedNodes);
    expect(row!.version).toBe(expectedVersion);
  }

  const SEED = [{ id: "text-1", type: "textNode", position: { x: 0, y: 0 }, data: { title: "t", text: "正文" } }];
  const seedBody = { nodes: JSON.stringify(SEED), edges: "[]", viewport: "{}" };
  const emptyBody = { nodes: "[]", edges: "[]", viewport: "{}" };
  const confirmedEmptyBody = { ...emptyBody, confirmEmpty: true };

  it("非空画布确认清空：缺头 428 → 哨兵 412 → 旧版本 412 → 未确认 422 → 当前版本成功；每步回读持久节点与版本", async () => {
    const project = await createProject();
    const created = await putCanvas(project.id, seedBody, '"missing"');
    expect(created.status).toBe(200);
    const version = ((await created.json()) as { data: { version: number } }).data.version;
    expect(version).toBe(0);

    // 确认清空缺 If-Match → 428，节点与版本原样
    const noHeader = await putCanvas(project.id, confirmedEmptyBody);
    expect(noHeader.status).toBe(428);
    await expectPersisted(project.id, SEED, version);

    // "missing" 哨兵只用于首次创建，不得充当已有非空画布的清空许可 → 412 带当前版本
    const sentinel = await putCanvas(project.id, confirmedEmptyBody, '"missing"');
    expect(sentinel.status).toBe(412);
    expect(((await sentinel.json()) as { data: unknown }).data).toEqual({ version });
    await expectPersisted(project.id, SEED, version);

    // 过期数值版本 → 412 带当前版本
    const stale = await putCanvas(project.id, confirmedEmptyBody, `"${version + 5}"`);
    expect(stale.status).toBe(412);
    expect(((await stale.json()) as { data: unknown }).data).toEqual({ version });
    await expectPersisted(project.id, SEED, version);

    // 未确认的非空到空提交（IKIIWN 回归）→ 422，零写入
    const unconfirmed = await putCanvas(project.id, emptyBody, `"${version}"`);
    expect(unconfirmed.status).toBe(422);
    await expectPersisted(project.id, SEED, version);

    // 当前数值版本 + confirmEmpty → 成功清空，版本前进一步
    const cleared = await putCanvas(project.id, confirmedEmptyBody, `"${version}"`);
    expect(cleared.status).toBe(200);
    await expectPersisted(project.id, [], version + 1);
  });

  it("If-Match 格式无效仍按既有 400 拒绝，零写入", async () => {
    const project = await createProject();
    await putCanvas(project.id, seedBody, '"missing"');

    const bad = await putCanvas(project.id, confirmedEmptyBody, 'W/"0"');
    expect(bad.status).toBe(400);
    await expectPersisted(project.id, SEED, 0);
  });

  it("首次创建空画布仍可用（哨兵 + 空文档）", async () => {
    const project = await createProject();

    const first = await putCanvas(project.id, emptyBody, '"missing"');
    expect(first.status).toBe(200);
    await expectPersisted(project.id, [], 0);
  });

  it("已有画布但当前为空：缺头空保存不触发 428/422（非破坏性路径保持既有行为）", async () => {
    const project = await createProject();
    await putCanvas(project.id, emptyBody, '"missing"');

    const resaved = await putCanvas(project.id, confirmedEmptyBody);
    expect(resaved.status).toBe(200);
    await expectPersisted(project.id, [], 1);
  });
});
