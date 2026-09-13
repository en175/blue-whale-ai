import "reflect-metadata";
import { createServer } from "node:http";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";
import { GenerationModelsController } from "../generation/models.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { createWorkerRepo } from "@lib/shared/persistence/generation-worker-repo.js";
import { runVideoJobStep } from "@lib/shared/generation-runtime/video-job-runner.js";
import { createNewApiVideoTaskProvider } from "@lib/shared/generation-runtime/new-api-video-task-provider.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";

// IKFC26「方案绑定媒体时同步视频模式与恢复状态」公开接口集成：
// 真 NestFactory 挂载生产 Canvas/Generation 控制器与服务 + 隔离 MySQL（IKFC26_DATABASE_URL 门控）。
// 链路：prompt-previews/apply 造方案与素材 → PUT 画布加视频目标 → POST prompt-references 绑定
// → 服务端同步 draftMode（文生视频 → 全能参考）随 edges 一并持久化 → GET 回读 → generation-jobs
// 实际提交（references 冻结）→ runVideoJobStep 记录式供应商消费（外部供应商为替身，非真实生成）。
describe.skipIf(!process.env.IKFC26_DATABASE_URL)("Plan media binding syncs video mode (IKFC26)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "doubao-seedance-2-0-ikfc26";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  let projectId = "";
  const source = { sessionId: "session-ikfc26", revisionId: "revision-one", shotNo: 1 };
  let materialPayload: Record<string, unknown> | undefined;
  const videoRequests: Array<{ prompt: string; metadata: { content: unknown[] } }> = [];
  const agent = createServer((req, res) => {
    if (req.url === "/v1/video/generations") {
      let body = ""; req.on("data", chunk => { body += chunk; });
      req.on("end", () => { videoRequests.push(JSON.parse(body)); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ task_id: "ikfc26-task", status: "queued" })); });
      return;
    }
    if (req.url?.startsWith("/v1/video/generations/")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ task_id: "ikfc26-task", status: "succeeded", result_url: `${process.env.AGENT_SERVICE_BASE_URL}/out.mp4` })); return;
    }
    if (req.url === "/api/usage/token/") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ success: true, data: { user_quota: 1000000 } })); return; }
    if (req.url === "/out.mp4" || req.url?.startsWith("/ref-")) { res.setHeader("content-type", req.url === "/out.mp4" ? "video/mp4" : "application/octet-stream"); res.end("x"); return; }
    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/events?after=0") || req.url?.includes("/events")) { res.setHeader("content-type", "text/event-stream"); res.write(": connected\n\n"); return; }
    if (!req.url?.endsWith("/snapshot")) { res.end(JSON.stringify({ items: [] })); return; }
    res.end(JSON.stringify({ session: { session_id: source.sessionId, title: "IKFC26", phase: "idle", lifecycle: "active" }, event_cursor: "0", messages: [], prompt_cards: [{
      session_id: source.sessionId,
      active_revision: { revision_id: source.revisionId, payload: materialPayload ?? {
        target_media: "video", assets: [],
        shots: [{ shot_no: 1, title: "纯文本方案", prompt_text: "只有文字" }],
      } },
    }] }));
  });
  const previousDatabase = process.env.DATABASE_URL;
  const previousAgent = process.env.AGENT_SERVICE_BASE_URL;
  const previousNewApi = process.env.NEW_API_BASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFC26_DATABASE_URL;
    vi.stubEnv("ROCKETMQ_ENDPOINTS", "");
    await new Promise<void>(resolve => agent.listen(0, "127.0.0.1", resolve));
    process.env.AGENT_SERVICE_BASE_URL = `http://127.0.0.1:${(agent.address() as { port: number }).port}`;
    process.env.NEW_API_BASE_URL = process.env.AGENT_SERVICE_BASE_URL;
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfc26-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikfc26-test", model_id: MODEL_ID, capability_type: "video", model_label: "IKFC26",
        supported_sizes: [{ id: "720p", label: "720p" }], supported_aspect_ratios: ["16:9"], supported_formats: ["mp4"],
        default_size: "720p", default_aspect_ratio: "16:9", default_duration: 5, supported_durations: { min: 4, max: 12, step: 1 },
        features: { reference_image: true, max_reference_images: 9, first_frame: true, last_frame: true, first_last_frame: true },
      },
      update: { features: { reference_image: true, max_reference_images: 9, first_frame: true, last_frame: true, first_last_frame: true } },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, GenerationCostEstimatorService, CanvasService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController], providers: [
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      { provide: GenerationCostEstimatorService, useValue: new GenerationCostEstimatorService() },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
    app.use(json({ limit: "16mb" }));
    app.setGlobalPrefix("api");
    app.use((req: { user: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = { userId: "987654" };
      req.headers.authorization ||= "Bearer sk-ikfc26-test";
      next();
    });
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  }, 30_000);
  afterAll(async () => {
    await app?.close();
    agent.closeAllConnections();
    await new Promise<void>(resolve => agent.close(() => resolve()));
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousAgent === undefined) delete process.env.AGENT_SERVICE_BASE_URL;
    else process.env.AGENT_SERVICE_BASE_URL = previousAgent;
    if (previousNewApi === undefined) delete process.env.NEW_API_BASE_URL;
    else process.env.NEW_API_BASE_URL = previousNewApi;
    vi.unstubAllEnvs();
    await prisma.client.$disconnect();
  });

  async function createAsset(name: string, type: "image" | "video" | "audio") {
    const asset = await prisma.client.assets.create({ data: {
      user_id: 987654n, project_id: BigInt(projectId), type,
      url: `${process.env.AGENT_SERVICE_BASE_URL}/ref-${name}.${type === "image" ? "png" : type === "video" ? "mp4" : "mp3"}`,
      ...(type === "image" ? { width: 1024, height: 1024 } : {}), size: 2048n,
    } });
    return asset;
  }
  async function applyPlan() {
    const response = await fetch(`${base}/api/canvases/${projectId}/prompt-previews/apply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, position: { x: 120, y: 240 } }),
    });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    return (await response.json()).data as { node: { id: string }; canvas: { version: number; nodes: string } };
  }
  function addTarget(nodes: unknown[], draftMode?: string, extraData?: Record<string, unknown>) {
    const next = [...nodes, { id: "video-target", type: "mediaNode", position: { x: 900, y: 300 },
      data: { mediaType: "video", draft: true, genStatus: "draft", draftModelId: MODEL_ID, prompt: "保留草稿", ...(draftMode !== undefined ? { draftMode } : {}), ...extraData } }];
    return next;
  }
  async function putNodes(version: number, nodes: unknown[]) {
    const saved = (await (await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) })).json()).data;
    return saved as { version: number };
  }
  async function link(version: number, planNodeId: string, syncBindings?: unknown[]) {
    const response = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ planNodeId, targetNodeId: "video-target", expectedVersion: version, ...(syncBindings !== undefined ? { syncBindings } : {}) }),
    });
    const text = await response.text();
    return { status: response.status, text: () => text, data: response.status === 201 ? JSON.parse(text).data : undefined };
  }
  async function readCanvas() {
    const canvas = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
    return { version: canvas.version as number, nodes: JSON.parse(canvas.nodes) as Array<Record<string, unknown>>, edges: JSON.parse(canvas.edges ?? "[]") as Array<Record<string, unknown>> };
  }

  it("方案绑定图片/视频/音频 → 文生视频目标切全能参考并随连线一并持久化（A1/A2 回读）", async () => {
    projectId = (await projects.create("987654", "IKFC26 sync")).id;
    const assets = await Promise.all((["image", "video", "audio"] as const).map(type => createAsset(type, type)));
    materialPayload = { target_media: "video", assets: assets.map((a, i) => ({ asset_ref_id: `a${i}`, asset_id: String(a.id), media_type: a.type })),
      shots: [{ shot_no: 1, title: "混合媒体方案", prompt_text: "图A视频B音频C", asset_bindings: assets.map((_, i) => ({ asset_ref_id: `a${i}` })),
        prompt_mentions: [{ start: 0, end: 2, asset_ref_id: "a0", index: 1 }, { start: 2, end: 5, asset_ref_id: "a1", index: 2 }, { start: 5, end: 8, asset_ref_id: "a2", index: 3 }] }] };
    try {
      const applied = await applyPlan();
      const nodes = JSON.parse(applied.canvas.nodes) as Array<Record<string, unknown>>;
      // 目标带角色库参考：切换后媒体引用身份（含素材库 materialId）完整保留
      const characterRef = { materialId: "asset-ikfc26-character", mediaType: "image", role: "reference", url: "https://example.test/character.png" };
      const saved = await putNodes(applied.canvas.version, addTarget(nodes, "prompt", { draftMaterialRefs: [characterRef] }));
      const linked = await link(saved.version, applied.node.id);
      expect(linked.status, await linked.text()).toBe(201);
      // 响应即持久化结果：目标切 all，其余节点与素材身份原样保留
      const canvas = await readCanvas();
      const savedTarget = canvas.nodes.find(n => n.id === "video-target") as { data: Record<string, unknown> };
      expect(savedTarget.data.draftMode).toBe("all");
      expect(savedTarget.data.prompt).toBe("保留草稿");
      expect(savedTarget.data.draft).toBe(true);
      expect(savedTarget.data.draftMaterialRefs).toEqual([characterRef]);
      // 素材边与方案身份完整保留：3 条素材边（inputSources 登记方案）+ 1 条方案边（promptReference）
      const materialEdges = canvas.edges.filter(e => e.target === "video-target" && e.source !== applied.node.id);
      expect(materialEdges).toHaveLength(3);
      for (const edge of materialEdges) {
        expect((edge.data as { inputSources: { planNodeIds: string[] } }).inputSources.planNodeIds).toContain(applied.node.id);
      }
      const planEdge = canvas.edges.find(e => e.source === applied.node.id && e.target === "video-target");
      expect(planEdge).toMatchObject({ data: { promptReference: { bindings: [
        { index: 1, assetId: String(assets[0]!.id) }, { index: 2, assetId: String(assets[1]!.id) }, { index: 3, assetId: String(assets[2]!.id) },
      ] } } });
    } finally { materialPayload = undefined; }
  }, 60_000);

  it("方案仅文本（资产清单有媒体但正文未索引）→ 保持文生视频，仅建方案连线（A2）", async () => {
    projectId = (await projects.create("987654", "IKFC26 text only")).id;
    // 资产在方案资产清单中但正文未 @ 索引：媒体未实际绑定，不触发切换
    const shelved = await createAsset("shelved", "image");
    materialPayload = { target_media: "video", assets: [{ asset_ref_id: "a0", asset_id: String(shelved.id), media_type: "image" }],
      shots: [{ shot_no: 1, title: "纯文本方案", prompt_text: "只有文字" }] };
    try {
      const applied = await applyPlan();
      const nodes = JSON.parse(applied.canvas.nodes) as Array<Record<string, unknown>>;
      expect(nodes.filter(n => n.type === "mediaNode")).toHaveLength(0);
      const saved = await putNodes(applied.canvas.version, addTarget(nodes, "prompt"));
      const linked = await link(saved.version, applied.node.id);
      expect(linked.status, await linked.text()).toBe(201);
      const canvas = await readCanvas();
      expect((canvas.nodes.find(n => n.id === "video-target") as { data: Record<string, unknown> }).data.draftMode).toBe("prompt");
      expect(canvas.edges.filter(e => e.target === "video-target")).toHaveLength(1);
      expect(canvas.edges[0]).toMatchObject({ source: applied.node.id });
    } finally { materialPayload = undefined; }
  }, 60_000);

  it.each([
    ["all", ["image", "video", "audio"], "all"],
    ["text2video", ["image"], "text2video"],
  ])("非文生视频模式（%s）绑定媒体 → 模式不受污染", async (mode, types, expected) => {
    projectId = (await projects.create("987654", `IKFC26 keep ${mode}`)).id;
    const assets = await Promise.all((types as Array<"image" | "video" | "audio">).map(type => createAsset(type, type)));
    materialPayload = { target_media: "video", assets: assets.map((a, i) => ({ asset_ref_id: `a${i}`, asset_id: String(a.id), media_type: a.type })),
      shots: [{ shot_no: 1, title: "方案", prompt_text: `方案${mode}`, asset_bindings: assets.map((_, i) => ({ asset_ref_id: `a${i}` })),
        prompt_mentions: assets.map((a, i) => ({ start: 2 * i, end: 2 * i + 1, asset_ref_id: `a${i}`, index: i + 1 })) }] };
    try {
      const applied = await applyPlan();
      const nodes = JSON.parse(applied.canvas.nodes) as Array<Record<string, unknown>>;
      const saved = await putNodes(applied.canvas.version, addTarget(nodes, mode));
      const linked = await link(saved.version, applied.node.id);
      expect(linked.status, await linked.text()).toBe(201);
      expect((await readCanvas()).nodes.find(n => n.id === "video-target")).toMatchObject({ data: { draftMode: expected } });
    } finally { materialPayload = undefined; }
  }, 60_000);

  it("首尾帧模式绑定普通参考 → 既有校验拒绝且零写入（A3 边界）", async () => {
    projectId = (await projects.create("987654", "IKFC26 keyframe reject")).id;
    const asset = await createAsset("image", "image");
    materialPayload = { target_media: "video", assets: [{ asset_ref_id: "a0", asset_id: String(asset.id), media_type: "image" }],
      shots: [{ shot_no: 1, title: "方案", prompt_text: "图A", asset_bindings: [{ asset_ref_id: "a0" }], prompt_mentions: [{ start: 0, end: 2, asset_ref_id: "a0", index: 1 }] }] };
    try {
      const applied = await applyPlan();
      const nodes = JSON.parse(applied.canvas.nodes) as Array<Record<string, unknown>>;
      const saved = await putNodes(applied.canvas.version, addTarget(nodes, "keyframe"));
      const rejected = await link(saved.version, applied.node.id);
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).toContain("首尾帧模式不支持普通参考");
      const canvas = await readCanvas();
      expect((canvas.nodes.find(n => n.id === "video-target") as { data: Record<string, unknown> }).data.draftMode).toBe("keyframe");
      expect(canvas.edges).toEqual([]);
    } finally { materialPayload = undefined; }
  }, 60_000);

  it("无 draftMode 旧目标绑定媒体 → 不补模式字段（由前端门控纠正）", async () => {
    projectId = (await projects.create("987654", "IKFC26 legacy")).id;
    const asset = await createAsset("image", "image");
    materialPayload = { target_media: "video", assets: [{ asset_ref_id: "a0", asset_id: String(asset.id), media_type: "image" }],
      shots: [{ shot_no: 1, title: "方案", prompt_text: "图A", asset_bindings: [{ asset_ref_id: "a0" }], prompt_mentions: [{ start: 0, end: 2, asset_ref_id: "a0", index: 1 }] }] };
    try {
      const applied = await applyPlan();
      const nodes = JSON.parse(applied.canvas.nodes) as Array<Record<string, unknown>>;
      const saved = await putNodes(applied.canvas.version, addTarget(nodes));
      const linked = await link(saved.version, applied.node.id);
      expect(linked.status, await linked.text()).toBe(201);
      const target = (await readCanvas()).nodes.find(n => n.id === "video-target") as { data: Record<string, unknown> };
      expect("draftMode" in target.data).toBe(false);
    } finally { materialPayload = undefined; }
  }, 60_000);

  it("同步删光方案引用 → 释放素材边但模式不自动切回（A5）", async () => {
    projectId = (await projects.create("987654", "IKFC26 no switch back")).id;
    const asset = await createAsset("image", "image");
    materialPayload = { target_media: "video", assets: [{ asset_ref_id: "a0", asset_id: String(asset.id), media_type: "image" }],
      shots: [{ shot_no: 1, title: "方案", prompt_text: "图A", asset_bindings: [{ asset_ref_id: "a0" }], prompt_mentions: [{ start: 0, end: 2, asset_ref_id: "a0", index: 1 }] }] };
    try {
      const applied = await applyPlan();
      const nodes = JSON.parse(applied.canvas.nodes) as Array<Record<string, unknown>>;
      const saved = await putNodes(applied.canvas.version, addTarget(nodes, "prompt"));
      const linked = await link(saved.version, applied.node.id);
      expect(linked.status).toBe(201);
      // 方案正文删光素材索引（素材身份保留不缩）后同步
      const before = await readCanvas();
      const edited = before.nodes.map(n => n.id === applied.node.id
        ? { ...n, data: { ...n.data, text: "只剩文字", promptMentions: [] } } : n);
      const savedEdit = await putNodes(before.version, edited);
      const synced = await link(savedEdit.version, applied.node.id, []);
      expect(synced.status, await synced.text()).toBe(201);
      const after = await readCanvas();
      expect((after.nodes.find(n => n.id === "video-target") as { data: Record<string, unknown> }).data.draftMode).toBe("all");
      expect(after.edges.filter(e => e.target === "video-target" && e.data?.inputSources)).toHaveLength(0);
      expect(after.edges.find(e => e.source === applied.node.id)).toMatchObject({ data: { promptReference: { bindings: [] } } });
    } finally { materialPayload = undefined; }
  }, 60_000);

  it("切换后实际提交 → references 完整冻结并被记录式供应商消费（A6，供应商为替身）", async () => {
    projectId = (await projects.create("987654", "IKFC26 submit")).id;
    const assets = await Promise.all((["image", "video", "audio"] as const).map(type => createAsset(type, type)));
    materialPayload = { target_media: "video", assets: assets.map((a, i) => ({ asset_ref_id: `a${i}`, asset_id: String(a.id), media_type: a.type })),
      shots: [{ shot_no: 1, title: "混合媒体方案", prompt_text: "图A视频B音频C", asset_bindings: assets.map((_, i) => ({ asset_ref_id: `a${i}` })),
        prompt_mentions: [{ start: 0, end: 2, asset_ref_id: "a0", index: 1 }, { start: 2, end: 5, asset_ref_id: "a1", index: 2 }, { start: 5, end: 8, asset_ref_id: "a2", index: 3 }] }] };
    try {
      const applied = await applyPlan();
      const nodes = JSON.parse(applied.canvas.nodes) as Array<Record<string, unknown>>;
      const saved = await putNodes(applied.canvas.version, addTarget(nodes, "prompt"));
      const linked = await link(saved.version, applied.node.id);
      expect(linked.status, await linked.text()).toBe(201);
      const references = assets.map(a => ({ asset_id: String(a.id), type: a.type, role: "reference" }));
      const submit = await fetch(`${base}/api/projects/${projectId}/generation-jobs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "video", target_node_id: "video-target", expected_output_count: 1, references,
          parameters: { prompt: "保留草稿", model_id: MODEL_ID, aspect_ratio: "16:9", resolution: "720p", duration: 5 } }),
      });
      expect(submit.status, await submit.clone().text()).toBe(201);
      const created = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records[0];
      // 切换后（all）模式校验通过且引用无丢失：快照冻结完整三类参考
      expect(created.input.prompt_plan_snapshot.videoReferences).toEqual(assets.map(a => ({ assetId: String(a.id), type: a.type, role: "reference", url: a.url, providerUrl: a.url })));
      const jobId = String((await (await submit.clone().json()).data).generation_job_id);
      await vi.waitFor(async () => expect(await runVideoJobStep({ repo: createWorkerRepo(prisma.client), workerId: "ikfc26-worker", jobId,
        credentialVault: { open: value => value },
        createProvider: token => createNewApiVideoTaskProvider({ baseUrl: process.env.AGENT_SERVICE_BASE_URL!, token }),
        mediaRelay: { persist: async url => ({ url, storageKey: null, mime: "video/mp4", size: 100 }) },
      })).toBe(jobId), { timeout: 5000 });
      // 供应商（替身）实际收到完整参考
      expect(videoRequests.at(-1)?.metadata.content).toMatchObject([
        { type: "image_url", role: "reference_image" },
        { type: "video_url", role: "reference_video" },
        { type: "audio_url", role: "reference_audio" },
      ]);
    } finally { materialPayload = undefined; }
  }, 120_000);
});
