import "reflect-metadata";
import express from "express";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { NewApiError } from "@lib/core";
import { closeDefaultTlsLogWriter } from "@lib/core/logging";
import { traceMiddleware } from "@lib/infra/middleware/trace.middleware.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { AppModule } from "./app.module.js";
import {
  assertAgentModelGatewayConfig,
  drainAgentModelStreams,
} from "./api/agent/agent-model-gateway.controller.js";

const port = Number.parseInt(process.env.PORT ?? "3100", 10);

async function bootstrap(): Promise<void> {
  // 模型网关凭证在这里查，不留到第一个请求才发现（IKCGDX review）。前缀配错会让整条
  // 网关路径静默失效，所以那一种直接拒绝启动。
  assertAgentModelGatewayConfig();

  // `bodyParser: false` 是下面那两个解析器能按注册顺序生效的前提。
  //
  // NestJS 自带的 body parser 不是"后注册就后跑"——它在 `init()` 时装到用户中间件**之前**，
  // 于是 `app.useBodyParser("json", { limit })` 无论写在哪一行，都会先把请求流读掉。此前
  // 这里靠"先注册先命中"给 agent-model 单独放开 64MB，那行实际从未生效：实测本地打
  // 1.9MB 进 /api/internal/agent-model 仍然 `PayloadTooLargeError`，抛错的是全局 1MB 的
  // jsonParser。关掉自带的，改为下面手工注册，顺序才真的说了算。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // 入站 trace 上下文（IK9RSS）：在所有路由处理前注入 x-trace-id → ALS，
  // 使下游 getCurrentTraceId() 可用，出站 X-Trace-Id 透传、结构化日志 trace_id 有值。
  app.use(traceMiddleware);

  // 解析会话 cookie（HttpOnly 登录态，ADR-0062 #19 凭证分层）。
  app.use(cookieParser());

  // 前端 apiFetch 走 /api/... 前缀（对齐 blue_whale_web/app/api 路由）。
  app.setGlobalPrefix("api");

  // Agent 多模态透传（IKAL46）：读图/读视频时 Mastra 会把素材下载后以 base64 内联进
  // chat/completions 请求体，一张 8MB 的图编码后就有 ~11MB。这条内部代理必须放到与
  // Agent 侧媒体策略 `requestBodyMaxBytes`（64MB）一致的上限，否则请求在 body-parser
  // 就被 PayloadTooLargeError 挡下，表现为模型网关 500、Agent 侧「读不到图」。
  //
  // 只对这一条内部路由放开，而不是抬高全局上限——其余端点没有理由接收几十 MB 的体。
  // 注册在全局解析器之前：先命中的解析器填好 req.body，后面那个看到流已被消费就跳过。
  // 这个顺序只有在 `bodyParser: false` 之下才成立，见上面 NestFactory.create 的说明。
  app.use("/api/internal/agent-model", express.json({ limit: "64mb" }));

  // 对齐原 BFF：文生文透传上限 1MB（TEXT_MAX_BODY_BYTES）；框架默认 100kb 会先于
  // 控制器内的 OpenAI 形 413 拦截，导致 100kb–1MB 体返回错误响应形态。
  // Canvas JSON is itself a string in the envelope; allow escaping overhead for the 4 MiB document contract.
  app.use("/api/canvases", express.json({ limit: "16mb" }));
  app.use(express.json({ limit: "1mb" }));
  // urlencoded 随之一并手工注册：关掉自带 parser 之后它也没了，而表单端点还在用。
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

  // 这里曾有 `app.enableShutdownHooks()`。它只做一件事：替我们监听 SIGTERM/SIGINT 然后调
  // `app.close()`。而下面本来就有一对自己的处理器做同样的事——两份监听器在同一个信号上并发
  // 跑，Nest 那份会立刻开始 `callDestroyHook()` 关掉 Redis，把我们刚开始的排空连同进程一起
  // 掀翻（IKHCJ2，见下面 shutdown 的说明）。生命周期钩子由 `app.close()` 照常触发，不受影响。

  await app.listen(port);
  logger.info(`backend listening on :${port}`);

  // 优雅停机（IK9RSS）：app.close() 触发 OnModuleDestroy 链，之后冲刷 TLS 缓冲。
  // closeDefaultTlsLogWriter 自带 5s 超时，TLS 不可达不反噬进程退出。
  //
  // **排空必须排在 app.close() 之前**（IKHCJ2）。Nest 的停机顺序是 onModuleDestroy →
  // beforeApplicationShutdown → 关 HTTP server，第一步就把 Redis 关了；在途请求挂着的 Redis
  // 命令被 ioredis 的 flushQueue 以一个未处理的拒绝掀翻，整个进程当场死。2026-09-20 实测：
  // 排空日志打出了「在途 1 条，最多等 90000ms」，0.2 秒后进程就没了，ioredis 的堆栈留在
  // stdout 上。所以在途模型流不能靠 Nest 的生命周期排空，只能在它开始拆之前排干净。
  const shutdown = async (): Promise<void> => {
    await drainAgentModelStreams();
    await app.close();
    await closeDefaultTlsLogWriter(5_000);
    // 显式退出：没有 Nest 的信号处理器之后，没人再把信号重新抛一次，而残留的句柄
    // （连接池、计时器）足以让进程挂到容器的停止超时被 SIGKILL。
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void bootstrap();
