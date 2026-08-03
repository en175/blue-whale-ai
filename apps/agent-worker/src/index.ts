import {
  createFakeAgentAdapter,
  createSkillSummarizeChatClient,
  createSkillSummarizePipeline,
  createUnavailableSkillSummarizePipeline,
  loadSkillSummarizeRules,
  SkillNameTakenError,
  type SkillSummarizePipeline,
} from "@blue-whale/agent-runtime";
import { readinessResponseSchema } from "@blue-whale/contracts";
import { checkReadiness } from "@blue-whale/core";
import {
  createAgentRunRepo,
  createMySqlPool,
  createMySqlReadinessProbe,
  createSkillRepo,
  createSkillSummarizeRepo,
  getPrismaClient,
  SkillNameConflictError,
  SkillNameReservedError,
  type PrismaClient,
} from "@blue-whale/persistence";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { runAgentWorkerLoop } from "./worker-loop.js";
import { validateAgentWorkerStartup } from "./startup.js";

validateAgentWorkerStartup();

if ((process.env.AGENT_RUNTIME_MODE ?? "fake") !== "fake") {
  throw new Error("Slice 0 only supports AGENT_RUNTIME_MODE=fake");
}

/** 总结管道接线（IK60X1，契约 §15.2）：env 缺 NEW_API_BASE_URL /
 *  NEW_API_ROOT_ACCESS_TOKEN / SKILL_SUMMARIZE_MODEL 时走兜底管道——
 *  总结意图返回失败说明（§15.3 失败分支），确认模式关闭不拦截普通消息。 */
function wireSkillSummarize(prisma: PrismaClient): SkillSummarizePipeline {
  const baseUrl = process.env.NEW_API_BASE_URL?.trim();
  const token = process.env.NEW_API_ROOT_ACCESS_TOKEN?.trim();
  const model = process.env.SKILL_SUMMARIZE_MODEL?.trim();
  if (!baseUrl || !token || !model) {
    return createUnavailableSkillSummarizePipeline();
  }
  const skillRepo = createSkillRepo(prisma);
  return createSkillSummarizePipeline({
    chat: createSkillSummarizeChatClient({ baseUrl, token, model }),
    store: createSkillSummarizeRepo(prisma),
    skills: {
      async createPersonalSkill(userId, input) {
        try {
          return await skillRepo.createPersonalSkill(userId, input);
        } catch (error) {
          // 冲突语义映射（§15.3）：100101/100102 → 管道的提议名分支。
          if (
            error instanceof SkillNameConflictError ||
            error instanceof SkillNameReservedError
          ) {
            throw new SkillNameTakenError(error.message);
          }
          throw error;
        }
      },
      checkPersonalNameAvailable: (userId, name) =>
        skillRepo.checkPersonalNameAvailable(userId, name),
    },
    rules: loadSkillSummarizeRules(),
  });
}

const pool = createMySqlPool();
const mysql = createMySqlReadinessProbe(pool);
const runtime = createFakeAgentAdapter();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL required");
}
const prisma = getPrismaClient(databaseUrl);
const workerAbort = new AbortController();
const rawLeaseMs = Number.parseInt(process.env.AGENT_LEASE_MS ?? "", 10);
const workerLoop = runAgentWorkerLoop({
  repo: createAgentRunRepo(prisma),
  runtime,
  summarize: wireSkillSummarize(prisma),
  workerId: process.env.AGENT_WORKER_ID ?? `agent-${randomUUID()}`,
  signal: workerAbort.signal,
  ...(Number.isInteger(rawLeaseMs) && rawLeaseMs > 0
    ? { leaseMs: rawLeaseMs }
    : {}),
});

const server = createServer((request, response) => {
  void (async () => {
    if (request.method !== "GET" || request.url !== "/ready") {
      response.writeHead(404).end();
      return;
    }

    const report = readinessResponseSchema.parse(
      await checkReadiness("agent-worker", [
        mysql,
        { name: runtime.name, check: () => runtime.ready() },
      ]),
    );
    response.writeHead(report.status === "ready" ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(report));
  })().catch(() => response.writeHead(500).end());
});

async function shutdown(): Promise<void> {
  workerAbort.abort();
  await workerLoop;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}

server.listen(
  Number.parseInt(process.env.PORT ?? "4001", 10),
  process.env.HOST ?? "0.0.0.0",
);
