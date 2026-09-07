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
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";

// IKDMQQ「图片草稿创建、保存与首次生成」公开接口集成（契约「验证」节服务端项）：
// 真 NestFactory 挂载生产 Canvas/Generation/Jobs 控制器与服务 + 隔离 MySQL（IKDMQQ_DATABASE_URL 门控）。
// 本切片服务端零改动：草稿身份（genStatus=draft、无 assetId）随 nodes JSON 原样存取；
// target_node_id 接纳校验不要求 assetId（IKDLQF 既有行为），快照冻结语义复用。
// 浏览器段（IKDMQQ_BROWSER=1）在同 describe 尾部：另挂 JobsController 支撑前端轮询原位回填。
describe.skipIf(!process.env.IKDMQQ_DATABASE_URL)("Image draft public API (IKDMQQ)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikdmqq-image-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDMQQ_DATABASE_URL;
    const sizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqq-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikdmqq-test",
        model_id: MODEL_ID,
        capability_type: "image",
        model_label: "IKDMQQ Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: {},
      },
      update: { supported_sizes: sizes, default_size: "1024x1024" },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, GenerationCostEstimatorService, CanvasService], GenerationJobsController);
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
      { provide: GenerationCostEstimatorService, useValue: new GenerationCostEstimatorService() },
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

  function draftNode(id: string, prompt = "") {
    return {
      id,
      type: "mediaNode",
      position: { x: 120, y: 90 },
      data: {
        src: "",
        mediaType: "image",
        fileName: "图片草稿",
        genStatus: "draft",
        draft: true,
        prompt,
        draftModelId: MODEL_ID,
        draftSize: "1024x1024",
        draftRatio: "1:1",
        targetRatio: "1:1",
      },
    };
  }
  function textNode(id: string, text: string, title = "文本") {
    return { id, type: "textNode", position: { x: 0, y: 0 }, data: { title, text } };
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
  async function getJobs(projectId: string) {
    const response = await fetch(`${base}/api/jobs?projectId=${projectId}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.code).toBe(200);
    return body.data.records;
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

  it("草稿节点（genStatus=draft、无 assetId）随 PUT 保存并原样恢复", async () => {
    const projectId = (await projects.create("987654", "IKDMQQ draft roundtrip")).id;
    const draft = draftNode("media-draft-1", "暮色蓝鲸");
    const edges = [{ id: "e1", source: "text-1", target: "media-draft-1" }];
    const saved = await saveCanvas(projectId, [textNode("text-1", "赛博朋克", "雨夜"), draft], edges, "missing");
    expect(saved.status).toBe(200);

    const canvas = await getCanvas(projectId);
    const nodes = JSON.parse(canvas.nodes) as Array<Record<string, unknown>>;
    expect(nodes).toHaveLength(2);
    // 草稿身份与全部参数原样恢复（前端据此渲染「待生成」而非「素材已被删除」）
    expect(nodes[1]).toEqual(draft);
    expect(JSON.parse(canvas.edges)).toEqual(edges);

    // 重读（等价刷新/重开项目）内容一致
    const reloaded = await getCanvas(projectId);
    expect(JSON.parse(reloaded.nodes)).toEqual(nodes);
  });

  it("对空草稿 target_node_id 创建任务：冻结快照；接纳后来源修改不改写当次输入", async () => {
    const projectId = (await projects.create("987654", "IKDMQQ draft snapshot")).id;
    const nodes = [draftNode("media-draft-1", ""), textNode("text-1", "赛博朋克", "雨夜")];
    const edges = [{ id: "e1", source: "text-1", target: "media-draft-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    // 空草稿（无 assetId）作为生成目标被接纳：任务身份约定 target_node_id = 草稿节点 id
    const created = await createJob(projectId, {
      type: "image",
      target_node_id: "media-draft-1",
      expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: MODEL_ID, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job).not.toBeNull();
    expect(job!.input.target_node_id).toBe("media-draft-1");
    expect(job!.input.prompt).toBe("暮色");
    expect(job!.input.text_attachments).toEqual([{ node_id: "text-1", title: "雨夜", text: "赛博朋克" }]);

    // 接纳后来源正文修改：当次任务输入不回读、不改写；下一次任务读取最新画布
    const canvas = await getCanvas(projectId);
    const edited = await saveCanvas(
      projectId,
      [draftNode("media-draft-1", ""), textNode("text-1", "霓虹都市", "雨夜")],
      edges,
      canvas.version,
    );
    expect(edited.status).toBe(200);
    const frozen = await readJob(created.data.generation_job_id);
    expect(frozen!.input.text_attachments).toEqual([{ node_id: "text-1", title: "雨夜", text: "赛博朋克" }]);

    const second = await createJob(projectId, {
      type: "image",
      target_node_id: "media-draft-1",
      expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: MODEL_ID, aspect_ratio: "1:1" },
    });
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(secondJob!.input.text_attachments).toEqual([{ node_id: "text-1", title: "雨夜", text: "霓虹都市" }]);
  });

  it.runIf(process.env.IKDUHM_BROWSER).each([
    { model: "ikdmqq-image-model", size: "1024x1024", ratio: "1:1", ref: false, error: "" },
    { model: "ikdmqq-image-model", size: "1024x1024", ratio: "1:1", ref: "valid", error: "" },
    { model: "ikdmqq-image-model", size: "1024x1024", ratio: "1:1", ref: "incompatible", error: "当前模型不支持图片参考，请调整模型或参考" },
    { model: "", size: "1024x1024", ratio: "1:1", ref: false, error: "原生成模型已不可用，请重新选择模型" },
    { model: "unavailable-model", size: "1024x1024", ratio: "1:1", ref: false, error: "原生成模型已不可用，请重新选择模型" },
    { model: "ikdmqq-image-model", size: "removed-size", ratio: "1:1", ref: false, error: "原分辨率已不可用，请重新选择分辨率" },
    { model: "ikdmqq-image-model", size: "1024x1024", ratio: "16:9", ref: false, error: "原比例与当前配置不兼容，请重新选择比例" },
    { model: "ikdmqq-image-model", size: "1024x1024", ratio: "1:1", ref: true, error: "参考素材不可用，请调整参考后发送" },
  ])("IKDUHM browser: $error; preserve edits and retry saving", async ({ model, size, ratio, ref, error }) => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDUHM model restore")).id;
    const otherProjectId = (await projects.create("987654", "IKDUHM other project")).id;
    await prisma.client.generation_model_capability.update({
      where: { provider_id_model_id: { provider_id: "ikdmqq-test", model_id: MODEL_ID } },
      data: { features: { reference_image: ref !== "incompatible", max_reference_images: 9 } },
    });
    const asset = await prisma.client.assets.create({ data: {
      user_id: BigInt(987654), project_id: BigInt(projectId), type: "image", url: "https://example.com/saved.png",
    } });
    const node = draftNode("saved-image", "A");
    const savedNode = { ...node, data: { ...node.data, draft: false, genStatus: undefined,
      jobId: "123", assetId: asset.id.toString(), src: asset.url, draftModelId: model, draftSize: size, draftRatio: ratio } };
    const source = { ...savedNode, id: "failed-source", position: { x: 600, y: 90 },
      data: { ...savedNode.data, jobId: undefined, genStatus: ref === true ? "failed" : undefined } };
    const initialEdges = ref ? [{ id: "image-ref", source: source.id, target: savedNode.id }] : [];
    const other = { ...savedNode, id: "other-image", position: { x: 650, y: 90 }, data: { ...savedNode.data, prompt: "另一节点" } };
    const upload = { ...other, id: "uploaded-image", position: { x: 950, y: 90 }, data: { ...other.data, jobId: undefined } };
    const initialNodes = ref ? [savedNode, other, upload, { ...source, position: { x: 600, y: 450 } }] : [savedNode, other, upload];
    expect((await saveCanvas(projectId, initialNodes, initialEdges, "missing")).status).toBe(200);
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base }, "/agent": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const requests: string[] = [];
      page.on("request", request => {
        if (request.method() === "POST" && request.url().endsWith("/generation-jobs")) requests.push(request.url());
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      await page.locator('[data-id="uploaded-image"] [data-testid="media-content"]').click();
      expect(await page.locator("textarea").count()).toBe(0);
      await page.locator('[data-id="saved-image"] [data-testid="media-content"]').click();
      if (error) await page.getByText(error).waitFor({ timeout: 10_000 });
      else await page.getByText("IKDMQQ Test", { exact: true }).waitFor();
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(Boolean(error));
      if (ref === "valid") expect(await page.getByTestId("dock-media-ref").count()).toBe(1);
      await page.locator("textarea").fill("B");
      await page.locator("textarea").press("Enter");
      await vi.waitFor(async () => {
        const stored = JSON.parse((await getCanvas(projectId)).nodes);
        expect(stored[0].data.prompt).toBe("B\n");
        expect(stored[0].data.draftModelId).toBe(model);
        expect(stored[0].data.draftSize).toBe(size);
        expect(stored[0].data.draftRatio).toBe(ratio);
      }, { timeout: 10_000 });
      await page.reload();
      await page.locator('[data-id="saved-image"] [data-testid="media-content"]').click();
      if (error) await page.getByText(error).waitFor({ timeout: 10_000 });
      else await page.getByText("IKDMQQ Test", { exact: true }).waitFor();
      expect(await page.locator("textarea").inputValue()).toBe("B\n");
      await page.locator('[data-id="other-image"] [data-testid="media-content"]').click({ modifiers: ["Meta"] });
      await vi.waitFor(async () => expect(await page.locator('.react-flow__node.selected').count()).toBe(2));
      await vi.waitFor(async () => expect(await page.locator("textarea").count(), "多选隐藏编辑面板").toBe(0));
      await page.locator('.react-flow__pane').click({ position: { x: 1100, y: 450 } });
      await page.locator('[data-id="saved-image"] [data-testid="media-content"]').click();
      expect(await page.locator("textarea").inputValue()).toBe("B\n");
      // 恢复网络前仅保存重试，不以发送动作作为重试入口。
      await page.route("**/api/canvases/*", route => route.request().method() === "PUT"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, msg: "保存故障" }) })
        : route.continue());
      await page.locator("textarea").fill("尚未保存的 C");
      await page.getByRole("button", { name: "重试保存" }).waitFor({ timeout: 10_000 });
      expect(await page.locator('button[title="发送"]').isDisabled(), "保存失败暂停发送").toBe(true);
      await page.locator('button[aria-label="图片对话"]').click();
      expect(await page.locator('.react-flow__node-mediaNode').count(), "保存失败禁止侧栏切换到新草稿").toBe(initialNodes.length);
      await page.locator("button", { hasText: "IKDUHM model restore" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDUHM other project" }).first().click();
      expect(page.url(), "保存失败不得离开项目").toContain(`project=${projectId}`);
      await page.getByRole("button", { name: "返回首页" }).click();
      expect(page.url(), "保存失败不得经首页离开当前项目").toContain(`project=${projectId}`);
      await page.locator('[data-id="other-image"] [data-testid="media-content"]').click();
      await page.getByText("重新编辑", { exact: true }).click();
      expect(await page.locator("textarea").evaluateAll(inputs => inputs.map(input => input.value))).not.toContain("另一节点");
      await page.locator('[data-id="saved-image"] [data-testid="media-content"]').click();
      expect(await page.locator("textarea").inputValue()).toBe("尚未保存的 C");
      await page.locator('.react-flow__pane').click({ position: { x: 1100, y: 200 } });
      await vi.waitFor(async () => expect(await page.locator("textarea").count()).toBe(0));
      await page.locator('[data-id="saved-image"] [data-testid="media-content"]').click();
      expect(await page.locator("textarea").inputValue()).toBe("尚未保存的 C");
      await page.unroute("**/api/canvases/*");
      let finishRetry!: () => void;
      const retryHeld = new Promise<void>(resolve => { finishRetry = resolve; });
      let retryReceived!: () => void;
      const retryReceiving = new Promise<void>(resolve => { retryReceived = resolve; });
      const retryResponses: number[] = [];
      await page.route("**/api/canvases/*", async route => {
        if (route.request().method() !== "PUT") return route.continue();
        const response = await route.fetch();
        retryResponses.push(response.status());
        retryReceived();
        await retryHeld;
        await route.fulfill({ response });
      });
      try {
        await page.getByRole("button", { name: "重试保存" }).click();
        await retryReceiving;
        expect(await page.locator('button[title="发送"]').isDisabled(), "重试响应未成功前继续暂停发送").toBe(true);
        await page.locator('[data-id="other-image"] [data-testid="media-content"]').click();
        const visibleInputs = await page.locator("textarea").evaluateAll(inputs => inputs.map(input => input.value));
        expect(visibleInputs).not.toContain("另一节点");
      } finally { finishRetry(); }
      await vi.waitFor(async () => expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data.prompt).toBe("尚未保存的 C"));
      await vi.waitFor(async () => expect(await page.getByRole("button", { name: "重试保存" }).count(), `retry statuses: ${retryResponses}`).toBe(0), { timeout: 5_000 });
      await page.getByText(/^已保存 /).waitFor();
      await page.unroute("**/api/canvases/*");
      await page.locator('[data-id="other-image"] [data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator("textarea").inputValue()).toBe("另一节点"));
      await page.locator('[data-id="saved-image"] [data-testid="media-content"]').click();
      expect(await page.locator("textarea").inputValue()).toBe("尚未保存的 C");
      if (!error) {
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let received!: () => void;
        const receiving = new Promise<void>(resolve => { received = resolve; });
        await page.route("**/api/canvases/*", async route => {
          if (route.request().method() !== "PUT") return route.continue();
          const response = await route.fetch();
          received();
          await held;
          await route.fulfill({ response });
        });
        try {
          await page.locator("textarea").fill("在途旧编辑");
          await receiving;
          await page.locator("textarea").fill("在途期间的新编辑");
        } finally { release(); }
        await vi.waitFor(async () => expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data.prompt).toBe("在途期间的新编辑"), { timeout: 10_000 });
        await page.unroute("**/api/canvases/*");
      }
      const persisted = await getCanvas(projectId);
      expect(JSON.parse(persisted.nodes)).toHaveLength(initialNodes.length);
      expect(JSON.parse(persisted.edges)).toEqual(initialEdges);
      await page.screenshot({ path: `/tmp/ikduhm-${String(ref)}-${model || "missing"}-${size}-${ratio.replace(":", "-")}.png` });
      await page.locator("button", { hasText: "IKDUHM model restore" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDUHM other project" }).first().click();
      await page.waitForURL(`**project=${otherProjectId}**`);
      expect(requests).toEqual([]);
      expect(await getJobs(projectId)).toEqual([]);
    } finally { await browser.close(); await vite.close(); }
  }, 60_000);

  it("IKDUHM API: stale save cannot replace the latest node edit", async () => {
    const projectId = (await projects.create("987654", "IKDUHM conditional save")).id;
    expect((await saveCanvas(projectId, [draftNode("same-node", "A")], [], "missing")).status).toBe(200);
    const version = (await getCanvas(projectId)).version;
    expect((await saveCanvas(projectId, [draftNode("same-node", "B")], [], version)).status).toBe(200);
    expect((await saveCanvas(projectId, [draftNode("same-node", "late A")], [], version)).status).toBe(412);
    expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data.prompt).toBe("B");
    expect(await getJobs(projectId)).toEqual([]);
  });

  // 浏览器段（契约「验证」节）：真实浏览器 + 真实业务 API + 隔离 MySQL。
  // 场景：建卡未建任务 → 重复创建 → 参数编辑与刷新恢复 → 保存故障阻断生成与项目切换 →
  // 恢复后原位提交（生成中只读）→ DB 翻 succeeded → 同卡回填不新增结果卡 → 项目切换放行。
  it.runIf(process.env.IKDMQQ_BROWSER)("browser: draft create → restore → save-failure gate → in-place generation", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDMQQ browser A")).id;
    const otherProjectId = (await projects.create("987654", "IKDMQQ browser B")).id;

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      // 只捕获创建调用（不含 retry/cancel 子路径）：断言「建卡与编辑不自动执行」与请求体
      const generationRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push({ url: request.url(), body: request.postDataJSON() as Record<string, unknown> });
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const mediaNodes = page.locator(".react-flow__node-mediaNode");
      const sidebarImage = page.locator('button[aria-label="图片对话"]');
      await sidebarImage.waitFor();

      // 1) 侧栏点击：先出现草稿卡、自动选中并打开面板；位置避开 Dock；不创建任务
      await sidebarImage.click();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(1));
      const textarea = page.locator("textarea");
      await textarea.waitFor();
      expect(await mediaNodes.first().innerText()).toContain("待生成");
      expect(await mediaNodes.first().innerText()).not.toContain("素材已被删除");
      expect(await page.locator(".react-flow__node-mediaNode.selected").count(), "新卡自动选中").toBe(1);
      const nodeBox = (await mediaNodes.first().boundingBox())!;
      const dockBox = (await page.locator('xpath=//textarea/ancestor::div[contains(@class,"dialog")][1]').boundingBox())!;
      const overlaps = nodeBox.x < dockBox.x + dockBox.width && nodeBox.x + nodeBox.width > dockBox.x
        && nodeBox.y < dockBox.y + dockBox.height && nodeBox.y + nodeBox.height > dockBox.y;
      expect(overlaps, "新卡不与 Dock 区域重叠").toBe(false);
      expect(generationRequests, "建卡不创建生成任务").toEqual([]);

      // 2) 重复点击：每次新增独立草稿（面板绑定最新一张，后续编辑与提交都以它为准）
      await sidebarImage.click();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(2));
      expect(generationRequests).toEqual([]);
      const draftId = (await mediaNodes.nth(1).getAttribute("data-id"))!;
      expect(draftId).not.toBe(await mediaNodes.first().getAttribute("data-id"));

      // 3) 面板编辑：提示词与模型参数实时写回并落盘；模型目录就位
      await page.getByText("IKDMQQ Test").waitFor();
      await textarea.fill("画一只蓝鲸");
      await vi.waitFor(async () => {
        const canvas = await getCanvas(projectId);
        const nodes = JSON.parse(canvas.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
        const draft = nodes.find((n) => n.id === draftId);
        expect(draft?.data.prompt, "提示词随自动保存落盘").toBe("画一只蓝鲸");
        expect(draft?.data.draftModelId, "模型参数随自动保存落盘").toBe(MODEL_ID);
        expect(draft?.data.genStatus).toBe("draft");
        expect(draft?.data.draft).toBe(true);
      }, { timeout: 10_000 });
      expect(generationRequests, "编辑不创建生成任务").toEqual([]);

      // 4) 刷新恢复：草稿与参数原样回来，点击卡片重开面板
      await page.reload();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(2));
      expect(await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`).innerText()).toContain("待生成");
      expect(await page.locator(".react-flow__pane").innerText()).not.toContain("素材已被删除");
      await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"] [data-testid="media-content"]`).click();
      await page.locator("textarea").waitFor();
      expect(await page.locator("textarea").inputValue(), "刷新后草稿提示词恢复").toBe("画一只蓝鲸");
      await page.getByText("IKDMQQ Test").waitFor();

      // 5) 保存故障：阻断生成与项目切换，保留当前编辑与草稿
      await page.route("**/api/canvases/*", (route) => {
        if (route.request().method() === "PUT") return route.fulfill({ status: 500, body: "forced failure" });
        return route.continue();
      });
      await page.locator("textarea").fill("画一只蓝鲸，逆光");
      await page.getByText("保存失败，请重试").first().waitFor({ timeout: 10_000 });
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(async () => {
        expect(await page.getByText("保存失败，请重试").count(), "落盘失败提示").toBeGreaterThan(0);
      });
      expect(generationRequests, "保存失败暂停生成").toEqual([]);
      expect(await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`).count(), "草稿保留").toBe(1);
      // 项目切换被阻断：选择另一项目后仍停留在当前项目
      await page.locator("button", { hasText: "IKDMQQ browser A" }).first().click();
      // 下拉项（同名历史项目取首个 = 最新）
      await page.locator('div[class*="projectItem"]', { hasText: "IKDMQQ browser B" }).first().click();
      await page.waitForTimeout(800);
      expect(page.url(), "保存失败暂停项目切换").toContain(`project=${projectId}`);
      await page.unroute("**/api/canvases/*");

      // 6) 保存恢复后原位提交：先落盘再建任务；生成中面板只读
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].body.target_node_id).toBe(draftId);
      expect((generationRequests[0].body.parameters as Record<string, unknown>).prompt).toBe("画一只蓝鲸，逆光");
      await vi.waitFor(async () => {
        const row = await prisma.client.generation_jobs.findFirst({
          where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
        });
        expect(row).not.toBeNull();
        const job = await readJob(row!.id.toString());
        expect(job!.input.target_node_id).toBe(draftId);
        expect(job!.input.prompt, "任务输入按提交快照冻结").toBe("画一只蓝鲸，逆光");
      }, { timeout: 10_000 });
      expect(await page.locator("textarea").isDisabled(), "生成中参数只读").toBe(true);
      await page.getByText("生成中，参数与连线只读").waitFor();
      expect(await mediaNodes.count(), "原位生成不新增占位卡").toBe(2);

      // 7) 任务成功：结果填回同一张卡（身份不变、不新增结果卡），另一张草稿不受影响
      const jobRow = await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
      });
      const outputAsset = await prisma.client.assets.create({
        data: {
          user_id: BigInt(987654),
          project_id: BigInt(projectId),
          type: "image",
          url: "https://example.com/ikdmqq-out.png",
          width: 1024,
          height: 1024,
          size: BigInt(2048),
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
      const doneCard = page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`);
      await doneCard.locator("img").waitFor({ timeout: 15_000 });
      expect(await doneCard.innerText()).not.toContain("待生成");
      expect(await mediaNodes.count(), "成功回填不新增结果卡").toBe(2);
      expect(await mediaNodes.first().innerText(), "另一张草稿保持待生成").toContain("待生成");
      // 草稿转成品卡后面板自动收起
      await vi.waitFor(async () => expect(await page.locator("textarea").count()).toBe(0));

      // 8) 保存状态正常：项目切换放行
      await page.locator("button", { hasText: "IKDMQQ browser A" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDMQQ browser B" }).first().click();
      await page.waitForURL(`**project=${otherProjectId}**`, { timeout: 10_000 });

      await page.screenshot({ path: "/tmp/ikdmqq-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);
});
