import { Worker } from "bullmq";
import { createServer } from "node:http";
import { hostname } from "node:os";

import { openGenerationCredential } from "@blue-whale/core";
import {
  createNewApiVideoTaskProvider,
  createTosVideoMediaRelay,
  loadGenerationTosConfig,
  runVideoJobStep,
} from "@blue-whale/generation-runtime";
import { createWorkerRepo, getPrismaClient } from "@blue-whale/persistence";

import {
  VIDEO_GENERATION_QUEUE,
  closeVideoGenerationQueue,
  enqueueVideoGenerationJob,
  loadRedisConnection,
} from "../lib/generation/video-queue.js";
import {
  createVideoJobProcessor,
  recoverDueVideoJobs,
} from "../lib/generation/video-worker.js";

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = process.env.NEW_API_BASE_URL;
const tosConfig = loadGenerationTosConfig();
if (!databaseUrl) throw new Error("DATABASE_URL required");
if (!baseUrl) throw new Error("NEW_API_BASE_URL required");
if (!tosConfig) throw new Error("TOS configuration required");

const credentialSecret =
  process.env.GENERATION_CREDENTIAL_SECRET ??
  process.env.JWT_SECRET ??
  "blue-whale-dev-secret-key-at-least-256-bits!!";
const prisma = getPrismaClient(databaseUrl);
const repo = createWorkerRepo(prisma);
const mediaRelay = createTosVideoMediaRelay(tosConfig);
const workerId = `generation-${hostname()}-${process.pid}`;
const producer = { enqueue: enqueueVideoGenerationJob };

const processor = createVideoJobProcessor({
  runStep: (jobId) =>
    runVideoJobStep({
      repo,
      workerId,
      jobId,
      createProvider: (token) =>
        createNewApiVideoTaskProvider({ baseUrl, token }),
      credentialVault: {
        open: (ciphertext) =>
          openGenerationCredential(ciphertext, credentialSecret),
      },
      mediaRelay,
      scheduleNext: (id, delayMs) =>
        enqueueVideoGenerationJob(id, { delayMs }),
    }),
});

const worker = new Worker(VIDEO_GENERATION_QUEUE, processor, {
  connection: loadRedisConnection(process.env, true),
  concurrency: Number.parseInt(process.env.GENERATION_WORKER_CONCURRENCY ?? "8", 10),
});

worker.on("failed", (job, error) => {
  console.error(
    `[generation-worker] BullMQ job ${job?.id ?? "unknown"} failed:`,
    error.message,
  );
});
// Redis 连接/消费者级错误必须显式监听，否则 Node 默认会把无 listener 的 'error' 事件抛成崩溃，
// 或静默丢消费者（job 全孤儿、看似 /ready 却不消费）。
worker.on("error", (error) => {
  console.error("[generation-worker] worker error:", error.message);
});

await worker.waitUntilReady();
await recoverDueVideoJobs(repo, producer);
const recoveryTimer = setInterval(() => {
  void recoverDueVideoJobs(repo, producer).catch((error) =>
    console.error(
      "[generation-worker] recovery scan failed:",
      error instanceof Error ? error.message : "unknown",
    ),
  );
}, Number.parseInt(process.env.GENERATION_RECOVERY_INTERVAL_MS ?? "60000", 10));

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/ready") {
    response.writeHead(worker.isRunning() ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify({ status: worker.isRunning() ? "ready" : "not_ready" }));
    return;
  }
  response.writeHead(404).end();
});

server.listen(
  Number.parseInt(process.env.GENERATION_WORKER_PORT ?? "4002", 10),
  process.env.HOST ?? "0.0.0.0",
);

async function shutdown(): Promise<void> {
  clearInterval(recoveryTimer);
  await worker.close();
  await closeVideoGenerationQueue();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}
