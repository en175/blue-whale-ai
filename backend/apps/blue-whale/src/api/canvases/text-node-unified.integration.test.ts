import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";






describe.skipIf(!process.env.IKFM3L_DATABASE_URL)("Unified text node content contract (IKFM3L)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFM3L_DATABASE_URL;
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController], providers: [
      { provide: CanvasService, useValue: canvasService },
      { provide: PrismaService, useValue: prisma },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
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
      data: { owner_id: 987654n, name: `ikfm3l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    });
  }
  async function saveCanvas(projectId: bigint, nodes: unknown[], edges: unknown[], version: number | "missing") {
    const response = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": version === "missing" ? '"missing"' : `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
    return response;
  }
  async function readCanvasRow(projectId: bigint) {
    return prisma.client.project_canvas.findUnique({ where: { project_id: projectId } });
  }
  function parseNodes(row: { nodes_json: unknown }): Array<{ id: string; position: { x: number; y: number }; data: Record<string, unknown> }> {
    const raw = typeof row.nodes_json === "string" ? JSON.parse(row.nodes_json) : row.nodes_json;
    return raw as Array<{ id: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  }

  it("普通新增：Markdown 源正文直存，无 html 通道", async () => {
    const project = await createProject();
    const markdown = "# 标题\n\n正文 **粗体** *斜体*\n\n- 项一\n- 项二\n\n1. 一\n2. 二\n\n---";
    const nodes = [{ id: "text-new", type: "textNode", position: { x: 10, y: 20 }, data: { title: "新卡", text: markdown } }];
    const saved = await saveCanvas(project.id, nodes, [], "missing");
    expect(saved.status).toBe(200);
    const row = await readCanvasRow(project.id);
    const persisted = parseNodes(row!)[0];
    expect(persisted.id).toBe("text-new");
    expect(persisted.position).toEqual({ x: 10, y: 20 });
    expect(persisted.data.title).toBe("新卡");
    expect(persisted.data.text).toBe(markdown);
    expect(persisted.data.html).toBeUndefined();
  });

  it("历史纯文本卡：正文原样保留，不引入 html", async () => {
    const project = await createProject();
    const nodes = [{ id: "text-legacy", type: "textNode", position: { x: 1, y: 2 }, data: { title: "旧便签", text: "一段旧正文" } }];
    await saveCanvas(project.id, nodes, [], "missing");
    const persisted = parseNodes((await readCanvasRow(project.id))!)[0];
    expect(persisted.data.text).toBe("一段旧正文");
    expect(persisted.data.html).toBeUndefined();
  });

  it("历史 HTML 卡：存量经 API 保存原样保留（升级在前端读时发生）；升级后形态落盘通过校验", async () => {
    const project = await createProject();

    const legacy = [{ id: "text-html", type: "textNode", position: { x: 3, y: 4 }, data: { title: "HTML 旧卡", html: "<h1>旧标题</h1><p>旧<b>粗</b>正文</p>" } }];
    const first = await saveCanvas(project.id, legacy, [], "missing");
    expect(first.status).toBe(200);
    const persistedLegacy = parseNodes((await readCanvasRow(project.id))!)[0];
    expect(persistedLegacy.data.html).toBe("<h1>旧标题</h1><p>旧<b>粗</b>正文</p>");

    const upgraded = [{ id: "text-html", type: "textNode", position: { x: 3, y: 4 }, data: { title: "HTML 旧卡", text: "# 旧标题\n\n旧**粗**正文" } }];
    const second = await saveCanvas(project.id, upgraded, [], (await readCanvasRow(project.id))!.version);
    expect(second.status).toBe(200);
    const persistedUpgraded = parseNodes((await readCanvasRow(project.id))!)[0];
    expect(persistedUpgraded.data.text).toBe("# 旧标题\n\n旧**粗**正文");
    expect(persistedUpgraded.data.html).toBeUndefined();
  });

  it("Agent 绑定卡：直写 DB 种子读回保留身份与区间；编辑后经 API 保存不变式通过", async () => {
    const project = await createProject();
    const promptSource = { sessionId: "ikfm3l-session", revisionId: "rev-1", shotNo: 1 };
    const seed = [
      { id: "text-agent", type: "textNode", position: { x: 5, y: 6 }, data: {
        title: "方案卡", text: "参考这段素材继续", promptOriginalTitle: "原题",
        promptMentions: [{ start: 2, end: 6, index: 1, assetId: "9001" }],
        promptMaterials: [{ assetId: "9001", mediaType: "image", url: "https://example.com/m.png" }],
        promptSource,
      } },
    ];

    const forged = [{ id: "text-forged", type: "textNode", position: { x: 0, y: 0 }, data: { text: "x", promptMentions: [{ start: 0, end: 1, index: 1, assetId: "9001" }] } }];
    const rejected = await saveCanvas(project.id, forged, [], "missing");
    expect(rejected.status).toBe(400);

    await prisma.client.project_canvas.create({ data: { project_id: project.id, nodes_json: seed, edges_json: [], viewport_json: {}, version: 1 } });
    const row = (await readCanvasRow(project.id))!;
    expect(parseNodes(row)[0].data.promptSource).toEqual(promptSource);

    const edited = [JSON.parse(JSON.stringify(seed[0]))];
    edited[0].data.text = "编辑后 **加粗** 的正文";
    edited[0].data.promptMentions = [];
    delete edited[0].data.html;
    const saved = await saveCanvas(project.id, edited, [], row.version);
    expect(saved.status).toBe(200);
    const persisted = parseNodes((await readCanvasRow(project.id))!)[0];
    expect(persisted.data.text).toBe("编辑后 **加粗** 的正文");
    expect(persisted.data.promptSource).toEqual(promptSource);
  });

  it("data.html 超长被拒绝（堵住存量通道绕过正文限长）", async () => {
    const project = await createProject();
    const nodes = [{ id: "text-huge", type: "textNode", position: { x: 0, y: 0 }, data: { title: "超长", html: `<p>${"长".repeat(100_001)}</p>` } }];
    const response = await saveCanvas(project.id, nodes, [], "missing");
    expect(response.status).toBe(400);
    const body = await response.json() as { message: string };
    expect(body.message).toContain("文本超限");
  });
});
