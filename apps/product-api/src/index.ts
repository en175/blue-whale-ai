import { readinessResponseSchema } from "@blue-whale/contracts";
import { checkReadiness } from "@blue-whale/core";
import {
  createMySqlPool,
  createMySqlReadinessProbe,
} from "@blue-whale/persistence";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

const pool = createMySqlPool();
const app = Fastify({ logger: true });
const mysql = createMySqlReadinessProbe(pool);

async function handleReadiness(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const report = readinessResponseSchema.parse(
    await checkReadiness("product-api", [mysql]),
  );
  return reply.code(report.status === "ready" ? 200 : 503).send(report);
}

app.get("/ready", handleReadiness);
app.get("/api/ready", handleReadiness);

async function shutdown(): Promise<void> {
  await app.close();
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
await app.listen({ host: process.env.HOST ?? "0.0.0.0", port });
