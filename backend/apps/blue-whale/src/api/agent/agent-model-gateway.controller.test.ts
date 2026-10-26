import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AGENT_TOKEN = "agent-service-token-for-test";
const UPSTREAM_KEY = "sk-unified-upstream-key";

function listen(server: Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server | undefined): Promise<void> {
  return new Promise(resolve => (server ? server.close(() => resolve()) : resolve()));
}

function createFakeNewApi(seen: IncomingHttpHeaders[]) {
  return createServer((req, res) => {
    seen.push(req.headers);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
}

function settingsStub(key: string | null) {
  return {
    requireUpstreamKey: async () => {
      if (key === null) throw new Error("上游凭证未配置");
      return key;
    },
  };
}

type Captured = { status: number; body: unknown };

function createGateway(controller: { proxy: (...args: never[]) => Promise<void> }) {
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
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = { model: "test-model" };
      try {
        if (raw) body = JSON.parse(raw);
      } catch {
      }
      Object.assign(req, { originalUrl: req.url, body });
      void controller.proxy(
        req as never,
        shim as never,
        req.headers["x-agent-service-token"] as never,
      );
    });
  });
}

async function post(
  port: number,
  headers: Record<string, string>,
  body: string = JSON.stringify({ model: "test-model" }),
): Promise<Captured> {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/internal/agent-model/v1/chat/completions`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    },
  );
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe("AgentModelGatewayController 统一上游凭证", () => {
  let upstream: Server | undefined;
  let gateway: Server | undefined;
  let seen: IncomingHttpHeaders[];
  let port: number;

  async function boot(key: string | null): Promise<void> {
    await close(gateway);
    await close(upstream);
    gateway = undefined;
    upstream = undefined;
    seen = [];
    upstream = createFakeNewApi(seen);
    const upstreamPort = await listen(upstream);

    process.env.AGENT_SERVICE_TOKEN = AGENT_TOKEN;
    process.env.NEW_API_BASE_URL = `http://127.0.0.1:${upstreamPort}`;

    vi.resetModules();
    const module = await import("./agent-model-gateway.controller.js");
    const controller = new module.AgentModelGatewayController(settingsStub(key) as never);
    gateway = createGateway(controller as never);
    port = await listen(gateway);
  }

  beforeEach(async () => {
    await boot(UPSTREAM_KEY);
  });

  afterEach(async () => {
    await close(gateway);
    await close(upstream);
    gateway = undefined;
    upstream = undefined;
    delete process.env.AGENT_SERVICE_TOKEN;
    delete process.env.NEW_API_BASE_URL;
  });

  it("服务凭证不对时不打上游", async () => {
    const result = await post(port, { "x-agent-service-token": "wrong" });
    expect(result.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("正常路径换成统一上游 key，不再发送计费主体头", async () => {
    const result = await post(port, {
      "x-agent-service-token": AGENT_TOKEN,
      "x-blue-whale-project-id": "214",
      "x-blue-whale-run-id": "run_abc",
    });
    expect(result.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(seen[0]!["x-bw-subject-user-id"]).toBeUndefined();
    expect(seen[0]!["x-bw-agent-run-id"]).toBe("run_abc");
    expect(seen[0]!["x-agent-service-token"]).toBeUndefined();
  });

  it("没有项目号也照常转发——项目号不再参与鉴权或计费", async () => {
    const result = await post(port, { "x-agent-service-token": AGENT_TOKEN });
    expect(result.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!["x-bw-subject-user-id"]).toBeUndefined();
  });

  it("Agent 伪造的计费主体头和 Authorization 都在网关被丢弃", async () => {
    const result = await post(port, {
      "x-agent-service-token": AGENT_TOKEN,
      "x-blue-whale-project-id": "214",
      "x-bw-subject-user-id": "1",
      "x-bw-agent-run-id": "run_forged",
      authorization: "Bearer sk-someone-elses-key",
    });
    expect(result.status).toBe(200);
    expect(seen[0]!["x-bw-subject-user-id"]).toBeUndefined();
    expect(seen[0]!.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(seen[0]!["x-bw-agent-run-id"]).toBeUndefined();
  });

  it("统一凭证不可用时返回 503，且不打上游", async () => {
    await boot(null);
    const result = await post(port, {
      "x-agent-service-token": AGENT_TOKEN,
      "x-blue-whale-project-id": "214",
    });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ data: { reason: "upstream_credential_missing" } });
    expect(seen).toHaveLength(0);
  });

  it.each([
    ["带空格", JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "你好" }] }, null, 1)],
    ["中文转义", JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "你好" }] }).replace("你好", "\\u4f60\\u597d")],
  ])("请求体不是最紧凑的写法（%s）也照常转给上游", async (_name, body) => {
    const result = await post(
      port,
      { "x-agent-service-token": AGENT_TOKEN, "x-blue-whale-project-id": "214" },
      body,
    );
    expect(result.status).toBe(200);
    expect(seen).toHaveLength(1);
  });
});

