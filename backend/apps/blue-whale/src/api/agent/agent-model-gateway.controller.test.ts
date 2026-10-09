import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


const AGENT_TOKEN = "agent-service-token-for-test";
const BILLING_TOKEN = "bwsvc_test_billing_credential";

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
): Promise<Captured> {
  const response = await fetch(
    `http://127.0.0.1:${port}/api/internal/agent-model/v1/chat/completions`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ model: "test-model" }),
    },
  );
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe("AgentModelGatewayController 计费归属", () => {
  let upstream: Server | undefined;
  let gateway: Server | undefined;
  let seen: IncomingHttpHeaders[];
  let lookups: string[];
  let owners: Map<string, string | null>;
  let port: number;

  beforeEach(async () => {
    seen = [];
    lookups = [];
    owners = new Map([["214", "37"]]);

    upstream = createFakeNewApi(seen);
    const upstreamPort = await listen(upstream);

    process.env.AGENT_SERVICE_TOKEN = AGENT_TOKEN;
    process.env.NEW_API_AGENT_BILLING_TOKEN = BILLING_TOKEN;
    process.env.NEW_API_BASE_URL = `http://127.0.0.1:${upstreamPort}`;

    vi.resetModules();
    const module = await import("./agent-model-gateway.controller.js");
    const controller = new module.AgentModelGatewayController({
      findOwnerId: async (id: string) => {
        lookups.push(id);
        return owners.has(id) ? owners.get(id)! : null;
      },
    } as never);

    gateway = createGateway(controller as never);
    port = await listen(gateway);
  });

  afterEach(async () => {
    await close(gateway);
    await close(upstream);
    delete process.env.AGENT_SERVICE_TOKEN;
    delete process.env.NEW_API_AGENT_BILLING_TOKEN;
    delete process.env.NEW_API_BASE_URL;
  });

  it("服务凭证不对时不打上游", async () => {
    const result = await post(port, { "x-agent-service-token": "wrong" });
    expect(result.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("不带项目号时拒绝，且不打上游", async () => {
    const result = await post(port, { "x-agent-service-token": AGENT_TOKEN });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ data: { reason: "project_context_required" } });
    expect(seen).toHaveLength(0);
  });

  it("项目解不出主人时拒绝，绝不回落到默认账户", async () => {
    const result = await post(port, {
      "x-agent-service-token": AGENT_TOKEN,
      "x-blue-whale-project-id": "999",
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ data: { reason: "attribution_unresolved" } });
    expect(seen).toHaveLength(0);
  });

  it("正常路径注入项目主人作为计费主体，并换成蓝鲸自己的凭证", async () => {
    const result = await post(port, {
      "x-agent-service-token": AGENT_TOKEN,
      "x-blue-whale-project-id": "214",
      "x-blue-whale-run-id": "run_abc",
    });
    expect(result.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!["x-bw-subject-user-id"]).toBe("37");
    expect(seen[0]!.authorization).toBe(`Bearer ${BILLING_TOKEN}`);
    expect(seen[0]!["x-bw-agent-run-id"]).toBe("run_abc");
    expect(seen[0]!["x-agent-service-token"]).toBeUndefined();
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
    expect(seen[0]!["x-bw-subject-user-id"]).toBe("37");
    expect(seen[0]!.authorization).toBe(`Bearer ${BILLING_TOKEN}`);
    expect(seen[0]!["x-bw-agent-run-id"]).toBeUndefined();
  });

  it("同一项目的连续调用只查一次库", async () => {
    const headers = {
      "x-agent-service-token": AGENT_TOKEN,
      "x-blue-whale-project-id": "214",
    };
    await post(port, headers);
    await post(port, headers);
    expect(lookups).toEqual(["214"]);
    expect(seen).toHaveLength(2);
  });
});

describe("项目→主体缓存的淘汰顺序", () => {
  it("续期过的热点项目不会因为「插入序最旧」而被淘汰", async () => {
    vi.resetModules();
    process.env.AGENT_SERVICE_TOKEN = AGENT_TOKEN;
    process.env.NEW_API_AGENT_BILLING_TOKEN = BILLING_TOKEN;
    const module = await import("./agent-model-gateway.controller.js");

    const lookups: string[] = [];
    const controller = new module.AgentModelGatewayController({
      findOwnerId: async (id: string) => {
        lookups.push(id);
        return "37";
      },
    } as never);

    const resolve = (id: string) =>
      (controller as unknown as { resolveSubject(id: string): Promise<string | null> }).resolveSubject(id);

    await resolve("hot");
    for (let i = 0; i < 2_100; i += 1) await resolve(`cold-${i}`);
    await resolve("hot");

    const hotLookups = lookups.filter(id => id === "hot").length;
    expect(hotLookups).toBe(2);

    const before = lookups.filter(id => id === "hot").length;
    for (let i = 0; i < 1_500; i += 1) await resolve(`cold2-${i}`);
    await resolve("hot");
    expect(lookups.filter(id => id === "hot").length).toBe(before);
  });
});

describe("网关凭证的启动校验", () => {
  afterEach(() => {
    vi.resetModules();
  });

  async function assertConfig(token: string | undefined): Promise<void> {
    vi.resetModules();
    if (token === undefined) delete process.env.NEW_API_AGENT_BILLING_TOKEN;
    else process.env.NEW_API_AGENT_BILLING_TOKEN = token;
    const module = await import("./agent-model-gateway.controller.js");
    module.assertAgentModelGatewayConfig();
  }

  it("没配只记日志，不拦启动——不跑 Agent 的部署仍要能起来", async () => {
    await expect(assertConfig(undefined)).resolves.toBeUndefined();
  });

  it("带 bwsvc_ 前缀的凭证通过", async () => {
    await expect(assertConfig("bwsvc_deadbeef")).resolves.toBeUndefined();
  });

  it("配了却没有 bwsvc_ 前缀就拒绝启动——NewAPI 按前缀分流，它会静默走错分支", async () => {
    await expect(assertConfig("sk-looks-like-a-real-token")).rejects.toThrow("bwsvc_");
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
    process.env.NEW_API_AGENT_BILLING_TOKEN = "bwsvc_test_billing_credential";
    process.env.NEW_API_BASE_URL = `http://127.0.0.1:${upstreamPort}`;
    process.env.AGENT_MODEL_IDLE_TIMEOUT_MS = String(IDLE_MS);
    vi.resetModules();
    const module = await import("./agent-model-gateway.controller.js");
    const controller = new module.AgentModelGatewayController({
      findOwnerId: async () => "37",
    } as never);
    gateway = createGateway(controller as never);
    port = await listen(gateway);
  }

  afterEach(async () => {
    await close(gateway);
    await close(upstream);
    gateway = undefined;
    upstream = undefined;
    delete process.env.AGENT_SERVICE_TOKEN;
    delete process.env.NEW_API_AGENT_BILLING_TOKEN;
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
