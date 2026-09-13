import { runVideoJobStep } from "@lib/shared/generation-runtime/video-job-runner.js";
import { createNewApiVideoTaskProvider } from "@lib/shared/generation-runtime/new-api-video-task-provider.js";
import { UsageController } from "../usage/usage.controller.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { processJob } from "@lib/shared/generation/worker/generation-worker.js";
import { createWorkerRepo } from "@lib/shared/persistence/index.js";
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";
import { GenerationModelsController } from "../generation/models.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";
import "reflect-metadata";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Module } from "@nestjs/common";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { AgentV1ProxyController } from "../agent/agent-v1-proxy.controller.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { AssetsController } from "../assets/assets.controller.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";

// Public HTTP seam, real production Canvas/Project services and disposable MySQL.
// Authentication middleware supplies the already-authenticated identity; no Canvas API mocks.
describe.skipIf(!process.env.IKDLQE_DATABASE_URL)("Prompt preview public API", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  let projectId = "";
  const source = { sessionId: "session-preview", revisionId: "revision-one", shotNo: 1 };
  let activeRevision: string | undefined;
  let materialPayload: Record<string, unknown> | undefined;
  const prompt = "雪夜的城市\n保留换行与 <光影> & 细节。";
  const videoRequests: Array<{ prompt: string; metadata: { content: unknown[] } }> = [];
  const agentRequests: Array<{ path: string; user: unknown; project: unknown }> = [];
  const agent = createServer((req, res) => {
    if (req.url === "/v1/video/generations") {
      let body = ""; req.on("data", chunk => { body += chunk; });
      req.on("end", () => { videoRequests.push(JSON.parse(body)); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ task_id: "iketsx-task", status: "queued" })); });
      return;
    }
    if (req.url?.startsWith("/v1/video/generations/")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ task_id: "iketsx-task", status: "succeeded", result_url: `${process.env.AGENT_SERVICE_BASE_URL}/b.mp4` })); return; }
    if (req.url === '/api/usage/token/') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ success: true, data: { user_quota: 1000000 } })); return; }
    if (req.url?.startsWith('/a.png') || req.url === '/b.mp4') {
      res.setHeader('content-type', req.url?.startsWith('/a.png') ? 'image/png' : 'video/mp4');
      res.end(readFileSync(new URL(req.url?.startsWith('/a.png') ? '../../../../../../web/public/favicon.png' : '../../../../../../web/src/assets/home-hero/aurora.mp4', import.meta.url)));
      return;
    }
    agentRequests.push({ path: req.url ?? "", user: req.headers["x-blue-whale-user-id"], project: req.headers["x-blue-whale-project-id"] });
    res.setHeader("content-type", "application/json");
    const session = { session_id: source.sessionId, title: "Prompt 预览", phase: "idle", lifecycle: "active" };
    if (req.url?.endsWith("/events?after=0" ) || req.url?.includes("/events")) {
      res.setHeader("content-type", "text/event-stream"); res.write(": connected\n\n");
      return;
    }
    if (!req.url?.endsWith("/snapshot")) { res.end(JSON.stringify({ items: [session] })); return; }
    res.end(JSON.stringify({ session, event_cursor: "0", messages: [
      { message_id: "user-1", sequence: 1, role: "user", content: [{ type: "text", text: "请整理 Prompt" }] },
      { message_id: "assistant-1", sequence: 2, role: "assistant", content: [{ type: "text", text: "已整理，请预览。" }] },
    ], prompt_cards: [{
      session_id: source.sessionId,
      active_revision: { revision_id: activeRevision ?? source.revisionId, payload: materialPayload ?? {
        shots: [{ shot_no: 1, title: "雪夜", prompt_text: prompt, frame_description: "不应应用此画面描述" }],
      } },
    }] }));
  });
  const previousDatabase = process.env.DATABASE_URL;
  const previousNewApi = process.env.NEW_API_BASE_URL;
  const previousAgent = process.env.AGENT_SERVICE_BASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDLQE_DATABASE_URL;
    await new Promise<void>(resolve => agent.listen(0, "127.0.0.1", resolve));
    process.env.AGENT_SERVICE_BASE_URL = `http://127.0.0.1:${(agent.address() as { port: number }).port}`;
    process.env.NEW_API_BASE_URL = process.env.AGENT_SERVICE_BASE_URL;
    projectId = (await projects.create("987654", "IKDLQE integration")).id;
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "iketsw-test", model_id: "iketsw-image" } },
      create: { provider_id: "iketsw-test", model_id: "iketsw-image", capability_type: "image", model_label: "IKETSW", supported_sizes: [{ id: "1024x1024", label: "1024x1024" }], supported_aspect_ratios: ["1:1"], supported_formats: ["png"], default_size: "1024x1024", default_aspect_ratio: "1:1", features: { reference_image: true, max_reference_images: 3 } },
      update: { features: { reference_image: true, max_reference_images: 3 } },
    });
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "iketsx-test", model_id: "doubao-seedance-2-0-260128" } },
      create: { provider_id: "iketsx-test", model_id: "doubao-seedance-2-0-260128", capability_type: "video", model_label: "IKETSX", supported_sizes: [{ id: "720p", label: "720p" }], supported_aspect_ratios: ["16:9"], supported_formats: [], default_size: "720p", default_aspect_ratio: "16:9", supported_durations: { min: 4, max: 12, step: 1 }, default_duration: 5, features: { reference_image: true, max_reference_images: 9 } },
      update: {},
    });
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService], AgentV1ProxyController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, GenerationCostEstimatorService, CanvasService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    Reflect.defineMetadata("design:paramtypes", [AccountService], UsageController);
    Reflect.defineMetadata("design:paramtypes", [AssetService], AssetsController);
    class HarnessModule {}
    Module({ controllers: [AssetsController, UsageController, CanvasesController, ProjectsController, AgentV1ProxyController, GenerationJobsController, GenerationModelsController, JobsController], providers: [
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: AccountService, useValue: new AccountService() },
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      { provide: GenerationCostEstimatorService, useValue: new GenerationCostEstimatorService() },
      { provide: CanvasService, useValue: new CanvasService(prisma, projects) },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.use(json({ limit: "16mb" }));
    app.setGlobalPrefix("api");
    app.use((req: { user: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.headers.authorization ||= "Bearer sk-iketsw-test";
      req.user = { userId: "987654" };
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
    await prisma.client.$disconnect();
  });
  async function apply() {
    return fetch(`${base}/api/canvases/${projectId}/prompt-previews/apply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, position: { x: 120, y: 240 } }),
    });
  }
  it("applies one preview as an independently persisted ordinary text node", async () => {
    const response = await apply();
    expect(response.status).toBeLessThan(300);
    const result = await response.json();
    expect(result.data.node).toMatchObject({ type: "textNode", data: { title: "雪夜", text: prompt } });
    const canvas = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
    expect(JSON.parse(canvas.data.nodes)).toEqual([result.data.node]);
    expect(agentRequests).toContainEqual({ path: `/v1/projects/${projectId}/sessions/${source.sessionId}/snapshot`, user: "987654", project: projectId });
  });
  it("IKETSX: video plan references all media and freezes indexed provider inputs", async () => {
    projectId = (await projects.create("987654", "IKETSX mixed video")).id;
    const assets = await Promise.all((["image", "video", "audio"] as const).map(type => prisma.client.assets.create({ data: {
      user_id: 987654n, type, material_id: type === "image" ? `asset-iketsx-${projectId}` : null, url: `${process.env.AGENT_SERVICE_BASE_URL}/${type}`, ...(type === "video" ? { width: 1280, height: 720, duration_ms: 5000, mime: "video/mp4" } : {}),
    } })));
    materialPayload = { target_media: "image", assets: assets.map((a, i) => ({ asset_ref_id: `a${i}`, asset_id: String(a.id), media_type: a.type })),
      shots: [{ shot_no: 1, title: "IMAGE 方案", prompt_text: "图A视频B音频C", asset_bindings: assets.map((_, i) => ({ asset_ref_id: `a${i}` })),
        prompt_mentions: [{ start: 0, end: 2, asset_ref_id: "a0", index: 7 }, { start: 2, end: 5, asset_ref_id: "a1", index: 2 }, { start: 5, end: 8, asset_ref_id: "a2", index: 9 }] }] };
    try {
      const applied = (await (await apply()).json()).data;
      expect(applied.node).toBeDefined();
      const nodes = JSON.parse(applied.canvas.nodes);
      nodes.push({ id: "video-target", type: "mediaNode", position: { x: 900, y: 300 }, data: { mediaType: "video", draft: true, genStatus: "draft", draftModelId: "doubao-seedance-2-0-260128", prompt: "保留草稿", draftMaterialRefs: [{ materialId: "asset-manual-character", mediaType: "image", role: "reference", url: "https://example.test/character.png" }] } });
      const saved = (await (await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${applied.canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) })).json()).data;
      const capabilityKey = { provider_id_model_id: { provider_id: "iketsx-test", model_id: "doubao-seedance-2-0-260128" } };
      await prisma.client.generation_model_capability.update({ where: capabilityKey, data: { features: { reference_image: true, max_reference_images: 1 } } });
      const overLimit = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planNodeId: applied.node.id, targetNodeId: "video-target", expectedVersion: saved.version }) });
      expect(await overLimit.text()).toContain("最多 1");
      expect((await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data.edges).toBe(saved.edges);
      await prisma.client.generation_model_capability.update({ where: capabilityKey, data: { features: { reference_image: true, max_reference_images: 9 } } });
      const response = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planNodeId: applied.node.id, targetNodeId: "video-target", expectedVersion: saved.version }) });
      expect(response.status, await response.clone().text()).toBe(201);
      const linked = (await response.json()).data;
      expect(JSON.parse(linked.nodes)).toEqual(nodes);
      expect(JSON.parse(linked.edges)).toHaveLength(4);
      const submit = (references: Array<Record<string, unknown>>) => fetch(`${base}/api/projects/${projectId}/generation-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "video", expected_output_count: 1, target_node_id: "video-target", references, parameters: { prompt: "保留草稿", model_id: "doubao-seedance-2-0-260128", aspect_ratio: "16:9", resolution: "720p", duration: 5 } }) });
      const refs = assets.map(a => ({ asset_id: String(a.id), type: a.type, role: "reference" }));
      let modeVersion = linked.version;
      for (const mode of ["keyframe", "text2video", "all"]) {
        nodes.find((n: { id: string }) => n.id === "video-target").data.draftMode = mode;
        const savedMode = (await (await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${modeVersion}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) })).json()).data;
        modeVersion = savedMode.version;
        if (mode !== "all") expect(await (await submit(refs)).text()).toContain("模式");
      }
      for (const invalid of [refs.slice(0, 2), refs.map((r, i) => i === 1 ? { ...r, type: "image" } : r), refs.map((r, i) => i === 0 ? { ...r, role: "first_frame" } : r)]) {
        const rejected = await submit(invalid);
        expect(await rejected.text()).toContain("索引");
      }
      await prisma.client.assets.update({ where: { id: assets[1]!.id }, data: { mime: "video/webm" } });
      expect(await (await submit(refs)).text()).toContain("MP4");
      await prisma.client.assets.update({ where: { id: assets[1]!.id }, data: { mime: "video/mp4", user_id: 12345n } });
      expect(await (await submit(refs)).text()).toContain("#2");
      await prisma.client.assets.update({ where: { id: assets[1]!.id }, data: { user_id: 987654n } });
      const modelKey = { provider_id_model_id: { provider_id: "iketsx-test", model_id: "doubao-seedance-2-0-260128" } };
      await prisma.client.generation_model_capability.update({ where: modelKey, data: { features: { reference_image: true, max_reference_images: 0 } } });
      expect(await (await submit(refs)).text()).toContain("最多 0");
      await prisma.client.generation_model_capability.update({ where: modelKey, data: { features: { reference_image: true, max_reference_images: 9 } } });
      expect((await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records).toEqual([]);
      const mixedRefs = [...refs, { material_id: "asset-manual-character", type: "image", role: "reference" }];
      const generated = await submit(mixedRefs);
      expect(generated.status, await generated.clone().text()).toBe(201);
      expect((await generated.clone().json()).code, await generated.clone().text()).toBe(200);
      const jobs = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
      expect(jobs[0].input.prompt_plan_snapshot.providerPrompt).toBe("参考图1参考视频1参考音频1\n\n保留草稿");
      expect(jobs[0].input.prompt_plan_snapshot.videoReferences).toEqual([...assets.map(a => ({ assetId: String(a.id), type: a.type, role: "reference", url: a.url, providerUrl: a.material_id ? `asset://${a.material_id}` : a.url })), { materialId: "asset-manual-character", type: "image", role: "reference", url: "https://example.test/character.png", providerUrl: "asset://asset-manual-character" }]);
      await prisma.client.assets.updateMany({ where: { id: { in: assets.map(a => a.id) } }, data: { url: "https://changed.invalid/later", material_id: null } });
      const jobId = (await generated.json()).data.generation_job_id;
      const execute = () => runVideoJobStep({ repo: createWorkerRepo(prisma.client), workerId: "iketsx-worker", jobId,
        credentialVault: { open: value => value },
        createProvider: token => createNewApiVideoTaskProvider({ baseUrl: process.env.AGENT_SERVICE_BASE_URL!, token }),
        mediaRelay: { persist: async url => ({ url, storageKey: null, mime: "video/mp4", size: 100 }) },
      });
      if (process.env.IKETSX_JAVA) {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        await promisify(execFile)("docker", ["run", "--rm", "-v", `${process.cwd()}/worker-java:/work`, "-v", "iketsx-maven-cache:/root/.m2", "-w", "/work",
          "-e", `IKETSX_JOB_ID=${jobId}`, "-e", "IKETSX_JDBC_URL=jdbc:mysql://host.docker.internal:23416/iketsx?useSSL=false&allowPublicKeyRetrieval=true",
          "-e", `IKETSX_PROVIDER_URL=${process.env.AGENT_SERVICE_BASE_URL!.replace("127.0.0.1", "host.docker.internal")}`,
          "maven:3.9-eclipse-temurin-21", "mvn", "-q", "-Dtest=PromptPlanVideoIntegrationTest", "test"], { timeout: 180000, maxBuffer: 2000000 });
      } else {
        await vi.waitFor(async () => expect(await execute()).toBe(jobId), { timeout: 3000 });
      }
      expect(videoRequests.at(-1)?.prompt).toBe("参考图1参考视频1参考音频1\n\n保留草稿");
      expect(videoRequests.at(-1)?.metadata.content).toMatchObject([
        { type: "image_url", image_url: { url: `asset://asset-iketsx-${projectId}` }, role: "reference_image" },
        { type: "video_url", video_url: { url: assets[1]!.url }, role: "reference_video" },
        { type: "audio_url", audio_url: { url: assets[2]!.url }, role: "reference_audio" },
        { type: "image_url", image_url: { url: "asset://asset-manual-character" }, role: "reference_image" },
      ]);
      await vi.waitFor(async () => {
        if (!process.env.IKETSX_JAVA) await execute();
        const records = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
        expect(records[0].status).toBe("succeeded");
      }, { timeout: 10000, interval: 500 });
    } finally { materialPayload = undefined; }
  }, 240000);
  it("IKETSX: pure text video plans need no media", async () => {
    projectId = (await projects.create("987654", "IKETSX pure text")).id;
    const applied = (await (await apply()).json()).data;
    const nodes = JSON.parse(applied.canvas.nodes);
    nodes.push({ id: "text-video", type: "mediaNode", position: { x: 900, y: 0 }, data: { mediaType: "video", draft: true, genStatus: "draft", draftModelId: "doubao-seedance-2-0-260128", prompt: "", draftMode: "all" } });
    let canvas = (await (await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${applied.canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) })).json()).data;
    canvas = (await (await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planNodeId: applied.node.id, targetNodeId: "text-video", expectedVersion: canvas.version }) })).json()).data;
    expect(canvas).toBeDefined();
    const response = await fetch(`${base}/api/projects/${projectId}/generation-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "video", target_node_id: "text-video", expected_output_count: 1, parameters: { prompt: "", model_id: "doubao-seedance-2-0-260128", aspect_ratio: "16:9", resolution: "720p", duration: 5 } }) });
    expect((await response.json()).code).toBe(200);
    const jobs = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
    expect(jobs[0].input.prompt_plan_snapshot).toMatchObject({ providerPrompt: prompt, videoReferences: [], images: [] });
  });
  it("IKETSW: reference a plan atomically adds direct material edges and preserves manual provenance", async () => {
    projectId = (await projects.create("987654", "IKETSW reference")).id;
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    materialPayload = { target_media: "image", assets: [{ asset_ref_id: "a", asset_id: String(asset.id), media_type: "image" }],
      shots: [{ shot_no: 1, title: "方案", prompt_text: "素材A的雨夜", asset_bindings: [{ asset_ref_id: "a" }], prompt_mentions: [{ start: 0, end: 3, asset_ref_id: "a", index: 7 }] }] };
    try {
      const applied = await (await apply()).json();
      const nodes = JSON.parse(applied.data.canvas.nodes);
      const media = nodes.find((n: { type: string }) => n.type === "mediaNode");
      nodes.push({ id: "target", type: "mediaNode", position: { x: 900, y: 300 }, data: { mediaType: "image", draft: true, genStatus: "draft", draftModelId: "iketsw-image", prompt: "保留草稿" } });
      const saved = await (await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${applied.data.canvas.version}"` },
        body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify([{ id: "manual", source: media.id, target: "target" }]), viewport: "{}" }) })).json();
      const response = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ planNodeId: applied.data.node.id, targetNodeId: "target", expectedVersion: saved.data.version }) });
      expect(response.status).toBe(201);
      const linked = (await response.json()).data;
      expect(JSON.parse(linked.nodes)).toEqual(nodes);
      expect(JSON.parse(linked.edges)).toEqual([
        { id: "manual", source: media.id, target: "target", data: { inputSources: { manual: true, planNodeIds: [applied.data.node.id] } } },
        expect.objectContaining({ source: applied.data.node.id, target: "target", data: { promptReference: { bindings: [{ index: 7, assetId: String(asset.id) }] } } }),
      ]);
      const readback = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
      expect(readback.edges).toBe(linked.edges);
      const submit = (ids: string[], modelId = "iketsw-image") => fetch(`${base}/api/projects/${projectId}/generation-jobs`, {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-iketsw-test" },
        body: JSON.stringify({ type: "image", target_node_id: "target", input_asset_ids: ids, expected_output_count: 1, parameters: { prompt: "", model_id: modelId, aspect_ratio: "1:1" } }),
      });
      const missing = await submit([]);
      expect(missing.status).toBe(400);
      expect(await missing.text()).toContain("#7");
      const stale = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ planNodeId: applied.data.node.id, targetNodeId: "target", expectedVersion: saved.data.version }) });
      expect(stale.status).toBe(412);
      await prisma.client.assets.update({ where: { id: asset.id }, data: { is_delete: true } });
      const deleted = await submit([String(asset.id)]);
      expect(deleted.status).toBe(400);
      expect(await deleted.text()).toContain("#7");
      await prisma.client.assets.update({ where: { id: asset.id }, data: { is_delete: false } });
      await prisma.client.generation_model_capability.update({ where: { provider_id_model_id: { provider_id: "iketsw-test", model_id: "iketsw-image" } }, data: { features: { reference_image: false, max_reference_images: 0 } } });
      const unsupported = await submit([String(asset.id)]);
      expect(unsupported.status).toBe(400);
      expect(await unsupported.text()).toContain("#7");
      await prisma.client.generation_model_capability.update({ where: { provider_id_model_id: { provider_id: "iketsw-test", model_id: "iketsw-image" } }, data: { features: { reference_image: true, max_reference_images: 3 } } });
      const generated = await (await fetch(`${base}/api/projects/${projectId}/generation-jobs`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-iketsw-test" },
        body: JSON.stringify({ type: "image", target_node_id: "target", input_asset_ids: [String(asset.id)], expected_output_count: 1, parameters: { prompt: "保留草稿", model_id: "iketsw-image", aspect_ratio: "1:1" } }) })).json();
      expect(generated.code).toBe(200);
      const jobs = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
      expect(jobs[0].input.prompt_plan_snapshot).toEqual({ canvasVersion: linked.version,
        plans: [{ nodeId: applied.data.node.id, text: "素材A的雨夜", mentions: [{ start: 0, end: 3, index: 7, assetId: String(asset.id) }] }],
        images: [{ assetId: String(asset.id), url: asset.url }], providerPrompt: "参考图1的雨夜\n\n保留草稿" });
      // Provider execution must use the accepted snapshot even after the asset URL changes.
      await prisma.client.assets.update({ where: { id: asset.id }, data: { url: `${asset.url}?edited-after-submit` } });
      const requests: Array<Record<string, unknown>> = [];
      await vi.waitFor(async () => expect(await processJob({ repo: createWorkerRepo(prisma.client), workerId: "iketsw-worker", jobId: generated.data.generation_job_id, userId: "987654",
        credentialVault: { open: value => value },
        createImageProvider: () => ({ generate: async request => { requests.push(request); return [{ url: asset.url, width: 1024, height: 1024 }]; } }),
        createAudioProvider: () => { throw new Error("unexpected audio"); },
      })).toBe(generated.data.generation_job_id), { timeout: 3000 });
      expect(requests).toEqual([expect.objectContaining({ prompt: "参考图1的雨夜\n\n保留草稿", sourceImage: { url: asset.url } })]);
      expect((await (await fetch(`${base}/api/jobs/${generated.data.generation_job_id}`)).json()).data.status).toBe("succeeded");
    } finally { materialPayload = undefined; }
  });

  it("IKETSW: shared plan sources deduplicate assets and attachment-only generation freezes current text", async () => {
    projectId = (await projects.create("987654", "IKETSW shared sources")).id;
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    materialPayload = { target_media: "image", assets: [{ asset_ref_id: "a", asset_id: String(asset.id), media_type: "image" }],
      shots: [1, 2].map(shot_no => ({ shot_no, title: "方案", prompt_text: "素材A雨夜", asset_bindings: [{ asset_ref_id: "a" }], prompt_mentions: [{ start: 0, end: 3, asset_ref_id: "a", index: 7 }] })) };
    try {
      const first = (await (await apply()).json()).data.node;
      const second = (await (await fetch(`${base}/api/canvases/${projectId}/prompt-previews/apply`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: { ...source, shotNo: 2 }, position: { x: 400, y: 20 } }) })).json()).data.node;
      let canvas = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
      const nodes = JSON.parse(canvas.nodes);
      nodes.push({ id: "target", type: "mediaNode", position: { x: 900, y: 0 }, data: { mediaType: "image", draft: true, genStatus: "draft", draftModelId: "iketsw-image", prompt: "" } });
      canvas = (await (await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` },
        body: JSON.stringify({ nodes: JSON.stringify(nodes) }) })).json()).data;
      for (const plan of [first, second, first]) {
        const response = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ planNodeId: plan.id, targetNodeId: "target", expectedVersion: canvas.version }) });
        expect(response.status).toBe(201);
        canvas = (await response.json()).data;
      }
      const edges = JSON.parse(canvas.edges);
      expect(edges).toHaveLength(3);
      expect(edges.find((e: { data: { inputSources?: unknown } }) => e.data.inputSources).data.inputSources).toEqual({ manual: false, planNodeIds: [first.id, second.id] });
      nodes.find((n: { id: string }) => n.id === first.id).data.text = "素材A新的雨夜";
      const edited = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) });
      expect(edited.status).toBe(200);
      const generate = () => fetch(`${base}/api/projects/${projectId}/generation-jobs`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-iketsw-test" },
        body: JSON.stringify({ type: "image", target_node_id: "target", input_asset_ids: [String(asset.id)], expected_output_count: 1, parameters: { prompt: "", model_id: "iketsw-image", aspect_ratio: "1:1" } }) });
      canvas = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
      const disconnected = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` },
        body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges.filter((e: { source: string }) => e.source === first.id || e.source === second.id)) }) });
      expect(disconnected.status).toBe(200);
      canvas = (await disconnected.json()).data;
      const missing = await generate();
      expect(missing.status).toBe(400);
      expect(await missing.text()).toContain("#7");
      const restored = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges) }) });
      expect(restored.status).toBe(200);
      expect((await (await generate()).json()).code).toBe(200);
      const jobs = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
      expect(jobs[0].input.prompt_plan_snapshot.providerPrompt).toBe("参考图1新的雨夜\n\n参考图1雨夜");
    } finally { materialPayload = undefined; }
  });

  it("IKETSW: a pure text plan can generate without a target prompt or media inputs", async () => {
    projectId = (await projects.create("987654", "IKETSW pure text")).id;
    const applied = (await (await apply()).json()).data;
    const nodes = JSON.parse(applied.canvas.nodes);
    nodes.push({ id: "target", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "image", draft: true, draftModelId: "iketsw-image", prompt: "" } });
    const saved = (await (await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${applied.canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) })).json()).data;
    const referenced = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ planNodeId: applied.node.id, targetNodeId: "target", expectedVersion: saved.version }) });
    expect(referenced.status).toBe(201);
    expect(JSON.parse((await referenced.json()).data.edges)).toHaveLength(1);
    const generated = await fetch(`${base}/api/projects/${projectId}/generation-jobs`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "image", target_node_id: "target", expected_output_count: 1, parameters: { prompt: "", model_id: "iketsw-image", aspect_ratio: "1:1" } }) });
    expect((await generated.json()).code).toBe(200);
    const jobs = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
    expect(jobs[0].input.prompt_plan_snapshot).toMatchObject({ providerPrompt: prompt, images: [] });
  });

  it("IKE5G8: plan compilation respects the catalog prompt budget and still rejects overflow", async () => {
    projectId = (await projects.create("987654", "IKE5G8 prompt budget")).id;
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    materialPayload = { target_media: "image", assets: [{ asset_ref_id: "a", asset_id: String(asset.id), media_type: "image" }],
      shots: [{ shot_no: 1, title: "长度边界", prompt_text: "图", asset_bindings: [{ asset_ref_id: "a" }], prompt_mentions: [{ start: 0, end: 1, asset_ref_id: "a", index: 7 }] }] };
    const capabilityKey = { provider_id_model_id: { provider_id: "iketsw-test", model_id: "iketsw-image" } };
    const features = { reference_image: true, max_reference_images: 3 };
    await prisma.client.generation_model_capability.update({ where: capabilityKey, data: { features: { ...features, max_prompt_length: 32000 } } });
    try {
      const applied = (await (await apply()).json()).data;
      const nodes = JSON.parse(applied.canvas.nodes);
      nodes.push({ id: "target", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "image", draft: true, draftModelId: "iketsw-image", prompt: "" } });
      const saved = (await (await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${applied.canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) })).json()).data;
      const referenced = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ planNodeId: applied.node.id, targetNodeId: "target", expectedVersion: saved.version }) });
      expect(referenced.status).toBe(201);
      const submit = (text: string) => fetch(`${base}/api/projects/${projectId}/generation-jobs`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "image", target_node_id: "target", input_asset_ids: [String(asset.id)], expected_output_count: 1, parameters: { prompt: text, model_id: "iketsw-image", aspect_ratio: "1:1" } }) });
      const compiledPlan = "参考图1";
      const text = "字".repeat(32000 - compiledPlan.length - 2);
      const accepted = await (await submit(text)).json();
      expect(accepted.code, accepted.msg).toBe(200);
      const jobs = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
      expect(jobs).toHaveLength(1);
      expect(jobs[0].input.prompt_plan_snapshot.providerPrompt).toBe(`${compiledPlan}\n\n${text}`);
      const rejected = await (await submit(`${text}字`)).json();
      expect(rejected.code).not.toBe(200);
      expect(rejected.msg).toContain("标签转换后的提示词为空或超限");
      expect((await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records).toHaveLength(1);
    } finally {
      materialPayload = undefined;
      await prisma.client.generation_model_capability.update({ where: capabilityKey, data: { features } });
    }
  });

  it("IKETSY: a text-only plan can add an owned Canvas material and rejects forged metadata", async () => {
    projectId = (await projects.create("987654", "IKETSY text plan")).id;
    const applied = (await (await apply()).json()).data;
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    const nodes = JSON.parse(applied.canvas.nodes);
    const node = nodes.find((n: { id: string }) => n.id === applied.node.id);
    nodes.push({ id: "chosen", type: "mediaNode", data: { assetId: String(asset.id), mediaType: "image", src: asset.url }, position: { x: 0, y: 0 } });
    node.data.promptMentions = [{ start: 0, end: 2, index: 1, assetId: String(asset.id) }];
    node.data.promptMaterials = [{ assetId: String(asset.id), mediaType: "image", url: "https://forged.invalid/image.png" }];
    const save = (version: number) => fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) });
    expect((await save(applied.canvas.version)).status).toBe(400);
    expect((await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data.nodes).toBe(applied.canvas.nodes);
    node.data.promptMaterials[0].url = asset.url;
    const saved = await save(applied.canvas.version);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const canvas = (await saved.json()).data;
    node.data.promptMaterials.unshift({ ...node.data.promptMaterials[0], url: "https://forged.invalid/image.png" });
    expect((await save(canvas.version)).status).toBe(400);
    expect((await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data.nodes).toBe(canvas.nodes);
  });

  it("IKETSY: deleting a newly selected tag before saving keeps the edited plan saveable", async () => {
    projectId = (await projects.create("987654", "IKETSY remove before save")).id;
    const applied = (await (await apply()).json()).data;
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    const nodes = JSON.parse(applied.canvas.nodes);
    const plan = nodes.find((n: { id: string }) => n.id === applied.node.id);
    nodes.push({ id: "chosen", type: "mediaNode", data: { assetId: String(asset.id), mediaType: "image", src: asset.url }, position: { x: 0, y: 0 } });
    plan.data.promptMentions = [];
    plan.data.promptMaterials = [{ assetId: String(asset.id), mediaType: "image", url: asset.url }];
    plan.data.text = "删除新标签后的正文";
    const saved = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${applied.canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const readback = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
    expect(JSON.parse(readback.nodes).find((n: { id: string }) => n.id === plan.id).data).toMatchObject({ text: "删除新标签后的正文", promptMentions: [] });
  });

  it("IKETSY: each target confirms edits independently and preserves shared inputs and historical snapshots", async () => {
    projectId = (await projects.create("987654", "IKETSY sync")).id;
    const assets = await Promise.all([0, 1].map(() => prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } })));
    const [a, b] = assets.map(asset => String(asset.id));
    materialPayload = { target_media: "image", assets: [{ asset_ref_id: "a", asset_id: a, media_type: "image" }],
      shots: [{ shot_no: 1, title: "方案", prompt_text: "素材A雨夜", asset_bindings: [{ asset_ref_id: "a" }], prompt_mentions: [{ start: 0, end: 3, asset_ref_id: "a", index: 7 }] }] };
    const read = async () => (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
    try {
      const applied = (await (await apply()).json()).data;
      let canvas = applied.canvas;
      const nodes = JSON.parse(canvas.nodes);
      const plan = nodes.find((n: { id: string }) => n.id === applied.node.id);
      const media = nodes.find((n: { type: string }) => n.type === "mediaNode");
      nodes.push({ id: "new-material", type: "mediaNode", position: { x: 0, y: 500 }, data: { mediaType: "image", assetId: b, src: assets[1]!.url } });
      for (const id of ["A", "B"]) nodes.push({ id, type: "mediaNode", position: { x: 900, y: 0 }, data: { mediaType: "image", draft: true, draftModelId: "iketsw-image", prompt: "" } });
      const save = async () => {
        const res = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) });
        expect(res.status, await res.clone().text()).toBe(200); canvas = (await res.json()).data;
      };
      await save();
      const reference = (targetNodeId: string, syncBindings?: Array<{ index: number; assetId: string }>, expectedVersion = canvas.version) => fetch(`${base}/api/canvases/${projectId}/prompt-references`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planNodeId: plan.id, targetNodeId, expectedVersion, ...(syncBindings ? { syncBindings } : {}) }),
      });
      for (const target of ["A", "B"]) { const res = await reference(target); expect(res.status).toBe(201); canvas = (await res.json()).data; }
      const submit = (target: string, ids: string[]) => fetch(`${base}/api/projects/${projectId}/generation-jobs`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "image", target_node_id: target, input_asset_ids: ids, expected_output_count: 1, parameters: { prompt: "", model_id: "iketsw-image", aspect_ratio: "1:1" } }) });
      plan.data.text = "素材A新文字";
      await save();
      expect((await (await submit("A", [a!])).json()).code).toBe(200);
      const oldJob = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records[0];
      expect(oldJob.input.prompt_plan_snapshot.providerPrompt).toBe("参考图1新文字");
      canvas = await read();
      // Protect a shared source on A; B's old input is exclusively from this plan.
      const sharedEdges = JSON.parse(canvas.edges);
      sharedEdges.find((e: { source: string; target: string }) => e.source === media.id && e.target === "A").data.inputSources = { manual: true, planNodeIds: [plan.id, "other-plan"] };
      canvas = (await (await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(sharedEdges) }) })).json()).data;
      plan.data.promptMentions = [{ start: 0, end: 3, index: 7, assetId: b }];
      plan.data.promptMaterials.push({ assetId: b, mediaType: "image", url: assets[1]!.url });
      await save();
      const before = canvas;
      for (const target of ["A", "B"]) expect(await (await submit(target, [a!])).text()).toContain("待同步");
      expect((await reference("A", [{ index: 7, assetId: a! }])).status).toBe(412);
      expect((await reference("A", [{ index: 7, assetId: b! }], before.version - 1)).status).toBe(412);
      await prisma.client.assets.update({ where: { id: assets[1]!.id }, data: { is_delete: true } });
      expect(await (await reference("A", [{ index: 7, assetId: b! }])).text()).toContain("#7");
      expect((await read()).edges).toBe(before.edges);
      await prisma.client.assets.update({ where: { id: assets[1]!.id }, data: { is_delete: false } });
      const modelKey = { provider_id_model_id: { provider_id: "iketsw-test", model_id: "iketsw-image" } };
      await prisma.client.generation_model_capability.update({ where: modelKey, data: { features: { reference_image: true, max_reference_images: 1 } } });
      expect(await (await reference("A", [{ index: 7, assetId: b! }])).text()).toContain("最多 1");
      expect((await read()).edges).toBe(before.edges);
      await prisma.client.generation_model_capability.update({ where: modelKey, data: { features: { reference_image: true, max_reference_images: 3 } } });
      const synced = await reference("A", [{ index: 7, assetId: b! }]);
      expect(synced.status, await synced.clone().text()).toBe(201);
      canvas = (await synced.json()).data;
      const edges = JSON.parse(canvas.edges);
      expect(edges.find((e: { source: string; target: string }) => e.source === media.id && e.target === "A").data.inputSources).toEqual({ manual: true, planNodeIds: ["other-plan"] });
      expect(edges.filter((e: { target: string }) => e.target === "B")).toEqual(JSON.parse(before.edges).filter((e: { target: string }) => e.target === "B"));
      expect((await (await submit("A", [a!, b!])).json()).code).toBe(200);
      expect(await (await submit("B", [a!])).text()).toContain("待同步");
      canvas = await read();
      const syncB = await reference("B", [{ index: 7, assetId: b! }]);
      expect(syncB.status).toBe(201); canvas = (await syncB.json()).data;
      expect(JSON.parse(canvas.edges).some((e: { source: string; target: string }) => e.source === media.id && e.target === "B")).toBe(false);
      // Both public commands compete for one version: only one can commit.
      const race = await Promise.all([
        reference("B", [{ index: 7, assetId: b! }]),
        fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) }),
      ]);
      expect(race.filter(res => res.status === 412)).toHaveLength(1);
      expect(race.filter(res => res.status < 300)).toHaveLength(1);
      canvas = await read();
      plan.data.text = "删除全部标签"; plan.data.promptMentions = [];
      await save();
      const empty = await reference("B", []); expect(empty.status).toBe(201); canvas = (await empty.json()).data;
      expect(JSON.parse(canvas.edges).filter((e: { target: string }) => e.target === "B")).toEqual([expect.objectContaining({ source: plan.id, data: { promptReference: { bindings: [] } } })]);
      expect((await (await submit("B", [])).json()).code).toBe(200);
      expect((await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records.find((job: { job_id: string }) => job.job_id === oldJob.job_id).input.prompt_plan_snapshot).toEqual(oldJob.input.prompt_plan_snapshot);
    } finally { materialPayload = undefined; }
  });

  it("IKETSZ: removing a plan releases only its exclusive inputs and preserves other targets", async () => {
    projectId = (await projects.create("987654", "IKETSZ sources")).id;
    const assets = await Promise.all([0, 1, 2].map(() => prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } })));
    materialPayload = { target_media: "image", assets: assets.map((a, i) => ({ asset_ref_id: `a${i}`, asset_id: String(a.id), media_type: "image" })),
      shots: [{ shot_no: 1, title: "共享方案", prompt_text: "甲乙丙", asset_bindings: assets.map((_, i) => ({ asset_ref_id: `a${i}` })),
        prompt_mentions: assets.map((_, i) => ({ start: i, end: i + 1, index: i + 1, asset_ref_id: `a${i}` })) }] };
    try {
      const first = (await (await apply()).json()).data;
      activeRevision = "second-plan";
      materialPayload = { target_media: "image", assets: [{ asset_ref_id: "shared", asset_id: String(assets[1]!.id), media_type: "image" }],
        shots: [{ shot_no: 1, title: "另一方案", prompt_text: "乙", asset_bindings: [{ asset_ref_id: "shared" }], prompt_mentions: [{ start: 0, end: 1, index: 9, asset_ref_id: "shared" }] }] };
      const second = (await (await fetch(`${base}/api/canvases/${projectId}/prompt-previews/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: { ...source, revisionId: activeRevision }, position: { x: 0, y: 300 } }) })).json()).data;
      let canvas = second.canvas;
      const nodes = JSON.parse(canvas.nodes);
      nodes.find((n: { id: string }) => n.id === first.node.id).data.title = "待移除方案";
      const media = assets.map(a => nodes.find((n: { data: { assetId?: string } }) => n.data.assetId === String(a.id)));
      nodes.push(...["A", "B"].map(id => ({ id, type: "mediaNode", data: { mediaType: "image", draft: true, genStatus: "draft", draftModelId: "iketsw-image", draftSize: "1024x1024", draftRatio: "1:1" }, position: { x: 900, y: id === "A" ? 0 : 400 } })));
      const save = async (edges: unknown[]) => {
        const res = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges) }) });
        expect(res.status, await res.clone().text()).toBe(200); canvas = (await res.json()).data;
      };
      await save([{ id: "manual", source: media[2].id, target: "A" }]);
      for (const [planNodeId, targetNodeId] of [[first.node.id, "A"], [first.node.id, "B"], [second.node.id, "A"]]) {
        const res = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planNodeId, targetNodeId, expectedVersion: canvas.version }) });
        expect(res.status, await res.clone().text()).toBe(201); canvas = (await res.json()).data;
      }
      const before = JSON.parse(canvas.edges);
      if (process.env.IKETSZ_BROWSER) {
        const { page, browser, vite } = await openPlanBrowser(false);
        try {
          await page.locator('.react-flow__node-mediaNode[data-id="A"] [data-testid="media-content"]').click();
          await page.getByRole('button', { name: '移除方案 待移除方案', exact: true }).click();
          await vi.waitFor(async () => {
            const stored = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
            expect(JSON.parse(stored.edges).some((e: { source: string; target: string }) => e.source === first.node.id && e.target === "A")).toBe(false);
          });
          await page.reload();
          await page.locator('.react-flow__node-mediaNode[data-id="A"] [data-testid="media-content"]').click();
          expect(await page.getByRole('button', { name: '移除方案 待移除方案', exact: true }).count()).toBe(0);
        } finally { await browser.close(); await vite.close(); }
      } else {
        await save(before.filter((e: { source: string; target: string }) => !(e.source === first.node.id && e.target === "A")));
      }
      const restored = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
      const edges = JSON.parse(restored.edges);
      expect(edges.filter((e: { target: string }) => e.target === "A").map((e: { source: string }) => e.source).sort()).toEqual([media[1].id, media[2].id, second.node.id].sort());
      expect(edges.find((e: { id: string }) => e.id === "manual").data.inputSources).toEqual({ manual: true, planNodeIds: [] });
      expect(edges.find((e: { source: string; target: string }) => e.source === media[1].id && e.target === "A").data.inputSources).toEqual({ manual: false, planNodeIds: [second.node.id] });
      expect(edges.filter((e: { target: string }) => e.target === "B")).toEqual(before.filter((e: { target: string }) => e.target === "B"));
      const restoredNodes = JSON.parse(restored.nodes);
      expect(restoredNodes.map((n: { id: string }) => n.id).sort()).toEqual(nodes.map((n: { id: string }) => n.id).sort());
      for (const original of nodes.filter((n: { type: string }) => n.type === "textNode")) {
        expect(restoredNodes.find((n: { id: string }) => n.id === original.id).data).toMatchObject(original.data);
      }
      for (const original of media) expect(restoredNodes.find((n: { id: string }) => n.id === original.id).data.assetId).toBe(original.data.assetId);
      if (process.env.IKETSZ_BROWSER) {
        const { page, browser, vite } = await openPlanBrowser(false);
        try {
          await page.locator(`.react-flow__node-textNode[data-id="${second.node.id}"]`).click({ button: 'right' });
          await page.getByText('删除', { exact: true }).click();
          await vi.waitFor(async () => {
            const stored = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
            expect(JSON.parse(stored.nodes).some((n: { id: string }) => n.id === second.node.id)).toBe(false);
          });
          const target = page.locator('.react-flow__node-mediaNode[data-id="A"] [data-testid="media-content"]');
          await target.click();
          expect(await page.getByTestId('dock-media-ref').count()).toBe(1);
          const box = (await target.boundingBox())!;
          await page.mouse.move(box.x + 50, box.y + 50); await page.mouse.down();
          await page.mouse.move(box.x + 80, box.y + 70, { steps: 5 }); await page.mouse.up();
          await vi.waitFor(async () => {
            const stored = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
            expect(JSON.parse(stored.nodes).find((n: { id: string }) => n.id === "A").position.x).not.toBe(900);
            expect(JSON.parse(stored.edges).filter((e: { target: string }) => e.target === "A")).toHaveLength(1);
          });
          await page.reload(); await target.click();
          expect(await page.getByTestId('dock-media-ref').count()).toBe(1);
        } finally { await browser.close(); await vite.close(); }
      }
    } finally { materialPayload = undefined; activeRevision = undefined; }
  }, 30_000);

  it("IKETSZ: public generation rejects disconnected, inaccessible and deleted plan assets until repaired", async () => {
    projectId = (await projects.create("987654", "IKETSZ invalidation")).id;
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    materialPayload = { target_media: "video", assets: [{ asset_ref_id: "a", asset_id: String(asset.id), media_type: "image" }],
      shots: [{ shot_no: 1, title: "共享方案", prompt_text: "素材A雨夜", asset_bindings: [{ asset_ref_id: "a" }], prompt_mentions: [{ start: 0, end: 3, asset_ref_id: "a", index: 7 }] }] };
    try {
      const applied = (await (await apply()).json()).data;
      let canvas = applied.canvas;
      const nodes = JSON.parse(canvas.nodes);
      const plan = nodes.find((n: { id: string }) => n.id === applied.node.id);
      nodes.push(...["image", "video", "history"].map(id => ({ id, type: "mediaNode", position: { x: 900, y: 0 }, data: { mediaType: id === "video" ? "video" : "image", genStatus: "draft", draftModelId: id === "video" ? "doubao-seedance-2-0-260128" : "iketsw-image" } })));
      const save = async (edges: unknown[]) => {
        const res = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges) }) });
        expect(res.status, await res.clone().text()).toBe(200); canvas = (await res.json()).data;
      };
      const reference = async (targetNodeId: string, syncBindings?: unknown[]) => {
        const res = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planNodeId: plan.id, targetNodeId, expectedVersion: canvas.version, syncBindings }) });
        expect(res.status, await res.clone().text()).toBe(201); canvas = (await res.json()).data;
      };
      const submit = (id: string, ids = [String(asset.id)]) => fetch(`${base}/api/projects/${projectId}/generation-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        type: id === "video" ? "video" : "image", target_node_id: id, expected_output_count: 1,
        ...(id === "video" ? (ids.length ? { references: ids.map(asset_id => ({ asset_id, type: "image", role: "reference" })) } : {}) : { input_asset_ids: ids }),
        parameters: { prompt: "保留草稿", model_id: id === "video" ? "doubao-seedance-2-0-260128" : "iketsw-image", aspect_ratio: id === "video" ? "16:9" : "1:1", ...(id === "video" ? { resolution: "720p", duration: 5 } : {}) },
      }) });
      const jobs = async () => (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
      await save([]);
      for (const id of ["image", "video", "history"]) await reference(id);
      expect((await (await submit("history")).json()).code).toBe(200);
      const oldSnapshot = (await jobs())[0].input.prompt_plan_snapshot;
      const connected = JSON.parse(canvas.edges);
      await save(connected.filter((e: { source: string; target: string }) => !(e.target === "image" && e.source !== plan.id)));
      expect(await (await submit("image")).text()).toContain("#7");
      expect(await (await submit("image", [])).text()).toContain("#7");
      expect(JSON.parse(canvas.nodes).find((n: { id: string }) => n.id === plan.id)).toEqual(plan);
      await save(connected);
      await prisma.client.assets.update({ where: { id: asset.id }, data: { user_id: 12345n } });
      for (const id of ["image", "video"]) expect(await (await submit(id)).text()).toContain("#7");
      await prisma.client.assets.update({ where: { id: asset.id }, data: { user_id: 987654n } });
      expect((await (await fetch(`${base}/api/assets/${asset.id}`, { method: "DELETE" })).json()).code).toBe(200);
      for (const id of ["image", "video"]) expect(await (await submit(id)).text()).toContain("#7");
      expect(await jobs()).toHaveLength(1);
      expect((await jobs())[0].input.prompt_plan_snapshot).toEqual(oldSnapshot);
      // Repair the shared plan explicitly; clearing a target's media list alone was rejected above.
      plan.data.text = "修正后的纯文字方案"; plan.data.promptMentions = [];
      await save(JSON.parse(canvas.edges));
      for (const id of ["image", "video"]) expect(await (await submit(id, [])).text()).toContain("待同步");
      await reference("image", []);
      expect(await (await submit("video", [])).text()).toContain("待同步");
      await reference("video", []);
      for (const id of ["image", "video"]) expect((await (await submit(id, [])).json()).code).toBe(200);
      expect((await jobs()).find((j: { input: { target_node_id: string } }) => j.input.target_node_id === "history").input.prompt_plan_snapshot).toEqual(oldSnapshot);
      const repairedVideo = (await jobs()).find((j: { input: { target_node_id: string } }) => j.input.target_node_id === "video");
      const execute = () => runVideoJobStep({ repo: createWorkerRepo(prisma.client), workerId: "iketsz-worker", jobId: repairedVideo.job_id,
        credentialVault: { open: value => value },
        createProvider: token => createNewApiVideoTaskProvider({ baseUrl: process.env.AGENT_SERVICE_BASE_URL!, token }),
        mediaRelay: { persist: async url => ({ url, storageKey: null, mime: "video/mp4", size: 100 }) },
      });
      await vi.waitFor(async () => expect(await execute()).toBe(repairedVideo.job_id), { timeout: 3000 });
      expect(videoRequests.at(-1)?.prompt).toBe("修正后的纯文字方案\n\n保留草稿");
      expect(videoRequests.at(-1)?.metadata.content).toEqual([]);
      await vi.waitFor(async () => {
        await execute();
        expect((await jobs()).find((j: { job_id: string }) => j.job_id === repairedVideo.job_id).status).toBe("succeeded");
      }, { timeout: 10000, interval: 500 });
    } finally { materialPayload = undefined; }
  }, 20_000);

  async function openPlanBrowser(applyPreview = true) {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const vite = await createVite({ root: `${process.cwd()}/web`, server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } } } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: { userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      if (applyPreview) {
        await page.getByRole("button", { name: "Agent", exact: true }).click();
        await page.getByRole("button", { name: "手动应用", exact: true }).click();
      }
      const plan = page.locator(".react-flow__node-textNode").first();
      await plan.waitFor();
      await page.reload();
      await plan.waitFor();
      return { page, plan, browser, vite };
    } catch (error) {
      await browser.close();
      await vite.close();
      throw error;
    }
  }

  it.runIf(process.env.IKETSZ_BROWSER)("IKETSZ browser: remove and restore plan inputs independently for image and video", async () => {
    projectId = (await projects.create("987654", "IKETSZ browser")).id;
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png?case=iketsz-${projectId}` } });
    materialPayload = { target_media: "video", assets: [{ asset_ref_id: "a", asset_id: String(asset.id), media_type: "image" }],
      shots: [{ shot_no: 1, title: "共享方案", prompt_text: "素材A雨夜", asset_bindings: [{ asset_ref_id: "a" }], prompt_mentions: [{ start: 0, end: 3, asset_ref_id: "a", index: 7 }] }] };
    const targets = ["image", "video"].map((type, i) => ({ id: type, type: "mediaNode", position: { x: 350, y: 40 + i * 330 },
      data: { mediaType: type, draft: true, genStatus: "draft", draftModelId: type === "image" ? "iketsw-image" : "doubao-seedance-2-0-260128", draftSize: type === "image" ? "1024x1024" : "720p", draftRatio: type === "image" ? "1:1" : "16:9", draftMode: "all", draftDuration: 5, prompt: "已有草稿", targetRatio: "1:1" } }));
    await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodes: JSON.stringify(targets), edges: "[]", viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }) });
    const { page, plan, browser, vite } = await openPlanBrowser();
    const read = async () => (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
    try {
      let canvas = await read();
      const planId = JSON.parse(canvas.nodes).find((n: { type: string }) => n.type === "textNode").id;
      for (const targetNodeId of ["image", "video"]) {
        const res = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planNodeId: planId, targetNodeId, expectedVersion: canvas.version }) });
        expect(res.status).toBe(201); canvas = (await res.json()).data;
      }
      await page.reload(); await plan.waitFor();
      const target = (id: string) => page.locator(`.react-flow__node-mediaNode[data-id="${id}"] [data-testid="media-content"]`);
      for (const type of ["image", "video"]) {
        await target(type).click();
        const mediaRef = page.getByTestId(type === "image" ? "dock-media-ref" : "dock-video-ref");
        await mediaRef.getByRole("button", { name: type === "image" ? "移除" : "移除（断开连线）", exact: true }).click();
        await page.getByText(/方案索引 #7 素材缺失/).waitFor();
        expect(await (type === 'video' ? page.getByTestId('video-send') : page.locator('button[title="发送"]')).isDisabled()).toBe(true);
        await vi.waitFor(async () => expect(JSON.parse((await read()).edges).filter((e: { target: string }) => e.target === type)).toHaveLength(1));
        if (type === 'image') {
          await page.reload(); await plan.waitFor();
          await target('image').click();
          await page.getByText(/方案索引 #7 素材缺失/).waitFor();
          await target('video').click();
          await vi.waitFor(async () => expect(await page.getByTestId('video-send').isEnabled(), (await page.locator('body').innerText()).slice(-2500)).toBe(true));
          const materialId = JSON.parse((await read()).nodes).find((n: { data: { assetId?: string } }) => n.data.assetId === String(asset.id)).id;
          const materialNode = page.locator(`.react-flow__node-mediaNode[data-id="${materialId}"]`);
          await materialNode.locator('[data-testid="media-content"]').click();
          const from = (await materialNode.locator('.react-flow__handle-right').boundingBox())!;
          const to = (await page.locator('.react-flow__node-mediaNode[data-id="image"] .react-flow__handle-left').boundingBox())!;
          await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
          await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 }); await page.mouse.up();
          await target('image').click();
        } else await page.keyboard.press('Control+z');
        await vi.waitFor(async () => expect(await (type === 'video' ? page.getByTestId('video-send') : page.locator('button[title="发送"]')).isEnabled(), (await page.locator('body').innerText()).slice(-2500)).toBe(true));
        const remove = page.getByRole("button", { name: /^移除方案 / });
        expect(await remove.count()).toBe(1);
        await remove.click();
        await vi.waitFor(async () => expect(JSON.parse((await read()).edges).filter((e: { target: string }) => e.target === type)).toHaveLength(type === "image" ? 1 : 0));
        expect(await plan.count()).toBe(1);
        expect(JSON.parse((await read()).nodes).find((n: { id: string }) => n.id === type).data.prompt).toBe("已有草稿");
        await page.keyboard.press('Control+z');
        await vi.waitFor(async () => expect(JSON.parse((await read()).edges).filter((e: { target: string }) => e.target === type)).toHaveLength(2));
        await page.keyboard.press('Control+Shift+z');
        await vi.waitFor(async () => expect(JSON.parse((await read()).edges).filter((e: { target: string }) => e.target === type)).toHaveLength(type === "image" ? 1 : 0));
        await page.keyboard.press('Control+z');
        await vi.waitFor(async () => expect(JSON.parse((await read()).edges).filter((e: { target: string }) => e.target === type)).toHaveLength(2));
        await page.reload(); await plan.waitFor();
      }
      expect(JSON.parse((await read()).nodes).filter((n: { data: { assetId?: string } }) => n.data.assetId === String(asset.id))).toHaveLength(1);
      const canvasUrl = page.url();
      await page.goto(new URL('/library', canvasUrl).href);
      const assetCard = page.getByRole('button', { name: '查看图片资产详情', exact: true }).filter({ has: page.locator(`img[src="${asset.url}"]`) });
      await assetCard.hover({ timeout: 5000 });
      await assetCard.getByRole('button', { name: '删除资产', exact: true }).click();
      const deleted = page.waitForResponse(response => response.url().endsWith(`/assets/${asset.id}`) && response.request().method() === 'DELETE');
      await page.getByRole('button', { name: '确认删除', exact: true }).click();
      expect((await (await deleted).json()).code).toBe(200);
      await page.goto(canvasUrl); await plan.waitFor();
      for (const type of ["image", "video"]) {
        await target(type).click();
        await page.getByText(/方案索引 #7 素材缺失/).waitFor();
        expect(await (type === 'video' ? page.getByTestId('video-send') : page.locator('button[title="发送"]')).isDisabled()).toBe(true);
      }
      await page.screenshot({ path: '/tmp/iketsz-deleted-asset.png', fullPage: true });
      await plan.locator('[data-placeholder="输入内容..."]').dblclick();
      await plan.locator('[data-prompt-index="7"]').click();
      await plan.getByRole('button', { name: '删除标签 #7', exact: true }).click();
      await vi.waitFor(async () => expect(JSON.parse((await read()).nodes).find((n: { id: string }) => n.id === planId).data.promptMentions).toEqual([]));
      for (const type of ['image', 'video']) {
        await target(type).click();
        if (type === 'image') {
          // Explicit reconnection added a manual input; plan sync must not silently remove it.
          await page.getByRole('button', { name: '移除失效参考', exact: true }).click();
        }
        await page.getByRole('button', { name: '同步素材到目标', exact: true }).click();
        await vi.waitFor(async () => expect(await (type === 'video' ? page.getByTestId('video-send') : page.locator('button[title="发送"]')).isEnabled(), (await page.locator('body').innerText()).slice(-2500)).toBe(true));
      }
      await page.screenshot({ path: '/tmp/iketsz-repaired.png', fullPage: true });
    } finally { materialPayload = undefined; await browser.close(); await vite.close(); }
  }, 60_000);

  it.runIf(process.env.IKETSY_BROWSER)("IKETSY browser: edit material tags and confirm A without releasing B", async () => {
    projectId = (await projects.create("987654", "IKETSY browser")).id;
    const assets = await Promise.all([0, 1].map(() => prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } })));
    const [a, b] = assets.map(asset => String(asset.id));
    await prisma.client.project_asset.create({ data: { user_id: 987654n, project_id: BigInt(projectId), asset_id: assets[1]!.id, is_delete: 0 } });
    materialPayload = { target_media: "image", assets: [{ asset_ref_id: "a", asset_id: a, media_type: "image" }],
      shots: [{ shot_no: 1, title: "共享方案", prompt_text: "素材A雨夜", asset_bindings: [{ asset_ref_id: "a" }], prompt_mentions: [{ start: 0, end: 3, asset_ref_id: "a", index: 7 }] }] };
    const targets = ["A", "B"].map((id, i) => ({ id, type: "mediaNode", position: { x: 350, y: 40 + i * 330 },
      data: { mediaType: "image", draft: true, genStatus: "draft", draftModelId: "iketsw-image", draftSize: "1024x1024", draftRatio: "1:1", prompt: "已有草稿", targetRatio: "1:1" } }));
    await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodes: JSON.stringify([...targets,
      { id: "material-b", type: "mediaNode", position: { x: 0, y: 0 }, data: { assetId: b, src: assets[1]!.url, mediaType: "image", fileName: "素材B" } }]), edges: "[]", viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }) });
    const { page, plan, browser, vite } = await openPlanBrowser();
    const read = async () => (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
    try {
      let canvas = await read();
      const planId = JSON.parse(canvas.nodes).find((n: { type: string }) => n.type === "textNode").id;
      for (const targetNodeId of ["A", "B"]) {
        const res = await fetch(`${base}/api/canvases/${projectId}/prompt-references`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planNodeId: planId, targetNodeId, expectedVersion: canvas.version }) });
        expect(res.status).toBe(201); canvas = (await res.json()).data;
      }
      await page.reload(); await plan.waitFor();
      const editor = plan.locator('[data-placeholder="输入内容..."]');
      await editor.dblclick();
      await plan.locator('[data-prompt-index="7"]').click();
      await plan.getByLabel("替换素材 #7").selectOption(b!);
      await vi.waitFor(async () => expect(JSON.parse((await read()).nodes).find((n: { id: string }) => n.id === planId).data.promptMentions[0].assetId).toBe(b));
      const target = (id: string) => page.locator(`.react-flow__node-mediaNode[data-id="${id}"] [data-testid="media-content"]`);
      await target("A").click();
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(true);
      await page.getByRole("button", { name: "同步素材到目标", exact: true }).click();
      await vi.waitFor(async () => expect(await page.locator('button[title="发送"]').isEnabled()).toBe(true));
      expect(await page.locator('textarea').inputValue()).toBe("已有草稿");
      await page.reload(); await plan.waitFor();
      await target("B").click();
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(true);
      await page.getByText(/素材待同步/).first().waitFor();
      canvas = await read();
      const edges = JSON.parse(canvas.edges);
      expect(edges.find((e: { source: string; target: string }) => e.source === planId && e.target === "A").data.promptReference.bindings).toEqual([{ index: 7, assetId: b }]);
      expect(edges.find((e: { source: string; target: string }) => e.source === planId && e.target === "B").data.promptReference.bindings).toEqual([{ index: 7, assetId: a }]);
      await page.screenshot({ path: '/tmp/iketsy-browser.png', fullPage: true });
      await editor.dblclick();
      await plan.locator('[data-prompt-index="7"]').click();
      await plan.getByRole("button", { name: "删除标签 #7", exact: true }).click();
      await vi.waitFor(async () => expect(JSON.parse((await read()).nodes).find((n: { id: string }) => n.id === planId).data.promptMentions).toEqual([]));
      await plan.getByLabel("新增素材标签").selectOption(b!);
      await vi.waitFor(async () => expect(JSON.parse((await read()).nodes).find((n: { id: string }) => n.id === planId).data.promptMentions).toEqual([expect.objectContaining({ index: 1, assetId: b })]));
      await page.reload(); await plan.waitFor();
      await target("A").click();
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(true);
      await page.getByRole("button", { name: "同步素材到目标", exact: true }).waitFor();
      // Delay, but do not replace, the real API request while another client saves an edit.
      let releaseRequest!: () => void;
      let requestStarted!: () => void;
      const gate = new Promise<void>(resolve => { releaseRequest = resolve; });
      const started = new Promise<void>(resolve => { requestStarted = resolve; });
      await page.route('**/prompt-references', async route => { requestStarted(); await gate; await route.continue(); });
      const staleSync = page.waitForResponse(res => res.url().endsWith('/prompt-references'));
      await page.getByRole("button", { name: "同步素材到目标", exact: true }).click();
      await started;
      try {
        const remote = await read();
        const remoteNodes = JSON.parse(remote.nodes);
        const remotePlan = remoteNodes.find((n: { id: string }) => n.id === planId);
        remotePlan.data.promptMentions[0].index = 2;
        const changed = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${remote.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(remoteNodes) }) });
        expect(changed.status).toBe(200);
      } finally { releaseRequest(); }
      expect((await staleSync).status()).toBe(412);
      await vi.waitFor(async () => expect(await page.getByRole("status").filter({ hasText: '正在保存画布引用' }).count()).toBe(0));
      expect(await plan.locator('[data-prompt-index="1"]').count()).toBe(1);
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(true);
      await page.unroute('**/prompt-references');


    } finally { materialPayload = undefined; await browser.close(); await vite.close(); }
  }, 60_000);

  it.runIf(process.env.IKETSY_BROWSER)("IKETSY browser: shortening an over-limit draft preserves the newly selected material", async () => {
    projectId = (await projects.create("987654", "IKETSY recover edit")).id;
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    await prisma.client.project_asset.create({ data: { user_id: 987654n, project_id: BigInt(projectId), asset_id: asset.id, is_delete: 0 } });
    await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodes: JSON.stringify([
      { id: "chosen", type: "mediaNode", data: { assetId: String(asset.id), src: asset.url, mediaType: "image", fileName: "素材B" }, position: { x: 0, y: 0 } },
    ]), edges: "[]", viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }) });
    const { page, plan, browser, vite } = await openPlanBrowser();
    try {
      const editor = plan.locator('[data-placeholder="输入内容..."]');
      await editor.dblclick();
      await editor.fill('字'.repeat(100_000));
      await plan.getByLabel('新增素材标签').selectOption(String(asset.id));
      await plan.getByText(/正文最多 100000 字/).waitFor();
      // Select only the ordinary text; the real Backspace/input event retains the atomic material tag.
      await editor.evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let text: Node | null;
        while ((text = walker.nextNode())) {
          if ((text.textContent?.length ?? 0) < 100_000) continue;
          const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 99_990);
          const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); break;
        }
        (element as HTMLElement).focus();
      });
      await page.keyboard.press('Backspace');
      await vi.waitFor(async () => {
        const canvas = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
        const saved = JSON.parse(canvas.nodes).find((n: { type: string }) => n.type === 'textNode');
        expect(saved.data.promptMentions).toEqual([expect.objectContaining({ assetId: String(asset.id), index: 1 })]);
        expect(saved.data.text.length).toBeLessThan(100);
      }, { timeout: 5000 });
      await page.reload(); await plan.waitFor();
      expect(await plan.locator('[data-prompt-asset]').getAttribute('data-prompt-asset')).toBe(String(asset.id));
    } finally { await browser.close(); await vite.close(); }
  }, 60_000);

  it.runIf(process.env.IKETSW_BROWSER)("IKETSW browser: apply, Dock reference and drag connect preserve drafts and restore inputs", async () => {
    projectId = (await projects.create("987654", "IKETSW browser")).id;
    const a = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    materialPayload = { target_media: "video", assets: [{ asset_ref_id: "a", asset_id: String(a.id), media_type: "image" }],
      shots: [{ shot_no: 1, title: "VIDEO 方案", prompt_text: "素材A的雨夜", asset_bindings: [{ asset_ref_id: "a" }], prompt_mentions: [{ start: 0, end: 3, asset_ref_id: "a", index: 7 }] }] };
    const targets = ["dock-target", "drag-target"].map((id, i) => ({ id, type: "mediaNode", position: { x: 350, y: 40 + i * 330 },
      data: { mediaType: "image", draft: true, genStatus: "draft", draftModelId: "iketsw-image", draftSize: "1024x1024", draftRatio: "1:1", prompt: "已有草稿", targetRatio: "1:1" } }));
    await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodes: JSON.stringify(targets), edges: "[]", viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }) });
    const { page, plan, browser, vite } = await openPlanBrowser();
    try {
      const dock = page.locator('.react-flow__node-mediaNode[data-id="dock-target"]');
      await dock.locator('[data-testid="media-content"]').click();
      await page.locator('button[title="从资产中选择 / 从节点添加素材"]').click();
      await page.getByRole("button", { name: "从节点添加素材", exact: true }).click();
      const referenced = page.waitForResponse(r => r.url().endsWith('/prompt-references') && r.request().method() === 'POST');
      await plan.locator('[data-testid="text-title"]').click();
      await page.screenshot({ path: '/tmp/iketsw-reference-debug.png' });
      expect((await referenced).status()).toBe(201);
      await page.getByText("文本附件（1）").waitFor();
      expect(await page.locator('textarea').inputValue()).toBe("已有草稿");
      await vi.waitFor(async () => expect(await page.locator('.react-flow__edge').count()).toBe(2));
      await page.keyboard.press('Control+z');
      await vi.waitFor(async () => expect(await page.locator('.react-flow__edge').count()).toBe(0));
      await page.keyboard.press('Control+Shift+z');
      await vi.waitFor(async () => expect(await page.locator('.react-flow__edge').count()).toBe(2));
      await vi.waitFor(async () => {
        const persisted = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
        expect(JSON.parse(persisted.edges)).toHaveLength(2);
      });
      await page.reload();
      await plan.waitFor();
      const drag = page.locator('.react-flow__node-mediaNode[data-id="drag-target"]');
      await plan.locator('[data-testid="text-title"]').click();
      const src = (await plan.locator('.react-flow__handle-right').boundingBox())!;
      const dst = (await drag.locator('.react-flow__handle-left').boundingBox())!;
      const connected = page.waitForResponse(r => r.url().endsWith('/prompt-references') && r.request().method() === 'POST');
      await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
      await page.mouse.down();
      await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 12 });
      await page.mouse.up();
      expect((await connected).status()).toBe(201);
      const saved = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
      const edges = JSON.parse(saved.edges);
      expect(edges.filter((e: { target: string }) => e.target === 'dock-target').map((e: { source: string }) => e.source).sort())
        .toEqual(edges.filter((e: { target: string }) => e.target === 'drag-target').map((e: { source: string }) => e.source).sort());
      await page.reload();
      await dock.waitFor();
      await dock.locator('[data-testid="media-content"]').click();
      await page.getByText("文本附件（1）").waitFor();
      expect(await page.locator('textarea').inputValue()).toBe("已有草稿");
      await page.screenshot({ path: '/tmp/iketsw-dock.png', fullPage: true, animations: 'disabled' });
      const generated = page.waitForResponse(r => r.url().endsWith('/generation-jobs') && r.request().method() === 'POST');
      await page.locator('button[title="发送"]').click();
      expect((await (await generated).json()).code).toBe(200);
      const jobs = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
      expect(jobs[0].input.prompt_plan_snapshot.providerPrompt).toBe("参考图1的雨夜\n\n已有草稿");
      await page.screenshot({ path: '/tmp/iketsw-browser.png', fullPage: true, animations: 'disabled' });
    } finally { materialPayload = undefined; await browser.close(); await vite.close(); }
  }, 60_000);
  it.runIf(process.env.IKETSX_BROWSER)("IKETSX browser: apply, Dock reference and drag connect preserve drafts and restore inputs", async () => {
    projectId = (await projects.create("987654", "IKETSX browser")).id;
    const a = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    const b = await prisma.client.assets.create({ data: { user_id: 987654n, type: "video", url: `${process.env.AGENT_SERVICE_BASE_URL}/b.mp4`, width: 1280, height: 720, duration_ms: 5000, mime: "video/mp4" } });
    const c = await prisma.client.assets.create({ data: { user_id: 987654n, type: "audio", url: `${process.env.AGENT_SERVICE_BASE_URL}/c.wav` } });
    materialPayload = { target_media: "image", assets: [a, b, c].map((asset, i) => ({ asset_ref_id: `a${i}`, asset_id: String(asset.id), media_type: asset.type })),
      shots: [{ shot_no: 1, title: "IMAGE 方案", prompt_text: "图A视频B音频C", asset_bindings: [0, 1, 2].map(i => ({ asset_ref_id: `a${i}` })), prompt_mentions: [{ start: 0, end: 2, asset_ref_id: "a0", index: 7 }, { start: 2, end: 5, asset_ref_id: "a1", index: 2 }, { start: 5, end: 8, asset_ref_id: "a2", index: 9 }] }] };
    const targets = ["dock-target", "drag-target"].map((id, i) => ({ id, type: "mediaNode", position: { x: 350, y: 40 + i * 330 },
      data: { mediaType: "video", draft: true, genStatus: "draft", draftModelId: "doubao-seedance-2-0-260128", draftResolution: "720p", draftDuration: 5, draftRatio: "16:9", draftMode: "all", prompt: "已有草稿", targetRatio: "16:9" } }));
    await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodes: JSON.stringify(targets), edges: "[]", viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }) });
    const { page, plan, browser, vite } = await openPlanBrowser();
    try {
      const dock = page.locator('.react-flow__node-mediaNode[data-id="dock-target"]');
      await dock.locator('[data-testid="media-content"]').click();
      await page.locator('button[title="添加图片参考（从资产中选择 / 到节点选择 / 角色库）"]').click();
      await page.getByRole("button", { name: "到节点选择", exact: true }).click();
      const referenced = page.waitForResponse(r => r.url().endsWith('/prompt-references') && r.request().method() === 'POST');
      await plan.locator('[data-testid="text-title"]').click();
      await page.screenshot({ path: '/tmp/iketsx-reference-debug.png' });
      expect((await referenced).status()).toBe(201);
      await page.getByText("文本附件（1）").waitFor();
      expect(await page.getByTestId("dock-video-ref").count()).toBe(3);
      expect(await page.locator('[contenteditable=true]').last().innerText()).toBe("已有草稿");
      await vi.waitFor(async () => expect(await page.locator('.react-flow__edge').count()).toBe(4));
      await page.keyboard.press('Control+z');
      await vi.waitFor(async () => expect(await page.locator('.react-flow__edge').count()).toBe(0));
      await page.keyboard.press('Control+Shift+z');
      await vi.waitFor(async () => expect(await page.locator('.react-flow__edge').count()).toBe(4));
      await vi.waitFor(async () => {
        const persisted = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
        expect(JSON.parse(persisted.edges)).toHaveLength(4);
      });
      await page.reload();
      await plan.waitFor();
      const drag = page.locator('.react-flow__node-mediaNode[data-id="drag-target"]');
      await plan.locator('[data-testid="text-title"]').click();
      const src = (await plan.locator('.react-flow__handle-right').boundingBox())!;
      const dst = (await drag.locator('.react-flow__handle-left').boundingBox())!;
      const connected = page.waitForResponse(r => r.url().endsWith('/prompt-references') && r.request().method() === 'POST');
      await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
      await page.mouse.down();
      await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 12 });
      await page.mouse.up();
      expect((await connected).status()).toBe(201);
      const saved = (await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data;
      const edges = JSON.parse(saved.edges);
      expect(edges.filter((e: { target: string }) => e.target === 'dock-target').map((e: { source: string }) => e.source).sort())
        .toEqual(edges.filter((e: { target: string }) => e.target === 'drag-target').map((e: { source: string }) => e.source).sort());
      await page.reload();
      await dock.waitFor();
      await dock.locator('[data-testid="media-content"]').click();
      await page.getByText("文本附件（1）").waitFor();
      expect(await page.getByTestId("dock-video-ref").count()).toBe(3);
      expect(await page.locator('[contenteditable=true]').last().innerText()).toBe("已有草稿");
      await page.screenshot({ path: '/tmp/iketsx-dock.png', fullPage: true, animations: 'disabled' });
      const generated = page.waitForResponse(r => r.url().endsWith('/generation-jobs') && r.request().method() === 'POST');
      await page.locator('button[title="发送"]').click();
      expect((await (await generated).json()).code).toBe(200);
      const jobs = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
      expect(jobs[0].input.prompt_plan_snapshot.providerPrompt).toBe("参考图1参考视频1参考音频1\n\n已有草稿");
      const jobId = jobs[0].job_id;
      expect(jobId).toMatch(/^[0-9]+$/);
      await vi.waitFor(async () => {
        await runVideoJobStep({ repo: createWorkerRepo(prisma.client), workerId: "iketsx-browser-worker", jobId,
          credentialVault: { open: value => value },
          createProvider: token => createNewApiVideoTaskProvider({ baseUrl: process.env.AGENT_SERVICE_BASE_URL!, token }),
          mediaRelay: { persist: async url => ({ url, storageKey: null, mime: "video/mp4", size: 100 }) },
        });
        const records = (await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.records;
        expect(records[0].status).toBe("succeeded");
      }, { timeout: 10000, interval: 500 });
      await page.reload();
      await dock.locator('video').waitFor();
      await page.screenshot({ path: '/tmp/iketsx-browser.png', fullPage: true, animations: 'disabled' });
    } finally { materialPayload = undefined; await browser.close(); await vite.close(); }
  }, 60_000);

  it("reuses material A and atomically adds material B with persistent, numbered prompt bindings", async () => {
    projectId = (await projects.create("987654", "IKETSV materials")).id;
    const a = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: `${process.env.AGENT_SERVICE_BASE_URL}/a.png` } });
    const b = await prisma.client.assets.create({ data: { user_id: 987654n, type: "video", url: `${process.env.AGENT_SERVICE_BASE_URL}/b.mp4` } });
    const existing = { id: "existing-a", type: "mediaNode", position: { x: 0, y: 0 }, data: { assetId: String(a.id), mediaType: "image", src: a.url } };
    const text = "素材A与素材B，再用素材A。";
    materialPayload = {
      target_media: "video",
      assets: [
        { asset_ref_id: "a", asset_id: String(a.id), media_type: "image" },
        { asset_ref_id: "b", asset_id: String(b.id), media_type: "video" },
      ],
      shots: [{ shot_no: 1, title: "原描述不改", prompt_text: text,
        asset_bindings: [{ asset_ref_id: "a" }, { asset_ref_id: "b" }],
        prompt_mentions: [
          { start: 0, end: 3, asset_ref_id: "a", index: 1 },
          { start: 4, end: 7, asset_ref_id: "b", index: 2 },
          { start: 10, end: 13, asset_ref_id: "a", index: 1 },
        ],
      }],
    };
    try {
      expect((await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodes: JSON.stringify([existing]), viewport: "{}" }),
      })).status).toBe(200);
      const result = await (await apply()).json();
      expect(result.data.node.data).toMatchObject({ title: "VIDEO #1", text,
        promptMentions: [
          { start: 0, end: 3, assetId: String(a.id), index: 1 },
          { start: 4, end: 7, assetId: String(b.id), index: 2 },
          { start: 10, end: 13, assetId: String(a.id), index: 1 },
        ],
      });
      const stored = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
      const nodes = JSON.parse(stored.data.nodes);
      expect(nodes).toHaveLength(3);
      expect(nodes).toContainEqual(existing);
      expect(nodes.find((node: { data: { assetId?: string } }) => node.data.assetId === String(b.id))).toMatchObject({ type: "mediaNode" });
      const repeated = await (await apply()).json();
      expect(repeated.data.node).toEqual(result.data.node);
      expect(JSON.parse(repeated.data.canvas.nodes)).toEqual(nodes);
      if (process.env.IKDLQE_BROWSER) {
        const cleared = await fetch(`${base}/api/canvases/${projectId}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': `"${repeated.data.canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify([existing]) }) });
        expect(cleared.status).toBe(200);
        const { chromium } = await import("playwright");
        const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
        const vite = await createVite({ root: `${process.cwd()}/web`, server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } } } });
        await vite.listen();
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
          await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: { userId: 987654, username: "integration", isAdmin: false } }, version: 0 })));
          await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
          const generations: string[] = [];
          page.on('request', request => { if (request.method() === 'POST' && /\/(jobs|generation)\//.test(request.url())) generations.push(request.url()); });
          await page.getByRole('button', { name: 'Agent', exact: true }).click();
          await page.getByRole('button', { name: '手动应用', exact: true }).click();
          const editor = page.locator('.react-flow__node-textNode [data-placeholder="输入内容..."]');
          await editor.waitFor();
          await editor.locator('[data-prompt-asset]').first().waitFor({ timeout: 5000 });
          expect(await editor.locator('[data-prompt-asset]').count()).toBe(3);
          await editor.locator('img').first().evaluate(async (image: HTMLImageElement) => { await image.decode(); });
          expect(await editor.locator('[data-prompt-asset]').first().getAttribute('data-prompt-asset')).toBe(String(a.id));
          await editor.dblclick();
          await page.keyboard.press('Home');
          await page.keyboard.type('新增文字');
          await page.locator('.react-flow__pane').click({ position: { x: 40, y: 700 } });
          await page.getByText(/^已保存 /).waitFor();
          await page.reload();
          await editor.locator('[data-prompt-asset]').first().waitFor();
          expect(await editor.locator('[data-prompt-asset]').count()).toBe(3);
          await editor.dblclick();
          // Select exactly the atomic tag, then use the browser's real cut/paste path to reorder it.
          await editor.locator('[data-prompt-asset]').nth(1).evaluate(chip => {
            const range = document.createRange(); range.selectNode(chip);
            const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
          });
          await page.keyboard.press('ControlOrMeta+x');
          expect(await editor.locator('[data-prompt-asset]').count()).toBe(2);
          await page.locator('.react-flow__pane').click({ position: { x: 40, y: 700 } });
          await page.getByText(/^已保存 /).waitFor();
          await page.reload();
          await editor.locator('[data-prompt-asset]').first().waitFor();
          await editor.dblclick();
          await editor.evaluate(element => {
            const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
            const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
          });
          await page.keyboard.press('ControlOrMeta+v');
          expect(await editor.locator('[data-prompt-asset]').count()).toBe(3);
          await page.locator('.react-flow__pane').click({ position: { x: 40, y: 700 } });
          await page.getByText(/^已保存 /).waitFor();
          await page.reload();
          await editor.locator('[data-prompt-asset]').first().waitFor();
          expect(await editor.locator('[data-prompt-index]').evaluateAll(chips => chips.map(chip => chip.getAttribute('data-prompt-index')))).toEqual(['1', '1', '2']);
          expect(await editor.locator('[data-prompt-asset]').last().getAttribute('data-prompt-asset')).toBe(String(b.id));
          const persisted = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
          expect(JSON.parse(persisted.data.nodes)).toHaveLength(3);
          expect(JSON.parse(persisted.data.nodes).find((node: { id: string }) => node.id === existing.id)).toMatchObject(existing);
          expect(generations).toEqual([]);
          await page.screenshot({ path: '/tmp/iketsv-materials.png', fullPage: true });
        } finally { await browser.close(); await vite.close(); }
      }
    } finally { materialPayload = undefined; }
  }, 60_000);
  it("keeps one node under concurrent retry and creates a new identity after deletion", async () => {
    projectId = (await projects.create("987654", "IKDLQE concurrent")).id;
    const results = await Promise.all(Array.from({ length: 8 }, async () => (await apply()).json()));
    expect(new Set(results.map(result => result.data.node.id)).size).toBe(1);
    const firstId = results[0].data.node.id;
    const before = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
    expect(JSON.parse(before.data.nodes)).toHaveLength(1);
    const deleted = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": `"${before.data.version}"` },
      body: JSON.stringify({ nodes: "[]", viewport: before.data.viewport }),
    });
    expect(deleted.status).toBe(200);
    const recreated = await (await apply()).json();
    expect(recreated.data.node.id).not.toBe(firstId);
    expect(JSON.parse(recreated.data.canvas.nodes)).toHaveLength(1);
  });
  it("rejects an oversized edit without losing the saved text", async () => {
    const current = await (await apply()).json();
    const node = current.data.node;
    const original = node.data.text;
    node.data.text = "字".repeat(100_001);
    const response = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": `"${current.data.canvas.version}"` },
      body: JSON.stringify({ nodes: JSON.stringify([node]), viewport: "{}" }),
    });
    expect(response.status).toBe(400);
    const reloaded = await (await apply()).json();
    expect(reloaded.data.node.data.text).toBe(original);
  });
  it("preserves a full-length edited node across new previews and rejects forged duplicate sources", async () => {
    const current = await (await apply()).json();
    const node = current.data.node;
    node.data.text = "文".repeat(100_000);
    const save = (nodes: unknown[], version: number) => fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), viewport: "{}" }),
    });
    expect((await save([node], current.data.canvas.version)).status).toBe(200);
    const reused = await (await apply()).json();
    expect(reused.data.node.data.text).toBe("文".repeat(100_000));
    expect((await save([node, { ...node, id: "forged-copy" }], reused.data.canvas.version)).status).toBe(400);
    source.revisionId = "revision-two";
    const second = await (await apply()).json();
    const nodes = JSON.parse(second.data.canvas.nodes);
    expect(nodes).toHaveLength(2);
    expect(nodes.find((item: { id: string }) => item.id === node.id).data.text).toBe("文".repeat(100_000));
    expect(second.data.node.id).not.toBe(node.id);
  });
  it("does not apply untrusted source or write into another user's project", async () => {
    const before = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
    const missing = await fetch(`${base}/api/canvases/${projectId}/prompt-previews/apply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: { ...source, shotNo: 99 }, position: { x: 0, y: 0 } }),
    });
    expect(missing.status).toBe(404);
    const after = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
    expect(after).toEqual(before);
    const otherProject = await projects.create("987655", "IKDLQE ownership");
    const denied = await fetch(`${base}/api/canvases/${otherProject.id}/prompt-previews/apply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, position: { x: 0, y: 0 } }),
    });
    expect((await denied.json()).data).toBeNull();
  });
  it("uses explicit group order and time only, while keeping each preview independent", async () => {
    projectId = (await projects.create("987654", "IKETSV titles")).id;
    materialPayload = { target_media: "video", shots: [
      { shot_no: 1, title: "镜头一", prompt_text: "第一段", generation_suggestions: { duration_seconds: 3 } },
      { shot_no: 2, title: "镜头二", prompt_text: "第二段", time_range: { start: "00:03", end: "00:06" } },
    ] };
    try {
      source.shotNo = 2;
      const second = await (await apply()).json();
      expect(second.data.node.data).toMatchObject({ title: "VIDEO #2 00:03–00:06", text: "第二段", promptOriginalTitle: "镜头二" });
      source.shotNo = 1;
      const first = await (await apply()).json();
      expect(first.data.node.data.title).toBe("VIDEO #1");
      expect(first.data.node.id).not.toBe(second.data.node.id);
      expect(JSON.parse(first.data.canvas.nodes)).toHaveLength(2);
      const stale = await fetch(`${base}/api/canvases/${projectId}`, {
        method: "PUT", headers: { "content-type": "application/json", "if-match": `"${second.data.canvas.version}"` },
        body: JSON.stringify({ nodes: second.data.canvas.nodes }),
      });
      expect(stale.status).toBe(412);
      const current = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
      expect(current.data.nodes).toBe(first.data.canvas.nodes);
    } finally { source.shotNo = 1; materialPayload = undefined; }
  });

  it("rejects forged material bindings on ordinary text nodes", async () => {
    const pid = (await projects.create("987654", "IKETSV forged binding")).id;
    const response = await fetch(`${base}/api/canvases/${pid}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodes: JSON.stringify([{ id: "forged", type: "textNode", data: {
        title: "假方案", text: "A", promptMaterials: [{ assetId: "999", mediaType: "image" }],
        promptMentions: [{ start: 0, end: 1, assetId: "999", index: 1 }],
      } }]) }),
    });
    expect(response.status).toBe(400);
    const stored = await (await fetch(`${base}/api/canvases?projectId=${pid}`)).json();
    expect(stored.data.nodes).toBeNull();
  });
  it.each(["deleted", "foreign"])("applies nothing when reference #2 is %s, and safely retries after restoration", async kind => {
    projectId = (await projects.create("987654", `IKETSV ${kind}`)).id;
    const a = await prisma.client.assets.create({ data: { user_id: 987654n, type: "image", url: "https://example.com/a.png" } });
    const b = await prisma.client.assets.create({ data: { user_id: kind === "foreign" ? 987655n : 987654n, is_delete: kind === "deleted", type: "audio", url: "https://example.com/b.mp3" } });
    materialPayload = { target_media: "image", assets: [
      { asset_ref_id: "a", asset_id: String(a.id), media_type: "image" },
      { asset_ref_id: "b", asset_id: String(b.id), media_type: "audio" },
    ], shots: [{ shot_no: 1, title: "原题", prompt_text: "A+B", asset_bindings: [{ asset_ref_id: "a" }, { asset_ref_id: "b" }],
      prompt_mentions: [{ start: 0, end: 1, asset_ref_id: "a", index: 1 }, { start: 2, end: 3, asset_ref_id: "b", index: 2 }],
    }] };
    try {
      const failed = await apply();
      expect(failed.status).toBe(400);
      expect(JSON.stringify(await failed.json())).toContain("#2");
      const unchanged = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
      expect(unchanged.data.nodes).toBeNull();
      const snapshot = await (await fetch(`${base}/api/projects/${projectId}/snapshot`)).json();
      expect(JSON.stringify(snapshot)).not.toContain(String(a.url));
      await prisma.client.assets.update({ where: { id: b.id }, data: { user_id: 987654n, is_delete: false } });
      const attempts = await Promise.all(Array.from({ length: 6 }, async () => (await apply()).json()));
      expect(new Set(attempts.map(result => result.data.node.id)).size).toBe(1);
      const applied = attempts[0].data;
      expect(applied.node.data.title).toBe("IMAGE");
      expect(JSON.parse(applied.canvas.nodes)).toHaveLength(3);
      expect(applied.node.data.promptMaterials).toContainEqual({ assetId: String(b.id), mediaType: "audio", url: b.url });
      await prisma.client.assets.update({ where: { id: b.id }, data: { is_delete: true } });
      const repeatedMissing = await apply();
      expect(repeatedMissing.status).toBe(400);
      expect(JSON.stringify(await repeatedMissing.json())).toContain("#2");
      const preserved = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
      expect(preserved.data.nodes).toBe(applied.canvas.nodes);
      await prisma.client.assets.update({ where: { id: b.id }, data: { is_delete: false } });
      const nodes = JSON.parse(applied.canvas.nodes);
      const promptNode = nodes.find((node: { type: string }) => node.type === "textNode");
      promptNode.data.promptMentions[0].assetId = "999999999";
      const forged = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${applied.canvas.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(nodes) }) });
      expect(forged.status).toBe(400);
      const beforeDelete = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
      const deleted = await fetch(`${base}/api/canvases/${projectId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${beforeDelete.data.version}"` }, body: JSON.stringify({ nodes: JSON.stringify(JSON.parse(beforeDelete.data.nodes).filter((node: { type: string }) => node.type !== "textNode")) }) });
      expect(deleted.status).toBe(200);
      const restored = await (await apply()).json();
      expect(restored.data.node.id).not.toBe(applied.node.id);
      expect(restored.data.node.data).toEqual(applied.node.data);
      expect(JSON.parse(restored.data.canvas.nodes)).toHaveLength(3);
    } finally { materialPayload = undefined; }
  });
  it("recreates an applied historical revision after Agent advances and the node is deleted", async () => {
    projectId = (await projects.create("987654", "IKDLQE historical")).id;
    const applied = await (await apply()).json();
    activeRevision = "newer-agent-revision";
    try {
      const before = applied.data.canvas;
      const nodes = JSON.parse(before.nodes).filter((node: { id: string }) => node.id !== applied.data.node.id);
      const deleted = await fetch(`${base}/api/canvases/${projectId}`, {
        method: "PUT", headers: { "content-type": "application/json", "if-match": `"${before.version}"` },
        body: JSON.stringify({ nodes: JSON.stringify(nodes), viewport: before.viewport }),
      });
      expect(deleted.status).toBe(200);
      const response = await apply();
      expect(response.status).toBeLessThan(300);
      const recreated = await response.json();
      expect(recreated.data.node.id).not.toBe(applied.data.node.id);
      expect(recreated.data.node.data.text).toBe(prompt);
    } finally { activeRevision = undefined; }
  });
  it.runIf(process.env.IKDLQE_BROWSER)("browser applies, edits and reloads through real Canvas APIs", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      projectId = (await projects.create("987654", "IKDLQE browser")).id;
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
      const generationRequests: string[] = [];
      page.on('request', request => {
        if (request.method() === 'POST' && /\/(generation|jobs)\//.test(request.url())) generationRequests.push(request.url());
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      const url = `${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`;
      await page.goto(url);
      await page.getByRole("button", { name: "Agent", exact: true }).click();
      await page.getByRole("button", { name: "手动应用", exact: true }).waitFor();
      expect(await page.getByText("不应应用此画面描述", { exact: true }).count()).toBe(0);
      await page.getByRole("button", { name: "手动应用", exact: true }).click();
      const node = page.locator(".react-flow__node-textNode");
      await node.waitFor();
      const editor = node.locator('[data-placeholder="输入内容..."]');
      expect(await editor.innerText()).toBe(prompt);
      await editor.dblclick();
      const savedEdit = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await editor.fill("独立编辑\n<实际文本> & 完整保存");
      await page.locator(".react-flow__pane").click({ position: { x: 180, y: 700 } });
      expect((await savedEdit).status()).toBe(200);
      await page.getByText(/^已保存 /).waitFor();
      await page.reload();
      await editor.waitFor();
      expect(await editor.innerText()).toBe("独立编辑\n<实际文本> & 完整保存");
      expect(await node.count()).toBe(1);
      await node.getByText('雪夜', { exact: true }).dblclick();
      const title = node.getByRole('textbox', { name: '文本节点标题' });
      await title.fill('独立标题');
      const titleSaved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/api/canvases/'));
      await title.press('Enter');
      expect((await titleSaved).status()).toBe(200);
      await node.getByRole('button', { name: '展开全文' }).click();
      await node.getByRole('button', { name: '收起全文' }).click();
      const beforeDrag = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
      const firstPosition = JSON.parse(beforeDrag.data.nodes)[0].position;
      const box = (await editor.boundingBox())!;
      const dragSaved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/api/canvases/'));
      await page.mouse.move(box.x + 120, box.y + 90);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 140, { steps: 12 });
      await page.mouse.up();
      expect((await dragSaved).status()).toBe(200);
      const afterDrag = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
      expect(JSON.parse(afterDrag.data.nodes)[0].position).not.toEqual(firstPosition);
      await page.reload();
      await node.getByText('独立标题', { exact: true }).waitFor();
      expect(await editor.innerText()).toBe('独立编辑\n<实际文本> & 完整保存');
      await editor.dblclick();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('独立编辑\n<实际文本> & 完整保存');
      await editor.fill('字'.repeat(100_001));
      await node.getByRole('alert').waitFor();
      expect((await editor.innerText()).length).toBe(100_001);
      const stored = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
      expect(JSON.parse(stored.data.nodes)[0].data.text).toBe('独立编辑\n<实际文本> & 完整保存');
      await editor.fill('');
      await page.evaluate(() => navigator.clipboard.writeText('可保存的完整粘贴内容\n第二行'));
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
      expect(await editor.innerText()).toBe('可保存的完整粘贴内容\n第二行');
      const finalSave = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/api/canvases/'));
      await page.locator('.react-flow__pane').click({ position: { x: 180, y: 700 } });
      expect((await finalSave).status()).toBe(200);
      await page.reload();
      await editor.waitFor();
      expect(await editor.innerText()).toBe('可保存的完整粘贴内容\n第二行');
      await page.getByRole('button', { name: 'Agent', exact: true }).click();
      await page.getByRole('button', { name: '定位文本节点', exact: true }).click();
      expect(await node.count()).toBe(1);
      const firstId = JSON.parse((await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data.nodes)[0].id;
      await editor.click({ button: 'right' });
      const deleteSaved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/api/canvases/'));
      await page.getByRole('button', { name: '删除', exact: true }).click();
      expect((await deleteSaved).status()).toBe(200);
      await page.getByRole('button', { name: '手动应用', exact: true }).click();
      await editor.waitFor();
      expect(await editor.innerText()).toBe(prompt);
      const recreated = JSON.parse((await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data.nodes);
      expect(recreated).toHaveLength(1);
      expect(recreated[0].id).not.toBe(firstId);
      expect(generationRequests).toEqual([]);
      await page.screenshot({ path: '/tmp/ikdlqe-browser.png', fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 60_000);
});