describe("AgentModelGatewayController 上游空闲超时", () => {
  const AGENT_TOKEN_2 = "agent-service-token-for-test";
  const IDLE_MS = 300;
  let upstream: Server | undefined;
  let gateway: Server | undefined;
  let port: number;

  async function boot(handler: Parameters<typeof createServer>[0]): Promise<void> {
    upstream = createServer(handler);
    const upstreamPort = await listen(upstream);
    process.env.AGENT_SERVICE_TOKEN = AGENT_TOKEN_2;
    process.env.NEW_API_BASE_URL = `http://127.0.0.1:${upstreamPort}`;
    process.env.AGENT_MODEL_IDLE_TIMEOUT_MS = String(IDLE_MS);
    vi.resetModules();
    const module = await import("./agent-model-gateway.controller.js");
    const controller = new module.AgentModelGatewayController(settingsStub(UPSTREAM_KEY) as never);
    gateway = createGateway(controller as never);
    port = await listen(gateway);
  }

  afterEach(async () => {
    await close(gateway);
    await close(upstream);
    gateway = undefined;
    upstream = undefined;
    delete process.env.AGENT_SERVICE_TOKEN;
    delete process.env.NEW_API_BASE_URL;
    delete process.env.AGENT_MODEL_IDLE_TIMEOUT_MS;
  });

  it("上游一个字节都不吐，在空闲窗口内断开并说明原因", async () => {
    await boot(() => {
    });

    const started = Date.now();
    const result = await post(port, {
      "x-agent-service-token": AGENT_TOKEN_2,
      "x-blue-whale-project-id": "214",
    });

    expect(result.status).toBe(502);
    expect((result.body as { msg?: string })?.msg).toContain("没有任何响应");
    expect(Date.now() - started).toBeLessThan(IDLE_MS * 10);
  });

  it("持续吐字节的慢调用不被误杀——总时长早已超过空闲窗口", async () => {
    await boot((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      let sent = 0;
      const timer = setInterval(() => {
        res.write(`data: {"n":${sent}}\n\n`);
        if (++sent >= 9) {
          clearInterval(timer);
          res.end("data: [DONE]\n\n");
        }
      }, 100);
    });

    const started = Date.now();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/internal/agent-model/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-service-token": AGENT_TOKEN_2,
          "x-blue-whale-project-id": "214",
        },
        body: JSON.stringify({ model: "test-model", stream: true }),
      },
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThan(IDLE_MS);
    expect(text).toContain('data: {"n":8}');
    expect(text).toContain("[DONE]");
  });

  it("吐了一半就不说话了，照样断得掉", async () => {
    await boot((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"n":0}\n\n');
    });

    const started = Date.now();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/internal/agent-model/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-service-token": AGENT_TOKEN_2,
          "x-blue-whale-project-id": "214",
        },
        body: JSON.stringify({ model: "test-model", stream: true }),
      },
    );
    await expect(response.text()).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(IDLE_MS * 10);
  });
});
