import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
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
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
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
      listTransactions: async () => ({ items: [], total: 0 }),
    }),
  };
});

// IKDMQS「视频草稿与显式参考角色」公开接口集成（工单「范围与测试约定」节）：
// 真 NestFactory 挂载生产 Canvas/Generation/Jobs 控制器与服务 + 隔离 MySQL（IKDMQS_DATABASE_URL 门控）。
// 本切片服务端零改动：参考角色随连线 edge.data.refRole 原样存取；首尾帧/普通参考字段、
// 互斥校验（帧↔参考、尾帧配首帧）与文本附件冻结复用既有链路（IKDLQG）。浏览器段（IKDMQS_BROWSER=1）在尾部。
describe.skipIf(!process.env.IKDMQS_DATABASE_URL)("Video draft & explicit ref roles public API (IKDMQS)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikdmqs-video-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDMQS_DATABASE_URL;
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqs-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikdmqs-test",
        model_id: MODEL_ID,
        capability_type: "video",
        model_label: "IKDMQS Video",
        supported_sizes: [{ id: "720p", label: "720p", api_value: "720p" }],
        supported_aspect_ratios: ["16:9"],
        supported_formats: ["mp4"],
        default_size: "720p",
        default_aspect_ratio: "16:9",
        default_duration: 5,
        supported_durations: { min: 4, max: 12, step: 1 },
        features: {
          reference_image: true,
          image_reference_max: 10,
          first_frame: true,
          last_frame: true,
          first_last_frame: true,
        },
        // channel 为必填封闭枚举；video 行的渠道就是媒介本身（无解析器/协议之分）
        channel: "seedream-video",
      },
      update: { features: { reference_image: true, image_reference_max: 10, first_frame: true, last_frame: true, first_last_frame: true } },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, IdentityService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController], providers: [
      // IKIPWT：业务失败经 DomainError → AllExceptionsFilter 统一投影（与 app.module 的 APP_FILTER 同款），
      // 台架不挂过滤器时 DomainError 落 Nest 默认 500 处理，信封 code/msg 均不可见。
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
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

  function videoDraftNode(id: string, prompt = "", draftMode?: string, x = 420, y = 160) {
    return {
      id,
      type: "mediaNode",
      position: { x, y },
      data: {
        src: "",
        mediaType: "video",
        fileName: "视频草稿",
        genStatus: "draft",
        draft: true,
        prompt,
        draftModelId: MODEL_ID,
        draftSize: "720p",
        draftRatio: "16:9",
        draftDuration: 5,
        ...(draftMode ? { draftMode } : {}),
      },
    };
  }
  function readyImageNode(id: string, assetId: string, fileName: string, x = 120, y = 90) {
    return {
      id,
      type: "mediaNode",
      position: { x, y },
      data: { src: `https://example.com/${id}.png`, mediaType: "image", fileName, assetId },
    };
  }
  function textNode(id: string, text: string, title = "文本", x = 560, y = 80) {
    return { id, type: "textNode", position: { x, y }, data: { title, text } };
  }
  async function createAsset(projectId: string, type: "image" | "video", url: string) {
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
  async function readJob(jobId: string) {
    const row = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(jobId) } });
    return row ? { ...row, input: row.input as Record<string, unknown> } : null;
  }
  const videoParameters = { prompt: "海面日出", model_id: MODEL_ID, aspect_ratio: "16:9", resolution: "720p", duration: 5 };

  it("视频草稿与显式角色连线随画布保存并原样恢复（refRole 持久化；与文本附件并存）", async () => {
    const projectId = (await projects.create("987654", "IKDMQS role roundtrip")).id;
    const first = await createAsset(projectId, "image", "https://example.com/f1.png");
    const last = await createAsset(projectId, "image", "https://example.com/f2.png");
    const nodes = [
      readyImageNode("f1", first, "首帧图"),
      readyImageNode("f2", last, "尾帧图"),
      textNode("t1", "开场文案", "旁白"),
      videoDraftNode("d1"),
    ];
    const edges = [
      { id: "e-first", source: "f1", target: "d1", data: { refRole: "first" } },
      { id: "e-last", source: "f2", target: "d1", data: { refRole: "last" } },
      { id: "e-text", source: "t1", target: "d1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const canvas = await getCanvas(projectId);
    expect(JSON.parse(canvas.nodes)).toEqual(nodes);
    expect(JSON.parse(canvas.edges)).toEqual(edges);
    const reloaded = await getCanvas(projectId);
    expect(JSON.parse(reloaded.edges)).toEqual(edges);
  });

  it("显式首尾帧提交冻结输入：first/last_frame_asset_id 与文本附件并存；接纳后断线改文不改写", async () => {
    const projectId = (await projects.create("987654", "IKDMQS frozen frames")).id;
    const first = await createAsset(projectId, "image", "https://example.com/f1.png");
    const last = await createAsset(projectId, "image", "https://example.com/f2.png");
    const nodes = [
      readyImageNode("f1", first, "首帧图"),
      readyImageNode("f2", last, "尾帧图"),
      textNode("t1", "开场文案", "旁白"),
      videoDraftNode("d1"),
    ];
    const edges = [
      { id: "e-first", source: "f1", target: "d1", data: { refRole: "first" } },
      { id: "e-last", source: "f2", target: "d1", data: { refRole: "last" } },
      { id: "e-text", source: "t1", target: "d1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, {
      type: "video",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: videoParameters,
      first_frame_asset_id: first,
      last_frame_asset_id: last,
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job).not.toBeNull();
    expect(job!.input.target_node_id).toBe("d1");
    expect(job!.input.first_frame_asset_id).toBe(first);
    expect(job!.input.last_frame_asset_id).toBe(last);
    expect(job!.input.text_attachments).toEqual([{ node_id: "t1", title: "旁白", text: "开场文案" }]);

    // 接纳后断线 + 改文：当次任务输入不回读、不改写（快照语义）
    const canvas = await getCanvas(projectId);
    expect(
      (await saveCanvas(
        projectId,
        [readyImageNode("f1", first, "首帧图"), readyImageNode("f2", last, "尾帧图"), textNode("t1", "改写后的文案", "旁白"), videoDraftNode("d1")],
        [{ id: "e-text", source: "t1", target: "d1" }],
        canvas.version,
      )).status,
    ).toBe(200);
    const frozen = await readJob(created.data.generation_job_id);
    expect(frozen!.input.first_frame_asset_id).toBe(first);
    expect(frozen!.input.last_frame_asset_id).toBe(last);
    expect(frozen!.input.text_attachments).toEqual([{ node_id: "t1", title: "旁白", text: "开场文案" }]);
  });

  it("普通参考连线提交 reference_asset_ids 冻结；后续断线后新任务不再携带参考", async () => {
    const projectId = (await projects.create("987654", "IKDMQS reference frozen")).id;
    const ref1 = await createAsset(projectId, "image", "https://example.com/r1.png");
    const nodes = [readyImageNode("m1", ref1, "参考图"), videoDraftNode("d1")];
    const edges = [{ id: "e-ref", source: "m1", target: "d1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, {
      type: "video",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: videoParameters,
      reference_asset_ids: [ref1],
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.reference_asset_ids).toEqual([ref1]);

    const canvas = await getCanvas(projectId);
    expect((await saveCanvas(projectId, nodes, [], canvas.version)).status).toBe(200);
    const second = await createJob(projectId, {
      type: "video",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: videoParameters,
    });
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(secondJob!.input.reference_asset_ids).toBeUndefined();
  });

  it("组合约束回归（服务端既有 400 链路）：首尾帧与普通参考混用、尾帧无首帧均被拒绝", async () => {
    const projectId = (await projects.create("987654", "IKDMQS combo reject")).id;
    const a1 = await createAsset(projectId, "image", "https://example.com/a1.png");
    const a2 = await createAsset(projectId, "image", "https://example.com/a2.png");
    expect((await saveCanvas(projectId, [videoDraftNode("d1")], [], "missing")).status).toBe(200);

    const mixed = await createJob(projectId, {
      type: "video",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: videoParameters,
      first_frame_asset_id: a1,
      reference_asset_ids: [a2],
    });
    expect(mixed.code).toBe(1034);
    expect(mixed.msg).toContain("首尾帧模式不能与普通参考素材混用");

    const loneLast = await createJob(projectId, {
      type: "video",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: videoParameters,
      last_frame_asset_id: a2,
    });
    expect(loneLast.code).toBe(1034);
    expect(loneLast.msg).toContain("尾帧必须与首帧一起使用");
    expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(0);
  });

  // 浏览器段（工单「范围与测试约定」）：真实浏览器 + 真实业务 API + 隔离 MySQL；
  // 仅记录提交请求（无真实供应商执行，任务停在 pending 驱动「生成中只读」）。
  // 场景：侧栏建视频草稿 → Dock 首帧/尾帧显式选取 → 普通参考拖线 → 混用提示与发送阻止 →
  // 移除恢复 → 刷新恢复（连线与角色）→ 提交冻结输入=请求=Dock 显示 → 生成中只读 → 文本附件回归。
  it.runIf(process.env.IKDMQS_BROWSER)("browser: video draft, explicit roles, frozen input, read-only while generating", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDMQS browser")).id;
    const firstAsset = await createAsset(projectId, "image", "https://example.com/frame-first.png");
    const lastAsset = await createAsset(projectId, "image", "https://example.com/frame-last.png");
    const refAsset = await createAsset(projectId, "image", "https://example.com/ref-one.png");
    expect(
      (await saveCanvas(
        projectId,
        [
          // 四角布局：视口中心留给草稿出生点（避让算法不在视口外落位，拖线目标可见可达）
          readyImageNode("f1", firstAsset, "首帧图", 60, 40),
          textNode("t1", "故事文案正文", "故事文案", 950, 40),
          readyImageNode("f2", lastAsset, "尾帧图", 60, 520),
          readyImageNode("m1", refAsset, "普通参考图", 950, 520),
        ],
        [],
        "missing",
      )).status,
    ).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const generationRequests: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);

      const edges = page.locator(".react-flow__edge");
      const dockRefs = page.locator('[data-testid="dock-video-ref"]');
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      async function dragConnect(sourceId: string, targetId: string) {
        const src = page.locator(`.react-flow__node[data-id="${sourceId}"] .react-flow__handle-right`);
        const dst = page.locator(`.react-flow__node[data-id="${targetId}"] .react-flow__handle-left`);
        const sb = (await src.boundingBox())!;
        const db = (await dst.boundingBox())!;
        await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
        await page.mouse.down();
        await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 });
        await page.mouse.up();
      }

      await nodeById("f1").locator("img").waitFor();
      await nodeById("f2").locator("img").waitFor();
      await nodeById("m1").locator("img").waitFor();

      // 0) 侧栏建视频草稿：角色槽面板打开，无任务
      await page.locator('button[aria-label="视频对话"]').click();
      const draftLocator = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const draftId = (await draftLocator.getAttribute("data-id"))!;
      await page.getByText("首帧").first().waitFor();
      await page.getByText("尾帧").first().waitFor();
      await page.getByText("普通参考").first().waitFor();
      expect(generationRequests, "建卡不创建生成任务").toEqual([]);

      // 1) 显式角色：首帧槽选取 f1 → 连线 refRole=first，Dock 首帧徽标
      await page.locator('button[title="到节点选择首帧"]').click();
      await nodeById("f1").locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await edges.count()).toBe(1));
      await vi.waitFor(async () => {
        expect(await dockRefs.locator('[data-role="first"]').count()).toBe(1);
      });

      // 2) 尾帧槽选取 f2
      await page.locator('button[title="到节点选择尾帧"]').click();
      await nodeById("f2").locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await edges.count()).toBe(2));

      // 3) 混用输入：画布拖普通参考 m1 → 明确提示、发送禁用，不静默丢弃
      await dragConnect("m1", draftId);
      await vi.waitFor(async () => expect(await edges.count()).toBe(3));
      await page.getByText("首尾帧与普通参考不能混用").waitFor();
      expect(await page.locator('[data-testid="video-send"]').isDisabled()).toBe(true);
      expect(generationRequests, "冲突输入不提交").toEqual([]);

      // 4) 移除普通参考（Dock 移除=断线）：冲突解除，来源卡保留
      const refThumb = dockRefs.filter({ has: page.locator('[data-role="reference"]') });
      await refThumb.locator('button[title="移除（断开连线）"]').click();
      await vi.waitFor(async () => expect(await edges.count()).toBe(2));
      await vi.waitFor(async () => expect(await page.getByText("首尾帧与普通参考不能混用").count()).toBe(0));
      await nodeById("m1").locator("img").waitFor();

      // 5) 文本附件回归：t1 → 草稿
      await dragConnect("t1", draftId);
      await vi.waitFor(async () => expect(await edges.count()).toBe(3), { timeout: 5000 });
      await page.getByText("文本附件（1）").waitFor();

      // 6) 刷新恢复：连线与角色恢复，Dock 徽标一致
      await vi.waitFor(async () => {
        const canvas = await getCanvas(projectId);
        const saved = JSON.parse(canvas.edges) as Array<{ source: string; data?: { refRole?: string } }>;
        expect(saved.filter((e) => e.data?.refRole === "first").length).toBe(1);
        expect(saved.filter((e) => e.data?.refRole === "last").length).toBe(1);
      }, { timeout: 10_000 });
      await page.reload();
      await nodeById(draftId).waitFor();
      await vi.waitFor(async () => expect(await edges.count(), "刷新恢复全部连线").toBe(3));
      await nodeById(draftId).locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await dockRefs.count(), "刷新后 Dock 显示首尾帧").toBe(2));
      await page.getByText("文本附件（1）").waitFor();

      // 7) 提交：请求与冻结输入 = Dock 显示（显式首尾帧 + 文本附件）
      // BottomDialog 输入区是 Lexical contentEditable（非 textarea）
      const editor = page.locator('[data-testid="chip-editor"] [contenteditable="true"], [contenteditable="true"]').first();
      await editor.click();
      await page.keyboard.type("首尾帧驱动生成");
      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const sent = generationRequests[0]!;
      expect(sent.target_node_id).toBe(draftId);
      expect(sent.first_frame_asset_id, "首帧=Dock 显示").toBe(firstAsset);
      expect(sent.last_frame_asset_id, "尾帧=Dock 显示").toBe(lastAsset);
      expect(sent.reference_asset_ids).toBeUndefined();
      await vi.waitFor(async () => {
        const row = await prisma.client.generation_jobs.findFirst({
          where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
        });
        expect(row).not.toBeNull();
        const job = await readJob(row!.id.toString());
        expect(job!.input.first_frame_asset_id).toBe(firstAsset);
        expect(job!.input.last_frame_asset_id).toBe(lastAsset);
        expect(job!.input.text_attachments).toEqual([{ node_id: "t1", title: "故事文案", text: "故事文案正文" }]);
      }, { timeout: 10_000 });

      // 8) 执行中只读：发送禁用、移除隐藏、画布断线被拦截（任务停在 pending）
      await page.getByText("生成中，参数与连线只读").waitFor();
      await vi.waitFor(async () => expect(await page.locator('[contenteditable="true"]').count()).toBe(0));
      expect(await page.locator('[data-testid="video-send"]').isDisabled()).toBe(true);
      expect(await dockRefs.locator('button[title="移除（断开连线）"]').count()).toBe(0);
      const cutDuringRun = page.locator('.react-flow__edge[data-id^="xy-edge__f1-"] g[class*="deleteBtn"]');
      await cutDuringRun.waitFor({ state: "visible" });
      await cutDuringRun.dispatchEvent("click");
      await page.getByText("生成中，输入连线只读").waitFor();
      await vi.waitFor(async () => expect(await edges.count(), "生成中断线被拦截").toBe(3));

      // 9) 首次结果回填原卡（供应商替身=直接翻 DB 状态）：同卡身份/位置/连线保留，不新增结果卡
      const jobRow = await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
      });
      const outputAsset = await prisma.client.assets.create({
        data: {
          user_id: BigInt(987654),
          project_id: BigInt(projectId),
          type: "video",
          url: "https://example.com/generated-out.mp4",
          width: 1280,
          height: 720,
          size: BigInt(4096),
        },
      });
      await prisma.client.generation_output_slots.updateMany({
        where: { generation_job_id: jobRow!.id },
        data: { status: "succeeded", asset_id: outputAsset.id },
      });
      await prisma.client.generation_jobs.update({
        where: { id: jobRow!.id },
        data: { status: "succeeded", output_asset_ids: [outputAsset.id.toString()] },
      });
      const doneCard = nodeById(draftId);
      await doneCard.locator("video").waitFor({ timeout: 15_000 });
      expect(await doneCard.innerText()).not.toContain("待生成");
      await vi.waitFor(async () =>
        expect(await page.locator(".react-flow__node-mediaNode").count(), "成功回填不新增结果卡").toBe(4),
      );
      // 草稿转成品卡后面板自动收起
      await vi.waitFor(async () => expect(await page.locator('[data-testid="chip-editor"]').count()).toBe(0));
      // 连线保留（首尾帧参考关系不被成功清线）
      expect(await edges.count()).toBe(3);

      await page.screenshot({ path: "/tmp/ikdmqs-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 180_000);

  // 浏览器段（IKFDFW 视频参考即时保存与角色恢复）：真实浏览器 + 真实业务 API + 隔离 MySQL。
  // 场景：Dock 普通参考（图/视频）选取立即建线并落盘（不等发送）→ 关闭重开 → A→B→A →
  // 保存失败保留/阻断/重试 → Dock 移除断线且其他目标引用保持 → 刷新恢复 → 提交角色路由与 DB 冻结。
  // 首尾帧「从零添加」槽位受模式门控限制（空素材不可达），以预置 keyframe 草稿验证角色恢复。
  it.runIf(process.env.IKDMQS_BROWSER)("browser: IKFDFW video ref pick immediate persist, restore, failure retry, role routing", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    // 提交段用 Seedance 2.0 系模型（视频参考仅该系支持；MODEL_ID 非 seedance 系会被提交防线拦截）。
    // seedance-2 是前端别名，白名单按解析后的正式 id 校验，能力行与草稿都用正式 id。
    const SEEDANCE_MODEL_ID = "doubao-seedance-2-0-260128";
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqs-test", model_id: SEEDANCE_MODEL_ID } },
      create: {
        provider_id: "ikdmqs-test",
        model_id: SEEDANCE_MODEL_ID,
        capability_type: "video",
        model_label: "Seedance 2.0",
        supported_sizes: [{ id: "720p", label: "720p", api_value: "720p" }],
        supported_aspect_ratios: ["16:9"],
        supported_formats: ["mp4"],
        default_size: "720p",
        default_aspect_ratio: "16:9",
        default_duration: 5,
        supported_durations: { min: 4, max: 12, step: 1 },
        features: {
          reference_image: true,
          image_reference_max: 10,
          first_frame: true,
          last_frame: true,
          first_last_frame: true,
        },
        // channel 为必填封闭枚举；video 行的渠道就是媒介本身（无解析器/协议之分）
        channel: "seedream-video",
      },
      update: {},
    });
    const projectId = (await projects.create("987654", "IKFDFW browser")).id;
    const imageAsset = await createAsset(projectId, "image", "https://example.com/ikfdfw-ref-one.png");
    const videoAsset = await createAsset(projectId, "video", "https://example.com/ikfdfw-ref-video.mp4");
    const audioAsset = await createAsset(projectId, "audio", "https://example.com/ikfdfw-ref-audio.mp3");
    const frameFirstAsset = await createAsset(projectId, "image", "https://example.com/ikfdfw-frame-first.png");
    const frameLastAsset = await createAsset(projectId, "image", "https://example.com/ikfdfw-frame-last.png");
    expect(
      (await saveCanvas(
        projectId,
        [
          // 布局：d2 草稿居中（跟随面板悬停其附近），素材卡沿左右两列分布避开面板遮挡
          readyImageNode("m1", imageAsset, "普通参考图", 60, 520),
          { id: "v1", type: "mediaNode", position: { x: 60, y: 760 }, data: { src: `https://example.com/v1.mp4`, mediaType: "video", fileName: "参考视频", assetId: videoAsset } },
          { id: "s1", type: "mediaNode", position: { x: 60, y: 1000 }, data: { src: `https://example.com/s1.mp3`, mediaType: "audio", fileName: "参考音频", assetId: audioAsset } },
          readyImageNode("f1", frameFirstAsset, "首帧图", 1150, 80),
          readyImageNode("f2", frameLastAsset, "尾帧图", 1150, 620),
          videoDraftNode("dk", "", "keyframe", 700, 900),
          { ...videoDraftNode("d2"), data: { ...videoDraftNode("d2").data, draftModelId: SEEDANCE_MODEL_ID } },
        ],
        [
          { id: "e-f1-dk", source: "f1", target: "dk", data: { refRole: "first" } },
          { id: "e-f2-dk", source: "f2", target: "dk", data: { refRole: "last" } },
        ],
        "missing",
        JSON.stringify({ x: 0, y: 0, zoom: 0.7 }),
      )).status,
    ).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      const generationRequests: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);

      const edges = page.locator(".react-flow__edge");
      const dockRefs = page.locator('[data-testid="dock-video-ref"]');
      const editor = page.locator('[contenteditable="true"]');
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      const savedPairs = async () => {
        const canvas = await getCanvas(projectId);
        return (JSON.parse(canvas.edges) as Array<{ source: string; target: string; data?: { refRole?: string } }>)
          .map((e) => `${e.source}->${e.target}${e.data?.refRole ? `:${e.data.refRole}` : ""}`);
      };
      /** Dock 普通参考槽「从节点添加素材」（IKFE8U 起统一入口）：来源菜单两步入场；
       *  跟随面板悬停草稿卡附近，素材卡与面板在 Playwright 命中检测上重叠，统一 DOM 派发直触发（真实链路不变） */
      async function pickFromCanvas(slotTitle: string, sourceId: string) {
        await page.locator(`button[title="${slotTitle}"]`).dispatchEvent("click");
        await page.getByText("从节点添加素材", { exact: true }).dispatchEvent("click");
        await nodeById(sourceId).locator('[data-testid="media-content"]').dispatchEvent("click");
      }

      await nodeById("m1").locator("img").waitFor();
      await nodeById("f1").locator("img").waitFor();

      // 1) 打开普通草稿 d2：图片参考选取 → 立即建线（IKFDFW：不等待发送）
      await nodeById("d2").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await pickFromCanvas("从资产中选择 / 从节点添加素材", "m1");
      await vi.waitFor(async () => expect(await edges.count(), "图片选取立即建线").toBe(3));
      await vi.waitFor(async () => expect(await dockRefs.count()).toBe(1));

      // 1b) 不等待发送：连线随既有自动保存落盘（真实业务 API + 隔离库回读证明）
      await vi.waitFor(async () => {
        expect(await savedPairs(), "参考连线未发送即落盘").toContain("m1->d2");
      }, { timeout: 10_000 });
      expect(generationRequests, "保存参考不创建生成任务").toEqual([]);

      // 2) 视频参考槽再选 v1：第二条连线，Dock 两项按边序
      await pickFromCanvas("从资产中选择 / 从节点添加素材", "v1");
      await vi.waitFor(async () => expect(await edges.count()).toBe(4));
      await vi.waitFor(async () => expect(await dockRefs.count()).toBe(2));

      // 2b) IKFE8U 统一入口音频接纳：同一「+」选音频节点 s1 → 第三条连线，Dock 三项
      await pickFromCanvas("从资产中选择 / 从节点添加素材", "s1");
      await vi.waitFor(async () => expect(await edges.count(), "音频选取立即建线").toBe(5));
      await vi.waitFor(async () => expect(await dockRefs.count()).toBe(3));
      await vi.waitFor(async () => {
        expect(await savedPairs(), "音频参考连线落盘").toContain("s1->d2");
      }, { timeout: 10_000 });

      // 3) A→B→A：点 keyframe 草稿 dk（首尾帧角色恢复，B 不串入）→ 点回 d2 完整恢复
      await nodeById("dk").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "B 显示首尾帧而非 A 的普通参考").toBe(2));
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-video-ref"][title="首帧图"]').count()).toBe(1));
      await nodeById("d2").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "切回 A 恢复全部普通参考").toBe(3));

      // 4) 关闭重开：参考恢复（视频面板点击空白不自动关闭，关闭走右上角 ×）
      await page.locator('button[title="关闭"]').dispatchEvent("click");
      await vi.waitFor(async () => expect(await editor.count(), "关闭后面板退出").toBe(0));
      await nodeById("d2").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "重开恢复全部参考").toBe(3));

      // 5) 保存失败：保留选择并显示未保存，阻止发送，重试成功后落盘
      let failSave = true;
      await page.route("**/api/canvases/*", async (route) => {
        if (failSave && route.request().method() === "PUT") return route.abort();
        return route.continue();
      });
      await editor.click();
      await page.keyboard.type("失败保留");
      await page.getByText("保存失败，请重试").first().waitFor();
      expect(await dockRefs.count(), "保存失败保留当前页面选择").toBe(3);
      expect(await page.locator('[data-testid="video-send"]').isDisabled(), "保存失败时阻止发送").toBe(true);
      // 允许关闭并重开原目标：编辑仍在
      await page.locator('button[title="关闭"]').dispatchEvent("click");
      await nodeById("d2").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "重开原目标保留选择").toBe(3));
      failSave = false;
      await page.getByRole("button", { name: "重试保存" }).click();
      await page.getByText("已保存").first().waitFor();

      // 6) Dock 移除图片参考：仅断开 m1 连线，其他目标（dk 首帧）引用保持
      const removeButtons = dockRefs.locator('button[title="移除"]');
      await removeButtons.first().click();
      await vi.waitFor(async () => expect(await edges.count()).toBe(4));
      await vi.waitFor(async () => expect(await dockRefs.count()).toBe(2));
      await vi.waitFor(async () => {
        expect((await savedPairs()).sort(), "断线落盘且其他目标引用保持").toEqual(["f1->dk:first", "f2->dk:last", "s1->d2", "v1->d2"]);
      }, { timeout: 10_000 });

      // 7) 刷新恢复：连线与角色恢复，Dock 显示一致（从未生成）
      await page.reload();
      await nodeById("d2").waitFor();
      await vi.waitFor(async () => expect(await edges.count(), "刷新恢复全部连线").toBe(4));
      await nodeById("d2").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "刷新后恢复视频与音频参考").toBe(2));
      await nodeById("dk").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "刷新后恢复首尾帧").toBe(2));

      // 8) 提交（普通参考）：references 按角色路由，DB 冻结输入 = Dock 显示
      await nodeById("d2").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count()).toBe(2));
      await editor.click();
      await page.keyboard.type("参考驱动生成");
      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const sent = generationRequests[0]!;
      expect(sent.target_node_id).toBe("d2");
      expect(sent.references).toEqual([
        { asset_id: videoAsset, type: "video", role: "reference" },
        { asset_id: audioAsset, type: "audio", role: "reference" },
      ]);
      await vi.waitFor(async () => {
        const row = await prisma.client.generation_jobs.findFirst({
          where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
        });
        expect(row).not.toBeNull();
        const job = await readJob(row!.id.toString());
        // DB 冻结输入 = 请求 references（IKFA1O 契约：references 数组原样冻结）
        const frozenRefs = job!.input.references as Array<{ asset_id: string; type: string; role: string }>;
        expect(frozenRefs.some((r) => r.asset_id === videoAsset && r.role === "reference")).toBe(true);
        expect(frozenRefs.some((r) => r.asset_id === audioAsset && r.type === "audio" && r.role === "reference"), "音频参考随任务冻结").toBe(true);
      }, { timeout: 10_000 });

      // 9) 首尾帧草稿提交（角色端到端）：references 按 first_frame/last_frame 路由，DB 冻结一致
      await nodeById("dk").locator('[data-testid="media-content"]').dispatchEvent("click");
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "首尾帧草稿恢复两项").toBe(2));
      await editor.click();
      await page.keyboard.type("首尾帧端到端");
      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(2), { timeout: 10_000 });
      const frameSent = generationRequests[1]!;
      expect(frameSent.target_node_id).toBe("dk");
      expect(frameSent.references).toEqual([
        { asset_id: frameFirstAsset, type: "image", role: "first_frame" },
        { asset_id: frameLastAsset, type: "image", role: "last_frame" },
      ]);
      await vi.waitFor(async () => {
        // MySQL JSON 列存储规范化（键值间加空格），不可用精确子串匹配；取最新任务内存判定目标
        const row = await prisma.client.generation_jobs.findFirst({
          where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
        });
        expect(row).not.toBeNull();
        const job = await readJob(row!.id.toString());
        expect(job!.input.target_node_id).toBe("dk");
        const roles = (job!.input.references as Array<{ role: string }>).map((r) => r.role).sort();
        expect(roles).toEqual(["first_frame", "last_frame"]);
      }, { timeout: 10_000 });

      await page.screenshot({ path: "/tmp/ikfdfw-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 240_000);
  it.runIf(process.env.IKDMQS_BROWSER)("browser: IKFEWF ordinary text pick persists and reloads", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFEWF text source")).id;
    expect((await saveCanvas(projectId, [
      textNode("t1", "普通文本上下文", "普通文本", 60, 40),
      videoDraftNode("d1", "", "all", 700, 80),
    ], [], "missing")).status).toBe(200);
    const vite = await createVite({ root: `${process.cwd()}/web`, server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } } } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(10_000);
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: { userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const target = page.locator('.react-flow__node[data-id="d1"] [data-testid="media-content"]');
      await target.click();
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.locator('button[title="从资产中选择 / 从节点添加素材"]').click();
        if (attempt === 0) await page.screenshot({ path: "/tmp/ikfewf-video-menu.png", fullPage: true });
        await page.getByText("从节点添加素材", { exact: true }).click();
        await page.locator('.react-flow__node[data-id="t1"]').dispatchEvent("click");
        await vi.waitFor(async () => {
          const row = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
          const edges = row!.edges_json as Array<{ source: string; target: string }>;
          expect(edges.map(e => [e.source, e.target])).toEqual([["t1", "d1"]]);
        }, { timeout: 10_000 });
      }
      await page.reload(); await target.click();
      await page.locator('[data-testid="dock-text-ref"]').waitFor();
      await page.screenshot({ path: "/tmp/ikfewf-video-text.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);

});
