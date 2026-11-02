import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";






describe.skipIf(!process.env.IKFM3Q_DATABASE_URL)("Text node media index contract (IKFM3Q)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFM3Q_DATABASE_URL;
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
      data: { owner_id: 987654n, name: `ikfm3q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    });
  }
  async function createAsset(projectId: bigint, type: "image" | "video" | "audio", url: string, ownerId = 987654n) {
    const asset = await prisma.client.user_assets.create({ data: { user_id: ownerId, project_id: projectId, type, url, width: 640, height: 480 } });
    return asset.id.toString();
  }
  async function saveCanvas(projectId: bigint, nodes: unknown[], edges: unknown[], version: number | "missing") {
    return fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": version === "missing" ? '"missing"' : `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
  }
  async function readCanvasRow(projectId: bigint) {
    return prisma.client.project_canvas.findUnique({ where: { project_id: projectId } });
  }
  function parseNodes(row: { nodes_json: unknown }): Array<{ id: string; type: string; data: Record<string, unknown> }> {
    const raw = typeof row.nodes_json === "string" ? JSON.parse(row.nodes_json) : row.nodes_json;
    return raw as Array<{ id: string; type: string; data: Record<string, unknown> }>;
  }

  const mediaNode = (id: string, assetId: string, mediaType: string, src: string) => ({
    id, type: "mediaNode", position: { x: 0, y: 0 }, data: { assetId, mediaType, src, fileName: `素材${assetId}` },
  });
  const textNode = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
    id, type: "textNode", position: { x: 400, y: 0 }, data: { title: "文本", text, ...extra },
  });
  const indexEdge = (source: string, target: string) => ({ id: `e-${source}-${target}`, source, target, data: { textIndex: true } });

  it("合法新增：正文索引 + textIndex 关系线落库", async () => {
    const project = await createProject();
    const url = "https://example.com/cat.png";
    const assetId = await createAsset(project.id, "image", url);
    const text = "参考图片1生成";
    const nodes = [
      mediaNode("media-1", assetId, "image", url),
      textNode("text-1", text, {
        mediaMentions: [{ start: 2, end: 5, nodeId: "media-1", assetId }],
        mediaRefs: [{ nodeId: "media-1", assetId, mediaType: "image", name: "猫咪", url }],
      }),
    ];
    const saved = await saveCanvas(project.id, nodes, [indexEdge("media-1", "text-1")], "missing");
    expect(saved.status).toBe(200);
    const row = (await readCanvasRow(project.id))!;
    const persisted = parseNodes(row).find(n => n.id === "text-1")!;
    expect(persisted.data.mediaMentions).toEqual([{ start: 2, end: 5, nodeId: "media-1", assetId }]);
    expect(persisted.data.mediaRefs).toEqual([{ nodeId: "media-1", assetId, mediaType: "image", name: "猫咪", url }]);
    const edges = JSON.parse(typeof row.edges_json === "string" ? row.edges_json : JSON.stringify(row.edges_json)) as Array<{ id: string; data?: Record<string, unknown> }>;
    expect(edges).toEqual([{ id: "e-media-1-text-1", source: "media-1", target: "text-1", data: { textIndex: true } }]);
  });

  it("伪造身份：素材不存在 / 类型不符 / 地址不符均 400 零写入", async () => {
    const project = await createProject();
    const url = "https://example.com/dog.png";
    const assetId = await createAsset(project.id, "image", url);
    const text = "参考图片1";
    const baseMentions = [{ start: 2, end: 5, nodeId: "media-1", assetId }];
    const baseRefs = [{ nodeId: "media-1", assetId, mediaType: "image", name: "狗", url }];
    const nodes = [mediaNode("media-1", assetId, "image", url), textNode("text-1", text, { mediaMentions: baseMentions, mediaRefs: baseRefs })];

    const ghost = [mediaNode("media-1", "999999", "image", url), textNode("text-1", text, {
      mediaMentions: [{ start: 2, end: 5, nodeId: "media-1", assetId: "999999" }],
      mediaRefs: [{ nodeId: "media-1", assetId: "999999", mediaType: "image", name: "狗", url }],
    })];
    expect((await saveCanvas(project.id, ghost, [indexEdge("media-1", "text-1")], "missing")).status).toBe(400);

    const wrongType = [mediaNode("media-1", assetId, "video", url), textNode("text-1", text, {
      mediaMentions: baseMentions,
      mediaRefs: [{ ...baseRefs[0], mediaType: "video" }],
    })];
    expect((await saveCanvas(project.id, wrongType, [indexEdge("media-1", "text-1")], "missing")).status).toBe(400);

    const wrongUrl = [mediaNode("media-1", assetId, "image", url), textNode("text-1", text, {
      mediaMentions: baseMentions,
      mediaRefs: [{ ...baseRefs[0], url: "https://example.com/other.png" }],
    })];
    expect((await saveCanvas(project.id, wrongUrl, [indexEdge("media-1", "text-1")], "missing")).status).toBe(400);

    const wrongNode = [mediaNode("media-1", "888888", "image", url), textNode("text-1", text, { mediaMentions: baseMentions, mediaRefs: baseRefs })];
    expect((await saveCanvas(project.id, wrongNode, [indexEdge("media-1", "text-1")], "missing")).status).toBe(400);
    expect(await readCanvasRow(project.id)).toBeNull();
  });

  it("区间无效 / refs 不覆盖 / 字段缺省 / 非 textNode 均 400", async () => {
    const project = await createProject();
    const url = "https://example.com/a.png";
    const assetId = await createAsset(project.id, "image", url);
    const ref = { nodeId: "media-1", assetId, mediaType: "image", name: "图", url };

    const overlap = textNode("text-1", "图片1图片2", {
      mediaMentions: [{ start: 0, end: 4, nodeId: "media-1", assetId }, { start: 2, end: 6, nodeId: "media-1", assetId }],
      mediaRefs: [ref],
    });
    expect((await saveCanvas(project.id, [mediaNode("media-1", assetId, "image", url), overlap], [], "missing")).status).toBe(400);

    const missing = textNode("text-1", "图片1", { mediaMentions: [{ start: 0, end: 3, nodeId: "media-1", assetId }], mediaRefs: [] });
    expect((await saveCanvas(project.id, [mediaNode("media-1", assetId, "image", url), missing], [], "missing")).status).toBe(400);

    const extra = textNode("text-1", "图片1", {
      mediaMentions: [{ start: 0, end: 3, nodeId: "media-1", assetId }],
      mediaRefs: [ref, { ...ref, nodeId: "media-2" }],
    });
    expect((await saveCanvas(project.id, [mediaNode("media-1", assetId, "image", url), extra], [], "missing")).status).toBe(400);

    const onlyMentions = textNode("text-1", "图片1", { mediaMentions: [] });
    expect((await saveCanvas(project.id, [onlyMentions], [], "missing")).status).toBe(400);

    const mediaCarrying = { ...mediaNode("media-1", assetId, "image", url), data: { assetId, mediaType: "image", src: url, mediaMentions: [], mediaRefs: [] } };
    expect((await saveCanvas(project.id, [mediaCarrying], [], "missing")).status).toBe(400);
    expect(await readCanvasRow(project.id)).toBeNull();
  });

  it("存量失效豁免：来源节点与连线删除后编辑正文放行；展示元数据不可变", async () => {
    const project = await createProject();
    const url = "https://example.com/b.png";
    const assetId = await createAsset(project.id, "image", url);
    const mentions = [{ start: 2, end: 5, nodeId: "media-1", assetId }];
    const refs = [{ nodeId: "media-1", assetId, mediaType: "image", name: "旧图", url }];
    const first = await saveCanvas(project.id, [
      mediaNode("media-1", assetId, "image", url),
      textNode("text-1", "参考图片1", { mediaMentions: mentions, mediaRefs: refs }),
    ], [indexEdge("media-1", "text-1")], "missing");
    expect(first.status).toBe(200);
    const version = (await readCanvasRow(project.id))!.version;

    const edited = await saveCanvas(project.id, [
      textNode("text-1", "改为已失效：旧图继续", { mediaMentions: [{ start: 2, end: 8, nodeId: "media-1", assetId }], mediaRefs: refs }),
    ], [], version);
    expect(edited.status).toBe(200);
    const persisted = parseNodes((await readCanvasRow(project.id))!).find(n => n.id === "text-1")!;
    expect(persisted.data.text).toBe("改为已失效：旧图继续");
    expect(persisted.data.mediaRefs).toEqual(refs);

    const renamed = await saveCanvas(project.id, [
      textNode("text-1", "改为已失效：旧图继续", {
        mediaMentions: [{ start: 2, end: 8, nodeId: "media-1", assetId }],
        mediaRefs: [{ ...refs[0], name: "新名字" }],
      }),
    ], [], (await readCanvasRow(project.id))!.version);
    expect(renamed.status).toBe(400);
  });

  it("media 索引与 Agent 方案绑定区间重叠：整次保存拒绝", async () => {
    const project = await createProject();
    const url = "https://example.com/c.png";
    const assetId = await createAsset(project.id, "image", url);
    const promptSource = { sessionId: "ikfm3q-session", revisionId: "rev-1", shotNo: 1 };

    await prisma.client.project_canvas.create({ data: {
      project_id: project.id,
      nodes_json: [
        mediaNode("media-1", assetId, "image", url),
        { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: {
          title: "方案卡", text: "参考素材#1尾巴", promptOriginalTitle: "原题", promptSource,
          promptMentions: [{ start: 2, end: 6, index: 1, assetId }],
          promptMaterials: [{ assetId, mediaType: "image", url }],
        } },
      ],
      edges_json: [], viewport_json: {}, version: 1,
    } });

    const overlapped = await saveCanvas(project.id, [
      mediaNode("media-1", assetId, "image", url),
      { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: {
        title: "方案卡", text: "参考素材#1尾巴", promptOriginalTitle: "原题", promptSource,
        promptMentions: [{ start: 2, end: 6, index: 1, assetId }],
        promptMaterials: [{ assetId, mediaType: "image", url }],
        mediaMentions: [{ start: 4, end: 9, nodeId: "media-1", assetId }],
        mediaRefs: [{ nodeId: "media-1", assetId, mediaType: "image", name: "图", url }],
      } },
    ], [indexEdge("media-1", "text-1")], 1);
    expect(overlapped.status).toBe(400);

    const clean = await saveCanvas(project.id, [
      mediaNode("media-1", assetId, "image", url),
      { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: {
        title: "方案卡", text: "参考素材#1尾巴", promptOriginalTitle: "原题", promptSource,
        promptMentions: [{ start: 2, end: 6, index: 1, assetId }],
        promptMaterials: [{ assetId, mediaType: "image", url }],
        mediaMentions: [{ start: 6, end: 8, nodeId: "media-1", assetId }],
        mediaRefs: [{ nodeId: "media-1", assetId, mediaType: "image", name: "图", url }],
      } },
    ], [indexEdge("media-1", "text-1")], 1);
    expect(clean.status).toBe(200);
  });

  it("同区间且同 assetId（applyPreview 派生的方案绑定镜像）：放行并落库", async () => {
    const project = await createProject();
    const url = "https://example.com/mirror.png";
    const assetId = await createAsset(project.id, "image", url);
    const promptSource = { sessionId: "ikh4ef-session", revisionId: "rev-1", shotNo: 1 };

    await prisma.client.project_canvas.create({ data: {
      project_id: project.id,
      nodes_json: [
        mediaNode("media-1", assetId, "image", url),
        { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: {
          title: "方案卡", text: "参考素材#1尾巴", promptOriginalTitle: "原题", promptSource,
          promptMentions: [{ start: 2, end: 6, index: 1, assetId }],
          promptMaterials: [{ assetId, mediaType: "image", url }],
        } },
      ],
      edges_json: [], viewport_json: {}, version: 1,
    } });
    const mirrored = await saveCanvas(project.id, [
      mediaNode("media-1", assetId, "image", url),
      { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: {
        title: "方案卡", text: "参考素材#1尾巴", promptOriginalTitle: "原题", promptSource,
        promptMentions: [{ start: 2, end: 6, index: 1, assetId }],
        promptMaterials: [{ assetId, mediaType: "image", url }],
        mediaMentions: [{ start: 2, end: 6, nodeId: "media-1", assetId }],
        mediaRefs: [{ nodeId: "media-1", assetId, mediaType: "image", name: "图", url }],
      } },
    ], [indexEdge("media-1", "text-1")], 1);
    expect(mirrored.status).toBe(200);
    const persisted = parseNodes((await readCanvasRow(project.id))!).find(n => n.id === "text-1")!;
    expect(persisted.data.mediaMentions).toEqual([{ start: 2, end: 6, nodeId: "media-1", assetId }]);
    expect(persisted.data.promptMentions).toEqual([{ start: 2, end: 6, index: 1, assetId }]);
  });

  it("同区间但指向不同 assetId：仍 400（脏数据不被静默放过）", async () => {
    const project = await createProject();
    const urlA = "https://example.com/a.png";
    const urlB = "https://example.com/b.png";
    const assetA = await createAsset(project.id, "image", urlA);
    const assetB = await createAsset(project.id, "image", urlB);
    const promptSource = { sessionId: "ikh4ef-dirty", revisionId: "rev-1", shotNo: 1 };
    await prisma.client.project_canvas.create({ data: {
      project_id: project.id,
      nodes_json: [
        mediaNode("media-1", assetA, "image", urlA),
        { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: {
          title: "方案卡", text: "参考素材#1尾巴", promptOriginalTitle: "原题", promptSource,
          promptMentions: [{ start: 2, end: 6, index: 1, assetId: assetA }],
          promptMaterials: [{ assetId: assetA, mediaType: "image", url: urlA }],
        } },
      ],
      edges_json: [], viewport_json: {}, version: 1,
    } });

    const dirty = await saveCanvas(project.id, [
      mediaNode("media-1", assetA, "image", urlA),
      { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: {
        title: "方案卡", text: "参考素材#1尾巴", promptOriginalTitle: "原题", promptSource,
        promptMentions: [{ start: 2, end: 6, index: 1, assetId: assetB }],
        promptMaterials: [{ assetId: assetB, mediaType: "image", url: urlB }],
        mediaMentions: [{ start: 2, end: 6, nodeId: "media-1", assetId: assetA }],
        mediaRefs: [{ nodeId: "media-1", assetId: assetA, mediaType: "image", name: "图", url: urlA }],
      } },
    ], [indexEdge("media-1", "text-1")], 1);
    expect(dirty.status).toBe(400);
  });

  it("失效身份重新绑定新素材后落库为有效索引", async () => {
    const project = await createProject();
    const urlA = "https://example.com/old.png";
    const urlB = "https://example.com/new.png";
    const assetA = await createAsset(project.id, "image", urlA);
    const assetB = await createAsset(project.id, "image", urlB);
    const first = await saveCanvas(project.id, [
      mediaNode("media-1", assetA, "image", urlA),
      textNode("text-1", "参考图片1", {
        mediaMentions: [{ start: 2, end: 5, nodeId: "media-1", assetId: assetA }],
        mediaRefs: [{ nodeId: "media-1", assetId: assetA, mediaType: "image", name: "旧图", url: urlA }],
      }),
    ], [indexEdge("media-1", "text-1")], "missing");
    expect(first.status).toBe(200);

    const rebound = await saveCanvas(project.id, [
      mediaNode("media-2", assetB, "image", urlB),
      textNode("text-1", "参考图片1", {
        mediaMentions: [{ start: 2, end: 5, nodeId: "media-2", assetId: assetB }],
        mediaRefs: [{ nodeId: "media-2", assetId: assetB, mediaType: "image", name: "新图", url: urlB }],
      }),
    ], [indexEdge("media-2", "text-1")], (await readCanvasRow(project.id))!.version);
    expect(rebound.status).toBe(200);
    const persisted = parseNodes((await readCanvasRow(project.id))!).find(n => n.id === "text-1")!;
    expect(persisted.data.mediaRefs).toEqual([{ nodeId: "media-2", assetId: assetB, mediaType: "image", name: "新图", url: urlB }]);
  });
});
