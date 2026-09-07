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

// Public HTTP seam, real production Canvas/Project services and disposable MySQL.
// Authentication middleware supplies the already-authenticated identity; no Canvas API mocks.
describe.skipIf(!process.env.IKDLQJ_DATABASE_URL)("Conversation quote public API", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  let projectId = "";
  const source = { sessionId: "session-quote", revisionId: "revision-one", shotNo: 1 };
  const quotedText = "雪夜的城市\n保留换行与 <光影> & 细节。";
  const revisedPreviewText = "改写后的正文\n换行保留";
  // 浏览器/API 用例共享的 Agent 替身状态：应用与引用都以当前 active revision 为准
  let activeRevision = source.revisionId;
  let lastRunId = "";
  const revisionShots: Record<string, unknown[]> = {
    "revision-one": [{ shot_no: 1, title: "雪夜", prompt_text: quotedText, frame_description: "不应应用此画面描述" }],
    "revision-two": [{ shot_no: 1, title: "雪夜", prompt_text: revisedPreviewText, frame_description: "不应应用此画面描述" }],
  };
  const recordedMessages: Array<Record<string, unknown>> = [
    { message_id: "user-1", sequence: 1, role: "user", content: [{ type: "text", text: "请整理 Prompt" }] },
    { message_id: "assistant-1", sequence: 2, role: "assistant", content: [{ type: "text", text: "已整理，请预览。" }] },
  ];
  /** POST /messages 收到的请求体（字节级证据：引用正文随消息上线） */
  const messageBodies: Array<Record<string, unknown>> = [];
  let rejectNextMessage = false;
  let rejectMessage: (() => void) | null = null;
  const sseResponses = new Set<import("node:http").ServerResponse>();
  const agentRequests: Array<{ path: string; user: unknown; project: unknown }> = [];
  const agent = createServer((req, res) => {
    agentRequests.push({ path: req.url ?? "", user: req.headers["x-blue-whale-user-id"], project: req.headers["x-blue-whale-project-id"] });
    res.setHeader("content-type", "application/json");
    const session = { session_id: source.sessionId, title: "引用对话", phase: "idle", lifecycle: "active" };
    if (req.url?.includes("/events")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": connected\n\n");
      sseResponses.add(res);
      req.on("close", () => sseResponses.delete(res));
      return;
    }
    if (req.method === "POST" && req.url?.includes("/messages")) {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw) as { content: unknown[] };
        messageBodies.push(body);
        if (rejectNextMessage) {
          rejectNextMessage = false;
          rejectMessage = () => { res.writeHead(503); res.end(JSON.stringify({ message: "integration rejection" })); };
          return;
        }
        const seq = recordedMessages.length + 1;
        lastRunId = `run-${seq}`;
        activeRevision = "revision-two";
        const userMessage = { message_id: `user-${seq}`, sequence: seq, role: "user", content: body.content, input_batch_id: `batch-${seq}` };
        recordedMessages.push(userMessage);
        recordedMessages.push({ message_id: `assistant-${seq}`, sequence: seq + 1, role: "assistant", content: [{ type: "text", text: "已按引用改好，见新预览。" }], source_run_id: lastRunId });
        res.end(JSON.stringify({ message: userMessage, run: { run_id: lastRunId, status: "running", input_batch_id: `batch-${seq}` } }));
        // 与真实 Agent 同序：先 run.completed 终态，再发 revision_committed 加法事件
        const now = new Date().toISOString();
        const frames = [
          `event: run.completed\nid: ${seq}-a\ndata: ${JSON.stringify({ run_id: lastRunId, occurred_at: now, payload: { run: { run_id: lastRunId, status: "succeeded" } } })}\n\n`,
          `event: prompt_card.revision_committed.v1\nid: ${seq}-b\ndata: ${JSON.stringify({ run_id: lastRunId, occurred_at: now })}\n\n`,
        ];
        for (const sse of sseResponses) for (const frame of frames) sse.write(frame);
      });
      return;
    }
    if (!req.url?.endsWith("/snapshot")) { res.end(JSON.stringify({ items: [session] })); return; }
    res.end(JSON.stringify({ session, event_cursor: "0", messages: recordedMessages, prompt_cards: [{
      session_id: source.sessionId,
      ...(lastRunId ? { authoring_run_id: lastRunId } : {}),
      active_revision: { revision_id: activeRevision, payload: { shots: revisionShots[activeRevision] } },
    }] }));
  });
  const previousDatabase = process.env.DATABASE_URL;
  const previousAgent = process.env.AGENT_SERVICE_BASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDLQJ_DATABASE_URL;
    await new Promise<void>(resolve => agent.listen(0, "127.0.0.1", resolve));
    process.env.AGENT_SERVICE_BASE_URL = `http://127.0.0.1:${(agent.address() as { port: number }).port}`;
    projectId = (await projects.create("987654", "IKDLQJ integration")).id;
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
  async function createQuote(body: Record<string, unknown>, pid: string = projectId) {
    return fetch(`${base}/api/canvases/${pid}/conversation-quotes`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async function listQuotes(ids: string[], pid: string = projectId) {
    const response = await fetch(`${base}/api/canvases/${pid}/conversation-quotes?ids=${ids.join(",")}`);
    expect(response.status).toBeLessThan(300);
    return (await response.json()).data.items as Array<Record<string, unknown>>;
  }
  it("persists the quoted text with source and dedupes identical quotes including concurrent creates", async () => {
    const body = { nodeId: "text-node-1", title: "雪夜", text: quotedText, source };
    const first = await (await createQuote(body)).json();
    expect(first.data.quote).toMatchObject({ nodeId: "text-node-1", title: "雪夜", text: quotedText, source });
    expect(first.data.reused).toBe(false);
    const again = await (await createQuote(body)).json();
    expect(again.data.quote.quoteId).toBe(first.data.quote.quoteId);
    expect(again.data.reused).toBe(true);
    const concurrent = await Promise.all(Array.from({ length: 8 }, async () => (await createQuote(body)).json()));
    expect(new Set(concurrent.map(result => result.data.quote.quoteId)).size).toBe(1);
    expect(await prisma.client.conversation_quote_snapshots.count({ where: { project_id: BigInt(projectId) } })).toBe(1);
    const [found] = await listQuotes([first.data.quote.quoteId]);
    expect(found.text).toBe(quotedText);
    expect(found.source).toEqual(source);
  });
  it("rejects over-limit or empty content with zero writes", async () => {
    projectId = (await projects.create("987654", "IKDLQJ limits")).id;
    expect((await createQuote({ nodeId: "n1", title: "t", text: "字".repeat(100_001) })).status).toBe(400);
    expect((await createQuote({ nodeId: "n1", title: "题".repeat(201), text: "ok" })).status).toBe(400);
    expect((await createQuote({ nodeId: "n1", title: "t", text: "" })).status).toBe(400);
    expect((await createQuote({ nodeId: "", title: "t", text: "ok" })).status).toBe(400);
    expect((await createQuote({ nodeId: "n1", title: "t", text: "ok", extra: "forged" })).status).toBe(400);
    expect(await prisma.client.conversation_quote_snapshots.count({ where: { project_id: BigInt(projectId) } })).toBe(0);
  });
  it("keeps the frozen snapshot immutable when the same node is edited later", async () => {
    projectId = (await projects.create("987654", "IKDLQJ immutable")).id;
    const before = await (await createQuote({ nodeId: "text-node-9", title: "镜头一", text: "初稿正文" })).json();
    const after = await (await createQuote({ nodeId: "text-node-9", title: "镜头一", text: "编辑后正文\n第二行" })).json();
    expect(after.data.quote.quoteId).not.toBe(before.data.quote.quoteId);
    const items = await listQuotes([before.data.quote.quoteId, after.data.quote.quoteId]);
    expect(items.find(item => item.quoteId === before.data.quote.quoteId)?.text).toBe("初稿正文");
    expect(items.find(item => item.quoteId === after.data.quote.quoteId)?.text).toBe("编辑后正文\n第二行");
    const plain = await (await createQuote({ nodeId: "text-node-10", title: "", text: "无来源普通文本" })).json();
    expect(plain.data.quote.source).toBeNull();
  });
  it("reads quotes back after the source node is deleted from the canvas", async () => {
    projectId = (await projects.create("987654", "IKDLQJ deletion")).id;
    const saved = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify([{ id: "text-doomed", type: "textNode", position: { x: 0, y: 0 }, data: { title: "将删", text: quotedText } }]), viewport: "{}" }),
    });
    expect(saved.status).toBe(200);
    const quoted = await (await createQuote({ nodeId: "text-doomed", title: "将删", text: quotedText })).json();
    const canvas = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
    const deleted = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": `"${canvas.data.version}"` },
      body: JSON.stringify({ nodes: "[]", viewport: "{}" }),
    });
    expect(deleted.status).toBe(200);
    const [found] = await listQuotes([quoted.data.quote.quoteId]);
    expect(found.text).toBe(quotedText);
    expect(found.nodeId).toBe("text-doomed");
  });
  it("does not write into or read from another user's project", async () => {
    projectId = (await projects.create("987654", "IKDLQJ ownership mine")).id;
    const other = await projects.create("987655", "IKDLQJ ownership other");
    const deniedCreate = await (await createQuote({ nodeId: "n1", title: "t", text: "ok" }, other.id)).json();
    expect(deniedCreate.data).toBeNull();
    const mine = await (await createQuote({ nodeId: "n1", title: "t", text: "ok" })).json();
    const deniedList = await fetch(`${base}/api/canvases/${other.id}/conversation-quotes?ids=${mine.data.quote.quoteId}`);
    expect((await deniedList.json()).data).toBeNull();
  });
  it("omits unknown ids and caps the id list", async () => {
    const mine = await (await createQuote({ nodeId: "n-known", title: "t", text: "known" })).json();
    const items = await listQuotes([mine.data.quote.quoteId, "999999999"]);
    expect(items).toHaveLength(1);
    const tooMany = await fetch(`${base}/api/canvases/${projectId}/conversation-quotes?ids=${Array.from({ length: 101 }, (_, i) => i + 1).join(",")}`);
    expect(tooMany.status).toBe(400);
  });
  it("keeps existing nodes and edges untouched when the Agent's new preview is applied", async () => {
    projectId = (await projects.create("987654", "IKDLQJ apply keeps edges")).id;
    const seeded = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({
        nodes: JSON.stringify([
          { id: "text-a", type: "textNode", position: { x: 0, y: 0 }, data: { title: "方案一", text: "第一版正文" } },
          { id: "text-b", type: "textNode", position: { x: 320, y: 0 }, data: { title: "方案二", text: "第二版正文" } },
        ]),
        edges: JSON.stringify([{ id: "edge-a-b", source: "text-a", target: "text-b" }]),
        viewport: "{}",
      }),
    });
    expect(seeded.status).toBe(200);
    const applyWith = (revisionId: string) => fetch(`${base}/api/canvases/${projectId}/prompt-previews/apply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: { ...source, revisionId }, position: { x: 640, y: 0 } }),
    });
    const first = await (await applyWith("revision-one")).json();
    expect(first.data.canvas.edges).toBe(JSON.stringify([{ id: "edge-a-b", source: "text-a", target: "text-b" }]));
    expect(JSON.parse(first.data.canvas.nodes)).toHaveLength(3);
    activeRevision = "revision-two";
    try {
      const second = await (await applyWith("revision-two")).json();
      const nodes = JSON.parse(second.data.canvas.nodes);
      expect(nodes).toHaveLength(4);
      expect(second.data.node.id).not.toBe(first.data.node.id);
      expect(nodes.find((node: { id: string }) => node.id === "text-a").data.text).toBe("第一版正文");
      expect(nodes.find((node: { id: string }) => node.id === first.data.node.id).data.text).toBe(quotedText);
      expect(second.data.canvas.edges).toBe(JSON.stringify([{ id: "edge-a-b", source: "text-a", target: "text-b" }]));
    } finally { activeRevision = source.revisionId; }
  });
  it.runIf(process.env.IKDXHO_BROWSER)("browser previews, confirms and sends images in place while preserving canvas interaction and failed drafts", async () => {
    const { chromium, expect: browserExpect } = await import("playwright/test");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      projectId = (await projects.create("987654", "IKDXHO browser")).id;
      const url = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='blue'/%3E%3C/svg%3E";
      const asset = await prisma.client.assets.create({ data: { user_id: 987654n, project_id: BigInt(projectId), type: "image", url } });
      const seeded = await fetch(`${base}/api/canvases/${projectId}`, {
        method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' },
        body: JSON.stringify({ nodes: JSON.stringify([
          { id: "image-a", type: "mediaNode", position: { x: 100, y: 100 }, data: { mediaType: "image", src: url, assetId: String(asset.id), fileName: "图片 A", width: 180, height: 120 } },
          { id: "image-b", type: "mediaNode", position: { x: 400, y: 100 }, data: { mediaType: "image", src: url, assetId: String(asset.id), fileName: "图片 B", width: 180, height: 120 } },
          { id: "image-c", type: "mediaNode", position: { x: 100, y: 380 }, data: { mediaType: "image", src: url, assetId: String(asset.id), fileName: "图片 A", width: 180, height: 120 } },
          { id: "image-draft", type: "mediaNode", position: { x: 400, y: 380 }, data: { mediaType: "image", draft: true, genStatus: "draft", fileName: "图片草稿" } },
        ]), viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }),
      });
      expect(seeded.status).toBe(200);
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      await page.getByRole("button", { name: "Agent", exact: true }).click();
      const composer = page.locator('[contenteditable][aria-placeholder]');
      await page.locator('.react-flow__node[data-id="image-a"]').click();
      await browserExpect(composer.getByText("待确认引用")).toBeVisible();
      await browserExpect(composer).not.toBeFocused();
      expect(messageBodies).toHaveLength(0);
      await page.locator('.react-flow__node[data-id="image-b"]').click();
      await browserExpect(composer.getByLabel('待确认引用：图片 B', { exact: true })).toBeVisible();
      await browserExpect(composer.getByLabel('待确认引用：图片 A', { exact: true })).toHaveCount(0);
      const send = page.locator('button[title="发送"]');
      await browserExpect(send).toBeEnabled();
      await send.click();
      await browserExpect(page.getByRole('alert').filter({ hasText: '请先确认或取消待确认引用' })).toBeVisible();
      expect(messageBodies).toHaveLength(0);
      // 程序聚焦不是确认；Enter 也必须走同一发送阻断。
      await composer.focus();
      await page.keyboard.press('Enter');
      await browserExpect(composer.getByText('待确认引用')).toBeVisible();
      expect(messageBodies).toHaveLength(0);
      await page.keyboard.press('Escape');
      await browserExpect(composer.getByText('待确认引用')).toHaveCount(0);
      await page.locator('.react-flow__node[data-id="image-a"]').click();
      await browserExpect(composer.getByText('待确认引用')).toBeVisible();
      await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
      await browserExpect(composer.getByText('待确认引用')).toHaveCount(0);
      await composer.fill('第一段\n前文后文');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.locator('.react-flow__node[data-id="image-a"]').click();
      await browserExpect(composer.getByText('待确认引用')).toBeVisible();
      // 真实点击第一段开头：引用留在第二段原光标处，新文字写在点击位置。
      await page.waitForTimeout(1100); // 跨过 Lexical 历史合并窗口，独立验证确认与文字编辑的撤销。
      const start = await composer.evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let text: Node | null;
        while ((text = walker.nextNode())) {
          if (text.textContent?.startsWith('第一段')) {
            const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1);
            const rect = range.getBoundingClientRect(); return { x: rect.x + 1, y: rect.y + rect.height / 2 };
          }
        }
        throw new Error('第一段不可见');
      });
      await page.mouse.click(start.x, start.y);
      await page.waitForTimeout(1100);
      await page.keyboard.type('起');
      await browserExpect(composer.getByText('待确认引用')).toHaveCount(0);
      await browserExpect(composer).toHaveText('起第一段\n前文图片 A后文');
      await page.keyboard.press('ControlOrMeta+z');
      await browserExpect(composer).toHaveText('第一段\n前文图片 A后文');
      await page.keyboard.press('ControlOrMeta+z');
      await browserExpect(composer.getByText('待确认引用')).toHaveCount(0);
      await browserExpect(composer.getByRole('button', { name: '移除 图片 A' })).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await browserExpect(composer).toHaveText('起第一段\n前文图片 A后文');
      await page.locator('.react-flow__node[data-id="image-a"]').click();
      await browserExpect(composer.getByText('待确认引用')).toHaveCount(0);
      await browserExpect(composer.getByRole('button', { name: '移除 图片 A' })).toHaveCount(1);
      // 同名不同节点可以确认；删除标签后允许重选，取消后不得残留发送附件。
      await page.locator('.react-flow__node[data-id="image-c"]').click();
      await composer.click({ position: { x: 350, y: 10 } });
      await browserExpect(composer.getByRole('button', { name: '移除 图片 A' })).toHaveCount(2);
      await composer.getByRole('button', { name: '移除 图片 A' }).first().click();
      await page.locator('.react-flow__node[data-id="image-c"]').click();
      await browserExpect(composer.getByText('待确认引用')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.locator('.react-flow__node[data-id="image-draft"]').click();
      await browserExpect(composer.getByText('待确认引用')).toHaveCount(0);
      await browserExpect(page.getByText('图片草稿').first()).toBeVisible();
      await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
      rejectNextMessage = true;
      const rejected = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/messages'));
      await send.click();
      await browserExpect.poll(() => rejectMessage !== null).toBe(true);
      try {
        await browserExpect(composer).toHaveText('起第一段\n前文图片 A后文');
      } finally { rejectMessage?.(); rejectMessage = null; await rejected; }
      await browserExpect(page.getByText(/消息发送失败/).first()).toBeVisible();
      await browserExpect(composer).toHaveText('起第一段\n前文图片 A后文');
      const sent = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/messages'));
      await send.click();
      await sent;
      expect(messageBodies).toHaveLength(2);
      expect(messageBodies[1].content).toMatchObject([
        { type: 'text', text: '起第一段\n前文' },
        { type: 'asset_ref', asset_id: String(asset.id), node_id: 'image-a' },
        { type: 'text', text: '后文' },
      ]);
      expect(messageBodies[0].content).toEqual(messageBodies[1].content);
      await browserExpect(composer).toHaveText('');
      await page.locator('.react-flow__node[data-id="image-a"]').click();
      await browserExpect(composer.getByText('待确认引用')).toBeVisible();
      await browserExpect(page.locator('.react-flow__node[data-id="image-a"]')).toHaveClass(/selected/);
      await browserExpect(page.getByRole('button', { name: '添加到 Agent 聊天' }).first()).toBeVisible();
      await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
      const node = page.locator('.react-flow__node[data-id="image-a"]');
      const rect = (await node.boundingBox())!;
      const moved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/api/canvases/'));
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width / 2 + 60, rect.y + rect.height / 2 + 40, { steps: 8 });
      await page.mouse.up();
      expect((await moved).status()).toBe(200);
      await browserExpect.poll(async () => {
        const saved = await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json();
        return JSON.parse(saved.data.nodes).find((item: { id: string }) => item.id === 'image-a').position.x;
      }).toBeGreaterThan(140);
      await browserExpect(composer.getByText('待确认引用')).toHaveCount(0);
      await page.screenshot({ path: '/tmp/ikdxho-browser.png', fullPage: true });
    } finally {
      rejectMessage?.(); rejectMessage = null; rejectNextMessage = false;
      await browser.close(); await vite.close();
      messageBodies.length = 0; recordedMessages.splice(2); activeRevision = source.revisionId; lastRunId = '';
    }
  }, 90_000);
  it.runIf(process.env.IKDLQJ_BROWSER)("browser quotes edited text, receives a new preview and reapplies after reload", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      projectId = (await projects.create("987654", "IKDLQJ browser")).id;
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const generationRequests: string[] = [];
      page.on('request', request => {
        if (request.method() === 'POST' && /\/(generation|jobs)\//.test(request.url())) generationRequests.push(request.url());
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      await page.getByRole("button", { name: "Agent", exact: true }).click();
      await page.getByRole("button", { name: "手动应用", exact: true }).click();
      const node = page.locator(".react-flow__node-textNode");
      const editor = node.locator('[data-placeholder="输入内容..."]');
      await editor.waitFor();
      expect(await editor.innerText()).toBe(quotedText);

      // 画布上编辑正文并落盘
      await editor.dblclick();
      const editSaved = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await editor.fill("引用前的画布编辑\n第二行");
      await page.locator(".react-flow__pane").click({ position: { x: 180, y: 700 } });
      expect((await editSaved).status()).toBe(200);
      await page.getByText(/^已保存 /).waitFor();

      // 添加到对话：点击当刻正文冻结为服务端引用快照
      const nodeId = JSON.parse((await (await fetch(`${base}/api/canvases?projectId=${projectId}`)).json()).data.nodes)[0].id;
      const quoteSaved = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/conversation-quotes"));
      await node.click();
      await node.getByRole("button", { name: "添加到对话" }).first().click();
      expect((await quoteSaved).status()).toBeLessThan(300);
      const composer = page.locator("[contenteditable][aria-placeholder]");
      await composer.getByText("雪夜").waitFor();

      // 发送：Agent 收到引用当时的实际编辑内容，不含任何媒体部件
      await composer.click();
      await page.keyboard.type("请基于它改一版");
      const messageSent = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/messages"));
      await page.locator('button[title="发送"]').click();
      await messageSent;
      expect(messageBodies).toHaveLength(1);
      const parts = messageBodies[0].content as Array<Record<string, unknown>>;
      expect(parts.find(part => part.type === 'text')?.text.trim()).toBe("请基于它改一版");
      const quotePart = parts.find(part => part.type === "resource_ref");
      expect(quotePart).toMatchObject({
        resource_type: "text_quote",
        node_id: nodeId,
        resource_text: "引用前的画布编辑\n第二行",
        prompt_source: source,
      });
      expect(parts.some(part => part.type === "asset_ref")).toBe(false);

      // Agent 修改产生新预览：手动应用为新节点，原节点不动
      await page.getByRole("button", { name: "手动应用", exact: true }).click();
      await node.nth(1).waitFor();
      expect(await node.count()).toBe(2);
      expect(await node.first().locator('[data-placeholder="输入内容..."]').innerText()).toBe("引用前的画布编辑\n第二行");
      expect(await node.nth(1).locator('[data-placeholder="输入内容..."]').innerText()).toBe(revisedPreviewText);

      // 引用后继续编辑来源：对话依据不改写
      await node.first().locator('[data-placeholder="输入内容..."]').dblclick();
      const reeditSaved = page.waitForResponse(response => response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await page.keyboard.type("——引用后又改写");
      await page.locator(".react-flow__pane").click({ position: { x: 180, y: 700 } });
      expect((await reeditSaved).status()).toBe(200);
      const quoteId = String(quotePart!.resource_id);
      const quotesAfterEdit = await (await fetch(`${base}/api/canvases/${projectId}/conversation-quotes?ids=${quoteId}`)).json();
      expect(quotesAfterEdit.data.items[0].text).toBe("引用前的画布编辑\n第二行");

      // 刷新后回读：引用胶囊仍在，正文事实完整
      await page.reload();
      await page.getByRole("button", { name: "Agent", exact: true }).click();
      const bubbleChip = page.locator("[title*='引用前的画布编辑']");
      await bubbleChip.waitFor();
      expect(await bubbleChip.textContent()).toContain("雪夜");
      expect(generationRequests).toEqual([]);
      await page.screenshot({ path: '/tmp/ikdlqj-browser.png', fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 90_000);
});
