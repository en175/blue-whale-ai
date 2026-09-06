import "reflect-metadata";
import { createServer } from "node:http";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { AgentV1ProxyController } from "../agent/agent-v1-proxy.controller.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";

// Public HTTP seam, real production Canvas/Project services and disposable MySQL (IKDLQK).
// Authentication middleware supplies the already-authenticated identity; no Canvas API mocks.
describe.skipIf(!process.env.IKDLQK_DATABASE_URL)("Legacy generation-card migration public API", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";

  const SOURCE = { sessionId: "session-legacy", revisionId: "revision-1", shotNo: 1 };

  /** 浏览器用例的 Agent 替身：只提供会话列表/快照/SSE 骨架，迁移从不回读 Agent。 */
  const agent = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.includes("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": connected\n\n");
      req.on("close", () => res.end());
      return;
    }
    if (req.url?.endsWith("/snapshot")) {
      res.end(JSON.stringify({ session: { session_id: SOURCE.sessionId, title: "旧卡对话", phase: "idle", lifecycle: "active" }, event_cursor: "0", messages: [], prompt_cards: [] }));
      return;
    }
    res.end(JSON.stringify({ items: [] }));
  });

  const previousDatabase = process.env.DATABASE_URL;
  const previousAgent = process.env.AGENT_SERVICE_BASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDLQK_DATABASE_URL;
    await new Promise<void>(resolve => agent.listen(0, "127.0.0.1", resolve));
    process.env.AGENT_SERVICE_BASE_URL = `http://127.0.0.1:${(agent.address() as { port: number }).port}`;
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService], AgentV1ProxyController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, ProjectsController, AgentV1ProxyController], providers: [
      { provide: CanvasService, useValue: new CanvasService(prisma, projects) },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
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
    agent.closeAllConnections();
    await new Promise<void>(resolve => agent.close(() => resolve()));
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousAgent === undefined) delete process.env.AGENT_SERVICE_BASE_URL;
    else process.env.AGENT_SERVICE_BASE_URL = previousAgent;
    await prisma.client.$disconnect();
  });

  function legacyCardNode(id: string, card: unknown, position = { x: 100, y: 100 }) {
    return { id, type: "assetNode", position, data: { kind: "generation", generationCard: card } };
  }
  function mediaNode(id: string) {
    return { id, type: "mediaNode", position: { x: 500, y: 100 }, data: { kind: "image", status: "idle" } };
  }
  async function createProject(name: string) {
    return (await projects.create("987654", name)).id;
  }
  async function seedCanvas(projectId: string, nodes: unknown[], edges: unknown[] = []) {
    const response = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).data;
  }
  async function getCanvas(projectId: string) {
    const response = await fetch(`${base}/api/canvases?projectId=${projectId}`);
    expect(response.status).toBe(200);
    return (await response.json()).data;
  }
  async function listHistory(projectId: string) {
    const response = await fetch(`${base}/api/canvases/${projectId}/legacy-card-history`);
    expect(response.status).toBe(200);
    return ((await response.json()).data?.items ?? []) as Array<Record<string, unknown>>;
  }
  async function historyCount(projectId: string) {
    return prisma.client.legacy_card_history.count({ where: { project_id: BigInt(projectId) } });
  }

  it("migrates legacy generation cards on open, preserving title, position, edited prompt and edges", async () => {
    const projectId = await createProject("IKDLQK basic");
    const card = {
      shotTitle: "镜头 1", timeRange: "0-4s", visual: "暮色街道的画面", prompt: "用户编辑后的提示词\n第二行",
      cardId: "revision-1#1", shotNo: 1, source: SOURCE, assetRefItems: [{ assetId: "7", label: "街景", mediaType: "image" }],
    };
    await seedCanvas(projectId, [legacyCardNode("card-1", card), mediaNode("media-1")], [{ id: "e1", source: "card-1", target: "media-1" }]);

    const canvas = await getCanvas(projectId);
    expect(canvas.legacy_migration).toEqual({ migrated: ["card-1"], failed: [] });
    const nodes = JSON.parse(canvas.nodes);
    const migrated = nodes.find((node: { id: string }) => node.id === "card-1");
    expect(migrated).toEqual({
      id: "card-1", type: "textNode", position: { x: 100, y: 100 },
      data: { title: "镜头 1", text: "用户编辑后的提示词\n第二行", promptSource: SOURCE },
    });
    // 连线与其他节点不动
    expect(JSON.parse(canvas.edges)).toEqual([{ id: "e1", source: "card-1", target: "media-1" }]);
    expect(nodes.find((node: { id: string }) => node.id === "media-1")).toMatchObject({ type: "mediaNode" });

    const items = await listHistory(projectId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      nodeId: "card-1", title: "镜头 1", promptText: "用户编辑后的提示词\n第二行",
      visualText: "暮色街道的画面", source: SOURCE,
    });
    expect(items[0]!.cardJson).toMatchObject({ timeRange: "0-4s", cardId: "revision-1#1", assetRefItems: [{ assetId: "7", label: "街景", mediaType: "image" }] });
    expect(typeof items[0]!.migratedAt).toBe("string");
  });

  it("is idempotent across reopens and never overwrites post-migration edits", async () => {
    const projectId = await createProject("IKDLQK idempotent");
    await seedCanvas(projectId, [legacyCardNode("card-1", { shotTitle: "镜头 1", visual: "画面", prompt: "迁移时正文" })]);

    const first = await getCanvas(projectId);
    expect(first.legacy_migration?.migrated).toEqual(["card-1"]);
    const again = await getCanvas(projectId);
    expect(again.legacy_migration).toBeUndefined();
    expect(JSON.parse(again.nodes)).toHaveLength(1);
    expect(await historyCount(projectId)).toBe(1);

    // 迁移后按普通文本编辑并保存：历史与正文都不被迁移覆盖
    const edited = JSON.parse(again.nodes).map((node: { id: string; data: Record<string, unknown> }) =>
      node.id === "card-1" ? { ...node, data: { ...node.data, text: "迁移后的编辑" } } : node);
    const saved = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": `"${again.version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(edited), viewport: "{}" }),
    });
    expect(saved.status).toBe(200);
    const third = await getCanvas(projectId);
    expect(third.legacy_migration).toBeUndefined();
    expect(JSON.parse(third.nodes)[0].data.text).toBe("迁移后的编辑");
    const items = await listHistory(projectId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ promptText: "迁移时正文" });
  });

  it("dedupes duplicate sources and never forges promptSource for sourceless cards", async () => {
    const projectId = await createProject("IKDLQK sources");
    await seedCanvas(projectId, [
      legacyCardNode("card-a", { shotTitle: "A", prompt: "pa", source: SOURCE }),
      legacyCardNode("card-b", { shotTitle: "B", prompt: "pb", source: SOURCE }),
      legacyCardNode("card-c", { shotTitle: "C", prompt: "pc" }),
      legacyCardNode("card-d", { shotTitle: "D", prompt: "pd", source: { sessionId: "broken" } }),
    ]);

    const canvas = await getCanvas(projectId);
    expect(canvas.legacy_migration?.migrated).toEqual(["card-a", "card-b", "card-c", "card-d"]);
    const nodes = JSON.parse(canvas.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
    expect(nodes.find(n => n.id === "card-a")!.data.promptSource).toEqual(SOURCE);
    expect(nodes.find(n => n.id === "card-b")!.data).not.toHaveProperty("promptSource");
    expect(nodes.find(n => n.id === "card-c")!.data).not.toHaveProperty("promptSource");
    expect(nodes.find(n => n.id === "card-d")!.data).not.toHaveProperty("promptSource");

    const items = await listHistory(projectId);
    expect(items).toHaveLength(4);
    expect(items.map(i => i.source)).toEqual([SOURCE, SOURCE, null, null]);
  });

  it("keeps corrupt or over-limit cards untouched with explicit reasons, no history and no visual fallback", async () => {
    const projectId = await createProject("IKDLQK corrupt");
    const missingPrompt = legacyCardNode("card-missing", { shotTitle: "缺提示词", visual: "只有画面描述" });
    const missingBlock = { id: "card-noblock", type: "assetNode", position: { x: 0, y: 0 }, data: { kind: "generation" } };
    const overPrompt = legacyCardNode("card-over-prompt", { shotTitle: "超长", prompt: "文".repeat(100_001) });
    const overTitle = legacyCardNode("card-over-title", { shotTitle: "长".repeat(201), prompt: "p" });
    const valid = legacyCardNode("card-ok", { shotTitle: "正常", visual: "画面", prompt: "正常提示词" });
    await seedCanvas(projectId, [missingPrompt, missingBlock, overPrompt, overTitle, valid]);

    const canvas = await getCanvas(projectId);
    expect(canvas.legacy_migration.migrated).toEqual(["card-ok"]);
    expect(canvas.legacy_migration.failed).toEqual([
      { nodeId: "card-missing", title: "缺提示词", reason: "提示词缺失或已损坏" },
      { nodeId: "card-noblock", title: "", reason: "提示词缺失或已损坏" },
      { nodeId: "card-over-prompt", title: "超长", reason: "提示词超过存储限长" },
      { nodeId: "card-over-title", title: "长".repeat(201), reason: "标题超过存储限长" },
    ]);
    const nodes = JSON.parse(canvas.nodes) as Array<{ id: string; type: string; data: Record<string, unknown> }>;
    // 原资料保留：失败卡仍是旧生成卡，不用 visual 顶替提示词
    for (const id of ["card-missing", "card-noblock", "card-over-prompt", "card-over-title"]) {
      expect(nodes.find(n => n.id === id)!.type).toBe("assetNode");
    }
    expect(nodes.find(n => n.id === "card-missing")!.data.generationCard).toMatchObject({ visual: "只有画面描述" });
    const okNode = nodes.find(n => n.id === "card-ok")!;
    expect(okNode.type).toBe("textNode");
    expect(okNode.data.text).toBe("正常提示词");
    expect(await historyCount(projectId)).toBe(1);

    // 失败是无状态的：再次打开重新评估，报告一致且仍不落历史
    const second = await getCanvas(projectId);
    expect(second.legacy_migration.failed).toHaveLength(4);
    expect(await historyCount(projectId)).toBe(1);
  });

  it("recovers a stranded card from its saved history without rewriting history", async () => {
    const projectId = await createProject("IKDLQK recovery");
    await seedCanvas(projectId, [legacyCardNode("card-1", { shotTitle: "现值标题", visual: "现值画面", prompt: "现值提示词" })]);
    // 模拟上次迁移：历史已落库、画布写入失败
    await prisma.client.legacy_card_history.create({
      data: {
        project_id: BigInt(projectId), node_id: "card-1",
        title: "历史标题", prompt_text: "历史提示词", visual_text: "历史画面",
        card_json: { shotTitle: "历史标题", prompt: "历史提示词" },
      },
    });

    const canvas = await getCanvas(projectId);
    expect(canvas.legacy_migration?.migrated).toEqual(["card-1"]);
    const node = JSON.parse(canvas.nodes)[0];
    expect(node).toMatchObject({ type: "textNode", data: { title: "历史标题", text: "历史提示词" } });
    expect(await historyCount(projectId)).toBe(1);
  });

  it("does not migrate or expose history across project ownership", async () => {
    const mine = await createProject("IKDLQK ownership mine");
    await seedCanvas(mine, [legacyCardNode("card-1", { shotTitle: "A", prompt: "pa" })]);
    await getCanvas(mine);
    const other = (await projects.create("987655", "IKDLQK ownership other")).id;
    const deniedCanvas = await (await fetch(`${base}/api/canvases?projectId=${other}`)).json();
    expect(deniedCanvas.data).toBeNull();
    const deniedHistory = await (await fetch(`${base}/api/canvases/${other}/legacy-card-history`)).json();
    expect(deniedHistory.data).toBeNull();
    const mineHistory = await (await fetch(`${base}/api/canvases/${mine}/legacy-card-history`)).json();
    expect(mineHistory.data.items).toHaveLength(1);
  });

  it("concurrent opens converge to one converted node and one history row", async () => {
    const projectId = await createProject("IKDLQK concurrent");
    await seedCanvas(projectId, [
      legacyCardNode("card-1", { shotTitle: "A", prompt: "pa" }),
      legacyCardNode("card-2", { shotTitle: "B", prompt: "pb" }),
    ]);

    const results = await Promise.all(Array.from({ length: 8 }, () => getCanvas(projectId)));
    const shapes = new Set(results.map(canvas => canvas.nodes));
    expect(shapes.size).toBe(1);
    const nodes = JSON.parse(results[0]!.nodes);
    expect(nodes.filter((node: { type: string }) => node.type === "textNode")).toHaveLength(2);
    expect(await historyCount(projectId)).toBe(2);
  });

  it("migrates on the project snapshot path and carries the report", async () => {
    const projectId = await createProject("IKDLQK snapshot");
    await seedCanvas(projectId, [legacyCardNode("card-1", { shotTitle: "镜头 1", visual: "画面", prompt: "快照路径提示词" })]);

    const response = await fetch(`${base}/api/projects/${projectId}/snapshot`);
    expect(response.status).toBe(200);
    const snapshot = (await response.json()).data;
    expect(snapshot.legacy_migration).toEqual({ migrated: ["card-1"], failed: [] });
    const nodes = JSON.parse(snapshot.canvas.nodes);
    expect(nodes[0]).toMatchObject({ id: "card-1", type: "textNode", data: { title: "镜头 1", text: "快照路径提示词" } });
    // 再次打开：幂等，不再携带报告
    const second = (await (await fetch(`${base}/api/projects/${projectId}/snapshot`)).json()).data;
    expect(second.legacy_migration).toBeUndefined();
  });

  it.runIf(process.env.IKDLQK_BROWSER)("browser opens an old project, edits the migrated text, views read-only history and reloads", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const projectId = await createProject("IKDLQK browser");
      await seedCanvas(projectId, [
        legacyCardNode("card-1", { shotTitle: "镜头 1", visual: "暮色街道的画面", prompt: "浏览器迁移提示词" }),
        legacyCardNode("card-bad", { shotTitle: "坏卡", visual: "只有画面的坏卡" }, { x: 420, y: 100 }),
      ]);
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);

      // 打开即迁移：旧卡成为普通文本节点；损坏卡保留原样（仍渲染旧画面描述）
      const node = page.locator(".react-flow__node-textNode");
      await node.getByText("浏览器迁移提示词").waitFor();
      await page.getByText("只有画面的坏卡").waitFor();

      // 迁移后节点按普通文本编辑并落盘
      const editor = node.locator('[data-placeholder="输入内容..."]');
      await editor.dblclick();
      const editSaved = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await editor.fill("浏览器编辑后的正文\n第二行");
      await page.locator(".react-flow__pane").click({ position: { x: 900, y: 700 } });
      expect((await editSaved).status()).toBe(200);

      // 迁移历史只读入口：画面描述与迁移时提示词可查阅
      await page.getByRole("button", { name: "迁移历史" }).click();
      const modal = page.locator('[data-semantic="container"]');
      await modal.getByText("暮色街道的画面").waitFor();
      await modal.getByText("浏览器迁移提示词").waitFor();
      expect(await modal.locator("input, textarea, [contenteditable]").count()).toBe(0);
      await page.keyboard.press("Escape");

      // 服务端事实：坏卡无历史，历史只有一条且不可变
      expect(await historyCount(projectId)).toBe(1);

      // 刷新恢复：编辑后的正文、保留的坏卡与历史入口都在
      await page.reload();
      await page.locator(".react-flow__node-textNode").getByText("浏览器编辑后的正文").waitFor();
      await page.getByText("只有画面的坏卡").waitFor();
      await page.getByRole("button", { name: "迁移历史" }).waitFor();
      await page.screenshot({ path: "/tmp/ikdlqk-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 90_000);
});
