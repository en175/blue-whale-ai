import "reflect-metadata";
import express from "express";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { NewApiError } from "@lib/core";
import { closeDefaultTlsLogWriter } from "@lib/core/logging";
import { missingBillingConfig } from "@lib/shared/billing/billing-client.js";
import { assertClockAgreement } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { traceMiddleware } from "@lib/infra/middleware/trace.middleware.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { AppModule } from "./app.module.js";
import { drainAgentModelStreams } from "./api/agent/agent-model-gateway.controller.js";

const port = Number.parseInt(process.env.PORT ?? "3100", 10);

const APP_CLOSE_TIMEOUT_MS = Number(process.env.SHUTDOWN_APP_CLOSE_TIMEOUT_MS) || 10_000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.use(traceMiddleware);

  app.use(cookieParser());

  app.setGlobalPrefix("api");

  app.use("/api/internal/agent-model", express.json({ limit: "64mb" }));

  app.use("/api/canvases", express.json({ limit: "16mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

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


  const missingBilling = missingBillingConfig();
  if (missingBilling.length > 0) {
    logger.error(
      `启动中止：计费依赖未配置（缺 ${missingBilling.join(" / ")}）。` +
        `new-api 已切断，缺它会让生成不扣费。`,
    );
    process.exit(1);
  }

  try {
    await assertClockAgreement(app.get(PrismaService).client);
  } catch (error) {
    logger.error(
      `启动中止：${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  await app.listen(port);
  logger.info(`backend listening on :${port}`);

  const shutdown = async (): Promise<void> => {
    await drainAgentModelStreams();

    const closed = await Promise.race([
      app.close().then(() => true as const),
      new Promise<false>(resolve => setTimeout(() => resolve(false), APP_CLOSE_TIMEOUT_MS)),
    ]);
    if (!closed) {
      logger.warn(
        `[shutdown] app.close() ${APP_CLOSE_TIMEOUT_MS}ms 未返回，强断残留连接后继续退出`,
        { event: "shutdown.app_close_timeout", app_close_timeout_ms: APP_CLOSE_TIMEOUT_MS },
      );
      try {
        (app.getHttpServer() as { closeAllConnections?: () => void }).closeAllConnections?.();
      } catch {
      }
    }

    await closeDefaultTlsLogWriter(5_000);
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void bootstrap();
