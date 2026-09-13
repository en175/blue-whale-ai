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
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { createWorkerRepo } from "@lib/shared/persistence/generation-worker-repo.js";
import { processImageJobById } from "@lib/shared/generation/worker/generation-worker.js";
import { type GenerateImageInput } from "@lib/shared/generation/worker/image-provider.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";

// IKFA1N「引用删除重编号与失效修复」公开接口集成（父项 IKFA1J B1–B5/C4/E3）：
// 真 NestFactory 挂载生产控制器 + 隔离 MySQL（IKFA1N_DATABASE_URL 门控）。
// API 段验证服务端复核边界（失效阻止、替换/恢复后的映射编译）；
// 浏览器段（IKFA1N_BROWSER=1）走 草稿面板 → 删除提及/移除参考 → 失效/重编号 →
// 刷新恢复 → 目标隔离 → 替换/加回修复 → 生成 → 记录式供应商，按身份核对而非标签文字。
describe.skipIf(!process.env.IKFA1N_DATABASE_URL)("Image prompt ref invalidation public API (IKFA1N)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikfa1n-image-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFA1N_DATABASE_URL;
    const sizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfa1n-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikfa1n-test",
        model_id: MODEL_ID,
        capability_type: "image",
        model_label: "IKFA1N Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: { reference_image: true, max_reference_images: 9 },
      },
      update: {
        supported_sizes: sizes,
        default_size: "1024x1024",
        features: { reference_image: true, max_reference_images: 9 },
      },
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
      req.headers.authorization = "Bearer sk-ikfa1n-recording-provider";
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

  async function createImageAsset(projectId: string, name: string) {
    const asset = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type: "image",
        url: `https://example.com/${name}.png`,
        width: 1024,
        height: 1024,
        size: BigInt(2048),
      },
    });
    return asset.id.toString();
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
  const jobCount = (projectId: string) =>
    prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } });

  function imageBody(inputAssetIds: string[], promptDoc?: unknown, prompt = "让图片1的人物微笑") {
    return {
      type: "image",
      expected_output_count: 1,
      parameters: { prompt, model_id: MODEL_ID, aspect_ratio: "1:1" },
      input_asset_ids: inputAssetIds,
      ...(promptDoc !== undefined ? { prompt_doc: promptDoc } : {}),
    };
  }

  it("失效标签阻止生成；把该提及替换为其他已引用项后按当前映射提交成功（B5 服务端复核）", async () => {
    const projectId = (await projects.create("987654", "IKFA1N replace")).id;
    const a = await createImageAsset(projectId, "role");
    const b = await createImageAsset(projectId, "cloth");
    const c = await createImageAsset(projectId, "bg");
    // B 已移除（input=[a,c]），正文仍带 B 的失效提及
    const invalidDoc = {
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: a, label: "图片1" },
        { kind: "text", text: "的人物穿" },
        { kind: "asset_ref", asset_id: b, label: "图片2", invalid_label: "图片2" },
        { kind: "text", text: "的衣服" },
      ],
    };
    const blocked = await createJob(projectId, imageBody([a, c], invalidDoc));
    expect(blocked.code).toBe(400);
    expect(blocked.msg).toBe("存在已失效的素材标签，请删除后再提交");

    // 用户把失效提及替换为 C：该位置换绑身份，其他提及不变
    const replacedDoc = {
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: a, label: "图片1" },
        { kind: "text", text: "的人物穿" },
        { kind: "asset_ref", asset_id: c, label: "图片2" },
        { kind: "text", text: "的衣服" },
      ],
    };
    const created = await createJob(projectId, imageBody([a, c], replacedDoc));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    // 编译按最终输入顺序：替换处指向真实第二份输入（C），不是历史编号
    expect(job!.input.prompt).toBe("让图片1的人物穿图片2的衣服");
    expect((job!.input.input_asset_ids as unknown[]).map(String)).toEqual([a, c]);
    expect(job!.input.prompt_doc).toEqual(replacedDoc);
    expect(await jobCount(projectId)).toBe(1);
  });

  it("身份重新加回后（失效标记清除）直接提交成功，编号按当次输入派生（B4 服务端视角）", async () => {
    const projectId = (await projects.create("987654", "IKFA1N restore")).id;
    const a = await createImageAsset(projectId, "role");
    const b = await createImageAsset(projectId, "cloth");
    const c = await createImageAsset(projectId, "bg");
    // B 重新加回到末位：input=[a,c,b]，正文提及恢复为有效并派生当次编号图片3
    const restoredDoc = {
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: a, label: "图片1" },
        { kind: "text", text: "的人物穿" },
        { kind: "asset_ref", asset_id: b, label: "图片3" },
        { kind: "text", text: "的衣服" },
      ],
    };
    const created = await createJob(projectId, imageBody([a, c, b], restoredDoc));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("让图片1的人物穿图片3的衣服");
    expect((job!.input.input_asset_ids as unknown[]).map(String)).toEqual([a, c, b]);
    expect(job!.input.prompt_doc).toEqual(restoredDoc);
  });

  // 浏览器段：草稿面板真实操作 删除提及/移除参考/刷新/切换目标/替换/加回/生成。
  it.runIf(process.env.IKFA1N_BROWSER)("browser: 删除→失效重编号→刷新恢复→目标隔离→替换与加回修复→生成（B1–B5/C4/E3）", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA1N browser")).id;
    const a = await createImageAsset(projectId, "role");
    const b = await createImageAsset(projectId, "cloth");
    const c = await createImageAsset(projectId, "bg");
    const d = await createImageAsset(projectId, "scene");
    const e = await createImageAsset(projectId, "cloth2");
    // draft-1（主目标）：A/B/C 三参考；draft-2：与 draft-1 共享 B + 自有 D；
    // ref-e 与 ref-b 同名「衣服图」不同身份（B3），初始不连任何草稿。
    const seeded = await (await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({
        nodes: JSON.stringify([
          { id: "draft-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "image", fileName: "草稿一", draft: true, genStatus: "draft", prompt: "" } },
          { id: "draft-2", type: "mediaNode", position: { x: 900, y: 460 }, data: { mediaType: "image", fileName: "草稿二", draft: true, genStatus: "draft", prompt: "" } },
          { id: "ref-a", type: "mediaNode", position: { x: 140, y: 60 }, data: { mediaType: "image", fileName: "角色图", assetId: a, width: 1024, height: 1024 } },
          { id: "ref-b", type: "mediaNode", position: { x: 140, y: 260 }, data: { mediaType: "image", fileName: "衣服图", assetId: b, width: 1024, height: 1024 } },
          { id: "ref-c", type: "mediaNode", position: { x: 140, y: 460 }, data: { mediaType: "image", fileName: "背景图", assetId: c, width: 1024, height: 1024 } },
          { id: "ref-d", type: "mediaNode", position: { x: 140, y: 660 }, data: { mediaType: "image", fileName: "场景图", assetId: d, width: 1024, height: 1024 } },
          { id: "ref-e", type: "mediaNode", position: { x: 380, y: 660 }, data: { mediaType: "image", fileName: "衣服图", assetId: e, width: 1024, height: 1024 } },
        ]),
        edges: JSON.stringify([
          { id: "e1", source: "ref-a", target: "draft-1" },
          { id: "e2", source: "ref-b", target: "draft-1" },
          { id: "e3", source: "ref-c", target: "draft-1" },
          { id: "e4", source: "ref-b", target: "draft-2" },
          { id: "e5", source: "ref-d", target: "draft-2" },
        ]),
        viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      }),
    })).status;
    expect(seeded).toBe(200);

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
      const node = (id: string) => page.locator(`.react-flow__node-mediaNode[data-id="${id}"]`);
      await node("draft-1").waitFor();
      // 切换编辑目标走真实用户路径：点画布空白收起当前面板（Q9），再点目标卡打开
      const openDraft = async (id: string) => {
        await page.mouse.click(400, 900);
        await node(id).locator('[data-testid="media-content"]').click();
      };

      const readDraftDoc = async (nodeId: string) => {
        const canvas = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
        const nodes = canvas!.nodes_json as Array<{ id: string; data: Record<string, unknown> }>;
        return nodes.find((n) => n.id === nodeId)!.data.promptDoc as {
          segments: Array<{ kind: string; asset_id?: string; label?: string; invalid_label?: string }>;
        };
      };

      // 打开 draft-1：参考区三张（图片1/2/3），正文四次提及 A/B/B/C
      await node("draft-1").locator('[data-testid="media-content"]').click();
      await page.locator('[data-testid="dock-media-ref"]').first().waitFor();
      expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(3);
      const editor = page.locator('[contenteditable="true"]');
      const chipsOf = (kind: "valid" | "invalid") => page.locator(`[data-testid="asset-ref-${kind}"]`);
      const mentionItem = page.locator('[data-testid="mention-ref-item"]');
      const typeMention = async (text: string, pick: number) => {
        await page.keyboard.type(text);
        await page.keyboard.type("@");
        await page.locator('[data-testid="mention-menu"]').waitFor();
        await mentionItem.nth(pick).click();
      };
      const removeChip = async (index: number) => {
        await chipsOf("valid").nth(index).locator('button[title="删除该提及（附件保留）"]').click();
      };
      await editor.click();
      await typeMention("让", 0);
      await typeMention("的人物穿", 1);
      await typeMention("的衣服，拿着", 1);
      await typeMention("的包，背景参考", 2);
      await chipsOf("valid").first().waitFor();
      expect(await chipsOf("valid").count()).toBe(4);

      // B2（前半）：删除一次提及只删该处，附件与其他提及保留
      await removeChip(2);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-ref-valid"]').length === 3);
      expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(3);

      // B1：移除中间参考 B → B 失效保留原身份原编号，C 重编号为图片2 仍绑定 C，发送被阻止
      await page.locator('[data-testid="dock-media-ref"]').nth(1).locator('button[title="移除"]').click();
      await chipsOf("invalid").waitFor();
      expect(await chipsOf("invalid").innerText()).toContain("已失效：原图片2");
      const validTexts = await chipsOf("valid").allInnerTexts();
      expect(validTexts.join("|")).toBe("图片1|图片2");
      expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(2);
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(true);
      expect(await page.locator("div[role=alert]").first().innerText()).toContain("已失效的素材标签");
      // 身份核对（不只看标签文字）：结构中 B 失效原图片2、C 派生图片2；连线删除已持久化
      await vi.waitFor(async () => {
        const doc = await readDraftDoc("draft-1");
        expect(doc.segments).toEqual([
          { kind: "text", text: "让" },
          { kind: "asset_ref", asset_id: a, label: "图片1" },
          { kind: "text", text: "的人物穿" },
          { kind: "asset_ref", asset_id: b, label: "图片2", invalid_label: "图片2" },
          { kind: "text", text: "的衣服，拿着的包，背景参考" },
          { kind: "asset_ref", asset_id: c, label: "图片2" },
        ]);
        const canvas = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
        expect(canvas!.edges_json).not.toEqual(expect.arrayContaining([expect.objectContaining({ source: "ref-b", target: "draft-1" })]));
      }, { timeout: 10_000 });

      // C4：刷新后有效与失效标签均保留身份，编号与有效性按当前引用集合重新派生
      await page.reload();
      await node("draft-1").waitFor();
      await node("draft-1").locator('[data-testid="media-content"]').click();
      await chipsOf("invalid").waitFor();
      expect(await chipsOf("invalid").innerText()).toContain("已失效：原图片2");
      expect((await chipsOf("valid").allInnerTexts()).join("|")).toBe("图片1|图片2");
      expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(2);
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(true);

      // E3：切到共享 B 的 draft-2，其引用与标签不受 draft-1 移除影响
      await openDraft("draft-2");
      await page.locator('[data-testid="dock-media-ref"]').first().waitFor();
      expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(2);
      await editor.click();
      await typeMention("看", 0);
      await typeMention("和", 1);
      await vi.waitFor(async () => expect((await chipsOf("valid").allInnerTexts()).join("|")).toBe("图片1|图片2"), { timeout: 5_000 });
      expect(await chipsOf("invalid").count()).toBe(0);

      // B3：draft-2 移除 B 后失效；加回同名不同身份（ref-e）不恢复
      await page.locator('[data-testid="dock-media-ref"]').nth(0).locator('button[title="移除"]').click();
      await chipsOf("invalid").waitFor();
      expect(await chipsOf("invalid").innerText()).toContain("已失效：原图片1");
      expect((await chipsOf("valid").allInnerTexts()).join("|")).toBe("图片1");
      const pickFromCanvas = async (refId: string) => {
        await page.locator('button[title="从资产中选择 / 从节点添加素材"]').click();
        await page.locator("button", { hasText: "从节点添加素材" }).click();
        await node(refId).click();
      };
      await pickFromCanvas("ref-e");
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(2), { timeout: 5_000 });
      expect(await chipsOf("invalid").count()).toBe(1);
      expect(await chipsOf("invalid").innerText()).toContain("已失效：原图片1");
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(true);

      // B4：加回同一身份（ref-b）→ 失效标签恢复并显示当次编号（顺序 D、E、B → 图片3）
      await pickFromCanvas("ref-b");
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(3), { timeout: 5_000 });
      await vi.waitFor(async () => expect(await chipsOf("invalid").count()).toBe(0), { timeout: 5_000 });
      expect((await chipsOf("valid").allInnerTexts()).join("|")).toBe("图片3|图片1");
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(false);
      await vi.waitFor(async () => {
        const doc = await readDraftDoc("draft-2");
        expect(doc.segments).toEqual([
          { kind: "text", text: "看" },
          { kind: "asset_ref", asset_id: b, label: "图片3" },
          { kind: "text", text: "和" },
          { kind: "asset_ref", asset_id: d, label: "图片1" },
        ]);
      }, { timeout: 10_000 });

      // B5：回到 draft-1，点击失效标签把该位置替换为其他已引用项（只改该处，不新增输入）
      await openDraft("draft-1");
      await chipsOf("invalid").waitFor();
      await chipsOf("invalid").click();
      const replaceItems = page.locator('[data-testid="replace-ref-item"]');
      await page.locator('[data-testid="replace-ref-menu"]').waitFor();
      expect(await replaceItems.count()).toBe(2);
      expect(await replaceItems.first().innerText()).toContain("图片1");
      expect(await replaceItems.nth(1).innerText()).toContain("图片2");
      await replaceItems.nth(1).click();
      await vi.waitFor(async () => expect(await chipsOf("invalid").count()).toBe(0), { timeout: 5_000 });
      expect(await page.locator('[data-testid="replace-ref-menu"]').count()).toBe(0);
      expect((await chipsOf("valid").allInnerTexts()).join("|")).toBe("图片1|图片2|图片2");
      // 参考输入未重复添加（仍两项），发送恢复可用
      expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(2);
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(false);

      // B2（后半）：删除最后一个正文标签，附件保留；随后生成使用当前正确映射
      await removeChip(2);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-ref-valid"]').length === 2);
      expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(2);
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const body = generationRequests[0];
      expect(body.target_node_id).toBe("draft-1");
      expect((body.parameters as Record<string, unknown>).prompt).toBe("让图片1的人物穿图片2的衣服，拿着的包，背景参考");
      expect(body.prompt_doc).toEqual({
        version: 1,
        segments: [
          { kind: "text", text: "让" },
          { kind: "asset_ref", asset_id: a, label: "图片1" },
          { kind: "text", text: "的人物穿" },
          { kind: "asset_ref", asset_id: c, label: "图片2" },
          { kind: "text", text: "的衣服，拿着的包，背景参考" },
        ],
      });
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const jobRow = await prisma.client.generation_jobs.findFirst({ where: { project_id: BigInt(projectId) } });
      const frozen = jobRow!.input as Record<string, unknown>;
      expect(frozen.prompt).toBe("让图片1的人物穿图片2的衣服，拿着的包，背景参考");
      expect((frozen.input_asset_ids as unknown[]).map(String)).toEqual([a, c]);

      // 记录式供应商消费：模型收到按身份映射的正文与真实输入顺序
      const providerRequests: GenerateImageInput[] = [];
      const worker = {
        repo: createWorkerRepo(prisma.client),
        workerId: "ikfa1n-browser-worker",
        credentialVault: { open: (value: string) => value },
        createAudioProvider: () => { throw new Error("本测试只允许图片任务"); },
        createImageProvider: (token: string) => {
          expect(token).toBe("sk-ikfa1n-recording-provider");
          return { generate: async (input: GenerateImageInput) => {
            providerRequests.push(structuredClone(input));
            return [{ url: "https://example.com/result.png", width: 1024, height: 1024 }];
          } };
        },
      };
      const jobId = jobRow!.id.toString();
      await vi.waitFor(async () => expect(await processImageJobById(jobId, worker)).toBe(jobId), { timeout: 3_000 });
      expect((await readJob(jobId))!.status).toBe("succeeded");
      expect(providerRequests).toHaveLength(1);
      expect(providerRequests[0].prompt).toBe("让图片1的人物穿图片2的衣服，拿着的包，背景参考");
      expect(providerRequests[0].sourceImages?.map((item) => item.url)).toEqual([
        "https://example.com/role.png", "https://example.com/bg.png",
      ]);
      await page.screenshot({ path: "/tmp/ikfa1n-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);
});
