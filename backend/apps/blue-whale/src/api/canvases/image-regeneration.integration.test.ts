import "reflect-metadata";
import { createWorkerRepo } from "@lib/shared/persistence/index.js";
import { openGenerationCredential } from "@blue-whale/core";
import { processImageJobById } from "@lib/shared/generation/worker/generation-worker.js";
import { ImageProviderError, type ImageProvider } from "@lib/shared/generation/worker/image-provider.js";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
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

describe.skipIf(!process.env.IKDUHN_DATABASE_URL)("Image regeneration public API (IKDUHN)", () => {
  const secret = "ikduhn-isolated-test-secret";
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikduhn-image-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  let mediaBase = "";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZFAAAAAASUVORK5CYII=", "base64");
  const media = createServer((_req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("content-type", "image/png");
    res.end(png);
  });
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    vi.stubEnv("GENERATION_CREDENTIAL_SECRET", secret);
    vi.stubEnv("ROCKETMQ_ENDPOINTS", "");
    process.env.DATABASE_URL = process.env.IKDUHN_DATABASE_URL;
    media.listen(0, "127.0.0.1");
    await once(media, "listening");
    mediaBase = `http://127.0.0.1:${(media.address() as AddressInfo).port}`;
    const sizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikduhn-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikduhn-test",
        model_id: MODEL_ID,
        capability_type: "image",
        model_label: "IKDUHN Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: { reference_image: true, max_reference_images: 9 },
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
    media.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    await prisma.client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function api(path: string, body?: unknown) {
    const response = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-ikduhn-test" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response.json();
  }
  async function newJob(projectId: string, extra = {}) {
    const response = await api(`projects/${projectId}/generation-jobs`, {
      type: "image", expected_output_count: 1,
      parameters: { prompt: "蓝鲸", model_id: MODEL_ID, size: "1024x1024", aspect_ratio: "1:1" },
      ...extra,
    });
    expect(response.code).toBe(200);
    return String(response.data.generation_job_id);
  }
  async function run(jobId: string, provider: ImageProvider) {
    await vi.waitFor(async () => {
      const result = await processImageJobById(jobId, {
      repo: createWorkerRepo(prisma.client), workerId: "ikduhn-worker",
      credentialVault: { open: encrypted => openGenerationCredential(encrypted, secret) },
      createImageProvider: () => provider,
      createAudioProvider: () => { throw new Error("unexpected audio job"); },
      });
      if (result === null) expect((await api(`jobs/${jobId}`)).data.status).toBe("cancelled");
    }, { timeout: 60_000 });
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
  }

  it("API: cancelling a queued image prevents actual provider dispatch", async () => {
    const projectId = (await projects.create("987654", "IKDUHN queued cancellation")).id;
    const id = await newJob(projectId);
    expect((await api(`projects/${projectId}/generation-jobs/${id}/cancel`, {})).code).toBe(200);
    const requests: unknown[] = [];
    await run(id, { async generate(input) { requests.push(input); return []; } });
    expect(requests).toEqual([]);
    expect((await api(`jobs/${id}`)).data.status).toBe("cancelled");
  });
  it("API: confirmed cancellation rejects a late provider result; completed images win before cancellation", async () => {
    const projectId = (await projects.create("987654", "IKDUHN cancellation fence")).id;
    const id = await newJob(projectId);
    const reached = deferred<void>();
    const released = deferred<void>();
    const execution = run(id, { async generate() {
      reached.resolve();
      await released.promise;
      return [{ url: "https://example.com/late.png", width: 1024, height: 1024 }];
    } });
    try {
      await reached.promise;
      expect((await api(`jobs/${id}`)).data.status).toBe("processing");
      expect((await api(`projects/${projectId}/generation-jobs/${id}/cancel`, {})).code).toBe(200);
      expect((await api(`jobs/${id}`)).data.status).toBe("cancelled");
    } finally { released.resolve(); }
    await execution;
    const cancelled = (await api(`jobs/${id}`)).data;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.asset).toBeFalsy();
    expect((await api(`projects/${projectId}/generation-jobs/${id}/cancel`, {})).code).toBe(200);

    const completedId = await newJob(projectId);
    await run(completedId, { async generate() {
      return [{ url: "https://example.com/completed.png", width: 1024, height: 1024 }];
    } });
    const completed = (await api(`jobs/${completedId}`)).data;
    expect(completed.status).toBe("succeeded");
    expect((await api(`projects/${projectId}/generation-jobs/${completedId}/cancel`, {})).code).not.toBe(200);
    expect((await api(`jobs/${completedId}`)).data.asset).toEqual(completed.asset);
  });
  async function getCanvas(projectId: string) {
    return (await api(`canvases?projectId=${projectId}`)).data;
  }
  async function saveCanvas(projectId: string, nodes: unknown[], edges: unknown[], version: number | "missing") {
    return fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
  }
  async function seedImage(projectId: string, id: string, x: number) {
    const jobId = await newJob(projectId, { expected_output_count: 3 });
    await run(jobId, { async generate(input) {
      return Array.from({ length: input.n }, (_, i) => ({ url: `${mediaBase}/${jobId}-${i}.png`, width: 1024, height: 1024 }));
    } });
    const job = (await api(`jobs/${jobId}`)).data;
    expect(job.status).toBe("succeeded");
    return { id, type: "mediaNode", position: { x, y: 100 }, data: {
      jobId, assetId: String(job.asset.id), src: job.asset.url, mediaType: "image", fileName: id,
      prompt: "A", draftModelId: MODEL_ID, draftSize: "1024x1024", draftRatio: "1:1", draftCount: 3,
    } };
  }

  it.runIf(process.env.IKDUHN_BROWSER).each(["succeeded", "failed", "cancelled"] as const)("browser: %s preserves original identity, edits and edges", async (outcome) => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDUHN original image")).id;
    const original = await seedImage(projectId, "original-image", 200);
    const textNode = { id: "text", type: "textNode", position: { x: 800, y: 100 }, data: { title: "附件", text: "雨夜" } };
    const edges = [{ id: "text-ref", source: "text", target: original.id }];
    expect((await saveCanvas(projectId, [original, textNode], edges, "missing")).status).toBe(200);
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    const release = deferred<void>();
    let execution: Promise<void> | undefined;
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 },
        extraHTTPHeaders: { authorization: "Bearer sk-ikduhn-test" } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      const submissions: Record<string, unknown>[] = [];
      page.on("request", request => {
        if (request.method() === "POST" && request.url().endsWith("/generation-jobs")) submissions.push(request.postDataJSON());
      });
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const node = page.locator(`[data-id="${original.id}"]`);
      await node.getByTestId("media-content").click();
      await page.getByText("IKDUHN Test", { exact: true }).waitFor();
      await page.locator("textarea").fill("B");
      await page.locator("textarea").press("Enter");
      await vi.waitFor(async () => expect(JSON.parse((await getCanvas(projectId)).nodes).find((n: { id: string }) => n.id === original.id).data.prompt).toBe("B\n"), { timeout: 10_000 });
      expect(submissions).toEqual([]);
      // 保存故障在公开 HTTP 边界注入；生成接纳、查询与执行均为真实实现。
      await page.route("**/api/canvases/*", route => route.request().method() === "PUT"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, msg: "保存故障" }) })
        : route.continue());
      await page.locator("textarea").fill("保存失败的编辑");
      await page.locator('button[title="发送"]').click();
      await page.getByRole("button", { name: "重试保存" }).waitFor();
      expect(submissions).toEqual([]);
      expect(await page.locator("textarea").inputValue()).toBe("保存失败的编辑");
      expect(await page.locator('button[title="发送"]').isDisabled()).toBe(true);
      await page.unroute("**/api/canvases/*");
      await page.getByRole("button", { name: "重试保存" }).click();
      await vi.waitFor(async () => expect(await page.getByRole("button", { name: "重试保存" }).count()).toBe(0));
      await page.locator("textarea").fill("最新 B");
      const accepted = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/generation-jobs"));
      await page.locator('button[title="发送"]').click();
      const created = await (await accepted).json();
      expect(created.code).toBe(200);
      const id = String(created.data.generation_job_id);
      const reached = deferred<void>();
      const providerRequests: unknown[] = [];
      execution = run(id, { async generate(input) {
        providerRequests.push(input); reached.resolve(); await release.promise;
        if (outcome === "failed") throw new ImageProviderError("NO_RESULT", "生成服务未返回结果");
        return [{ url: `${mediaBase}/${id}.png`, width: 1024, height: 1024 }];
      } });
      await reached.promise;
      await node.getByTestId("regen-overlay").waitFor();
      if (outcome === "succeeded") {
        await vi.waitFor(async () => {
          const doc = await getCanvas(projectId);
          expect(JSON.parse(doc.nodes).find((n: { id: string }) => n.id === original.id).data.jobId).toBe(id);
        }, { timeout: 10_000 });
        // 持久文档可能保留已过期地址，刷新须按 Asset 身份重新解析旧素材。
        const stored = await getCanvas(projectId);
        const nodes = JSON.parse(stored.nodes);
        nodes.find((n: { id: string }) => n.id === original.id).data.src = `${mediaBase}/expired.png`;
        expect((await saveCanvas(projectId, nodes, edges, stored.version)).status).toBe(200);
        await page.reload();
        await node.getByTestId("media-content").click();
        await node.getByTestId("regen-overlay").waitFor();
      }
      expect(await node.locator("img").getAttribute("src")).toBe(original.data.src);
      expect(await page.locator("textarea").isDisabled()).toBe(true);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toMatchObject({ expected_output_count: 1, target_node_id: original.id, parameters: { prompt: "最新 B" } });
      expect(providerRequests[0]).toMatchObject({ n: 1 });
      expect(JSON.stringify(providerRequests[0])).toContain("雨夜");
      expect(JSON.parse((await getCanvas(projectId)).nodes).find((n: { id: string }) => n.id === original.id).data.prompt).toBe("最新 B");
      if (outcome === "cancelled") {
        await node.getByTestId("regen-overlay").getByRole("button", { name: "取消", exact: true }).click();
        await vi.waitFor(async () => expect((await api(`jobs/${id}`)).data.status).toBe("cancelled"));
        await vi.waitFor(async () => expect(await node.getByTestId("regen-overlay").count()).toBe(0), { timeout: 10_000 });
      }
      release.resolve(); await execution;
      const expectedSrc = outcome === "succeeded" ? `${mediaBase}/${id}.png` : original.data.src;
      await vi.waitFor(async () => {
        const saved = JSON.parse((await getCanvas(projectId)).nodes);
        expect(saved).toHaveLength(2);
        const result = saved.find((n: { id: string }) => n.id === original.id);
        expect(result).toMatchObject({ id: original.id, position: original.position, data: { prompt: "最新 B", src: expectedSrc } });
        if (outcome === "succeeded") expect(result.data.assetId).not.toBe(original.data.assetId);
        else expect(result.data.assetId).toBe(original.data.assetId);
        expect(result.data.genStatus).toBe(outcome === "failed" ? "failed" : undefined);
      }, { timeout: 15_000 });
      expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual(edges);
      await page.reload();
      await node.getByTestId("media-content").click();
      expect(await node.locator("img").getAttribute("src")).toBe(expectedSrc);
      expect(await page.locator("textarea").inputValue()).toBe("最新 B");
      if (outcome === "failed") await node.getByTestId("fail-overlay").waitFor();
      expect(await page.locator('.react-flow__node').count()).toBe(2);
      expect((await api(`jobs/${original.data.jobId}`)).data.asset.url).toBe(original.data.src);
    } finally { release.resolve(); await execution; await browser.close(); await vite.close(); }
  }, 90_000);
  it.runIf(process.env.IKDUHN_BROWSER)("browser: downstream tasks freeze submitted references and the next manual task uses the replacement", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDUHN downstream")).id;
    const source = await seedImage(projectId, "source-image", 160);
    const target = await seedImage(projectId, "target-image", 650);
    const edges = [{ id: "source-target", source: source.id, target: target.id }];
    expect((await saveCanvas(projectId, [source, target], edges, "missing")).status).toBe(200);
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    const releaseTarget = deferred<void>();
    let targetExecution: Promise<void> | undefined;
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 },
        extraHTTPHeaders: { authorization: "Bearer sk-ikduhn-test" } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const submitted: Record<string, unknown>[] = [];
      page.on("request", request => {
        if (request.method() === "POST" && request.url().endsWith("/generation-jobs")) submitted.push(request.postDataJSON());
      });
      async function send(nodeId: string, prompt: string) {
        await page.locator(`[data-id="${nodeId}"]`).getByTestId("media-content").click();
        await page.getByText("IKDUHN Test", { exact: true }).waitFor();
        await page.locator("textarea").fill(prompt);
        const response = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/generation-jobs"));
        await page.locator('button[title="发送"]').click();
        const created = await (await response).json();
        expect(created.code).toBe(200);
        return String(created.data.generation_job_id);
      }
      const targetId = await send(target.id, "下游旧快照");
      const targetReached = deferred<void>();
      const targetInputs: unknown[] = [];
      targetExecution = run(targetId, { async generate(input) {
        targetInputs.push(input); targetReached.resolve(); await releaseTarget.promise;
        return [{ url: `${mediaBase}/${targetId}.png`, width: 1024, height: 1024 }];
      } });
      await targetReached.promise;
      const sourceId = await send(source.id, "上游新素材");
      await run(sourceId, { async generate() {
        return [{ url: `${mediaBase}/${sourceId}.png`, width: 1024, height: 1024 }];
      } });
      await vi.waitFor(async () => {
        const nodes = JSON.parse((await getCanvas(projectId)).nodes);
        expect(nodes.find((n: { id: string }) => n.id === source.id).data.src).toBe(`${mediaBase}/${sourceId}.png`);
        expect(nodes.find((n: { id: string }) => n.id === target.id).data.assetId).toBe(target.data.assetId);
      }, { timeout: 15_000 });
      expect(submitted).toHaveLength(2);
      expect(targetInputs[0]).toMatchObject({ sourceImage: { url: source.data.src } });
      releaseTarget.resolve(); await targetExecution;
      await vi.waitFor(async () => {
        const node = JSON.parse((await getCanvas(projectId)).nodes).find((n: { id: string }) => n.id === target.id);
        expect(node.data.genStatus).toBeUndefined();
        expect(node.data.src).toBe(`${mediaBase}/${targetId}.png`);
      }, { timeout: 15_000 });
      const nextId = await send(target.id, "下游新快照");
      const nextInputs: unknown[] = [];
      await run(nextId, { async generate(input) {
        nextInputs.push(input);
        return [{ url: `${mediaBase}/${nextId}.png`, width: 1024, height: 1024 }];
      } });
      expect(nextInputs[0]).toMatchObject({ sourceImage: { url: `${mediaBase}/${sourceId}.png` }, n: 1 });
      expect((await api(`jobs/${targetId}`)).data.asset.url).toBe(`${mediaBase}/${targetId}.png`);
      expect((await api(`jobs/${source.data.jobId}`)).data.asset.url).toBe(source.data.src);
      await vi.waitFor(async () => {
        const doc = await getCanvas(projectId);
        expect(JSON.parse(doc.nodes)).toHaveLength(2);
        expect(JSON.parse(doc.edges)).toEqual(edges);
        expect(JSON.parse(doc.nodes).find((n: { id: string }) => n.id === target.id).data.src).toBe(`${mediaBase}/${nextId}.png`);
      }, { timeout: 15_000 });
      expect(submitted).toHaveLength(3);
    } finally { releaseTarget.resolve(); await targetExecution; await browser.close(); await vite.close(); }
  }, 90_000);
  it.runIf(process.env.IKDUHN_BROWSER)("browser: late cancellation response cannot unlock a newer submission", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDUHN late response")).id;
    const original = await seedImage(projectId, "race-image", 200);
    await saveCanvas(projectId, [original], [], "missing");
    const oldId = await newJob(projectId, { target_node_id: original.id });
    await saveCanvas(projectId, [{ ...original, data: { ...original.data, jobId: oldId, genStatus: "generating" } }], [], (await getCanvas(projectId)).version);
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    const releaseOld = deferred<void>();
    const releaseNew = deferred<void>();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { authorization: "Bearer sk-ikduhn-test" } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const node = page.locator(`[data-id="${original.id}"]`);
      await node.getByTestId("media-content").click();
      const oldHeld = deferred<void>();
      const cancelPath = `/generation-jobs/${oldId}/cancel`;
      await page.route(`**${cancelPath}`, async route => {
        const response = await route.fetch();
        expect((await response.json()).code).toBe(200);
        oldHeld.resolve(); await releaseOld.promise;
        await route.fulfill({ response });
      });
      await node.getByTestId("regen-overlay").getByRole("button", { name: "取消", exact: true }).click();
      await oldHeld.promise;
      // 轮询先读到真实取消终态；取消 POST 的成功响应仍在途。
      await vi.waitFor(async () => expect(await node.getByTestId("regen-overlay").count()).toBe(0), { timeout: 5_000 });
      const newHeld = deferred<void>();
      await page.route("**/generation-jobs", async route => {
        const response = await route.fetch(); newHeld.resolve(); await releaseNew.promise;
        await route.fulfill({ response });
      });
      await page.locator("textarea").fill("新的提交");
      await page.locator('button[title="发送"]').click();
      await newHeld.promise;
      const oldReturned = page.waitForResponse(r => r.url().endsWith(`/api/jobs/${oldId}`));
      releaseOld.resolve(); await oldReturned;
      // 尝试编辑是可观察行为：旧取消响应不得解除新提交的只读状态。
      await expect(page.locator("textarea").fill("不得写入", { timeout: 1000 })).rejects.toThrow();
      expect(await node.getByTestId("regen-overlay").count()).toBe(1);
    } finally { releaseOld.resolve(); releaseNew.resolve(); await browser.close(); await vite.close(); }
  }, 60_000);
});
