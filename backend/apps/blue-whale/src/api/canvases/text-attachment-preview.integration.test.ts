import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { GenerationModelsController } from "../generation/models.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";

// IKFCX4「图片文本附件完整预览与关系一致性」公开接口集成（IKFCVS 规格「测试决策」节）：
// 真 NestFactory 挂载生产控制器 + 隔离 MySQL（IKFCX4_DATABASE_URL 门控）；
// 浏览器段（IKFCX4_BROWSER=1：完整正文浮层 → 长文滚动 → 移入保持/移出关闭 →
// 多目标移除断边 → 来源更新预览当前正文 → 刷新恢复）在同 describe 尾部。
// 本切片不触发任何上游供应商调用，不挂 HTTP 替身。
describe.skipIf(!process.env.IKFCX4_DATABASE_URL)("Text attachment preview consistency (IKFCX4)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikfcx4-image-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFCX4_DATABASE_URL;
    const sizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfcx4-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikfcx4-test",
        model_id: MODEL_ID,
        capability_type: "image",
        model_label: "IKFCX4 Test",
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
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationModelsController, ProjectsController], providers: [
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
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

  async function getCanvas(projectId: string) {
    const response = await fetch(`${base}/api/canvases?projectId=${projectId}`);
    return (await response.json()).data;
  }

  it("多目标关系持久化基线：同来源到两目标的连线独立保存与读取（API 段）", async () => {
    const projectId = (await projects.create("987654", "IKFCX4 relations")).id;
    const nodes = [
      { id: "text-1", type: "textNode", position: { x: 0, y: 0 }, data: { title: "场景描述", text: "赛博朋克" } },
      { id: "media-1", type: "mediaNode", position: { x: 200, y: 0 }, data: { mediaType: "image" } },
      { id: "media-2", type: "mediaNode", position: { x: 400, y: 0 }, data: { mediaType: "image" } },
    ];
    const edges = [
      { id: "e1", source: "text-1", target: "media-1" },
      { id: "e2", source: "text-1", target: "media-2" },
    ];
    const saved = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }),
    });
    expect(saved.status).toBe(200);
    // 两目标关系独立存在：断开其一（面板移除的持久化形态）不影响另一目标
    const canvas = await getCanvas(projectId);
    const pruned = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": `"${canvas.version}"` },
      body: JSON.stringify({
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify([edges[1]!]),
        viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      }),
    });
    expect(pruned.status).toBe(200);
    const after = await getCanvas(projectId);
    expect(JSON.parse(after.edges)).toEqual([expect.objectContaining({ source: "text-1", target: "media-2" })]);
  });

  it.runIf(process.env.IKFCX4_BROWSER)("browser: 完整正文预览与关系一致性（悬浮滚动/移入保持/多目标移除/来源更新/刷新恢复）", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFCX4 browser")).id;
    // 长正文：多段落撑出滚动（textCard 上限 280px 高）；末尾标记用于断言滚动到底
    const longBody = Array.from({ length: 24 }, (_, i) => `第${i + 1}段落：蓝鲸在深海里缓慢游动，霓虹灯映在浪尖。`).join("\n");
    const LONG_TAIL_MARK = "末尾标记-XY7";
    const asset = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type: "image",
        url: "https://example.com/ikfcx4-target.png",
        width: 1024,
        height: 1024,
        size: BigInt(2048),
      },
    });
    const assetId = asset.id.toString();
    const seeded = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({
        nodes: JSON.stringify([
          { id: "text-1", type: "textNode", position: { x: 120, y: 140 }, data: { title: "场景描述", text: `${longBody}\n${LONG_TAIL_MARK}` } },
          { id: "text-2", type: "textNode", position: { x: 120, y: 460 }, data: { title: "雨夜", text: "青石板路，油纸伞" } },
          { id: "media-1", type: "mediaNode", position: { x: 880, y: 120 }, data: { mediaType: "image", fileName: "目标图一", assetId, width: 1024, height: 1024 } },
          { id: "media-2", type: "mediaNode", position: { x: 880, y: 460 }, data: { mediaType: "image", fileName: "目标图二", assetId, width: 1024, height: 1024 } },
        ]),
        // 播种三边：text-1 同时服务两目标（多目标移除验收的持久关系基线），text-2 只进 media-1；
        // 拖线建立连线的行为已由 IKDLQF 浏览器段覆盖，本片聚焦面板侧交互与关系一致性
        edges: JSON.stringify([
          { id: "e-t1-m1", source: "text-1", target: "media-1" },
          { id: "e-t1-m2", source: "text-1", target: "media-2" },
          { id: "e-t2-m1", source: "text-2", target: "media-1" },
        ]),
        viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      }),
    });
    expect(seeded.status).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const text1 = page.locator('.react-flow__node-textNode[data-id="text-1"]');
      const text2 = page.locator('.react-flow__node-textNode[data-id="text-2"]');
      const media1 = page.locator('.react-flow__node-mediaNode[data-id="media-1"]');
      const media2 = page.locator('.react-flow__node-mediaNode[data-id="media-2"]');
      await text1.waitFor();
      await text2.waitFor();
      await media1.waitFor();
      await media2.waitFor();
      await vi.waitFor(async () => expect(await page.locator(".react-flow__edge").count()).toBe(3));

      // 打开 media-1 面板：文本附件以图标进参考栏（两枚），无旧独立正文块
      await media1.locator('[data-testid="media-content"]').click();
      await media1.getByRole("button", { name: "生成图片" }).click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(2));
      expect(await page.getByText("文本附件（").count()).toBe(0);

      // 悬浮 text-1 图标：浮层显示完整正文（含末尾标记）、无来源标题
      const textThumbs = page.locator('[data-testid="dock-text-ref"]');
      const longThumb = textThumbs.first();
      await longThumb.hover();
      const overlay = page.locator('[data-testid="ref-thumb-preview"]');
      await overlay.waitFor();
      const overlayText = await overlay.innerText();
      expect(overlayText).toContain(longBody.split("\n")[0]!);
      expect(overlayText, "浮层无标题（来源名称不进浮层）").not.toContain("场景描述");
      const scrollable = await overlay.evaluate((el) => {
        const inner = el.firstElementChild as HTMLElement | null;
        return inner ? { scrollHeight: inner.scrollHeight, clientHeight: inner.clientHeight } : null;
      });
      expect(scrollable, "长文超出浮层上限形成滚动区").not.toBeNull();
      expect(scrollable!.scrollHeight).toBeGreaterThan(scrollable!.clientHeight);
      // 滚动至末尾：底部标记进入视口
      await overlay.evaluate((el) => {
        const inner = el.firstElementChild as HTMLElement;
        inner.scrollTop = inner.scrollHeight;
      });
      await overlay.locator(`text=${LONG_TAIL_MARK}`).waitFor();
      const tailVisible = await overlay.evaluate((el) => {
        const inner = el.firstElementChild as HTMLElement;
        return Math.abs(inner.scrollHeight - inner.scrollTop - inner.clientHeight) < 8;
      });
      expect(tailVisible, "长文本可滚动至末尾").toBe(true);

      // 移入浮层保持打开：鼠标从图标移到浮层内停留，超过关闭延迟浮层仍在
      const overlayBox = (await overlay.boundingBox())!;
      await page.mouse.move(overlayBox.x + overlayBox.width / 2, overlayBox.y + overlayBox.height / 2);
      await page.waitForTimeout(400);
      expect(await overlay.count(), "鼠标移入浮层保持打开").toBe(1);
      // 移出浮层（图标与浮层之外）后关闭
      await page.mouse.move(120, 60);
      await page.waitForTimeout(400);
      expect(await overlay.count(), "移出图标与浮层后关闭").toBe(0);

      // 多目标移除：media-1 面板移除 text-1 → 仅断 text-1→media-1；
      // text-1→media-2 与 text-2→media-1 保留，画布来源卡仍在
      const removeSaved = page.waitForResponse((response) =>
        response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await longThumb.locator('button[title="移除"]').click();
      expect((await removeSaved).status()).toBe(200);
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      const afterRemove = await getCanvas(projectId);
      const edgePairs = (JSON.parse(afterRemove.edges) as Array<{ source: string; target: string }>)
        .map((e) => `${e.source}->${e.target}`).sort();
      expect(edgePairs).toEqual(["text-1->media-2", "text-2->media-1"]);
      expect(await text1.count(), "来源文本卡保留").toBe(1);
      expect(await page.locator(".react-flow__edge").count()).toBe(2);

      // 来源更新：编辑 text-2 正文后返回目标面板，预览显示当前正文（IKFCX4）
      await text2.locator('[data-testid="text-title"]').click();
      const editor = text2.locator('[data-placeholder="输入内容..."]');
      await editor.dblclick();
      await editor.fill("雨后的巷子，猫在檐下躲雨");
      await page.locator(".react-flow__pane").click({ position: { x: 80, y: 900 } });
      // 返回 media-1（切换目标后返回）：图标与已保存关系一致
      await media1.locator('[data-testid="media-content"]').click();
      await media1.getByRole("button", { name: "生成图片" }).click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      await overlay.waitFor();
      expect(await overlay.innerText(), "来源正文修改后再次预览使用当前正文").toContain("雨后的巷子，猫在檐下躲雨");

      // 刷新画布：关系随保存恢复，media-2 面板图标与连线一致
      await page.reload();
      await text1.waitFor();
      await media2.waitFor();
      await vi.waitFor(async () => expect(await page.locator(".react-flow__edge").count()).toBe(2));
      await media2.locator('[data-testid="media-content"]').click();
      await media2.getByRole("button", { name: "生成图片" }).click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      await overlay.waitFor();
      expect(await overlay.innerText()).toContain(longBody.split("\n")[0]!);
      const reloaded = await getCanvas(projectId);
      expect((JSON.parse(reloaded.edges) as Array<{ source: string; target: string }>)
        .map((e) => `${e.source}->${e.target}`).sort()).toEqual(["text-1->media-2", "text-2->media-1"]);
      await page.screenshot({ path: "/tmp/ikfcx4-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);
});
