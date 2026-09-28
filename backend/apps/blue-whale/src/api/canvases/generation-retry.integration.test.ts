import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";
import { GenerationModelsController } from "../generation/models.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";

// 计费基线起建任务必接 billing Hold（fail closed、无开关），控制器第 7 参也新增 IdentityService。
// 本套件被测对象不是计费：进程内假客户端放行 hold/quote。
vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/billing/billing-client.js")>();
  return {
    ...actual,
    sharedBillingClient: () => ({
      hold: async () => ({ reservedCredits: 1, catalogVersion: 1, duplicated: false }),
      quote: async () => ({ credits: BigInt(1), catalogVersion: 1 }),
      queryBalance: async () => ({ availableCredits: 0, frozenCredits: 0, expiring: [] }),
      listTransactions: async () => ({ items: [], nextPageToken: "" }),
    }),
  };
});

// IKDMQV「失败重试与修改后重新生成」公开接口集成（契约沿用 IKDMQQ/QR/QS/QT）：
// 直接重试沿用失败任务冻结快照（来源正文变化不隐式替换原输入、历史任务不被改写）；
// 修改参数或引用后的新生成按现行规则冻结新输入。真 NestFactory 挂载生产控制器 +
// 隔离 MySQL（IKDMQV_DATABASE_URL 门控）。浏览器段（IKDMQV_BROWSER=1）在同 describe 尾部。
describe.skipIf(!process.env.IKDMQV_DATABASE_URL)("Generation failure retry public API (IKDMQV)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const IMAGE_MODEL = "ikdmqv-image-model";
  const VIDEO_MODEL = "ikdmqv-video-model";
  const AUDIO_MODEL = "ikdmqv-audio-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDMQV_DATABASE_URL;
    const imageSizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqv-test", model_id: IMAGE_MODEL } },
      create: {
        provider_id: "ikdmqv-test",
        model_id: IMAGE_MODEL,
        capability_type: "image",
        model_label: "IKDMQV Image",
        supported_sizes: imageSizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: {},
        // channel 为必填封闭枚举，取默认渠道 seedream-image
        channel: "seedream-image",
      },
      update: { features: {} },
    });
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqv-test", model_id: VIDEO_MODEL } },
      create: {
        provider_id: "ikdmqv-test",
        model_id: VIDEO_MODEL,
        capability_type: "video",
        model_label: "IKDMQV Video",
        supported_sizes: [{ id: "720p", label: "720p", api_value: "720p" }],
        supported_aspect_ratios: ["16:9"],
        supported_formats: ["mp4"],
        default_size: "720p",
        default_aspect_ratio: "16:9",
        default_duration: 5,
        supported_durations: { min: 4, max: 12, step: 1 },
        features: { reference_image: true, image_reference_max: 10, first_frame: true, last_frame: true, first_last_frame: true },
        // channel 为必填封闭枚举；video 行的渠道就是媒介本身
        channel: "seedream-video",
      },
      update: { features: { reference_image: true, image_reference_max: 10, first_frame: true, last_frame: true, first_last_frame: true } },
    });
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqv-test", model_id: AUDIO_MODEL } },
      create: {
        provider_id: "ikdmqv-test",
        model_id: AUDIO_MODEL,
        capability_type: "audio",
        model_label: "IKDMQV Audio",
        supported_sizes: [],
        supported_aspect_ratios: [],
        supported_formats: ["mp3"],
        default_size: "mp3",
        default_aspect_ratio: "1:1",
        features: {},
        // channel 为必填封闭枚举；audio 行的渠道就是媒介本身
        channel: "seedream-audio",
      },
      update: { features: {} },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, IdentityService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController], providers: [
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      // 造素材校验门（IKFYHJ / ADR-0087）自 MaterialService 取仓库面、自 AssetService 解析本地素材绑定。
      { provide: MaterialService, useValue: new MaterialService(prisma) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: IdentityService, useValue: new IdentityService(prisma) },
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

  function imageDraftNode(id: string, prompt = "") {
    return {
      id,
      type: "mediaNode",
      position: { x: 420, y: 160 },
      data: {
        src: "",
        mediaType: "image",
        fileName: "图片草稿",
        genStatus: "draft",
        draft: true,
        prompt,
        draftModelId: IMAGE_MODEL,
        draftSize: "1024x1024",
        draftRatio: "1:1",
        targetRatio: "1:1",
      },
    };
  }
  function textNode(id: string, text: string, title = "文本") {
    return { id, type: "textNode", position: { x: 560, y: 80 }, data: { title, text } };
  }
  async function createAsset(projectId: string, type: "image" | "video" | "audio", url: string) {
    const row = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type,
        url,
        width: 1024,
        height: 1024,
        size: BigInt(2048),
      },
    });
    return row.id.toString();
  }
  async function saveCanvas(projectId: string, nodes: unknown[], edges: unknown[], version: number | "missing", viewport = "{}") {
    return fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": version === "missing" ? '"missing"' : `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport }),
    });
  }
  async function getCanvas(projectId: string) {
    const response = await fetch(`${base}/api/canvases?projectId=${projectId}`);
    return (await response.json()).data;
  }
  async function createJob(projectId: string, body: unknown) {
    const response = await fetch(`${base}/api/projects/${projectId}/generation-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  }
  async function retryJob(projectId: string, jobId: string) {
    const response = await fetch(`${base}/api/projects/${projectId}/generation-jobs/${jobId}/retry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `ikdmqv-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify({}),
    });
    return response.json();
  }
  async function readJob(jobId: string) {
    const row = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(jobId) } });
    return row ? { ...row, input: row.input as Record<string, unknown> } : null;
  }
  /** 直接落库把任务置为终态 failed（job + 输出槽），模拟供应商执行失败 */
  async function failJob(jobId: string) {
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(jobId) },
      data: { status: "failed" },
    });
    await prisma.client.generation_jobs.update({ where: { id: BigInt(jobId) }, data: { status: "failed" } });
  }

  it("直接重试沿用失败任务冻结快照：来源正文变化不替换原输入，历史任务不被改写；修改后新生成按现行规则冻结新输入", async () => {
    const projectId = (await projects.create("987654", "IKDMQV retry snapshot")).id;
    const assetId = await createAsset(projectId, "image", "https://example.com/ref.png");
    const nodesBodyA = [imageDraftNode("d1", "暮色"), textNode("t1", "赛博朋克", "雨夜")];
    const edges = [
      { id: "e-media", source: "m0", target: "d1" },
      { id: "e-text", source: "t1", target: "d1" },
    ];
    // m0 来源节点（就绪图片，连线输入用）
    const sourceNode = {
      id: "m0",
      type: "mediaNode",
      position: { x: 100, y: 90 },
      data: { src: "https://example.com/ref.png", mediaType: "image", fileName: "参考图", assetId },
    };
    expect(
      (await saveCanvas(projectId, [sourceNode, ...nodesBodyA], edges, "missing")).status,
    ).toBe(200);

    const created = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      input_asset_ids: [assetId],
      expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: IMAGE_MODEL, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(200);
    const originalJobId = created.data.generation_job_id as string;
    const original = await readJob(originalJobId);
    expect(original!.input.text_attachments).toEqual([{ node_id: "t1", title: "雨夜", text: "赛博朋克" }]);
    expect(original!.input.input_asset_ids).toEqual([assetId]);

    // 任务失败后修改来源正文与连线（断开参考图）
    await failJob(originalJobId);
    const canvas = await getCanvas(projectId);
    expect(
      (await saveCanvas(
        projectId,
        [sourceNode, imageDraftNode("d1", "暮色"), textNode("t1", "霓虹都市", "雨夜")],
        [{ id: "e-text", source: "t1", target: "d1" }],
        canvas.version,
      )).status,
    ).toBe(200);

    // 直接重试：新任务沿用失败任务冻结快照——正文与参考都是提交时冻结的旧值
    const retried = await retryJob(projectId, originalJobId);
    expect(retried.code).toBe(200);
    const retryJobId = retried.data.generation_job_id as string;
    expect(retryJobId).not.toBe(originalJobId);
    const retryRow = await readJob(retryJobId);
    expect(retryRow!.input.text_attachments, "重试沿用旧正文快照").toEqual([
      { node_id: "t1", title: "雨夜", text: "赛博朋克" },
    ]);
    expect(retryRow!.input.input_asset_ids, "重试沿用旧参考快照").toEqual([assetId]);
    expect(retryRow!.input.prompt).toBe(original!.input.prompt);

    // 历史失败任务输入保持不变（重试不改写原任务）
    const originalAfter = await readJob(originalJobId);
    expect(originalAfter!.input).toEqual(original!.input);

    // 修改后新生成：按现行规则（最新画布）冻结新输入——新正文、断线后无参考
    const regenerated = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: { prompt: "暮色新版", model_id: IMAGE_MODEL, aspect_ratio: "1:1" },
    });
    expect(regenerated.code).toBe(200);
    const regenRow = await readJob(regenerated.data.generation_job_id as string);
    expect(regenRow!.input.text_attachments, "新生成使用新正文").toEqual([
      { node_id: "t1", title: "雨夜", text: "霓虹都市" },
    ]);
    expect(regenRow!.input.input_asset_ids).toBeUndefined();

    // 两条历史任务输入仍不被改写
    expect((await readJob(originalJobId))!.input).toEqual(original!.input);
    expect((await readJob(retryJobId))!.input).toEqual(retryRow!.input);
  });

  it("时序隔离：重试任务创建后，原任务迟到翻成功不改变新任务的输入与状态", async () => {
    const projectId = (await projects.create("987654", "IKDMQV stale isolation")).id;
    expect(
      (await saveCanvas(projectId, [imageDraftNode("d1", "首战"), textNode("t1", "旧正文", "文本")], [
        { id: "e-text", source: "t1", target: "d1" },
      ], "missing")).status,
    ).toBe(200);

    const created = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: { prompt: "首战", model_id: IMAGE_MODEL, aspect_ratio: "1:1" },
    });
    const originalJobId = created.data.generation_job_id as string;
    await failJob(originalJobId);

    const retried = await retryJob(projectId, originalJobId);
    const retryJobId = retried.data.generation_job_id as string;
    const retryInput = (await readJob(retryJobId))!.input;

    // 原任务「迟到成功」（例如取消/失败判定与供应商终态竞态）：仅改原任务自身
    const lateAsset = await createAsset(projectId, "image", "https://example.com/late.png");
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(originalJobId) },
      data: { status: "succeeded", asset_id: BigInt(lateAsset) },
    });
    await prisma.client.generation_jobs.update({
      where: { id: BigInt(originalJobId) },
      data: { status: "succeeded", output_asset_ids: [lateAsset] },
    });

    // 新任务的输入与状态不被迟到的原任务变化覆盖
    const retryAfter = await readJob(retryJobId);
    expect(retryAfter!.input).toEqual(retryInput);
    expect(retryAfter!.status).not.toBe("succeeded");
    // 原任务与新任务状态各自独立可查
    expect((await readJob(originalJobId))!.status).toBe("succeeded");
  });

  it("视频失败重试沿用冻结快照（显式首尾帧角色输入）", async () => {
    const projectId = (await projects.create("987654", "IKDMQV video retry")).id;
    const firstAsset = await createAsset(projectId, "image", "https://example.com/first.png");
    const lastAsset = await createAsset(projectId, "image", "https://example.com/last.png");
    const frameNode = (id: string, assetId: string) => ({
      id,
      type: "mediaNode" as const,
      position: { x: 100, y: 90 },
      data: { src: `https://example.com/${id}.png`, mediaType: "image", fileName: id, assetId },
    });
    const videoDraft = {
      id: "v1",
      type: "mediaNode",
      position: { x: 420, y: 160 },
      data: { src: "", mediaType: "video", fileName: "视频草稿", genStatus: "draft", draft: true, prompt: "追逐", draftModelId: VIDEO_MODEL, draftSize: "720p", draftRatio: "16:9", draftDuration: 5 },
    };
    expect(
      (await saveCanvas(projectId, [frameNode("f0", firstAsset), frameNode("l0", lastAsset), videoDraft], [
        { id: "e-first", source: "f0", target: "v1", data: { refRole: "first" } },
        { id: "e-last", source: "l0", target: "v1", data: { refRole: "last" } },
      ], "missing")).status,
    ).toBe(200);

    const created = await createJob(projectId, {
      type: "video",
      target_node_id: "v1",
      first_frame_asset_id: firstAsset,
      last_frame_asset_id: lastAsset,
      expected_output_count: 1,
      parameters: { prompt: "追逐", model_id: VIDEO_MODEL, aspect_ratio: "16:9", resolution: "720p", duration: 5 },
    });
    expect(created.code).toBe(200);
    const originalJobId = created.data.generation_job_id as string;
    await failJob(originalJobId);

    const retried = await retryJob(projectId, originalJobId);
    expect(retried.code).toBe(200);
    const retryRow = await readJob(retried.data.generation_job_id as string);
    expect(retryRow!.input.first_frame_asset_id).toBe(firstAsset);
    expect(retryRow!.input.last_frame_asset_id).toBe(lastAsset);
    expect(retryRow!.input.model_id).toBe(VIDEO_MODEL);
  });

  it("音频失败重试沿用冻结快照（纯文字描述输入）", async () => {
    const projectId = (await projects.create("987654", "IKDMQV audio retry")).id;
    const audioDraft = {
      id: "a1",
      type: "mediaNode",
      position: { x: 420, y: 160 },
      data: { src: "", mediaType: "audio", fileName: "音频草稿", genStatus: "draft", draft: true, prompt: "轻快的海浪声", draftModelId: AUDIO_MODEL },
    };
    expect((await saveCanvas(projectId, [audioDraft], [], "missing")).status).toBe(200);

    const created = await createJob(projectId, {
      type: "audio",
      target_node_id: "a1",
      expected_output_count: 1,
      parameters: { prompt: "轻快的海浪声", model_id: AUDIO_MODEL },
    });
    expect(created.code).toBe(200);
    const originalJobId = created.data.generation_job_id as string;
    await failJob(originalJobId);

    const retried = await retryJob(projectId, originalJobId);
    expect(retried.code).toBe(200);
    const retryRow = await readJob(retried.data.generation_job_id as string);
    expect(retryRow!.input.prompt).toBe("轻快的海浪声");
    expect(retryRow!.input.model_id).toBe(AUDIO_MODEL);
    // IKFCXE 起音频与图片/视频同源推导文本附件，无附件时冻结为空数组（不再是缺字段）
    expect(retryRow!.input.text_attachments).toEqual([]);
  });

  // 浏览器段（工单「范围与测试约定」）：真实浏览器 + 真实 Canvas/生成业务 API + 隔离 MySQL。
  // 图片链：三类失败恢复的代表主链——失败可见 → 来源正文变化 → 直接重试沿用快照 → 成功原卡承接 →
  // 编辑后新生成冻结新输入（历史任务不改写）。音频链：enqueue 失败即真实失败（IKCR78 fail-fast），
  // 失败保留草稿与原因、刷新恢复。视频链：DB 置失败后失败可见、重试入口可用。
  it.runIf(process.env.IKDMQV_BROWSER)("browser: failure recovery, retry with frozen snapshot, edit-then-regenerate", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDMQV browser")).id;
    expect(
      (await saveCanvas(projectId, [textNode("t1", "赛博朋克", "雨夜")], [], "missing")).status,
    ).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const generationRequests: Array<Record<string, unknown>> = [];
      const retryRequests: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
        if (request.method() === "POST" && /\/generation-jobs\/\d+\/retry$/.test(request.url())) {
          retryRequests.push(request.url());
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const mediaNodes = page.locator(".react-flow__node-mediaNode");
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

      // 等画布水合完成（t1 就位）再操作：doc 到达前建草稿会被水合 effect 清空（IKDMQQ 已知 race）
      await nodeById("t1").waitFor({ timeout: 15_000 });

      // ── 图片链 ─────────────────────────────────────────────
      // 1) 建图片草稿 + 文本附件连线 → 提交
      await page.locator('button[aria-label="图片对话"]').click();
      const draft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const draftId = (await draft.getAttribute("data-id"))!;
      await page.locator("textarea").waitFor();
      await page.getByText("IKDMQV Image").waitFor();
      await page.locator("textarea").fill("画一只蓝鲸");
      // 文本附件连线（画布拖线 t1 → 草稿）
      const srcHandle = page.locator('.react-flow__node[data-id="t1"] .react-flow__handle-right');
      const dstHandle = page.locator(`.react-flow__node[data-id="${draftId}"] .react-flow__handle-left`);
      const sb = (await srcHandle.boundingBox())!;
      const db = (await dstHandle.boundingBox())!;
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await page.mouse.down();
      await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.getByText("文本附件（1）").waitFor();
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0]!.target_node_id).toBe(draftId);

      const jobRows = async () =>
        prisma.client.generation_jobs.findMany({ where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" } });
      await vi.waitFor(async () => expect((await jobRows()).length).toBe(1));
      const firstJob = (await jobRows())[0]!;

      // 2) 失败：卡片与失败原因可见，参数与草稿身份保留
      await failJob(firstJob.id.toString());
      const failedCard = nodeById(draftId);
      await failedCard.getByText("生成失败").waitFor({ timeout: 15_000 });
      expect(await failedCard.getByRole("button", { name: "重试" }).count()).toBe(1);
      expect(await mediaNodes.count(), "失败不丢草稿卡").toBe(1);

      // 3) 来源正文变化（直接改已保存画布）后刷新恢复：失败态与参数原样回来（验收「已保存状态可恢复」），
      //    刷新同时同步前端乐观锁版本——外部改画布后前端旧 If-Match 会持续版本冲突
      const canvas = await getCanvas(projectId);
      const savedNodes = JSON.parse(canvas.nodes) as unknown[];
      const editedNodes = savedNodes.map((n) =>
        (n as { id: string; data?: Record<string, unknown> }).id === "t1"
          ? { ...(n as object), data: { ...(n as { data: Record<string, unknown> }).data, text: "霓虹都市" } }
          : n,
      );
      expect((await saveCanvas(projectId, editedNodes, JSON.parse(canvas.edges), canvas.version)).status).toBe(200);
      await page.reload();
      await nodeById("t1").waitFor({ timeout: 15_000 });
      await vi.waitFor(async () =>
        expect(await nodeById(draftId).innerText()).toContain("生成失败"),
      );

      // 4) 不改输入直接重试：走 retry 接口，新任务快照 = 旧正文
      await failedCard.getByRole("button", { name: "重试" }).click();
      await vi.waitFor(() => expect(retryRequests).toHaveLength(1), { timeout: 10_000 });
      await vi.waitFor(async () => expect((await jobRows()).length).toBe(2));
      const retryJobRow = (await jobRows())[1]!;
      expect(retryJobRow.id).not.toBe(firstJob.id);
      const retryDetail = await readJob(retryJobRow.id.toString());
      expect(retryDetail!.input.text_attachments, "重试沿用失败任务冻结快照").toEqual([
        { node_id: "t1", title: "雨夜", text: "赛博朋克" },
      ]);
      const firstDetail = await readJob(firstJob.id.toString());
      expect(firstDetail!.input.text_attachments, "历史失败任务输入不变").toEqual([
        { node_id: "t1", title: "雨夜", text: "赛博朋克" },
      ]);

      // 5) 重试成功：原失败卡承接结果（不重复建卡、身份不变）
      const outputAsset = await prisma.client.assets.create({
        data: {
          user_id: BigInt(987654),
          project_id: BigInt(projectId),
          type: "image",
          url: "https://example.com/ikdmqv-out.png",
          width: 1024,
          height: 1024,
          size: BigInt(2048),
        },
      });
      await prisma.client.generation_output_slots.updateMany({
        where: { generation_job_id: retryJobRow.id },
        data: { status: "succeeded", asset_id: outputAsset.id },
      });
      await prisma.client.generation_jobs.update({
        where: { id: retryJobRow.id },
        data: { status: "succeeded", output_asset_ids: [outputAsset.id.toString()] },
      });
      await failedCard.locator("img").waitFor({ timeout: 15_000 });
      expect(await mediaNodes.count(), "成功承接不新增结果卡").toBe(1);
      await vi.waitFor(async () => {
        const doc = await getCanvas(projectId);
        const nodes = JSON.parse(doc.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
        const done = nodes.find((n) => n.id === draftId);
        expect(done?.data.draft, "草稿身份结束").toBeUndefined();
        expect(done?.data.genStatus).toBeUndefined();
      });

      // 6) 编辑后新生成（成品卡路径）：面板改提示词发送 → 新任务冻结新输入，历史任务不改写
      await failedCard.locator('[data-testid="media-content"]').click();
      await page.locator("textarea").waitFor();
      await vi.waitFor(async () => expect(await page.locator("textarea").inputValue()).toBe("画一只蓝鲸"));
      await page.locator("textarea").fill("画一只蓝鲸，逆光");
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(2), { timeout: 10_000 });
      expect(generationRequests[1]!.target_node_id, "修改后新生成仍由原卡承接").toBe(draftId);
      expect((generationRequests[1]!.parameters as Record<string, unknown>).prompt).toBe("画一只蓝鲸，逆光");
      await vi.waitFor(async () => {
        const rows = await jobRows();
        const third = await readJob(rows[2]!.id.toString());
        expect(third!.input.prompt, "新生成按现行规则冻结新输入").toBe("画一只蓝鲸，逆光");
        expect(third!.input.text_attachments, "来源已改文：新生成读最新正文").toEqual([
          { node_id: "t1", title: "雨夜", text: "霓虹都市" },
        ]);
      }, { timeout: 10_000 });
      // 历史两条任务输入保持原样
      const rows = await jobRows();
      expect((await readJob(rows[0]!.id.toString()))!.input.prompt).toBe("画一只蓝鲸");
      expect((await readJob(rows[1]!.id.toString()))!.input.prompt).toBe("画一只蓝鲸");

      // ── 音频链（enqueue 失败即真实失败：IKCR78 fail-fast）──────────
      await page.locator('button[aria-label="音频生成"]').click();
      const audioDraft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const audioDraftId = (await audioDraft.getAttribute("data-id"))!;
      await page.locator('[data-testid="audio-input"]').waitFor();
      await page.getByText("IKDMQV Audio").waitFor();
      await page.locator('[data-testid="audio-input"]').fill("轻快的海浪声");
      await vi.waitFor(async () => {
        const doc = await getCanvas(projectId);
        const nodes = JSON.parse(doc.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
        expect(nodes.find((n) => n.id === audioDraftId)?.data.prompt, "描述落盘").toBe("轻快的海浪声");
      }, { timeout: 10_000 });
      await page.locator('[data-testid="audio-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(3), { timeout: 10_000 });
      // 无 RocketMQ 环境：音频任务入队失败被置 failed——真实失败路径，失败原因与重试入口可见
      const audioCard = nodeById(audioDraftId);
      await audioCard.getByText("任务入队失败").waitFor({ timeout: 15_000 });
      expect(await audioCard.getByRole("button", { name: "重试" }).count()).toBe(1);
      expect(await mediaNodes.count(), "音频失败保留草稿卡").toBe(2);
      // 等失败态随画布落盘（800ms 防抖），刷新恢复才有可恢复的已保存状态
      await vi.waitFor(async () => {
        const doc = await getCanvas(projectId);
        const nodes = JSON.parse(doc.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
        const audioSaved = nodes.find((n) => n.id === audioDraftId);
        expect(audioSaved?.data.genStatus, "音频失败态随画布落盘").toBe("failed");
        expect(audioSaved?.data.prompt, "描述随画布落盘").toBe("轻快的海浪声");
      }, { timeout: 10_000 });
      // 刷新恢复：失败态与描述恢复，可继续编辑重发
      await page.reload();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(2));
      await vi.waitFor(async () =>
        expect(await nodeById(audioDraftId).innerText()).toContain("任务入队失败"),
      );
      await audioCard.locator('[data-testid="media-content"]').click();
      await page.locator('[data-testid="audio-input"]').waitFor();
      await vi.waitFor(async () =>
        expect(await page.locator('[data-testid="audio-input"]').inputValue()).toBe("轻快的海浪声"),
      );

      // ── 视频链：失败可见 + 重试入口 ─────────────────────────
      await page.locator('button[aria-label="视频对话"]').click();
      const videoDraft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const videoDraftId = (await videoDraft.getAttribute("data-id"))!;
      const editor = page.locator('[data-testid="chip-editor"] [contenteditable="true"], [contenteditable="true"]').first();
      await editor.waitFor();
      await editor.click();
      await page.keyboard.type("追逐镜头");
      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(4), { timeout: 10_000 });
      // 等视频任务真实入库（create 在途时按序号取会拿到前一条音频任务）
      await vi.waitFor(async () => {
        const rows = await prisma.client.generation_jobs.findMany({
          where: { project_id: BigInt(projectId), type: "video" },
        });
        expect(rows.length).toBe(1);
      }, { timeout: 10_000 });
      const videoJob = (await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId), type: "video" }, orderBy: { id: "desc" },
      }))!;
      await failJob(videoJob.id.toString());
      const videoCard = nodeById(videoDraftId);
      await videoCard.getByText("生成失败").waitFor({ timeout: 15_000 });
      expect(await videoCard.getByRole("button", { name: "重试" }).count()).toBe(1);
      expect(await mediaNodes.count(), "视频失败保留草稿卡").toBe(3);

      await browser.close();
      await vite.close();
    } finally {
      await browser.close().catch(() => {});
      await vite.close().catch(() => {});
    }
  }, 180_000);
});
