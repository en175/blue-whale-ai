import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentV1ProxyController } from "./agent-v1-proxy.controller.js";


const CONNECT_TIMEOUT_MS = 120;
const LATE_EVENT_DELAY_MS = 400;

function listen(server: Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server | undefined): Promise<void> {
  return new Promise(resolve => (server ? server.close(() => resolve()) : resolve()));
}

function createFakeAgent() {
  return createServer((req, res) => {
    if (req.url?.endsWith("/events")) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.write("id: c1\nevent: run.queued\ndata: {}\n\n");
      setTimeout(() => {
        res.write("id: c2\nevent: run.completed\ndata: {}\n\n");
        res.end();
      }, LATE_EVENT_DELAY_MS);
      return;
    }
    if (req.url?.endsWith("/never")) return;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
}

function createBff(
  options: {
    findOwnedById?: (projectId: string, userId: string) => Promise<unknown>;
    userId?: string;
  } = {},
) {
  const controller = new AgentV1ProxyController({
    findOwnedById: options.findOwnedById ?? (async () => ({ id: "p1" })),
  } as never);
  const userId = options.userId ?? "u1";
  return createServer((req, res) => {
    const shim = res as typeof res & {
      status(code: number): typeof shim;
      set(name: string, value: string): typeof shim;
      json(body: unknown): void;
    };
    shim.status = code => {
      shim.statusCode = code;
      return shim;
    };
    shim.set = (name, value) => {
      shim.setHeader(name, value);
      return shim;
    };
    shim.json = body => {
      shim.setHeader("content-type", "application/json");
      shim.end(JSON.stringify(body));
    };
    Object.assign(req, { originalUrl: req.url, body: undefined });
    void controller.proxy(req as never, shim as never, { userId } as never);
  });
}

describe("AgentV1ProxyController 上游超时语义（IKA2V3）", () => {
  let agent: Server | undefined;
  let bff: Server | undefined;
  let bffPort = 0;

  beforeEach(async () => {
    agent = createFakeAgent();
    const agentPort = await listen(agent);
    process.env.AGENT_SERVICE_BASE_URL = `http://127.0.0.1:${agentPort}`;
    process.env.AGENT_UPSTREAM_CONNECT_TIMEOUT_MS = String(CONNECT_TIMEOUT_MS);
    process.env.AGENT_UPSTREAM_BODY_TIMEOUT_MS = String(CONNECT_TIMEOUT_MS);
    bff = createBff();
    bffPort = await listen(bff);
  });

  afterEach(async () => {
    await close(bff);
    await close(agent);
    delete process.env.AGENT_SERVICE_BASE_URL;
    delete process.env.AGENT_UPSTREAM_CONNECT_TIMEOUT_MS;
    delete process.env.AGENT_UPSTREAM_BODY_TIMEOUT_MS;
  });

  it("事件流不受建连/响应体超时约束：超时窗口之后产生的事件仍被投递", async () => {
    const response = await fetch(
      `http://127.0.0.1:${bffPort}/api/agent/v1/projects/p1/sessions/s1/events`,
      { headers: { accept: "text/event-stream" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const body = await response.text();
    expect(body).toContain("run.completed");
    expect(body).toContain("run.queued");
  });

  it("一次性请求仍受超时约束：上游不返回响应头 → 502", async () => {
    const response = await fetch(`http://127.0.0.1:${bffPort}/api/agent/v1/projects/p1/never`);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 502 });
  });

  it("一次性请求正常返回时原样透传", async () => {
    const response = await fetch(`http://127.0.0.1:${bffPort}/api/agent/v1/projects/p1/sessions`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe("AgentV1ProxyController 归属防线（IKCGF1 ②c）", () => {
  let agent: Server | undefined;
  let agentPort = 0;
  let seen: { url?: string; headers?: Record<string, unknown> }[] = [];
  let bff: Server | undefined;
  let bffPort = 0;

  beforeEach(async () => {
    seen = [];
    agent = createServer((req, res) => {
      seen.push({ url: req.url, headers: req.headers });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    agentPort = await listen(agent);
    process.env.AGENT_SERVICE_BASE_URL = `http://127.0.0.1:${agentPort}`;
  });

  afterEach(async () => {
    await close(bff);
    await close(agent);
    delete process.env.AGENT_SERVICE_BASE_URL;
  });

  async function start(options: Parameters<typeof createBff>[0]) {
    bff = createBff(options);
    bffPort = await listen(bff);
  }

  it("不是项目主人就 403，且一个字节都不打给 agent——打了就可能计费", async () => {
    await start({ findOwnedById: async () => null, userId: "u-outsider" });

    const response = await fetch(`http://127.0.0.1:${bffPort}/api/agent/v1/projects/p-someone-else/sessions`);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 403 });
    expect(seen).toHaveLength(0);
  });

  it("归属按「URL 里的项目号 + 会话里的用户」判，不看调用方说了什么", async () => {
    const calls: Array<[string, string]> = [];
    await start({
      findOwnedById: async (projectId, userId) => {
        calls.push([projectId, userId]);
        return { id: projectId };
      },
      userId: "u-real",
    });

    await fetch(`http://127.0.0.1:${bffPort}/api/agent/v1/projects/p-42/sessions`, {
      headers: {
        "x-blue-whale-project-id": "p-999",
        "x-blue-whale-user-id": "u-999",
      },
    });

    expect(calls).toEqual([["p-42", "u-real"]]);
  });

  it("透给 agent 的项目号与用户号由本层覆写，浏览器凭证不外泄", async () => {
    await start({ userId: "u-real" });

    await fetch(`http://127.0.0.1:${bffPort}/api/agent/v1/projects/p-42/sessions`, {
      headers: {
        authorization: "Bearer users-own-browser-token",
        "x-blue-whale-project-id": "p-999",
        "x-blue-whale-user-id": "u-999",
      },
    });

    expect(seen).toHaveLength(1);
    const headers = seen[0]!.headers as Record<string, string>;
    expect(headers["x-blue-whale-project-id"]).toBe("p-42");
    expect(headers["x-blue-whale-user-id"]).toBe("u-real");
    expect(headers.authorization).not.toContain("users-own-browser-token");
  });
});

function createHeaderEchoAgent() {
  return createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ headers: req.headers }));
  });
}

describe("AgentV1ProxyController 链路标识透传（IKB29O）", () => {
  let agent: Server | undefined;
  let bff: Server | undefined;
  let bffPort = 0;

  beforeEach(async () => {
    agent = createHeaderEchoAgent();
    const agentPort = await listen(agent);
    process.env.AGENT_SERVICE_BASE_URL = `http://127.0.0.1:${agentPort}`;
    bff = createBff();
    bffPort = await listen(bff);
  });

  afterEach(async () => {
    await close(bff);
    await close(agent);
    delete process.env.AGENT_SERVICE_BASE_URL;
  });

  async function upstreamHeaders(init?: RequestInit) {
    const response = await fetch(`http://127.0.0.1:${bffPort}/api/agent/v1/projects/p1/sessions`, init);
    const body = (await response.json()) as { headers: Record<string, string> };
    return body.headers;
  }

  it("总是带着 x-trace-id 去 agent——此前一个字节都不发，agent 只能自己另起一个", async () => {
    const headers = await upstreamHeaders();
    expect(headers["x-trace-id"]).toBeTruthy();
  });

  it("客户端自己带了 id 就沿用，不覆盖", async () => {
    const headers = await upstreamHeaders({ headers: { "x-trace-id": "from-client-1" } });
    expect(headers["x-trace-id"]).toBe("from-client-1");
  });

  it("仍然带着受信身份三件套", async () => {
    const headers = await upstreamHeaders();
    expect(headers["x-blue-whale-user-id"]).toBe("u1");
    expect(headers["x-blue-whale-project-id"]).toBe("p1");
    expect(headers["x-blue-whale-tenant-id"]).toBeTruthy();
  });
});
