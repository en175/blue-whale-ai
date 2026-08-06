import { createFakeAgentAdapter } from "@blue-whale/agent-runtime";
import { readinessResponseSchema } from "@blue-whale/contracts";
import { checkReadiness } from "@blue-whale/core";
import {
  TRACE_ID_HEADER,
  closeDefaultTlsLogWriter,
  createLogger,
  getOrCreateTraceId,
  runWithTraceId,
} from "@blue-whale/core/logging";
import {
  createAgentRunRepo,
  createMySqlPool,
  createMySqlReadinessProbe,
  getPrismaClient,
} from "@blue-whale/persistence";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { runAgentWorkerLoop } from "./worker-loop.js";

if ((process.env.AGENT_RUNTIME_MODE ?? "fake") !== "fake") {
  throw new Error("Slice 0 only supports AGENT_RUNTIME_MODE=fake");
}

const logger = createLogger("agent-worker");

const pool = createMySqlPool();
const mysql = createMySqlReadinessProbe(pool);
const runtime = createFakeAgentAdapter();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL required");
}
const workerAbort = new AbortController();
const workerLoop = runAgentWorkerLoop({
  repo: createAgentRunRepo(getPrismaClient(databaseUrl)),
  runtime,
  workerId: process.env.AGENT_WORKER_ID ?? `agent-${randomUUID()}`,
  signal: workerAbort.signal,
});

const server = createServer((request, response) => {
  // 透传优先：入站 X-Trace-Id 沿用，缺省生成，注入异步链路上下文（IK6KQQ）。
  const headerValue = request.headers[TRACE_ID_HEADER];
  const inboundTraceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  void runWithTraceId(getOrCreateTraceId(inboundTraceId), async () => {
    try {
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
    } catch {
      response.writeHead(500).end();
    }
  });
});

async function shutdown(): Promise<void> {
  workerAbort.abort();
  await workerLoop;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
  await closeDefaultTlsLogWriter();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}

const port = Number.parseInt(process.env.PORT ?? "4001", 10);
const host = process.env.HOST ?? "0.0.0.0";
server.listen(port, host, () => {
  logger.info(`agent-worker listening on ${host}:${port}`);
});
