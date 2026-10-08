import "reflect-metadata";
import { createServer, type Server } from "node:http";
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

describe.skipIf(!process.env.IKDLQL_DATABASE_URL)("Legacy preview compatibility public API", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";

  const SOURCE = { sessionId: "session-legacy-preview", revisionId: "revision-old", shotNo: 1 };
  const HISTORICAL_PROMPT = "历史修订的提示词\n保留换行与 <细节>";
  let revisionRouteMode: "ok" | "missing-route" | "no-revision" | "no-prompt" | "gateway" = "ok";
  let activeRevisionId = "revision-newer";
  const agentRequests: string[] = [];

  const agent: Server = createServer((req, res) => {
    agentRequests.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url?.includes("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": connected\n\n");
      req.on("close", () => res.end());
      return;
    }
    if (req.url?.includes("/prompt-card-revisions")) {
      if (revisionRouteMode === "missing-route") { res.writeHead(404); res.end(JSON.stringify({ error: "not found" })); return; }
      if (revisionRouteMode === "gateway") { res.writeHead(500); res.end(JSON.stringify({ error: "boom" })); return; }
      const revisions = revisionRouteMode === "no-revision" ? [] : [{
        revision_id: SOURCE.revisionId,
        card_id: "card-1",
        session_id: SOURCE.sessionId,
        revision_number: 1,
        schema_version: 3,
        payload: { shots: [{ shot_no: SOURCE.shotNo, title: "旧镜头", prompt_text: revisionRouteMode === "no-prompt" ? "" : HISTORICAL_PROMPT, frame_description: "绝不能用画面描述替代" }] },
      }];
      res.end(JSON.stringify({ revisions }));
      return;
    }
    if (req.url?.endsWith("/snapshot")) {
      res.end(JSON.stringify({
        session: { session_id: SOURCE.sessionId, title: "历史预览会话", phase: "idle", lifecycle: "active" },
        event_cursor: "0",
        messages: [
          { message_id: "user-1", sequence: 1, role: "user", content: [{ type: "text", text: "整理 Prompt" }] },
          { message_id: "assistant-1", sequence: 2, role: "assistant", content: [{ type: "text", text: "已整理。" }] },
        ],
        prompt_cards: [{
          session_id: SOURCE.sessionId,
          active_revision: {
            revision_id: activeRevisionId,
            payload: { shots: [{ shot_no: 1, title: "新版镜头", prompt_text: "新版正文", frame_description: "新版画面" }] },
          },
        }],
      }));
      return;
    }
    res.end(JSON.stringify({ items: [{ session_id: SOURCE.sessionId, title: "历史预览会话", phase: "idle", lifecycle: "active" }] }));
  });

  const previousDatabase = process.env.DATABASE_URL;
  const previousAgent = process.env.AGENT_SERVICE_BASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDLQL_DATABASE_URL;
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

  async function createProject(name: string) {
    return (await projects.create("987654", name)).id;
  }
  async function apply(projectId: string, source = SOURCE) {
    return fetch(`${base}/api/canvases/${projectId}/prompt-previews/apply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, position: { x: 120, y: 240 } }),
    });
  }
  async function canvasNodes(projectId: string) {
    const canvas = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
    return { canvas: canvas.data, nodes: JSON.parse(canvas.data.nodes ?? "[]") as Array<{ id: string; type: string; data?: Record<string, unknown> }> };
  }
  async function saveCanvas(projectId: string, nodes: unknown[], version: number | "missing") {
    return fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": version === "missing" ? '"missing"' : `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), viewport: "{}" }),
    });
  }
  function legacyCardNode(id: string, card: unknown, position = { x: 100, y: 100 }) {
    return { id, type: "assetNode", position, data: { kind: "generation", generationCard: card } };
  }

  it("applies a historical revision through the compatibility mapping route", async () => {
    const projectId = await createProject("IKDLQL historical apply");
    const response = await apply(projectId);
    expect(response.status).toBeLessThan(300);
    const result = await response.json();
    expect(result.data.node).toMatchObject({ type: "textNode", data: { title: "旧镜头", text: HISTORICAL_PROMPT } });
    expect(result.data.reused).toBe(false);
    const route = `/v1/projects/${projectId}/sessions/${SOURCE.sessionId}/prompt-card-revisions?revision_ids=${SOURCE.revisionId}`;
    expect(agentRequests).toContain(route);
  });

  it("reuses the node on repeat applies and recreates with a new identity after deletion", async () => {
    const projectId = await createProject("IKDLQL reuse rules");
    const first = await (await apply(projectId)).json();
    const second = await (await apply(projectId)).json();
    expect(second.data.node.id).toBe(first.data.node.id);
    expect(second.data.reused).toBe(true);
    const { canvas } = await canvasNodes(projectId);
    expect((await saveCanvas(projectId, [], canvas.version)).status).toBe(200);
    const recreated = await (await apply(projectId)).json();
    expect(recreated.data.node.id).not.toBe(first.data.node.id);
    expect(recreated.data.node.data.text).toBe(HISTORICAL_PROMPT);
  });

  it("still applies the active revision directly without calling the historical route", async () => {
    const projectId = await createProject("IKDLQL active direct");
    activeRevisionId = SOURCE.revisionId;
    try {
      const before = agentRequests.length;
      const response = await apply(projectId);
      expect(response.status).toBeLessThan(300);
      const result = await response.json();
      expect(result.data.node.data.text).toBe("新版正文");
      expect(agentRequests.slice(before).some(url => url.includes("/prompt-card-revisions"))).toBe(false);
    } finally { activeRevisionId = "revision-newer"; }
  });

  it("keeps the explicit error and zero writes when the Agent has no revision route", async () => {
    const projectId = await createProject("IKDLQL missing route");
    revisionRouteMode = "missing-route";
    try {
      const before = await canvasNodes(projectId);
      const response = await apply(projectId);
      expect(response.status).toBe(404);
      expect((await response.json()).message).toContain("该历史预览已不可读取");
      const after = await canvasNodes(projectId);
      expect(after.nodes).toEqual(before.nodes);
      expect(after.canvas.version).toBe(before.canvas.version);
    } finally { revisionRouteMode = "ok"; }
  });

  it("never substitutes the frame description for a missing historical prompt", async () => {
    const projectId = await createProject("IKDLQL no prompt");
    revisionRouteMode = "no-prompt";
    try {
      const before = await canvasNodes(projectId);
      const response = await apply(projectId);
      expect(response.status).toBe(400);
      expect((await response.json()).message).toContain("预览正文缺失");
      const after = await canvasNodes(projectId);
      expect(after.nodes).toEqual(before.nodes);
      expect(JSON.stringify(after.nodes)).not.toContain("绝不能用画面描述替代");
    } finally { revisionRouteMode = "ok"; }
  });

  it("reports an absent revision through the same explicit error", async () => {
    const projectId = await createProject("IKDLQL absent revision");
    revisionRouteMode = "no-revision";
    try {
      const response = await apply(projectId);
      expect(response.status).toBe(404);
      const { nodes } = await canvasNodes(projectId);
      expect(nodes).toHaveLength(0);
    } finally { revisionRouteMode = "ok"; }
  });

  it("concurrent first applies of a historical revision yield a single node", async () => {
    const projectId = await createProject("IKDLQL concurrent historical");
    const results = await Promise.all(Array.from({ length: 8 }, async () => (await apply(projectId)).json()));
    expect(new Set(results.map(result => result.data.node.id)).size).toBe(1);
    const { nodes } = await canvasNodes(projectId);
    expect(nodes.filter(node => node.type === "textNode")).toHaveLength(1);
  });

  it("surfaces upstream failures of the revision route as retryable gateway errors", async () => {
    const projectId = await createProject("IKDLQL gateway failure");
    revisionRouteMode = "gateway";
    try {
      const response = await apply(projectId);
      expect(response.status).toBe(502);
      expect((await response.json()).message).toContain("暂时无法读取预览");
      const { nodes } = await canvasNodes(projectId);
      expect(nodes).toHaveLength(0);
    } finally { revisionRouteMode = "ok"; }
  });

  it("retired legacy cards stay read-only and quotable in the real browser", async () => {
    if (!process.env.IKDLQL_BROWSER) return;
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const projectId = await createProject("IKDLQL browser");
      const seeded = await (await fetch(`${base}/api/canvases/${projectId}`, {
        method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' },
        body: JSON.stringify({
          nodes: JSON.stringify([
            legacyCardNode("card-good", { shotTitle: "好镜头", visual: "好卡的画面描述", prompt: "好卡提示词正文" }),
            legacyCardNode("card-bad", { shotTitle: "坏卡", visual: "只有画面的坏卡" }, { x: 420, y: 100 }),
          ]),
          viewport: "{}",
        }),
      })).json();
      expect(seeded.code).toBe(200);

      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);

      await page.getByText("好卡提示词正文").waitFor();
      await page.getByText("只有画面的坏卡").waitFor();
      expect(await page.getByText("提示词", { exact: true }).count()).toBe(0);

      await page.getByRole("button", { name: "迁移历史" }).click();
      const historyModal = page.locator('[data-semantic="container"]');
      await historyModal.getByText("好卡的画面描述").waitFor();
      await historyModal.getByText("好卡提示词正文").waitFor();
      await page.keyboard.press("Escape");

      expect(await page.getByRole("button", { name: "引用到 dock" }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "给 Agent" }).count()).toBe(0);
      await page.getByText("只有画面的坏卡").dblclick();
      expect(await page.locator("textarea:visible").count()).toBe(0);

      activeRevisionId = SOURCE.revisionId;
      const badCard = page.locator(".react-flow__node").filter({ hasText: "只有画面的坏卡" }).first();
      await badCard.hover();
      await badCard.getByRole("button", { name: "添加到对话" }).click();

      await page.getByRole("button", { name: "手动应用", exact: true }).waitFor();
      activeRevisionId = "revision-newer";
      await page.getByRole("button", { name: "手动应用", exact: true }).click();
      const appliedNode = page.locator(".react-flow__node-textNode").filter({ hasText: HISTORICAL_PROMPT });
      await appliedNode.waitFor();
      const editor = appliedNode.locator('[data-placeholder="输入内容..."]');
      expect(await editor.innerText()).toBe(HISTORICAL_PROMPT);

      await editor.dblclick();
      const editSaved = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await editor.fill("退役后的独立编辑\n第二行");
      await page.locator(".react-flow__pane").click({ position: { x: 900, y: 700 } });
      expect((await editSaved).status()).toBe(200);
      await page.reload();
      await page.locator(".react-flow__node-textNode").getByText("退役后的独立编辑").waitFor();
      await page.getByText("只有画面的坏卡").waitFor();
      await page.getByRole("button", { name: "迁移历史" }).waitFor();
    } finally {
      activeRevisionId = "revision-newer";
      await browser.close();
      await vite.close();
    }
  }, 120_000);
});
