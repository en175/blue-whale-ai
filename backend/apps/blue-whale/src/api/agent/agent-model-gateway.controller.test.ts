import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IKCGDX：计费主体不再由 Agent 自报，改由本层拿项目号查库解出。
// 这组测试钉死三件事：解不出主体就不许打上游、Agent 伪造的主体头必须死在网关、
// 上游看到的凭证是蓝鲸自己那把而不是 Agent 带来的任何东西。

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

/** 假 NewAPI：记下每次收到的请求头，回一个固定 JSON。 */
function createFakeNewApi(seen: IncomingHttpHeaders[]) {
  return createServer((req, res) => {
    seen.push(req.headers);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
}

type Captured = { status: number; body: unknown };

/** 把控制器挂进真实 HTTP 栈，补齐 express 的 status/set/json 三个便捷方法。 */
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
    Object.assign(req, { originalUrl: req.url, body: { model: "test-model" } });
    void controller.proxy(
      req as never,
      shim as never,
      req.headers["x-agent-service-token"] as never,
    );
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

    // NEW_API_BASE_URL 在模块加载时读取，必须先设好环境再导入。
    vi.resetModules();
    const module = await import("./agent-model-gateway.controller.js");
    module.resetAgentModelGatewayOwnerCache();
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
    // Agent 的服务凭证不该继续往上游走
    expect(seen[0]!["x-agent-service-token"]).toBeUndefined();
  });

  it("Agent 伪造的计费主体头和 Authorization 都在网关被丢弃", async () => {
    const result = await post(port, {
      "x-agent-service-token": AGENT_TOKEN,
      "x-blue-whale-project-id": "214",
      // 冒充别人记账 + 自带一把模型凭证，两样都必须不生效
      "x-bw-subject-user-id": "1",
      "x-bw-agent-run-id": "run_forged",
      authorization: "Bearer sk-someone-elses-key",
    });
    expect(result.status).toBe(200);
    expect(seen[0]!["x-bw-subject-user-id"]).toBe("37");
    expect(seen[0]!.authorization).toBe(`Bearer ${BILLING_TOKEN}`);
    // 没声明 run 号时不该继承伪造的那个
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

// 凭证配错的两种形态都表现为「Agent 不回话」，且都不会在任何地方变红。启动时就得叫。
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
