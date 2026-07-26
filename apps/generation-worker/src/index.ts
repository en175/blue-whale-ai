import { readinessResponseSchema } from "@blue-whale/contracts";
import { checkReadiness } from "@blue-whale/core";
import { createFakeGenerationAdapter } from "@blue-whale/generation-runtime";
import {
  createMySqlPool,
  createMySqlReadinessProbe,
} from "@blue-whale/persistence";
import { createServer } from "node:http";

if ((process.env.GENERATION_RUNTIME_MODE ?? "fake") !== "fake") {
  throw new Error("Slice 0 only supports GENERATION_RUNTIME_MODE=fake");
}

const pool = createMySqlPool();
const mysql = createMySqlReadinessProbe(pool);
const runtime = createFakeGenerationAdapter();

const server = createServer((request, response) => {
  void (async () => {
    if (request.method !== "GET" || request.url !== "/ready") {
      response.writeHead(404).end();
      return;
    }

    const report = readinessResponseSchema.parse(
      await checkReadiness("generation-worker", [
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
  Number.parseInt(process.env.PORT ?? "4002", 10),
  process.env.HOST ?? "0.0.0.0",
);
