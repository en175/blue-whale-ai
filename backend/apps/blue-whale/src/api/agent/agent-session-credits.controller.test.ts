import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSessionCreditsController } from "./agent-session-credits.controller.js";


type AgentBehaviour =
  | { kind: "runs"; items: unknown[] }
  | { kind: "status"; status: number }
  | { kind: "not-json" };

function listen(server: Server): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function close(server: Server | undefined): Promise<void> {
  return new Promise(resolve => (server ? server.close(() => resolve()) : resolve()));
}

function createFakeAgent(behaviour: () => AgentBehaviour) {
  return createServer((_req, res) => {
    const next = behaviour();
    if (next.kind === "status") {
      res.writeHead(next.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "nope" }));
      return;
    }
    if (next.kind === "not-json") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>502 Bad Gateway</body></html>");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: next.items }));
  });
}

interface SumCall {
  token: string;
  agentRunIds: readonly string[];
  window?: { startTimestamp?: number; endTimestamp?: number; maxPages?: number; budgetMs?: number };
}

function createAccount(result: { quota: number; matched: number; truncated: boolean }) {
  const calls: SumCall[] = [];
  return {
    calls,
    service: {
      sumAgentRunQuota(
        token: string,
        agentRunIds: readonly string[],
        window?: SumCall["window"],
      ) {
        calls.push({ token, agentRunIds, window });
        return Promise.resolve(result);
      },
    },
  };
}

function createProject(owned: boolean) {
  return { findOwnedById: async () => (owned ? { id: "p1" } : null) };
}

const USER = { userId: "42" } as never;

const UPSTREAM_KEY = "sk-upstream-key";
const SETTINGS = { requireUpstreamKey: async () => UPSTREAM_KEY } as never;
const SETTINGS_UNCONFIGURED = {
  requireUpstreamKey: async () => {
    throw new Error("上游凭证未配置");
  },
} as never;

function dataOf(envelope: unknown): Record<string, unknown> {
  return (envelope as { data: Record<string, unknown> }).data;
}

