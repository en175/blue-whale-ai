import { createFakeAgentAdapter } from "@blue-whale/agent-runtime";
import { readinessResponseSchema } from "@blue-whale/contracts";
import { checkReadiness } from "@blue-whale/core";
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

const pool = createMySqlPool();
const mysql = createMySqlReadinessProbe(pool);
const runtime = createFakeAgentAdapter();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL required");
}
const workerAbort = new AbortController();
const rawLeaseMs = Number.parseInt(process.env.AGENT_LEASE_MS ?? "", 10);
const workerLoop = runAgentWorkerLoop({
  repo: createAgentRunRepo(getPrismaClient(databaseUrl)),
  runtime,
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
