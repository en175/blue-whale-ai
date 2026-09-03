import "reflect-metadata";
// 服务名要在任何模块顶层建 logger 之前落定，所以它排在业务 import 前面。
import "./service-identity.js";
import { NestFactory } from "@nestjs/core";
import {
  closeDefaultTlsLogWriter,
  createLogger,
} from "@blue-whale/core/logging";
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

  app.enableShutdownHooks();

  await app.listen(port, process.env.HOST ?? "0.0.0.0");
  logger.info(`generation-worker listening on :${port}`);

  // 优雅停机（IK9RSS）：app.close() 触发 OnModuleDestroy 链，之后冲刷 TLS 缓冲。
  // closeDefaultTlsLogWriter 自带 5s 超时，TLS 不可达不反噬进程退出。
  const shutdown = async (): Promise<void> => {
    await app.close();
    await closeDefaultTlsLogWriter(5_000);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void bootstrap();
