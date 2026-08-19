import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { NewApiError } from "@blue-whale/core";
import { closeDefaultTlsLogWriter } from "@blue-whale/core/logging";
import { traceMiddleware } from "@lib/infra/middleware/trace.middleware.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { AppModule } from "./app.module.js";

const port = Number.parseInt(process.env.PORT ?? "3100", 10);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 入站 trace 上下文（IK9RSS）：在所有路由处理前注入 x-trace-id → ALS，
  // 使下游 getCurrentTraceId() 可用，出站 X-Trace-Id 透传、结构化日志 trace_id 有值。
  app.use(traceMiddleware);

  // 前端 apiFetch 走 /api/... 前缀（对齐 blue_whale_web/app/api 路由）。
  app.setGlobalPrefix("api");

  // 对齐原 BFF：文生文透传上限 1MB（TEXT_MAX_BODY_BYTES）；框架默认 100kb 会先于
  // 控制器内的 OpenAI 形 413 拦截，导致 100kb–1MB 体返回错误响应形态。
  app.useBodyParser("json", { limit: "1mb" });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) => {
        const first = errors[0];
        const message = first
          ? Object.values(first.constraints ?? {})[0]
          : undefined;
        return new NewApiError(message ?? "参数校验失败", 400, "validation_error");
      },
    }),
  );

  app.enableShutdownHooks();

  await app.listen(port);
  logger.info(`backend listening on :${port}`);

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
