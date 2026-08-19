import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createLogger } from "@blue-whale/core/logging";
import { traceMiddleware } from "@lib/infra/middleware/trace.middleware.js";
import { GenerationWorkerModule } from "./generation-worker.module.js";

const logger = createLogger("generation-worker");

const port = Number.parseInt(
  process.env.GENERATION_WORKER_PORT ?? "4002",
  10,
);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(GenerationWorkerModule);

  // 入站 trace 上下文（IK9RSS）：健康检查/外部 HTTP 入口也需要 trace_id。
  app.use(traceMiddleware);

  await app.listen(port, process.env.HOST ?? "0.0.0.0");
  logger.info(`generation-worker listening on :${port}`);
}

void bootstrap();