describe("AgentSessionCreditsController", () => {
  let server: Server | undefined;
  let behaviour: AgentBehaviour = { kind: "runs", items: [] };
  let previousBaseUrl: string | undefined;

  beforeEach(async () => {
    behaviour = { kind: "runs", items: [] };
    server = createFakeAgent(() => behaviour);
    const port = await listen(server);
    previousBaseUrl = process.env.AGENT_SERVICE_BASE_URL;
    process.env.AGENT_SERVICE_BASE_URL = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await close(server);
    server = undefined;
    if (previousBaseUrl === undefined) delete process.env.AGENT_SERVICE_BASE_URL;
    else process.env.AGENT_SERVICE_BASE_URL = previousBaseUrl;
  });

  describe("入口校验", () => {
    it("上游凭证未配置 → 当场抛（不拿空串去打扰上游）", async () => {
      behaviour = { kind: "runs", items: [{ run_id: "r1", created_at: "2026-08-23T07:00:00Z" }] };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS_UNCONFIGURED,
      );

      await expect(controller.sessionCredits("s1", "p1", USER)).rejects.toThrow(
        "上游凭证未配置",
      );
      expect(account.calls).toEqual([]);
    });

    it("缺 project_id 就 400", async () => {
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      await expect(controller.sessionCredits("s1", "", USER)).rejects.toMatchObject({
        status: 400,
        code: "invalid_request",
      });
    });

    it("项目不属于调用者就 403——账是按项目归属拦的，不是按会话 id 猜的", async () => {
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(false) as never,
        account.service as never,
        SETTINGS,
      );

      await expect(controller.sessionCredits("s1", "p1", USER)).rejects.toMatchObject({
        status: 403,
        code: "forbidden",
      });
      expect(account.calls).toEqual([]);
    });
  });

  describe("上游故障如实上报", () => {
    it("agent 说会话不存在，就原样是 404 session_not_found", async () => {
      behaviour = { kind: "status", status: 404 };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      await expect(controller.sessionCredits("s1", "p1", USER)).rejects.toMatchObject({
        status: 404,
        code: "session_not_found",
      });
    });

    it("agent 其他非 2xx 收敛成 502 agent_error", async () => {
      behaviour = { kind: "status", status: 500 };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      await expect(controller.sessionCredits("s1", "p1", USER)).rejects.toMatchObject({
        status: 502,
        code: "agent_error",
      });
    });

    it("agent 返回 200 但不是 JSON，同样是 502 而不是不透明的 500", async () => {
      behaviour = { kind: "not-json" };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      await expect(controller.sessionCredits("s1", "p1", USER)).rejects.toMatchObject({
        status: 502,
        code: "agent_error",
      });
    });
  });

  describe("一个 Run 号都读不到时", () => {
    it("有 Run 却一个 Run 号都读不到 → credits 是 null，不是 0", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: null, created_at: "2026-08-23T07:00:00Z" },
          { run_id: null, created_at: "2026-08-23T07:01:00Z" },
        ],
      };
      const account = createAccount({ quota: 999_999, matched: 7, truncated: true });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER));
      expect(data).toEqual({
        credits: null,
        quota: null,
        matched: 0,
        runCount: 2,
        truncated: false,
      });
      expect(account.calls).toEqual([]);
    });

    it("agent 返回的 Run 行整批缺号时，整个会话都是 null 而不是 0", async () => {
      behaviour = {
        kind: "runs",
        items: Array.from({ length: 5 }, () => ({
          created_at: "2026-08-23T07:00:00Z",
        })),
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER));
      expect(data).toMatchObject({ credits: null, quota: null, runCount: 5 });
    });

    it("一条 Run 都没有时才是真的 0——那时候确实什么都没发生", async () => {
      behaviour = { kind: "runs", items: [] };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER));
      expect(data).toMatchObject({ credits: 0, quota: 0, matched: 0, runCount: 0 });
    });
  });

  describe("有 Run 号时", () => {
    it("按 Run 号求和，项目统一 key 转给上游，并按 50000 换算成积分", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", created_at: "2026-08-23T07:00:00Z", finished_at: "2026-08-23T07:00:30Z" },
          { run_id: "r2", created_at: "2026-08-23T07:01:00Z", finished_at: "2026-08-23T07:01:20Z" },
        ],
      };
      const account = createAccount({ quota: 125_000, matched: 2, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER));
      expect(data).toMatchObject({ quota: 125_000, matched: 2, runCount: 2, credits: 2.5 });
      expect(account.calls).toHaveLength(1);
      expect(account.calls[0]?.token).toBe(UPSTREAM_KEY);
      expect(account.calls[0]?.agentRunIds).toEqual(["r1", "r2"]);
    });

    it("空串 Run 号不算 Run 号", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "", created_at: "2026-08-23T07:00:00Z" },
          { run_id: "r2", created_at: "2026-08-23T07:01:00Z" },
        ],
      };
      const account = createAccount({ quota: 50_000, matched: 1, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      await controller.sessionCredits("s1", "p1", USER);
      expect(account.calls[0]?.agentRunIds).toEqual(["r2"]);
    });

    it("只有一部分 Run 读到号时标 truncated——求和必然偏小，不能说成确切花费", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", created_at: "2026-08-23T07:00:00Z", finished_at: "2026-08-23T07:00:30Z" },
          { run_id: null, created_at: "2026-08-23T07:01:00Z", finished_at: "2026-08-23T07:01:20Z" },
        ],
      };
      const account = createAccount({ quota: 50_000, matched: 1, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER));
      expect(data).toMatchObject({ credits: 1, matched: 1, runCount: 2, truncated: true });
    });

    it("有 Run 号却一条账单都没匹配上 → 同样是 null，不是一个带背书的 0", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", created_at: "2026-08-23T07:00:00Z", finished_at: "2026-08-23T07:00:30Z" },
          { run_id: "r2", created_at: "2026-08-23T07:01:00Z", finished_at: "2026-08-23T07:01:30Z" },
        ],
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER));
      expect(data).toMatchObject({ credits: null, quota: null, matched: 0, runCount: 2, truncated: true });
    });

    it("免费模型留下的 quota=0 账单不算「查不到」——matched 是 1，就是确切的 0", async () => {
      behaviour = {
        kind: "runs",
        items: [{ run_id: "r1", created_at: "2026-08-23T07:00:00Z", finished_at: "2026-08-23T07:00:30Z" }],
      };
      const account = createAccount({ quota: 0, matched: 1, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER));
      expect(data).toMatchObject({ credits: 0, quota: 0, matched: 1, truncated: false });
    });

    it("truncated 原样透传——翻页到顶时 credits 是下界，不能说成确切花费", async () => {
      behaviour = {
        kind: "runs",
        items: [{ run_id: "r1", created_at: "2026-08-23T07:00:00Z", finished_at: "2026-08-23T07:00:30Z" }],
      };
      const account = createAccount({ quota: 50_000, matched: 1, truncated: true });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER));
      expect(data).toMatchObject({ truncated: true, credits: 1 });
    });
  });

  describe("时间窗推导", () => {
    const RUN_START = "2026-08-23T07:00:00Z";
    const RUN_END = "2026-08-23T07:00:30Z";
    const startSeconds = Math.floor(Date.parse(RUN_START) / 1000);
    const endSeconds = Math.floor(Date.parse(RUN_END) / 1000);
    const SLACK = 300;

    it("全部 Run 都结束了才设上界，两端各放宽 300 秒", async () => {
      behaviour = {
        kind: "runs",
        items: [{ run_id: "r1", created_at: RUN_START, finished_at: RUN_END }],
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      await controller.sessionCredits("s1", "p1", USER);
      expect(account.calls[0]?.window).toEqual({
        maxPages: 10,
        budgetMs: 15_000,
        startTimestamp: startSeconds - SLACK,
        endTimestamp: endSeconds + SLACK,
      });
    });

    it("只要还有一条 Run 没结束，就不设上界", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", created_at: RUN_START, finished_at: RUN_END },
          { run_id: "r2", created_at: RUN_START },
        ],
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      await controller.sessionCredits("s1", "p1", USER);
      expect(account.calls[0]?.window).toEqual({
        maxPages: 10,
        budgetMs: 15_000,
        startTimestamp: startSeconds - SLACK,
      });
      expect(account.calls[0]?.window).not.toHaveProperty("endTimestamp");
    });

    it("起点取所有 Run 里最早的那个", async () => {
      const earlier = "2026-08-23T06:30:00Z";
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", created_at: RUN_START, finished_at: RUN_END },
          { run_id: "r2", created_at: earlier, finished_at: RUN_END },
        ],
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      await controller.sessionCredits("s1", "p1", USER);
      expect(account.calls[0]?.window?.startTimestamp).toBe(
        Math.floor(Date.parse(earlier) / 1000) - SLACK,
      );
    });

    it("时间全都解析不出来时不设窗，只留翻页上限", async () => {
      behaviour = {
        kind: "runs",
        items: [{ run_id: "r1", created_at: "不是时间" }],
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
        SETTINGS,
      );

      await controller.sessionCredits("s1", "p1", USER);
      expect(account.calls[0]?.window).toEqual({ maxPages: 10, budgetMs: 15_000 });
    });
  });
});
