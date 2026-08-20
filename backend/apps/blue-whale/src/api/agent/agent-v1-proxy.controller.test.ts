import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentV1ProxyController } from "./agent-v1-proxy.controller.js";

// IKA2V3：BFF 曾用 AbortSignal.timeout 给整个 fetch（含响应体流）设 60s 上限，
// SSE 事件流因此每次活满 60s 就被自己掐断，Agent 回答必须刷新第二次才出现。
// 这里用极小的建连超时（120ms）+ 跨越该窗口才发出的事件，把回归钉死：
// 事件流不受建连超时约束，一次性请求仍然受约束。

const CONNECT_TIMEOUT_MS = 120;
/** 事件发出时刻必须明显晚于建连超时，否则测不到回归。 */
const LATE_EVENT_DELAY_MS = 400;

function listen(server: Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server | undefined): Promise<void> {
  return new Promise(resolve => (server ? server.close(() => resolve()) : resolve()));
}

/** 假 agent 服务：一条跨越建连超时窗口的事件流，外加一个永不返回响应头的路由。 */
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
    if (req.url?.endsWith("/never")) return; // 永不响应，用于验证建连超时仍生效
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
}

/**
 * 把控制器挂进真实的 Node HTTP 栈。
 *
 * express 的 res 本身就是 ServerResponse，只多出 status/set/json 三个便捷方法；
 * 这里补上这三个即可，既不依赖 express 的提升位置，又保留了真实的 socket、
 * flushHeaders 与管道行为——本工单要验证的正是这一层。
 */
function createBff() {
  const controller = new AgentV1ProxyController({
    findOwnedById: async () => ({ id: "p1" }),
  } as never);
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
    void controller.proxy(req as never, shim as never, { userId: "u1" } as never);
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
    // 这一行是回归本身：它在建连超时之后才发出，旧实现里永远收不到。
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
