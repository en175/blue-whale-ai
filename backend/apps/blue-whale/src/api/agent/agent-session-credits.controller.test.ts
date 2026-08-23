import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSessionCreditsController } from "./agent-session-credits.controller.js";

// 审查 W·S4：这个 controller 此前没有任何测试，而它下面那层（求和 helper）的 8 条用例
// 只喂合成日志行，从不触碰 `runs → capability_id` 这条链接——积分恒为 0 的缺陷正是从
// 这个缺口溜过去的。这里补的就是那一段：归属、上游故障、时间窗推导、truncated 透传，
// 以及「一张券都没有」时到底该给调用方什么。

/** 假的 agent 服务：按路径决定返回什么，用来驱动 fetchRuns 的各条分支。 */
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
      // 代理把错误页当 200 返回，是这一层最容易被忽略的一种上游故障。
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
  capabilityIds: readonly string[];
  window?: { startTimestamp?: number; endTimestamp?: number; maxPages?: number; budgetMs?: number };
}

/** 记下求和调用，并按需给出结果——时间窗推导只能从这里观测。 */
function createAccount(result: { quota: number; matched: number; truncated: boolean }) {
  const calls: SumCall[] = [];
  return {
    calls,
    service: {
      sumRunCapabilityQuota(
        token: string,
        capabilityIds: readonly string[],
        window?: SumCall["window"],
      ) {
        calls.push({ token, capabilityIds, window });
        return Promise.resolve(result);
      },
    },
  };
}

function createProject(owned: boolean) {
  return { findOwnedById: async () => (owned ? { id: "p1" } : null) };
}

const USER = { userId: "42" } as never;
const BEARER = "Bearer sk-user-token";

