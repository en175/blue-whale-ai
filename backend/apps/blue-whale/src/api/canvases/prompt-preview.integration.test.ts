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
describe.skipIf(!process.env.IKDLQE_DATABASE_URL)("Prompt preview public API", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  let projectId = "";
  const source = { sessionId: "session-preview", revisionId: "revision-one", shotNo: 1 };
  let activeRevision: string | undefined;
  const prompt = "雪夜的城市\n保留换行与 <光影> & 细节。";
  const agentRequests: Array<{ path: string; user: unknown; project: unknown }> = [];
  const agent = createServer((req, res) => {
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
      active_revision: { revision_id: activeRevision ?? source.revisionId, payload: {
        shots: [{ shot_no: 1, title: "雪夜", prompt_text: prompt, frame_description: "不应应用此画面描述" }],
      } },
    }] }));
  });
  const previousDatabase = process.env.DATABASE_URL;
  const previousAgent = process.env.AGENT_SERVICE_BASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDLQE_DATABASE_URL;
    await new Promise<void>(resolve => agent.listen(0, "127.0.0.1", resolve));
    process.env.AGENT_SERVICE_BASE_URL = `http://127.0.0.1:${(agent.address() as { port: number }).port}`;
    projectId = (await projects.create("987654", "IKDLQE integration")).id;
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
  it("recreates an applied historical revision after Agent advances and the node is deleted", async () => {
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