/** 结果信封只有 code/data/msg 三个字段，断言直接看 data。 */
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
    it("没有 Bearer 令牌就 401，不去打扰上游", async () => {
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      await expect(controller.sessionCredits("s1", "p1", USER, undefined)).rejects.toMatchObject({
        status: 401,
        code: "unauthorized",
      });
      expect(account.calls).toEqual([]);
    });

    it("缺 project_id 就 400", async () => {
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      await expect(controller.sessionCredits("s1", "", USER, BEARER)).rejects.toMatchObject({
        status: 400,
        code: "invalid_request",
      });
    });

    it("项目不属于调用者就 403——账是按项目归属拦的，不是按会话 id 猜的", async () => {
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(false) as never,
        account.service as never,
      );

      await expect(controller.sessionCredits("s1", "p1", USER, BEARER)).rejects.toMatchObject({
        status: 403,
        code: "forbidden",
      });
      // 越权请求一条上游调用都不该产生
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
      );

      await expect(controller.sessionCredits("s1", "p1", USER, BEARER)).rejects.toMatchObject({
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
      );

      await expect(controller.sessionCredits("s1", "p1", USER, BEARER)).rejects.toMatchObject({
        status: 502,
        code: "agent_error",
      });
    });

    // 审查 W·A14：try 只罩住 fetch，response.json() 抛出去会变成不透明的 500。
    it("agent 返回 200 但不是 JSON，同样是 502 而不是不透明的 500", async () => {
      behaviour = { kind: "not-json" };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      await expect(controller.sessionCredits("s1", "p1", USER, BEARER)).rejects.toMatchObject({
        status: 502,
        code: "agent_error",
      });
    });
  });

  describe("一张券都查不到时", () => {
    // 这一条是积分恒为 0 那个缺陷的正面：本层分辨不了「没花钱」和「券号没落库」，
    // 所以它**不编一个数**——credits 给 null，由调用方决定显示什么（审查 W·P1）。
    it("有 Run 却一张券都没有 → credits 是 null，不是 0", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", capability_id: null, created_at: "2026-08-23T07:00:00Z" },
          { run_id: "r2", capability_id: null, created_at: "2026-08-23T07:01:00Z" },
        ],
      };
      const account = createAccount({ quota: 999_999, matched: 7, truncated: true });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER, BEARER));
      expect(data).toEqual({
        credits: null,
        quota: null,
        matched: 0,
        runCount: 2,
        // 「不知道」不是「下界」。truncated 有它自己的意思，不能拿来给一个空答案背书。
        truncated: false,
      });
      // 没有券号就没有可查的东西，不该去翻上游账单
      expect(account.calls).toEqual([]);
    });

    // agent 侧回写 capability_id 的那次改动没部署时，就是这个形状（审查 W·P2）。
    // 前端因此会显示「—」并退避重试，而不是一个笃定的 0。
    it("agent 版本还没带上券号回写时，整个会话都是 null 而不是 0", async () => {
      behaviour = {
        kind: "runs",
        items: Array.from({ length: 5 }, (_, i) => ({
          run_id: `r${i}`,
          created_at: "2026-08-23T07:00:00Z",
        })),
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER, BEARER));
      expect(data).toMatchObject({ credits: null, quota: null, runCount: 5 });
    });

    it("一条 Run 都没有时才是真的 0——那时候确实什么都没发生", async () => {
      behaviour = { kind: "runs", items: [] };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER, BEARER));
      expect(data).toMatchObject({ credits: 0, quota: 0, matched: 0, runCount: 0 });
    });
  });

  describe("有券号时", () => {
    it("按券号求和，用户令牌原样转给上游，并按 50000 换算成积分", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", capability_id: "cap-a", created_at: "2026-08-23T07:00:00Z", finished_at: "2026-08-23T07:00:30Z" },
          { run_id: "r2", capability_id: "cap-b", created_at: "2026-08-23T07:01:00Z", finished_at: "2026-08-23T07:01:20Z" },
        ],
      };
      const account = createAccount({ quota: 125_000, matched: 2, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER, BEARER));
      expect(data).toMatchObject({ quota: 125_000, matched: 2, runCount: 2, credits: 2.5 });
      expect(account.calls).toHaveLength(1);
      expect(account.calls[0]?.token).toBe("sk-user-token");
      expect(account.calls[0]?.capabilityIds).toEqual(["cap-a", "cap-b"]);
    });

    it("空串券号不算券号", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", capability_id: "", created_at: "2026-08-23T07:00:00Z" },
          { run_id: "r2", capability_id: "cap-b", created_at: "2026-08-23T07:01:00Z" },
        ],
      };
      const account = createAccount({ quota: 50_000, matched: 1, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      await controller.sessionCredits("s1", "p1", USER, BEARER);
      expect(account.calls[0]?.capabilityIds).toEqual(["cap-b"]);
    });

    it("只有一部分 Run 留下券号时标 truncated——求和必然偏小，不能说成确切花费", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", capability_id: "cap-a", created_at: "2026-08-23T07:00:00Z", finished_at: "2026-08-23T07:00:30Z" },
          // 老 Run，券号没落库。它花的钱查不回来，但它确实花过。
          { run_id: "r2", capability_id: null, created_at: "2026-08-23T07:01:00Z", finished_at: "2026-08-23T07:01:20Z" },
        ],
      };
      const account = createAccount({ quota: 50_000, matched: 1, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER, BEARER));
      // 上游自己没截断，但我们知道只查了 2 个 Run 里的 1 个。
      expect(data).toMatchObject({ credits: 1, matched: 1, runCount: 2, truncated: true });
    });

    it("truncated 原样透传——翻页到顶时 credits 是下界，不能说成确切花费", async () => {
      behaviour = {
        kind: "runs",
        items: [{ run_id: "r1", capability_id: "cap-a", created_at: "2026-08-23T07:00:00Z", finished_at: "2026-08-23T07:00:30Z" }],
      };
      const account = createAccount({ quota: 50_000, matched: 1, truncated: true });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      const data = dataOf(await controller.sessionCredits("s1", "p1", USER, BEARER));
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
        items: [{ run_id: "r1", capability_id: "cap-a", created_at: RUN_START, finished_at: RUN_END }],
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      await controller.sessionCredits("s1", "p1", USER, BEARER);
      expect(account.calls[0]?.window).toEqual({
        maxPages: 10,
        budgetMs: 15_000,
        startTimestamp: startSeconds - SLACK,
        endTimestamp: endSeconds + SLACK,
      });
    });

    // 还在跑的 Run 没有 finished_at：设上界会把正在产生的账单挡在窗外。
    it("只要还有一条 Run 没结束，就不设上界", async () => {
      behaviour = {
        kind: "runs",
        items: [
          { run_id: "r1", capability_id: "cap-a", created_at: RUN_START, finished_at: RUN_END },
          { run_id: "r2", capability_id: "cap-b", created_at: RUN_START },
        ],
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      await controller.sessionCredits("s1", "p1", USER, BEARER);
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
          { run_id: "r1", capability_id: "cap-a", created_at: RUN_START, finished_at: RUN_END },
          { run_id: "r2", capability_id: "cap-b", created_at: earlier, finished_at: RUN_END },
        ],
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      await controller.sessionCredits("s1", "p1", USER, BEARER);
      expect(account.calls[0]?.window?.startTimestamp).toBe(
        Math.floor(Date.parse(earlier) / 1000) - SLACK,
      );
    });

    it("时间全都解析不出来时不设窗，只留翻页上限", async () => {
      behaviour = {
        kind: "runs",
        items: [{ run_id: "r1", capability_id: "cap-a", created_at: "不是时间" }],
      };
      const account = createAccount({ quota: 0, matched: 0, truncated: false });
      const controller = new AgentSessionCreditsController(
        createProject(true) as never,
        account.service as never,
      );

      await controller.sessionCredits("s1", "p1", USER, BEARER);
      expect(account.calls[0]?.window).toEqual({ maxPages: 10, budgetMs: 15_000 });
    });
  });
});
